"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  FileText,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { startTransition, useMemo, useState, type ReactNode } from "react";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataSummarizerProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

type FindingTone = "insight" | "warning" | "positive";
type ExportFormat = "markdown" | "text";
type SectionKey = "summary" | "findings" | "columns" | "recommendations";

interface SummaryFinding {
  id: string;
  tone: FindingTone;
  title: string;
  detail: string;
}

interface RecommendationItem {
  id: string;
  title: string;
  detail: string;
}

interface ColumnSnapshot {
  name: string;
  type: string;
  detail: string;
  qualityLabel: string;
  missingRate: number;
}

interface SummaryBundle {
  paragraphs: string[];
  findings: SummaryFinding[];
  recommendations: RecommendationItem[];
  snapshots: ColumnSnapshot[];
  markdown: string;
  plainText: string;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "overflow-hidden rounded-[1.9rem] border border-white/20 bg-white/75 shadow-[0_24px_90px_-48px_rgba(15,23,42,0.75)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";

const DEFAULT_SECTIONS: Record<SectionKey, boolean> = {
  summary: true,
  findings: true,
  columns: false,
  recommendations: true,
};

function isCurrencyLike(columnName: string) {
  return /(revenue|sales|price|cost|amount|profit|income|budget|spend|value|arr|mrr)/i.test(
    columnName,
  );
}

function formatMetricValue(
  value: number | string | undefined,
  columnName?: string,
) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (columnName && isCurrencyLike(columnName)) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
      }).format(value);
    }
    return formatNumber(value);
  }

  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return "n/a";
}

function columnTypeLabel(column: ColumnProfile) {
  switch (column.type) {
    case "number":
      return "numeric";
    case "string":
      return "text";
    case "date":
      return "date";
    case "boolean":
      return "boolean";
    default:
      return "untyped";
  }
}

function summarizeNumericColumn(column: ColumnProfile) {
  const rangeText =
    column.min !== undefined && column.max !== undefined
      ? `${formatMetricValue(column.min, column.name)} to ${formatMetricValue(column.max, column.name)}`
      : "an incomplete numeric range";
  const centerText =
    typeof column.median === "number"
      ? `with a median of ${formatMetricValue(column.median, column.name)}`
      : typeof column.mean === "number"
        ? `with an average of ${formatMetricValue(column.mean, column.name)}`
        : "with no stable center estimate yet";

  return `${column.name} spans ${rangeText} ${centerText}.`;
}

function summarizeTextColumn(column: ColumnProfile, rowCount: number) {
  const coverage = rowCount > 0 ? column.uniqueCount / rowCount : 0;
  if (coverage >= 0.8) {
    return `${column.name} is highly unique and behaves like an identifier, with ${formatNumber(column.uniqueCount)} distinct values.`;
  }
  if (coverage <= 0.1) {
    return `${column.name} looks segment-friendly with ${formatNumber(column.uniqueCount)} distinct values across ${formatNumber(rowCount)} rows.`;
  }
  return `${column.name} carries moderate variety with ${formatNumber(column.uniqueCount)} distinct values.`;
}

function summarizeBooleanColumn(column: ColumnProfile) {
  return `${column.name} is a boolean-style field that can be used for quick cohort splits or health checks.`;
}

function summarizeDateColumn(column: ColumnProfile) {
  if (column.min !== undefined && column.max !== undefined) {
    return `${column.name} covers a date span from ${formatMetricValue(column.min)} to ${formatMetricValue(column.max)}.`;
  }
  return `${column.name} is available for time-based trend analysis.`;
}

function mostCompleteColumns(columns: ColumnProfile[], rowCount: number) {
  return [...columns]
    .sort((left, right) => left.nullCount - right.nullCount)
    .slice(0, 3)
    .filter((column) => rowCount === 0 || column.nullCount < rowCount);
}

function mostMissingColumns(columns: ColumnProfile[], rowCount: number) {
  return [...columns]
    .sort((left, right) => right.nullCount - left.nullCount)
    .slice(0, 3)
    .filter((column) => column.nullCount > 0 && rowCount > 0);
}

