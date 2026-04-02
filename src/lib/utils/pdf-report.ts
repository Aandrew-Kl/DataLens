import { assessDataQuality } from "@/lib/utils/data-quality";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";

const integerFormatter = new Intl.NumberFormat("en-US");
const decimalFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const percentFormatter = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const longDateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "long" });
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCount(value: number): string {
  return integerFormatter.format(value);
}

function formatDecimal(value: number): string {
  return decimalFormatter.format(value);
}

function formatPercent(numerator: number, denominator: number): string {
  return denominator <= 0 ? "0%" : percentFormatter.format(numerator / denominator);
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const scaled = bytes / 1024 ** exponent;
  return `${scaled.toFixed(scaled >= 100 ? 0 : 1)} ${units[exponent]}`;
}

function formatScalar(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "number") return Number.isInteger(value) ? formatCount(value) : formatDecimal(value);
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

function formatTemporal(value: number | string | undefined): string {
  if (value === undefined) return "Not available";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : dateTimeFormatter.format(parsed);
}

function getQualityLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Moderate";
  return "Needs Attention";
}

function getSeverityRank(severity: "low" | "medium" | "high"): number {
  if (severity === "high") return 0;
  if (severity === "medium") return 1;
  return 2;
}

function buildColumnStats(column: ColumnProfile): Array<[string, string]> {
  switch (column.type) {
    case "number":
      return [
        ["Minimum", formatScalar(column.min)],
        ["Maximum", formatScalar(column.max)],
        ["Mean", column.mean !== undefined ? formatDecimal(column.mean) : "Not available"],
        ["Median", column.median !== undefined ? formatDecimal(column.median) : "Not available"],
      ];
    case "date":
      return [
        ["Earliest", formatTemporal(column.min)],
        ["Latest", formatTemporal(column.max)],
      ];
    case "boolean":
      return [[
        "Observed Values",
        column.sampleValues.length > 0
          ? column.sampleValues.map((value) => formatScalar(value)).join(", ")
          : "Not available",
      ]];
    case "string":
      return [[
        "Representative Samples",
        column.sampleValues.length > 0
          ? column.sampleValues.map((value) => formatScalar(value)).join(", ")
          : "Not available",
      ]];
    default:
      return [["Inference", "Column type could not be determined confidently"]];
  }
}

function renderLogo(): string {
  return `
    <div class="brand-lockup">
      <svg class="brand-mark" viewBox="0 0 80 80" aria-hidden="true">
        <defs><linearGradient id="datalens-logo" x1="0%" x2="100%" y1="0%" y2="100%"><stop offset="0%" stop-color="#7dd3fc" /><stop offset="100%" stop-color="#22c55e" /></linearGradient></defs>
        <rect x="6" y="6" width="68" height="68" rx="20" fill="#0f172a" />
        <circle cx="40" cy="40" r="22" fill="none" stroke="url(#datalens-logo)" stroke-width="8" />
        <path d="M40 18v44M18 40h44" stroke="#e2e8f0" stroke-linecap="round" stroke-width="4.5" />
      </svg>
      <div><div class="brand-name">DataLens</div><div class="brand-tagline">Dataset Profiling Report</div></div>
    </div>
  `;
}

