import type { ReportConfig } from "@/types/report";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function toNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatMetricValue(value: unknown, format?: string): string {
  const numeric = toNumeric(value);

  if (numeric === null) return formatCell(value);

  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(numeric);
    case "percent":
      return new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 2,
      }).format(numeric);
    case "compact":
      return new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(numeric);
    default:
      return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
      }).format(numeric);
  }
}

function renderTextContent(content: string): string {
  const blocks = content
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return '<p class="muted">No content provided.</p>';
  }

  return blocks
    .map((block) => {
      const lines = block
        .split("\n")
        .map((line) => escapeHtml(line.trim()))
        .filter(Boolean)
        .join("<br />");

      return `<p>${lines}</p>`;
    })
    .join("");
}

function renderDataTable(
  rows: Record<string, unknown>[],
  numericKey?: string,
): string {
  if (rows.length === 0) {
    return '<div class="empty-state">No rows returned for this widget.</div>';
  }

  const headers = Object.keys(rows[0]);
  const chartKey = numericKey && headers.includes(numericKey) ? numericKey : undefined;
  const numericValues = chartKey
    ? rows
        .map((row) => toNumeric(row[chartKey]))
        .filter((value): value is number => value !== null)
    : [];
  const maxValue =
    numericValues.length > 0
      ? Math.max(...numericValues.map((value) => Math.abs(value)), 1)
      : 1;

  const tableHead = headers
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join("");

  const rowsHtml = rows
    .map((row, index) => {
      const cells = headers
        .map((header) => `<td>${escapeHtml(formatCell(row[header]))}</td>`)
        .join("");

      const chartCell = chartKey
        ? (() => {
            const numeric = toNumeric(row[chartKey]);
            const width =
              numeric === null ? 0 : Math.max((Math.abs(numeric) / maxValue) * 100, 2);

            return `
              <td class="bar-cell">
                <div class="bar-track">
                  <div class="bar-fill" style="width:${width}%"></div>
                </div>
                <span class="bar-label">${escapeHtml(formatCell(row[chartKey]))}</span>
              </td>
            `;
          })()
        : "";

      return `<tr><td class="row-index">${index + 1}</td>${cells}${chartCell}</tr>`;
    })
    .join("");

  return `
    <table class="chart-table">
      <thead>
        <tr>
          <th>#</th>
          ${tableHead}
          ${chartKey ? "<th>Visual</th>" : ""}
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

export function generateReportHTML(
  config: ReportConfig,
  data: Record<string, Record<string, unknown>[]>,
): string {
  const widgetCards = config.widgets
    .map((widget) => {
      if (widget.type === "text") {
        return `
          <section class="widget widget-text">
            <div class="widget-head">
              <span class="eyebrow">Narrative</span>
              <h2>Text Block</h2>
            </div>
            <div class="rich-text">
              ${renderTextContent(widget.content)}
            </div>
          </section>
        `;
      }

      const rows = data[widget.id] ?? [];
      const errorMessage =
        rows.length > 0 && typeof rows[0].__error === "string"
          ? String(rows[0].__error)
          : null;

      if (widget.type === "metric") {
        const firstRow = rows[0];
        const firstValue =
          firstRow && !errorMessage ? Object.values(firstRow)[0] : undefined;

        return `
          <section class="widget widget-metric">
            <div class="widget-head">
              <span class="eyebrow">KPI</span>
              <h2>${escapeHtml(widget.label)}</h2>
            </div>
            ${
              errorMessage
                ? `<p class="error-text">${escapeHtml(errorMessage)}</p>`
                : `<p class="metric-value">${escapeHtml(
                    formatMetricValue(firstValue, widget.format),
                  )}</p>`
            }
          </section>
        `;
      }

      return `
        <section class="widget widget-chart">
          <div class="widget-head">
            <div>
              <span class="eyebrow">${escapeHtml(widget.chartType)} chart</span>
              <h2>${escapeHtml(widget.title)}</h2>
            </div>
            <div class="meta-pill">
              ${escapeHtml(widget.xAxis)} x ${escapeHtml(widget.yAxis)}
            </div>
          </div>
          ${
            errorMessage
              ? `<p class="error-text">${escapeHtml(errorMessage)}</p>`
              : renderDataTable(rows, widget.yAxis)
          }
          <pre class="sql-block">${escapeHtml(widget.sql)}</pre>
        </section>
      `;
    })
    .join("");

  const chartCount = config.widgets.filter((widget) => widget.type === "chart").length;
  const metricCount = config.widgets.filter((widget) => widget.type === "metric").length;
  const textCount = config.widgets.filter((widget) => widget.type === "text").length;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(config.title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f7fb;
        --panel: rgba(255, 255, 255, 0.94);
        --panel-border: rgba(148, 163, 184, 0.24);
        --text: #0f172a;
        --muted: #64748b;
        --line: #e2e8f0;
        --accent: #2563eb;
        --accent-soft: rgba(37, 99, 235, 0.12);
        --accent-strong: linear-gradient(135deg, #2563eb, #0f766e);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background:
          radial-gradient(circle at top left, rgba(59, 130, 246, 0.12), transparent 28%),
          linear-gradient(180deg, #f8fafc, var(--bg));
        color: var(--text);
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
          sans-serif;
        line-height: 1.55;
      }

      .page {
        max-width: 1120px;
        margin: 0 auto;
        padding: 48px 32px 72px;
      }

      .hero {
        padding: 32px 36px;
        border-radius: 28px;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(255, 255, 255, 0.84));
        border: 1px solid var(--panel-border);
        box-shadow: 0 28px 80px rgba(15, 23, 42, 0.08);
      }

      .hero h1 {
        margin: 0 0 10px;
        font-size: 2.35rem;
        line-height: 1.05;
        letter-spacing: -0.04em;
      }

      .hero p {
        margin: 0;
        max-width: 70ch;
        color: var(--muted);
        font-size: 1.02rem;
      }

      .hero-meta,
      .summary-grid {
        display: grid;
        gap: 14px;
      }

      .hero-meta {
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        margin-top: 28px;
      }

      .summary-grid {
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        margin: 28px 0 0;
      }

      .meta-card,
      .summary-card,
      .widget {
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 22px;
      }

      .meta-card,
      .summary-card {
        padding: 18px 20px;
      }

      .summary-card strong,
      .meta-card strong {
        display: block;
        margin-top: 6px;
        font-size: 1.5rem;
        letter-spacing: -0.03em;
      }

      .section-grid {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 18px;
        margin-top: 28px;
      }

      .widget {
        grid-column: span 12;
        padding: 24px;
        break-inside: avoid;
        box-shadow: 0 18px 42px rgba(15, 23, 42, 0.04);
      }

      .widget-metric {
        grid-column: span 4;
        min-height: 180px;
      }

      .widget-text {
        grid-column: span 12;
      }

      .widget-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 18px;
      }

      .widget-head h2 {
        margin: 4px 0 0;
        font-size: 1.2rem;
        letter-spacing: -0.03em;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        padding: 5px 10px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 0.74rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .meta-pill {
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid var(--line);
        color: var(--muted);
        font-size: 0.86rem;
        white-space: nowrap;
      }

      .metric-value {
        margin: 18px 0 0;
        font-size: 2.35rem;
        font-weight: 800;
        line-height: 1;
        letter-spacing: -0.05em;
      }

      .rich-text p {
        margin: 0 0 1rem;
        color: #1e293b;
      }

      .chart-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.94rem;
        overflow: hidden;
      }

      .chart-table th,
      .chart-table td {
        padding: 12px 10px;
        text-align: left;
        vertical-align: middle;
        border-bottom: 1px solid var(--line);
      }

      .chart-table thead th {
        background: rgba(248, 250, 252, 0.92);
        color: var(--muted);
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .chart-table tbody tr:nth-child(even) td {
        background: rgba(248, 250, 252, 0.55);
      }

      .row-index {
        color: var(--muted);
        width: 48px;
      }

      .bar-cell {
        min-width: 220px;
      }

      .bar-track {
        height: 10px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.18);
        overflow: hidden;
      }

      .bar-fill {
        height: 100%;
        border-radius: 999px;
        background: var(--accent-strong);
      }

      .bar-label {
        display: inline-block;
        margin-top: 8px;
        color: var(--muted);
        font-size: 0.8rem;
      }

      .sql-block {
        margin: 18px 0 0;
        padding: 14px 16px;
        border-radius: 16px;
        background: #f8fafc;
        border: 1px solid var(--line);
        overflow-x: auto;
        color: #0f172a;
        font-size: 0.82rem;
      }

      .empty-state,
      .error-text,
      .muted {
        color: var(--muted);
      }

      .error-text {
        color: #b91c1c;
        font-weight: 600;
      }

      @media (max-width: 900px) {
        .page {
          padding: 28px 18px 48px;
        }

        .hero {
          padding: 24px;
          border-radius: 22px;
        }

        .hero h1 {
          font-size: 1.85rem;
        }

        .widget-metric {
          grid-column: span 12;
        }

        .widget-head {
          flex-direction: column;
        }

        .meta-pill {
          white-space: normal;
        }
      }

      @media print {
        body {
          background: #ffffff;
        }

        .page {
          max-width: none;
          padding: 0;
        }

        .hero,
        .widget,
        .meta-card,
        .summary-card {
          box-shadow: none;
          background: #ffffff;
        }

        .section-grid {
          gap: 12px;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <span class="eyebrow">Standalone Report</span>
        <h1>${escapeHtml(config.title)}</h1>
        <p>${escapeHtml(config.description || "Generated analytical report.")}</p>

        <div class="hero-meta">
          <div class="meta-card">
            <span class="muted">Created</span>
            <strong>${escapeHtml(
              new Date(config.createdAt).toLocaleString(),
            )}</strong>
          </div>
          <div class="meta-card">
            <span class="muted">Widgets</span>
            <strong>${config.widgets.length}</strong>
          </div>
          <div class="meta-card">
            <span class="muted">Format</span>
            <strong>HTML</strong>
          </div>
        </div>

        <div class="summary-grid">
          <div class="summary-card">
            <span class="muted">Charts</span>
            <strong>${chartCount}</strong>
          </div>
          <div class="summary-card">
            <span class="muted">KPIs</span>
            <strong>${metricCount}</strong>
          </div>
          <div class="summary-card">
            <span class="muted">Text Sections</span>
            <strong>${textCount}</strong>
          </div>
        </div>
      </section>

      <section class="section-grid">
        ${widgetCards || '<div class="empty-state">This report has no widgets.</div>'}
      </section>
    </main>
  </body>
</html>`;
}