function buildSummaryBundle(
  tableName: string,
  columns: ColumnProfile[],
  rowCount: number,
): SummaryBundle {
  const numericColumns = columns.filter((column) => column.type === "number");
  const textColumns = columns.filter((column) => column.type === "string");
  const dateColumns = columns.filter((column) => column.type === "date");
  const booleanColumns = columns.filter((column) => column.type === "boolean");
  const unknownColumns = columns.filter((column) => column.type === "unknown");
  const totalCells = rowCount * Math.max(columns.length, 1);
  const totalNulls = columns.reduce((sum, column) => sum + column.nullCount, 0);
  const completeness = totalCells > 0 ? ((totalCells - totalNulls) / totalCells) * 100 : 100;
  const completeColumns = mostCompleteColumns(columns, rowCount);
  const missingColumns = mostMissingColumns(columns, rowCount);
  const skewedNumericColumns = numericColumns.filter((column) => {
    if (typeof column.mean !== "number" || typeof column.median !== "number") {
      return false;
    }
    const baseline = Math.max(Math.abs(column.median), 1);
    return Math.abs(column.mean - column.median) / baseline >= 0.35;
  });
  const constantColumns = columns.filter(
    (column) => rowCount > 1 && column.uniqueCount <= 1 && column.nullCount < rowCount,
  );
  const identifierCandidates = textColumns.filter(
    (column) => rowCount > 0 && column.uniqueCount / rowCount >= 0.8,
  );
  const segmentationCandidates = textColumns.filter(
    (column) =>
      rowCount > 0 &&
      column.uniqueCount > 1 &&
      column.uniqueCount <= Math.max(12, Math.floor(rowCount * 0.12)),
  );
  const strongestNumeric = [...numericColumns].sort((left, right) => {
    const leftRange =
      typeof left.min === "number" && typeof left.max === "number" ? left.max - left.min : 0;
    const rightRange =
      typeof right.min === "number" && typeof right.max === "number"
        ? right.max - right.min
        : 0;
    return rightRange - leftRange;
  })[0];
  const dateHighlight = dateColumns[0];

  const paragraphs = [
    `The ${tableName} dataset contains ${formatNumber(rowCount)} rows across ${formatNumber(columns.length)} columns. Estimated cell completeness is ${formatPercent(completeness, 1)}, with ${formatNumber(totalNulls)} null values detected across the full table footprint.`,
    strongestNumeric
      ? summarizeNumericColumn(strongestNumeric)
      : `There are no numeric columns available yet, so the current readout leans on schema shape and completeness rather than distribution metrics.`,
    textColumns[0]
      ? summarizeTextColumn(textColumns[0], rowCount)
      : booleanColumns[0]
        ? summarizeBooleanColumn(booleanColumns[0])
        : `The dataset does not expose rich text dimensions yet, so segmentation opportunities may depend on derived labels or grouped numeric bands.`,
    dateHighlight
      ? summarizeDateColumn(dateHighlight)
      : `No explicit date column was detected, so any trend analysis would need a derived timestamp or reporting period field.`,
  ];

  const findings: SummaryFinding[] = [];

  if (completeness >= 95) {
    findings.push({
      id: "healthy-completeness",
      tone: "positive",
      title: "High overall completeness",
      detail: `The dataset is ${formatPercent(completeness, 1)} complete, which is strong enough for direct exploration without major imputation work.`,
    });
  } else if (missingColumns[0]) {
    findings.push({
      id: "missingness-hotspot",
      tone: "warning",
      title: `${missingColumns[0].name} is the main quality hotspot`,
      detail: `${missingColumns[0].name} is missing in ${formatPercent(
        (missingColumns[0].nullCount / Math.max(rowCount, 1)) * 100,
        1,
      )} of rows, making it the first place to review before downstream analysis.`,
    });
  }

  if (strongestNumeric) {
    findings.push({
      id: "widest-range",
      tone: "insight",
      title: `${strongestNumeric.name} has the widest numeric spread`,
      detail: `${strongestNumeric.name} ranges from ${formatMetricValue(
        strongestNumeric.min,
        strongestNumeric.name,
      )} to ${formatMetricValue(
        strongestNumeric.max,
        strongestNumeric.name,
      )}, which makes it a strong candidate for distribution checks and outlier review.`,
    });
  }

  if (skewedNumericColumns[0]) {
    const numeric = skewedNumericColumns[0];
    findings.push({
      id: "skewed-metric",
      tone: "warning",
      title: `${numeric.name} shows a skewed distribution`,
      detail: `The mean (${formatMetricValue(
        numeric.mean,
        numeric.name,
      )}) and median (${formatMetricValue(
        numeric.median,
        numeric.name,
      )}) are materially apart, which usually signals outliers or a long-tailed distribution.`,
    });
  }

  if (identifierCandidates[0]) {
    findings.push({
      id: "identifier-candidate",
      tone: "positive",
      title: `${identifierCandidates[0].name} looks like a reliable key`,
      detail: `${identifierCandidates[0].name} is unique across most rows, so it should be useful for joins, deduplication, and audit trails.`,
    });
  } else if (segmentationCandidates[0]) {
    findings.push({
      id: "segment-candidate",
      tone: "insight",
      title: `${segmentationCandidates[0].name} is ready for slicing`,
      detail: `${segmentationCandidates[0].name} has ${formatNumber(
        segmentationCandidates[0].uniqueCount,
      )} distinct values, which is a manageable shape for pivots, heatmaps, and cohort views.`,
    });
  }

  if (constantColumns[0]) {
    findings.push({
      id: "constant-column",
      tone: "warning",
      title: `${constantColumns[0].name} is effectively constant`,
      detail: `${constantColumns[0].name} only carries one distinct value, so it likely adds little analytical value unless it encodes a fixed filter or source flag.`,
    });
  }

  if (unknownColumns[0]) {
    findings.push({
      id: "untyped-column",
      tone: "warning",
      title: `${unknownColumns[0].name} needs manual typing`,
      detail: `${unknownColumns[0].name} was not typed automatically, so downstream charts and aggregations may behave better after a cast or cleanup pass.`,
    });
  }

  const recommendations: RecommendationItem[] = [];

  if (missingColumns.length > 0) {
    recommendations.push({
      id: "clean-missing",
      title: "Prioritize missing-data cleanup",
      detail: `Start with ${missingColumns
        .slice(0, 2)
        .map((column) => column.name)
        .join(" and ")} before building dashboards or training downstream models.`,
    });
  }

  if (skewedNumericColumns.length > 0) {
    recommendations.push({
      id: "inspect-outliers",
      title: "Audit extreme numeric values",
      detail: `Review box plots or percentile caps for ${skewedNumericColumns
        .slice(0, 2)
        .map((column) => column.name)
        .join(" and ")} to confirm whether their tails reflect true business events or dirty inputs.`,
    });
  }

  if (segmentationCandidates.length > 0) {
    recommendations.push({
      id: "slice-by-category",
      title: "Use a low-cardinality segment column",
      detail: `A quick next step is to compare metrics by ${segmentationCandidates[0].name}, which has a compact category count and should work well in pivots or heatmaps.`,
    });
  }

  if (dateColumns.length > 0 && numericColumns.length > 0) {
    recommendations.push({
      id: "time-series",
      title: "Run a time-based trend analysis",
      detail: `Combine ${dateColumns[0].name} with ${numericColumns[0].name} to surface seasonality, drift, or reporting gaps over time.`,
    });
  }

  if (completeColumns.length > 0) {
    recommendations.push({
      id: "anchor-on-healthy-fields",
      title: "Anchor first analyses on stable columns",
      detail: `The cleanest starting points are ${completeColumns
        .slice(0, 3)
        .map((column) => column.name)
        .join(", ")}, which should reduce confusion while you validate the rest of the schema.`,
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: "general-profile",
      title: "Profile the table more deeply",
      detail: "Run a correlation view, missing-value scan, and per-column distribution profile to turn this high-level summary into action.",
    });
  }

  const snapshots = columns.slice(0, 8).map((column) => {
    const missingRate = rowCount > 0 ? (column.nullCount / rowCount) * 100 : 0;
    const detail =
      column.type === "number"
        ? summarizeNumericColumn(column)
        : column.type === "string"
          ? summarizeTextColumn(column, rowCount)
          : column.type === "date"
            ? summarizeDateColumn(column)
            : column.type === "boolean"
              ? summarizeBooleanColumn(column)
              : `${column.name} needs type review before it can drive confident analysis.`;

    return {
      name: column.name,
      type: columnTypeLabel(column),
      detail,
      qualityLabel:
        missingRate >= 25
          ? "Needs cleanup"
          : column.uniqueCount <= 1 && column.nullCount < rowCount
            ? "Low signal"
            : "Ready to explore",
      missingRate,
    } satisfies ColumnSnapshot;
  });

  const markdown = [
    `# Executive Summary: ${tableName}`,
    "",
    ...paragraphs.map((paragraph) => paragraph),
    "",
    "## Key Findings",
    ...findings.map((finding) => `- **${finding.title}:** ${finding.detail}`),
    "",
    "## Recommendations",
    ...recommendations.map(
      (recommendation) => `- **${recommendation.title}:** ${recommendation.detail}`,
    ),
  ].join("\n");

  const plainText = [
    `Executive Summary: ${tableName}`,
    "",
    ...paragraphs,
    "",
    "Key Findings",
    ...findings.map((finding) => `- ${finding.title}: ${finding.detail}`),
    "",
    "Recommendations",
    ...recommendations.map(
      (recommendation) => `- ${recommendation.title}: ${recommendation.detail}`,
    ),
  ].join("\n");

  return { paragraphs, findings, recommendations, snapshots, markdown, plainText };
}

