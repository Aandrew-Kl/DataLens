"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  Lightbulb,
  Loader2,
  RefreshCw,
  Sigma,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { assessDataQuality } from "@/lib/utils/data-quality";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataStoryProps { tableName: string; columns: ColumnProfile[]; rowCount: number; }
interface NumericInsight { name: string; mean: number | null; median: number | null; stddev: number | null; min: number | null; max: number | null; q1: number | null; q3: number | null; outlierCount: number; }
interface CategoryInsight { name: string; topValue: string | null; topCount: number; share: number; distinctCount: number; }
interface TemporalInsight { name: string; minValue: string | null; maxValue: string | null; spanDays: number | null; }
interface StorySection { id: string; title: string; icon: LucideIcon; body: string; accent: string; }
interface StoryAnalysis { qualityScore: number; completeness: number; sections: StorySection[]; }

const containerVariants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.36, ease: [0.16, 1, 0.3, 1], staggerChildren: 0.06 } },
} as const;
const cardVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.28, ease: "easeOut" } },
} as const;
const sectionBlueprints = [
  { id: "executive", title: "Executive Summary", icon: FileText, accent: "from-cyan-500/25 to-sky-500/10" },
  { id: "metrics", title: "Key Metrics", icon: Sigma, accent: "from-violet-500/25 to-fuchsia-500/10" },
  { id: "distribution", title: "Distribution Insights", icon: BarChart3, accent: "from-amber-500/25 to-orange-500/10" },
  { id: "quality", title: "Quality Assessment", icon: CheckCircle2, accent: "from-emerald-500/25 to-green-500/10" },
  { id: "outliers", title: "Outlier Report", icon: AlertTriangle, accent: "from-rose-500/25 to-red-500/10" },
  { id: "recommendations", title: "Recommendations", icon: Lightbulb, accent: "from-indigo-500/25 to-cyan-500/10" },
] as const;

const integerFormatter = new Intl.NumberFormat("en-US");
const decimalFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
const toNumber = (value: unknown) => {
  const numeric = value == null ? Number.NaN : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};
const formatPercent = (value: number) => `${value.toFixed(1)}%`;
const formatMetric = (value: number | null) => value === null
  ? "not available"
  : Math.abs(value) >= 1000 || Number.isInteger(value)
    ? integerFormatter.format(Math.round(value))
    : decimalFormatter.format(value);
const formatDate = (value: string | null) => {
  if (!value) return "not available";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
};
const escapeHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");
const getQualityLabel = (score: number) => score >= 90 ? "excellent" : score >= 75 ? "strong" : score >= 60 ? "mixed" : "fragile";
const getSchemaBlend = (columns: ColumnProfile[]) => {
  const numeric = columns.filter((column) => column.type === "number").length;
  const text = columns.filter((column) => column.type === "string").length;
  const dates = columns.filter((column) => column.type === "date").length;
  if (numeric > text && numeric >= dates) return "numerically oriented";
  if (text > numeric) return "text-heavy";
  if (dates > 0) return "time-aware";
  return "mixed-type";
};
const pickNumericColumns = (columns: ColumnProfile[], rowCount: number) => columns
  .filter((column) => column.type === "number")
  .sort((left, right) => ((rowCount - right.nullCount) + right.uniqueCount) - ((rowCount - left.nullCount) + left.uniqueCount))
  .slice(0, 3);
const pickCategoryColumns = (columns: ColumnProfile[], rowCount: number) => columns
  .filter((column) => {
    if (column.type !== "string" && column.type !== "boolean") return false;
    const nonNull = Math.max(rowCount - column.nullCount, 0);
    if (nonNull === 0 || column.uniqueCount <= 1) return false;
    return column.uniqueCount <= Math.min(40, Math.max(6, Math.floor(nonNull * 0.25)));
  })
  .sort((left, right) => ((rowCount - right.nullCount) - right.uniqueCount) - ((rowCount - left.nullCount) - left.uniqueCount))
  .slice(0, 2);