function renderColumnCard(column: ColumnProfile, rowCount: number, index: number): string {
  const nonNullCount = Math.max(rowCount - column.nullCount, 0);
  const stats = buildColumnStats(column)
    .map(([label, value]) => `<div class="stat-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
  const samples = column.sampleValues.length > 0
    ? column.sampleValues
        .slice(0, 6)
        .map((value) => `<span class="sample-chip">${escapeHtml(formatScalar(value))}</span>`)
        .join("")
    : '<span class="sample-chip muted-chip">No sample values captured</span>';

  return `
    <article class="profile-card">
      <div class="profile-head">
        <div><div class="profile-index">Column ${index + 1}</div><h3>${escapeHtml(column.name)}</h3></div>
        <span class="type-pill">${escapeHtml(column.type)}</span>
      </div>
      <div class="profile-metrics">
        <div class="mini-metric"><span>Nulls</span><strong>${escapeHtml(formatCount(column.nullCount))}</strong><small>${escapeHtml(formatPercent(column.nullCount, rowCount))}</small></div>
        <div class="mini-metric"><span>Unique</span><strong>${escapeHtml(formatCount(column.uniqueCount))}</strong><small>${escapeHtml(formatPercent(column.uniqueCount, Math.max(nonNullCount, 1)))}</small></div>
        <div class="mini-metric"><span>Completeness</span><strong>${escapeHtml(formatPercent(nonNullCount, Math.max(rowCount, 1)))}</strong><small>${escapeHtml(formatCount(nonNullCount))} non-null values</small></div>
      </div>
      <div class="stats-card">${stats}</div>
      <div class="samples-row">${samples}</div>
    </article>
  `;
}

export function generateProfileReport(
  dataset: DatasetMeta,
  columns: ColumnProfile[],
  rowCount: number,
): string {
  const resolvedColumns = columns.length > 0 ? columns : dataset.columns;
  const resolvedRowCount = rowCount > 0 ? rowCount : dataset.rowCount;
  const generatedAt = new Date();
  const quality = assessDataQuality(resolvedColumns, resolvedRowCount);
  const sortedIssues = [...quality.issues].sort((left, right) => getSeverityRank(left.severity) - getSeverityRank(right.severity));
  const qualityLabel = getQualityLabel(quality.overallScore);
  const nullHeavyColumns = resolvedColumns.filter((column) => column.nullCount > 0).length;
  const unknownColumns = resolvedColumns.filter((column) => column.type === "unknown").length;
  const columnsHtml = resolvedColumns.map((column, index) => renderColumnCard(column, resolvedRowCount, index)).join("");
  const issuesHtml = sortedIssues.length > 0
    ? sortedIssues
        .map((issue) => `
          <li class="issue-item issue-${issue.severity}">
            <div class="issue-topline"><span class="severity-badge">${escapeHtml(issue.severity)}</span><strong>${escapeHtml(issue.column)}</strong></div>
            <p>${escapeHtml(issue.message)}</p>
          </li>
        `)
        .join("")
    : `
      <li class="issue-item issue-clear">
        <div class="issue-topline"><span class="severity-badge">clear</span><strong>No active data quality issues</strong></div>
        <p>${escapeHtml(quality.summary)}</p>
      </li>
    `;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(dataset.name)} - DataLens Profile Report</title>
    <style>
      :root { color-scheme: dark; --bg:#060816; --sheet:#0b1220; --line:rgba(148,163,184,.18); --text:#e2e8f0; --muted:#94a3b8; --accent:#38bdf8; --accent2:#22c55e; --warn:#f59e0b; --danger:#fb7185; --shadow:0 32px 80px rgba(2,6,23,.45); }
      * { box-sizing:border-box; }
      @page { size:A4 portrait; margin:12mm; }
      html, body { margin:0; padding:0; }
      body { background:radial-gradient(circle at top, rgba(56,189,248,.14), transparent 28%), linear-gradient(180deg, #050814, var(--bg)); color:var(--text); font-family:Inter, "Segoe UI", Helvetica, Arial, sans-serif; line-height:1.5; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .report-shell { padding:16px 0 40px; }
      .sheet { width:min(100%, 210mm); min-height:297mm; margin:0 auto 24px; padding:18mm 16mm; position:relative; background:radial-gradient(circle at top right, rgba(34,197,94,.12), transparent 22%), linear-gradient(180deg, rgba(15,23,42,.98), rgba(8,13,25,.99)); border:1px solid rgba(125,211,252,.08); box-shadow:var(--shadow); }
      .sheet::after { content:""; position:absolute; inset:0; border:1px solid rgba(125,211,252,.04); pointer-events:none; }
      .title-sheet { display:flex; flex-direction:column; justify-content:space-between; background:radial-gradient(circle at top right, rgba(34,197,94,.18), transparent 22%), radial-gradient(circle at top left, rgba(56,189,248,.16), transparent 24%), linear-gradient(180deg, #081120, #050814); }
      .brand-lockup, .meta-grid, .summary-grid, .profile-grid { display:grid; gap:16px; }
      .brand-lockup { grid-template-columns:88px 1fr; align-items:center; gap:18px; }
      .brand-mark { width:88px; height:88px; }
      .brand-name { font-size:1.6rem; font-weight:700; letter-spacing:-.03em; }
      .brand-tagline, .section-kicker, .sheet-footer { color:var(--muted); }
      .title-block h1 { margin:18px 0 10px; font-size:2.9rem; line-height:1.02; letter-spacing:-.05em; }
      .title-block p { margin:0; max-width:62ch; color:#cbd5e1; font-size:1.03rem; }
      .meta-grid, .summary-grid { grid-template-columns:repeat(3, minmax(0, 1fr)); margin-top:24px; }
      .meta-card, .summary-card, .profile-card, .issue-item, .stats-card { background:rgba(15,23,42,.72); border:1px solid var(--line); backdrop-filter:blur(8px); }
      .meta-card, .summary-card { padding:16px 18px; }
      .meta-card span, .summary-card span, .mini-metric span { display:block; color:var(--muted); font-size:.76rem; text-transform:uppercase; letter-spacing:.08em; }
      .meta-card strong, .summary-card strong { display:block; margin-top:8px; font-size:1.3rem; letter-spacing:-.03em; }
      .summary-card strong.score { font-size:2rem; }
      .section-kicker { font-size:.78rem; letter-spacing:.14em; text-transform:uppercase; }
      .section-head { margin-bottom:22px; }
      .section-head h2 { margin:10px 0 8px; font-size:2rem; letter-spacing:-.04em; }
      .section-head p { margin:0; max-width:70ch; color:#cbd5e1; }
      .issues-list { list-style:none; padding:0; margin:20px 0 0; display:grid; gap:14px; }
      .issue-item { padding:16px 18px; break-inside:avoid; }
      .issue-topline { display:flex; align-items:center; gap:12px; margin-bottom:8px; }
      .issue-item p { margin:0; color:#d7e1ec; }
      .issue-high { border-left:4px solid var(--danger); }
      .issue-medium { border-left:4px solid var(--warn); }
      .issue-low, .issue-clear { border-left:4px solid var(--accent2); }
      .severity-badge, .type-pill, .sample-chip { display:inline-flex; align-items:center; border-radius:999px; }
      .severity-badge, .type-pill { padding:6px 10px; background:rgba(56,189,248,.12); color:#bae6fd; font-size:.74rem; text-transform:uppercase; letter-spacing:.08em; }
      .profile-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); align-items:start; }
      .profile-card { padding:18px; break-inside:avoid; }
      .profile-head { display:flex; justify-content:space-between; gap:12px; margin-bottom:16px; }
      .profile-index { color:var(--muted); font-size:.76rem; text-transform:uppercase; letter-spacing:.12em; }
      .profile-head h3 { margin:8px 0 0; font-size:1.25rem; line-height:1.15; letter-spacing:-.03em; }
      .profile-metrics { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px; margin-bottom:16px; }
      .mini-metric { padding:12px; background:rgba(148,163,184,.08); border:1px solid rgba(148,163,184,.1); }
      .mini-metric strong { display:block; margin:6px 0 4px; font-size:1.05rem; }
      .mini-metric small, .sheet-footer, .muted-chip { color:var(--muted); }
      .stats-card { padding:12px 14px; }
      .stat-row { display:flex; justify-content:space-between; gap:16px; padding:10px 0; border-bottom:1px solid rgba(148,163,184,.12); }
      .stat-row:last-child { border-bottom:0; }
      .stat-row span { color:var(--muted); }
      .stat-row strong { text-align:right; }
      .samples-row { display:flex; flex-wrap:wrap; gap:8px; margin-top:16px; }
      .sample-chip { padding:7px 11px; background:rgba(34,197,94,.12); border:1px solid rgba(34,197,94,.16); color:#dcfce7; font-size:.83rem; }
      .muted-chip { background:rgba(148,163,184,.08); border-color:rgba(148,163,184,.12); }
      .sheet-footer { margin-top:28px; font-size:.82rem; letter-spacing:.04em; }
      @media (max-width:960px) { .sheet { width:calc(100% - 24px); padding:32px 22px; min-height:auto; } .meta-grid, .summary-grid, .profile-grid, .profile-metrics { grid-template-columns:1fr; } .title-block h1, .section-head h2 { font-size:2rem; } .brand-lockup { grid-template-columns:1fr; } .profile-head, .issue-topline { flex-direction:column; align-items:flex-start; } }
      @media print { body { background:#050814; } .report-shell { padding:0; } .sheet { width:auto; margin:0; box-shadow:none; break-after:page; } }
    </style>
  </head>
  <body>
    <main class="report-shell">
      <section class="sheet title-sheet">
        <div>
          ${renderLogo()}
          <div class="title-block">
            <div class="section-kicker">Prepared for distribution</div>
            <h1>${escapeHtml(dataset.name)}</h1>
            <p>A PDF-style profiling report covering structure, quality indicators, and column-level statistics for ${escapeHtml(dataset.fileName)}.</p>
          </div>
          <div class="meta-grid">
            <div class="meta-card"><span>Generated</span><strong>${escapeHtml(longDateFormatter.format(generatedAt))}</strong></div>
            <div class="meta-card"><span>Uploaded</span><strong>${escapeHtml(formatTemporal(dataset.uploadedAt))}</strong></div>
            <div class="meta-card"><span>Dataset Size</span><strong>${escapeHtml(formatBytes(dataset.sizeBytes))}</strong></div>
          </div>
        </div>
        <div class="sheet-footer">DataLens report ID: ${escapeHtml(dataset.id)}</div>
      </section>
      <section class="sheet">
        <div class="section-head">
          <div class="section-kicker">Executive Summary</div>
          <h2>Dataset health at a glance</h2>
          <p>${escapeHtml(quality.summary)}</p>
        </div>
        <div class="summary-grid">
          <div class="summary-card"><span>Rows</span><strong>${escapeHtml(formatCount(resolvedRowCount))}</strong></div>
          <div class="summary-card"><span>Columns</span><strong>${escapeHtml(formatCount(resolvedColumns.length))}</strong></div>
          <div class="summary-card"><span>Data Quality Score</span><strong class="score">${escapeHtml(formatCount(quality.overallScore))}/100</strong></div>
          <div class="summary-card"><span>Quality Band</span><strong>${escapeHtml(qualityLabel)}</strong></div>
          <div class="summary-card"><span>Columns With Nulls</span><strong>${escapeHtml(formatCount(nullHeavyColumns))}</strong></div>
          <div class="summary-card"><span>Unknown Types</span><strong>${escapeHtml(formatCount(unknownColumns))}</strong></div>
        </div>
        <div class="section-head" style="margin-top:34px;">
          <div class="section-kicker">Data Quality Issues</div>
          <h2>Actionable findings</h2>
          <p>Review these items before downstream analysis, dashboarding, or model training.</p>
        </div>
        <ul class="issues-list">${issuesHtml}</ul>
        <div class="sheet-footer">${escapeHtml(dataset.name)} • ${escapeHtml(formatCount(resolvedRowCount))} rows • Generated ${escapeHtml(formatTemporal(generatedAt.toISOString()))}</div>
      </section>
      <section class="sheet">
        <div class="section-head">
          <div class="section-kicker">Column Profiles</div>
          <h2>Field-by-field breakdown</h2>
          <p>Each card summarizes inferred type, completeness, uniqueness, and captured distribution statistics for a profiled column.</p>
        </div>
        <div class="profile-grid">${columnsHtml}</div>
        <div class="sheet-footer">Column count: ${escapeHtml(formatCount(resolvedColumns.length))} • Source file: ${escapeHtml(dataset.fileName)}</div>
      </section>
    </main>
  </body>
</html>`;
}