function toneClasses(tone: FindingTone) {
  switch (tone) {
    case "positive":
      return "border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "warning":
      return "border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    default:
      return "border-cyan-400/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";
  }
}

function FindingIcon({ tone }: { tone: FindingTone }) {
  if (tone === "positive") {
    return <CheckCircle2 className="h-4 w-4" />;
  }
  if (tone === "warning") {
    return <AlertTriangle className="h-4 w-4" />;
  }
  return <TrendingUp className="h-4 w-4" />;
}

function CollapsibleSection({
  title,
  subtitle,
  sectionKey,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  sectionKey: SectionKey;
  open: boolean;
  onToggle: (sectionKey: SectionKey) => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[1.5rem] border border-white/15 bg-white/45 dark:bg-slate-950/30">
      <button
        type="button"
        onClick={() => onToggle(sectionKey)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            {title}
          </div>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{subtitle}</div>
        </div>
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.28, ease: EASE }}
          className="rounded-full border border-white/15 bg-white/55 p-2 text-slate-500 dark:bg-slate-950/45 dark:text-slate-300"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key={sectionKey}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.34, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/10 px-5 py-5">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function DataSummarizer({
  tableName,
  columns,
  rowCount,
}: DataSummarizerProps) {
  const bundle = useMemo(
    () => buildSummaryBundle(tableName, columns, rowCount),
    [columns, rowCount, tableName],
  );
  const [sections, setSections] =
    useState<Record<SectionKey, boolean>>(DEFAULT_SECTIONS);
  const [notice, setNotice] = useState<string | null>(null);

  function toggleSection(sectionKey: SectionKey) {
    startTransition(() => {
      setSections((current) => ({ ...current, [sectionKey]: !current[sectionKey] }));
    });
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(bundle.plainText);
    setNotice("Summary copied to clipboard.");
  }

  function handleExport(format: ExportFormat) {
    const content = format === "markdown" ? bundle.markdown : bundle.plainText;
    const extension = format === "markdown" ? "md" : "txt";
    const mimeType =
      format === "markdown" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8";
    downloadFile(content, `${tableName}-executive-summary.${extension}`, mimeType);
    setNotice(`Exported executive summary as ${extension.toUpperCase()}.`);
  }

  return (
    <section className={PANEL_CLASS}>
      <div className="border-b border-white/15 px-5 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
              <Sparkles className="h-3.5 w-3.5" />
              Rule-based executive summary
            </div>
            <h2 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              Auto-generated narrative for {tableName}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Purely deterministic wording based on schema, missingness, ranges, uniqueness,
              and distribution heuristics. No AI calls are involved.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/55 px-3 py-2 text-sm text-slate-700 transition hover:border-cyan-300/40 dark:bg-slate-950/35 dark:text-slate-200"
            >
              <Copy className="h-4 w-4" />
              Copy
            </button>
            <button
              type="button"
              onClick={() => handleExport("markdown")}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/55 px-3 py-2 text-sm text-slate-700 transition hover:border-cyan-300/40 dark:bg-slate-950/35 dark:text-slate-200"
            >
              <FileText className="h-4 w-4" />
              Export Markdown
            </button>
            <button
              type="button"
              onClick={() => handleExport("text")}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/55 px-3 py-2 text-sm text-slate-700 transition hover:border-cyan-300/40 dark:bg-slate-950/35 dark:text-slate-200"
            >
              <Download className="h-4 w-4" />
              Export Text
            </button>
          </div>
        </div>

        {notice ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: EASE }}
            className="mt-4 rounded-2xl border border-cyan-400/25 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-700 dark:text-cyan-300"
          >
            {notice}
          </motion.div>
        ) : null}
      </div>

      <div className="space-y-4 px-5 py-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[1.5rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-950/30">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Rows
            </div>
            <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              {formatNumber(rowCount)}
            </div>
          </div>
          <div className="rounded-[1.5rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-950/30">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Columns
            </div>
            <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              {formatNumber(columns.length)}
            </div>
          </div>
          <div className="rounded-[1.5rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-950/30">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Findings generated
            </div>
            <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              {bundle.findings.length}
            </div>
          </div>
        </div>

        <CollapsibleSection
          title="Executive Summary"
          subtitle="Plain-English paragraphs generated from dataset metadata."
          sectionKey="summary"
          open={sections.summary}
          onToggle={toggleSection}
        >
          <div className="space-y-3">
            {bundle.paragraphs.map((paragraph) => (
              <p
                key={paragraph}
                className="text-sm leading-7 text-slate-700 dark:text-slate-200"
              >
                {paragraph}
              </p>
            ))}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Key Findings"
          subtitle="Fast signals for growth, risk, and validation."
          sectionKey="findings"
          open={sections.findings}
          onToggle={toggleSection}
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {bundle.findings.map((finding) => (
              <div
                key={finding.id}
                className={`rounded-[1.35rem] border px-4 py-4 ${toneClasses(finding.tone)}`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    <FindingIcon tone={finding.tone} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{finding.title}</div>
                    <div className="mt-1 text-sm leading-6 opacity-90">{finding.detail}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Column Snapshots"
          subtitle="A quick health card for the most important fields."
          sectionKey="columns"
          open={sections.columns}
          onToggle={toggleSection}
        >
          <div className="grid gap-3 xl:grid-cols-2">
            {bundle.snapshots.map((snapshot) => (
              <div
                key={snapshot.name}
                className="rounded-[1.35rem] border border-white/15 bg-white/50 p-4 dark:bg-slate-950/35"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-950 dark:text-white">
                      {snapshot.name}
                    </div>
                    <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      {snapshot.type}
                    </div>
                  </div>
                  <div className="rounded-full border border-white/20 bg-white/65 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-950/45 dark:text-slate-300">
                    {snapshot.qualityLabel}
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {snapshot.detail}
                </p>
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>Missing rate</span>
                    <span>{formatPercent(snapshot.missingRate, 1)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/70 dark:bg-slate-900/70">
                    <div
                      className={`h-full rounded-full ${
                        snapshot.missingRate >= 25
                          ? "bg-amber-500"
                          : snapshot.missingRate > 0
                            ? "bg-cyan-500"
                            : "bg-emerald-500"
                      }`}
                      style={{ width: `${Math.max(4, Math.min(snapshot.missingRate, 100))}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Recommendations"
          subtitle="Suggested cleaning and analysis next steps."
          sectionKey="recommendations"
          open={sections.recommendations}
          onToggle={toggleSection}
        >
          <div className="space-y-3">
            {bundle.recommendations.map((recommendation) => (
              <div
                key={recommendation.id}
                className="rounded-[1.35rem] border border-white/15 bg-white/50 px-4 py-4 dark:bg-slate-950/35"
              >
                <div className="text-sm font-semibold text-slate-950 dark:text-white">
                  {recommendation.title}
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {recommendation.detail}
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      </div>
    </section>
  );
}