async function loadNumericInsight(tableName: string, columnName: string): Promise<NumericInsight> {
  const table = quote(tableName);
  const column = quote(columnName);
  const rows = await runQuery(`
    WITH stats AS (
      SELECT AVG(${column}) AS mean_value, MEDIAN(${column}) AS median_value, STDDEV_SAMP(${column}) AS stddev_value,
        MIN(${column}) AS min_value, MAX(${column}) AS max_value, QUANTILE_CONT(${column}, 0.25) AS q1, QUANTILE_CONT(${column}, 0.75) AS q3
      FROM ${table} WHERE ${column} IS NOT NULL
    )
    SELECT mean_value, median_value, stddev_value, min_value, max_value, q1, q3,
      (SELECT COUNT(*) FROM ${table} CROSS JOIN stats
        WHERE ${column} IS NOT NULL AND q1 IS NOT NULL AND q3 IS NOT NULL
        AND (${column} < q1 - 1.5 * (q3 - q1) OR ${column} > q3 + 1.5 * (q3 - q1))) AS outlier_count
    FROM stats
  `);
  const row = rows[0] ?? {};
  return {
    name: columnName,
    mean: toNumber(row.mean_value),
    median: toNumber(row.median_value),
    stddev: toNumber(row.stddev_value),
    min: toNumber(row.min_value),
    max: toNumber(row.max_value),
    q1: toNumber(row.q1),
    q3: toNumber(row.q3),
    outlierCount: toNumber(row.outlier_count) ?? 0,
  };
}

async function loadCategoryInsight(tableName: string, columnName: string): Promise<CategoryInsight> {
  const table = quote(tableName);
  const column = quote(columnName);
  const [topRows, baseRows] = await Promise.all([
    runQuery(`SELECT CAST(${column} AS VARCHAR) AS value, COUNT(*) AS value_count FROM ${table} WHERE ${column} IS NOT NULL GROUP BY 1 ORDER BY value_count DESC, value LIMIT 1`),
    runQuery(`SELECT COUNT(${column}) AS non_null_count, COUNT(DISTINCT ${column}) AS distinct_count FROM ${table}`),
  ]);
  const topRow = topRows[0] ?? {};
  const baseRow = baseRows[0] ?? {};
  const nonNullCount = toNumber(baseRow.non_null_count) ?? 0;
  const topCount = toNumber(topRow.value_count) ?? 0;
  return { name: columnName, topValue: topRow.value == null ? null : String(topRow.value), topCount, share: nonNullCount > 0 ? (topCount / nonNullCount) * 100 : 0, distinctCount: toNumber(baseRow.distinct_count) ?? 0 };
}

async function loadTemporalInsight(tableName: string, columnName: string): Promise<TemporalInsight> {
  const table = quote(tableName);
  const column = quote(columnName);
  const rows = await runQuery(`
    SELECT MIN(TRY_CAST(${column} AS TIMESTAMP)) AS min_value, MAX(TRY_CAST(${column} AS TIMESTAMP)) AS max_value,
      DATE_DIFF('day', CAST(MIN(TRY_CAST(${column} AS TIMESTAMP)) AS DATE), CAST(MAX(TRY_CAST(${column} AS TIMESTAMP)) AS DATE)) AS span_days
    FROM ${table} WHERE TRY_CAST(${column} AS TIMESTAMP) IS NOT NULL
  `);
  const row = rows[0] ?? {};
  return { name: columnName, minValue: row.min_value == null ? null : String(row.min_value), maxValue: row.max_value == null ? null : String(row.max_value), spanDays: toNumber(row.span_days) };
}

function buildStoryHtml(tableName: string, sections: StorySection[], qualityScore: number, completeness: number, rowCount: number, columnCount: number) {
  const cards = sections.map((section) => `<article class="story-card"><span class="eyebrow">${escapeHtml(section.title)}</span><p>${escapeHtml(section.body).replace(/\n/g, "<br />")}</p></article>`).join("");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(tableName)} data story</title><style>
  :root { color-scheme: dark; --bg:#060816; --panel:rgba(15,23,42,.78); --line:rgba(148,163,184,.16); --text:#e2e8f0; --muted:#94a3b8; }
  * { box-sizing:border-box; } body { margin:0; font-family:Inter,"Segoe UI",sans-serif; color:var(--text); background:radial-gradient(circle at top, rgba(56,189,248,.16), transparent 26%), linear-gradient(180deg, #050814, var(--bg)); }
  .shell { max-width:1120px; margin:0 auto; padding:40px 20px 56px; } .hero,.story-card,.stat { background:var(--panel); border:1px solid var(--line); backdrop-filter:blur(18px); }
  .hero { padding:28px; border-radius:28px; box-shadow:0 30px 80px rgba(2,6,23,.45); } h1 { margin:0; font-size:2.35rem; letter-spacing:-.04em; } .lede { margin:14px 0 0; max-width:72ch; color:#cbd5e1; line-height:1.7; }
  .stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; margin-top:20px; } .stat { border-radius:20px; padding:16px 18px; } .stat span,.eyebrow { display:block; color:var(--muted); text-transform:uppercase; letter-spacing:.14em; font-size:.73rem; } .stat strong { display:block; margin-top:8px; font-size:1.35rem; }
  .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; margin-top:20px; } .story-card { border-radius:24px; padding:20px 22px; min-height:190px; } .story-card p { margin:14px 0 0; color:#d8e1ec; line-height:1.75; }
  @media (max-width:900px) { .stats,.grid { grid-template-columns:1fr; } h1 { font-size:1.85rem; } }
</style></head><body><main class="shell"><section class="hero"><span class="eyebrow">Automatic narrative</span><h1>${escapeHtml(tableName)} data story</h1>
<p class="lede">A rule-based narrative generated from live DuckDB analysis of the loaded dataset. It combines structural signals, column profiles, distribution scans, and outlier checks into a single professional summary.</p>
<div class="stats"><div class="stat"><span>Rows</span><strong>${escapeHtml(formatNumber(rowCount))}</strong></div><div class="stat"><span>Columns</span><strong>${escapeHtml(formatNumber(columnCount))}</strong></div><div class="stat"><span>Quality Score</span><strong>${escapeHtml(String(qualityScore))}/100</strong></div><div class="stat"><span>Completeness</span><strong>${escapeHtml(formatPercent(completeness))}</strong></div></div></section><section class="grid">${cards}</section></main></body></html>`;
}

export default function DataStory({ tableName, columns, rowCount }: DataStoryProps) {
  const [analysis, setAnalysis] = useState<StoryAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function analyze() {
      setLoading(true);
      setError(null);
      try {
        const totalNulls = columns.reduce((sum, column) => sum + column.nullCount, 0);
        const totalCells = rowCount * Math.max(columns.length, 1);
        const completeness = totalCells > 0 ? ((totalCells - totalNulls) / totalCells) * 100 : 100;
        const quality = assessDataQuality(columns, rowCount);
        const numericTargets = pickNumericColumns(columns, rowCount);
        const categoryTargets = pickCategoryColumns(columns, rowCount);
        const dateTarget = columns.filter((column) => column.type === "date").sort((left, right) => left.nullCount - right.nullCount)[0];
        const [numericInsights, categoryInsights, temporalInsight] = await Promise.all([
          Promise.all(numericTargets.map((column) => loadNumericInsight(tableName, column.name))),
          Promise.all(categoryTargets.map((column) => loadCategoryInsight(tableName, column.name))),
          dateTarget ? loadTemporalInsight(tableName, dateTarget.name) : Promise.resolve<TemporalInsight | null>(null),
        ]);

        const strongestOutlier = [...numericInsights].sort((left, right) => right.outlierCount - left.outlierCount)[0];
        const leadingNumeric = numericInsights[0];
        const leadingCategory = categoryInsights[0];
        const topIssue = quality.issues[0];
        const executiveFocus = strongestOutlier?.outlierCount > 0
          ? `${strongestOutlier.name} stands out for unusual spread, with ${formatNumber(strongestOutlier.outlierCount)} detected outlier${strongestOutlier.outlierCount === 1 ? "" : "s"}`
          : leadingCategory?.topValue
            ? `${leadingCategory.name} is anchored by ${leadingCategory.topValue}, which represents ${formatPercent(leadingCategory.share)} of populated records`
            : temporalInsight?.spanDays
              ? `${temporalInsight.name} spans ${formatNumber(temporalInsight.spanDays)} days of observed history`
              : "the initial scan found a balanced profile without a single dominant anomaly";

        const executiveSummary = `${tableName} contains ${formatNumber(rowCount)} rows across ${formatNumber(columns.length)} columns and reads as a ${getQualityLabel(quality.overallScore)} ${getSchemaBlend(columns)} dataset. Overall completeness is ${formatPercent(completeness)}, and ${executiveFocus}. ${topIssue ? `The main watchpoint is ${topIssue.column}, where ${topIssue.message.toLowerCase()}` : "The first-pass quality sweep did not surface any material structural concerns."}`;
        const keyMetrics = [
          leadingNumeric
            ? `${leadingNumeric.name} centers at a mean of ${formatMetric(leadingNumeric.mean)} with a median of ${formatMetric(leadingNumeric.median)}, spanning ${formatMetric(leadingNumeric.min)} to ${formatMetric(leadingNumeric.max)}.`
            : `The schema contains ${formatNumber(columns.filter((column) => column.type === "number").length)} numeric columns ready for metric-driven analysis.`,
          leadingCategory?.topValue
            ? `${leadingCategory.name} is led by ${leadingCategory.topValue}, accounting for ${formatPercent(leadingCategory.share)} of non-null records across ${formatNumber(leadingCategory.distinctCount)} distinct values.`
            : `The dataset includes ${formatNumber(columns.filter((column) => column.type === "string").length)} text-like columns and ${formatNumber(columns.filter((column) => column.type === "boolean").length)} boolean columns.`,
          temporalInsight
            ? `${temporalInsight.name} runs from ${formatDate(temporalInsight.minValue)} to ${formatDate(temporalInsight.maxValue)}, a coverage window of ${formatNumber(Math.max(temporalInsight.spanDays ?? 0, 0))} days.`
            : "No strongly typed date column was available for temporal coverage analysis.",
        ].join(" ");

        const skewLine = leadingNumeric
          ? `${leadingNumeric.name} appears ${leadingNumeric.mean !== null && leadingNumeric.median !== null && leadingNumeric.stddev !== null && Math.abs(leadingNumeric.mean - leadingNumeric.median) > Math.max(leadingNumeric.stddev * 0.15, 0.01) ? leadingNumeric.mean > leadingNumeric.median ? "right-skewed, suggesting a long upper tail" : "left-skewed, suggesting a lower-tail pull" : "fairly balanced through the center of the distribution"}, with the middle 50% of values sitting between ${formatMetric(leadingNumeric.q1)} and ${formatMetric(leadingNumeric.q3)}.`
          : "Numeric distribution checks were limited because the dataset does not expose many complete numeric measures.";
        const categoryLine = leadingCategory?.topValue
          ? `${leadingCategory.name} is ${leadingCategory.share >= 55 ? "highly concentrated" : leadingCategory.share >= 35 ? "moderately concentrated" : "fairly distributed"}, and the lead value ${leadingCategory.topValue} contributes ${formatPercent(leadingCategory.share)} of the populated rows.`
          : "No low-cardinality text or boolean column was strong enough to support a category concentration readout.";
        const temporalLine = temporalInsight?.spanDays != null
          ? `${temporalInsight.name} offers a ${temporalInsight.spanDays >= 365 ? "multi-period" : "short-horizon"} timeline, which makes trend analysis ${temporalInsight.spanDays >= 90 ? "credible" : "possible but narrow"} from the outset.`
          : "Temporal sequencing could not be assessed from the current column set.";
        const distributionInsights = [skewLine, categoryLine, temporalLine].join(" ");

        const nullHeavyColumns = columns.filter((column) => rowCount > 0 && column.nullCount / rowCount >= 0.2);
        const qualityAssessment = `${quality.summary} At dataset level, ${formatPercent(completeness)} of all cells are populated. ${nullHeavyColumns.length > 0 ? `${nullHeavyColumns.slice(0, 2).map((column) => `${column.name} (${formatPercent((column.nullCount / Math.max(rowCount, 1)) * 100)} null)`).join(" and ")} deserve the earliest remediation attention.` : "Missingness is not concentrated enough to dominate the quality profile."} ${columns.some((column) => column.type === "unknown") ? "There are also unresolved typing questions that may affect downstream joins or aggregations." : "Column typing is stable enough for exploratory modeling and dashboarding."}`;

        const lowerFence = strongestOutlier?.q1 === null || strongestOutlier?.q3 === null ? null : strongestOutlier.q1 - 1.5 * (strongestOutlier.q3 - strongestOutlier.q1);
        const upperFence = strongestOutlier?.q1 === null || strongestOutlier?.q3 === null ? null : strongestOutlier.q3 + 1.5 * (strongestOutlier.q3 - strongestOutlier.q1);
        const outlierReport = strongestOutlier?.outlierCount
          ? `${strongestOutlier.name} has the clearest anomaly footprint, with ${formatNumber(strongestOutlier.outlierCount)} records falling outside the Tukey fence of ${formatMetric(lowerFence)} to ${formatMetric(upperFence)}. ${strongestOutlier.outlierCount / Math.max(rowCount, 1) >= 0.05 ? "This is dense enough to inspect for segmentation or source-system effects rather than dismissing it as noise." : "The volume is still modest, which suggests the extremes are notable but not yet overwhelming."}`
          : "The numeric columns reviewed do not show a pronounced outlier burden under a Tukey-fence check. That lowers the risk of a few extreme records distorting top-line averages, although domain-specific anomaly rules may still surface edge cases.";

        const recommendations = [
          nullHeavyColumns[0] ? `Prioritize cleanup or source validation for ${nullHeavyColumns[0].name}, because missingness is the clearest reliability drag on the current dataset.` : "Preserve the current collection standards, because completeness is already supportive of repeatable analysis.",
          strongestOutlier?.outlierCount ? `Use medians and percentile bands alongside averages for ${strongestOutlier.name} so reporting stays stable even when extreme values move.` : "Keep averages in the core metric set, but pair them with ranges to make spread visible to stakeholders.",
          leadingCategory?.share && leadingCategory.share >= 50 ? `Segment reporting by ${leadingCategory.name} early, since one dominant category can hide performance differences in the remaining population.` : "Add cohort or segment cuts only after the first dashboard pass, because no single category currently overwhelms the dataset.",
          temporalInsight?.spanDays && temporalInsight.spanDays >= 90 ? `Lean into trend views and recency comparisons on ${temporalInsight.name}; the observed time span is wide enough to support seasonality or momentum checks.` : "If trend analysis matters, enrich the dataset with a cleaner date field before building recency-focused views.",
        ].join(" ");

        const sectionBodies: Record<string, string> = {
          executive: executiveSummary,
          metrics: keyMetrics,
          distribution: distributionInsights,
          quality: qualityAssessment,
          outliers: outlierReport,
          recommendations,
        };
        const sections: StorySection[] = sectionBlueprints.map((blueprint) => ({ ...blueprint, body: sectionBodies[blueprint.id] }));
        if (!cancelled) setAnalysis({ qualityScore: quality.overallScore, completeness, sections });
      } catch (analysisError) {
        if (!cancelled) {
          setError(analysisError instanceof Error ? analysisError.message : "Failed to analyze the dataset.");
          setAnalysis(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void analyze();
    return () => { cancelled = true; };
  }, [columns, rowCount, tableName]);

  const storyText = useMemo(() => analysis ? analysis.sections.map((section) => `${section.title}\n${section.body}`).join("\n\n") : "", [analysis]);
  const handleCopy = async () => {
    if (!storyText) return;
    await navigator.clipboard.writeText(storyText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const handleExport = () => {
    if (!analysis) return;
    const html = buildStoryHtml(tableName, analysis.sections, analysis.qualityScore, analysis.completeness, rowCount, columns.length);
    downloadFile(html, `${tableName}-data-story.html`, "text/html;charset=utf-8;");
  };

  return (
    <motion.section variants={containerVariants} initial="hidden" animate="visible" className="glass relative overflow-hidden rounded-[28px] border border-white/15 bg-white/55 shadow-[0_28px_90px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-slate-950/45">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_28%),radial-gradient(circle_at_80%_20%,rgba(168,85,247,0.12),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.12),transparent_26%)]" />

      <div className="relative border-b border-white/15 px-6 py-6 dark:border-white/10">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
              <FileText className="h-3.5 w-3.5" />
              Automatic Data Story
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">Narrative briefing for {tableName}</h2>
            <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
              This narrative is generated from live DuckDB statistics, column profiles, and rule-based templates so the summary stays grounded in the loaded data instead of a generic AI response.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={handleCopy} disabled={!analysis || loading} className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/70 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-cyan-400/40 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-900/60 dark:text-slate-200">
              <Copy className="h-4 w-4" />
              {copied ? "Copied" : "Copy Story"}
            </button>
            <button type="button" onClick={handleExport} disabled={!analysis || loading} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-700 transition hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-cyan-300">
              <Download className="h-4 w-4" />
              Export as HTML
            </button>
          </div>
        </div>
      </div>

      <div className="relative px-6 py-6">
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="animate-shimmer rounded-[24px] border border-white/15 bg-white/45 p-5 dark:bg-slate-900/35">
                <div className="h-4 w-28 rounded-full bg-white/60 dark:bg-white/10" />
                <div className="mt-4 h-3 w-full rounded-full bg-white/55 dark:bg-white/8" />
                <div className="mt-2 h-3 w-[92%] rounded-full bg-white/45 dark:bg-white/8" />
                <div className="mt-2 h-3 w-[84%] rounded-full bg-white/35 dark:bg-white/8" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-[24px] border border-rose-400/20 bg-rose-500/10 p-6 text-sm text-rose-700 dark:text-rose-300">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">Narrative generation failed</p>
                <p className="mt-2 leading-7">{error}</p>
              </div>
            </div>
          </div>
        ) : analysis ? (
          <>
            <motion.div variants={cardVariants} className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Rows", value: formatNumber(rowCount) },
                { label: "Columns", value: formatNumber(columns.length) },
                { label: "Quality Score", value: `${analysis.qualityScore}/100` },
                { label: "Completeness", value: formatPercent(analysis.completeness) },
              ].map((metric) => (
                <div key={metric.label} className="rounded-[22px] border border-white/15 bg-white/60 p-4 backdrop-blur-xl dark:bg-slate-900/40">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">{metric.label}</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">{metric.value}</p>
                </div>
              ))}
            </motion.div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {analysis.sections.map((section) => {
                const Icon = section.icon;
                return (
                  <motion.article key={section.id} variants={cardVariants} className="group rounded-[24px] border border-white/15 bg-white/60 p-5 backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-white/25 dark:bg-slate-900/42">
                    <div className={`inline-flex rounded-2xl bg-gradient-to-br p-[1px] ${section.accent}`}>
                      <div className="rounded-[15px] bg-white/85 p-2.5 dark:bg-slate-950/75">
                        <Icon className="h-4 w-4 text-slate-700 dark:text-slate-200" />
                      </div>
                    </div>
                    <h3 className="mt-4 text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">{section.title}</h3>
                    <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">{section.body}</p>
                  </motion.article>
                );
              })}
            </div>
          </>
        ) : null}
      </div>

      <div className="relative border-t border-white/15 px-6 py-4 dark:border-white/10">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Rule-based narrative engine with live DuckDB statistics
        </div>
      </div>
    </motion.section>
  );
}
