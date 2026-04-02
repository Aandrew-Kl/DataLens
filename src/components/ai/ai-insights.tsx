"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, BarChart3, CheckCircle, ChevronDown, Lightbulb, RefreshCw, TrendingUp } from "lucide-react";
import { SkeletonCard } from "@/components/ui/skeleton";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber, formatPercent, truncate } from "@/lib/utils/formatters";
import { highlightSQL } from "@/lib/utils/sql-highlight";
import type { ColumnProfile } from "@/types/dataset";

type InsightKind = "completeness" | "cardinality" | "distribution" | "anomaly" | "extremes";
type InsightSeverity = "info" | "warning" | "interesting";
type FilterValue = "all" | InsightKind;

interface AIInsightsProps { tableName: string; columns: ColumnProfile[]; rowCount: number; }
interface Insight {
  id: InsightKind;
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  description: string;
  sql: string;
  metric: string;
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "completeness", label: "Completeness" },
  { value: "cardinality", label: "Cardinality" },
  { value: "distribution", label: "Distribution" },
  { value: "anomaly", label: "Anomalies" },
  { value: "extremes", label: "Top/Bottom" },
] as const;

const KIND_META = {
  completeness: { label: "Completeness", Icon: CheckCircle, accent: "text-emerald-500" },
  cardinality: { label: "Cardinality", Icon: BarChart3, accent: "text-cyan-500" },
  distribution: { label: "Distribution", Icon: TrendingUp, accent: "text-violet-500" },
  anomaly: { label: "Anomaly", Icon: AlertTriangle, accent: "text-amber-500" },
  extremes: { label: "Extremes", Icon: Lightbulb, accent: "text-sky-500" },
} as const;

const SEVERITY_META = {
  info: "border-blue-200/70 bg-blue-500/10 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300",
  warning: "border-amber-200/70 bg-amber-500/10 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300",
  interesting: "border-fuchsia-200/70 bg-fuchsia-500/10 text-fuchsia-700 dark:border-fuchsia-500/20 dark:bg-fuchsia-500/10 dark:text-fuchsia-300",
} as const;

const TOKEN_CLASS: Record<string, string> = {
  keyword: "text-blue-500 dark:text-blue-400",
  function: "text-violet-500 dark:text-violet-400",
  string: "text-emerald-500 dark:text-emerald-400",
  number: "text-amber-500 dark:text-amber-400",
  operator: "text-rose-400 dark:text-rose-400",
  identifier: "text-cyan-500 dark:text-cyan-400",
  comment: "text-gray-400 italic dark:text-gray-500",
  plain: "text-gray-800 dark:text-gray-200",
};

const listVariants = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.05 } } };
const itemVariants = { hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.28 } } };
const emptyQuery = "SELECT NULL AS insight WHERE FALSE";
const quoteId = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
const quoteLiteral = (value: string) => value.replace(/'/g, "''");

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "bigint") return formatNumber(Number(value));
  if (typeof value === "boolean") return value ? "true" : "false";
  return truncate(String(value), 24);
}

function describeSkew(score: number) {
  if (score >= 0.75) return "right skew";
  if (score <= -0.75) return "left skew";
  return "near symmetric";
}

function pickCategoricalColumn(columns: ColumnProfile[], rowCount: number): ColumnProfile | null {
  return [...columns]
    .filter((column) => column.type !== "date" && rowCount - column.nullCount > 0)
    .sort((left, right) => {
      const leftNonNull = Math.max(rowCount - left.nullCount, 1);
      const rightNonNull = Math.max(rowCount - right.nullCount, 1);
      const leftLikely = left.type === "boolean" || left.uniqueCount <= 12 || left.uniqueCount / leftNonNull <= 0.05;
      const rightLikely = right.type === "boolean" || right.uniqueCount <= 12 || right.uniqueCount / rightNonNull <= 0.05;
      return Number(rightLikely) - Number(leftLikely) || left.uniqueCount / leftNonNull - right.uniqueCount / rightNonNull || left.uniqueCount - right.uniqueCount;
    })[0] ?? null;
}

function pickExtremeColumn(columns: ColumnProfile[]): ColumnProfile | null {
  const numeric = [...columns]
    .filter((column) => column.type === "number")
    .sort((left, right) => {
      const leftRange = typeof left.max === "number" && typeof left.min === "number" ? left.max - left.min : -1;
      const rightRange = typeof right.max === "number" && typeof right.min === "number" ? right.max - right.min : -1;
      return rightRange - leftRange || right.uniqueCount - left.uniqueCount;
    })[0];
  return numeric ?? columns.find((column) => column.type === "date") ?? columns.find((column) => column.type === "string") ?? columns[0] ?? null;
}

function buildCompletenessQuery(tableName: string, columns: ColumnProfile[]) {
  if (!columns.length) return emptyQuery;
  const table = quoteId(tableName);
  return `WITH column_nulls AS (${columns.map((column) => `SELECT '${quoteLiteral(column.name)}' AS column_name, COUNT(*) AS total_rows, SUM(CASE WHEN ${quoteId(column.name)} IS NULL THEN 1 ELSE 0 END) AS null_rows FROM ${table}`).join(" UNION ALL ")}) SELECT column_name, total_rows, null_rows, ROUND(100.0 * null_rows / NULLIF(total_rows, 0), 2) AS null_rate_pct FROM column_nulls ORDER BY null_rate_pct DESC, null_rows DESC, column_name ASC LIMIT 3`;
}

function buildCardinalityQuery(tableName: string, column: ColumnProfile | null) {
  if (!column) return emptyQuery;
  const table = quoteId(tableName);
  const col = quoteId(column.name);
  return `WITH non_nulls AS (SELECT CAST(${col} AS VARCHAR) AS category FROM ${table} WHERE ${col} IS NOT NULL) SELECT category, COUNT(*) AS frequency, ROUND(100.0 * COUNT(*) / NULLIF((SELECT COUNT(*) FROM non_nulls), 0), 2) AS share_pct FROM non_nulls GROUP BY category ORDER BY frequency DESC, category ASC LIMIT 5`;
}

function buildDistributionQuery(tableName: string, numericColumns: ColumnProfile[]) {
  if (!numericColumns.length) return emptyQuery;
  const table = quoteId(tableName);
  return `WITH skew_scan AS (${numericColumns.map((column) => `SELECT '${quoteLiteral(column.name)}' AS column_name, COUNT(${quoteId(column.name)}) AS non_null_count, AVG(CAST(${quoteId(column.name)} AS DOUBLE)) AS mean_value, MEDIAN(CAST(${quoteId(column.name)} AS DOUBLE)) AS median_value, STDDEV_SAMP(CAST(${quoteId(column.name)} AS DOUBLE)) AS stddev_value, CASE WHEN STDDEV_SAMP(CAST(${quoteId(column.name)} AS DOUBLE)) IS NULL OR STDDEV_SAMP(CAST(${quoteId(column.name)} AS DOUBLE)) = 0 THEN 0 ELSE 3 * (AVG(CAST(${quoteId(column.name)} AS DOUBLE)) - MEDIAN(CAST(${quoteId(column.name)} AS DOUBLE))) / STDDEV_SAMP(CAST(${quoteId(column.name)} AS DOUBLE)) END AS skew_score FROM ${table} WHERE ${quoteId(column.name)} IS NOT NULL`).join(" UNION ALL ")}) SELECT column_name, non_null_count, mean_value, median_value, stddev_value, skew_score FROM skew_scan WHERE non_null_count >= 8 ORDER BY ABS(skew_score) DESC, non_null_count DESC, column_name ASC LIMIT 3`;
}

function buildAnomalyQuery(tableName: string, numericColumns: ColumnProfile[]) {
  if (!numericColumns.length) return emptyQuery;
  const table = quoteId(tableName);
  return `WITH anomaly_scan AS (${numericColumns.map((column) => `SELECT '${quoteLiteral(column.name)}' AS column_name, COUNT(*) AS anomaly_count, MAX(z_score) AS max_z_score, MIN(value) AS min_anomaly, MAX(value) AS max_anomaly FROM (SELECT CAST(${quoteId(column.name)} AS DOUBLE) AS value, ABS((CAST(${quoteId(column.name)} AS DOUBLE) - AVG(CAST(${quoteId(column.name)} AS DOUBLE)) OVER ()) / NULLIF(STDDEV_SAMP(CAST(${quoteId(column.name)} AS DOUBLE)) OVER (), 0)) AS z_score FROM ${table} WHERE ${quoteId(column.name)} IS NOT NULL) scored WHERE z_score > 3`).join(" UNION ALL ")}) SELECT column_name, anomaly_count, max_z_score, min_anomaly, max_anomaly FROM anomaly_scan ORDER BY anomaly_count DESC, max_z_score DESC NULLS LAST, column_name ASC LIMIT 3`;
}

function buildExtremesQuery(tableName: string, column: ColumnProfile | null) {
  if (!column) return emptyQuery;
  const table = quoteId(tableName);
  const col = quoteId(column.name);
  const sort = column.type === "number" ? `CAST(${col} AS DOUBLE)` : column.type === "date" ? `CAST(${col} AS TIMESTAMP)` : `CAST(${col} AS VARCHAR)`;
  return `WITH base AS (SELECT ${sort} AS sort_value, CAST(${col} AS VARCHAR) AS value FROM ${table} WHERE ${col} IS NOT NULL), top_values AS (SELECT 'top' AS bucket, value FROM base ORDER BY sort_value DESC LIMIT 3), bottom_values AS (SELECT 'bottom' AS bucket, value FROM base ORDER BY sort_value ASC LIMIT 3) SELECT bucket, value FROM top_values UNION ALL SELECT bucket, value FROM bottom_values`;
}

async function generateInsights(tableName: string, columns: ColumnProfile[], rowCount: number): Promise<Insight[]> {
  const numeric = columns.filter((column) => column.type === "number");
  const categorical = pickCategoricalColumn(columns, rowCount);
  const extreme = pickExtremeColumn(columns);
  const sql = {
    completeness: buildCompletenessQuery(tableName, columns),
    cardinality: buildCardinalityQuery(tableName, categorical),
    distribution: buildDistributionQuery(tableName, numeric),
    anomaly: buildAnomalyQuery(tableName, numeric),
    extremes: buildExtremesQuery(tableName, extreme),
  };

  const [completenessRows, cardinalityRows, distributionRows, anomalyRows, extremesRows] = await Promise.all([
    runQuery(sql.completeness),
    runQuery(sql.cardinality),
    runQuery(sql.distribution),
    runQuery(sql.anomaly),
    runQuery(sql.extremes),
  ]);

  const totalCells = rowCount * Math.max(columns.length, 1);
  const completeness = totalCells > 0 ? ((totalCells - columns.reduce((sum, column) => sum + column.nullCount, 0)) / totalCells) * 100 : 100;
  const missing = completenessRows.filter((row) => Number(row.null_rows ?? 0) > 0);
  const nonNull = categorical ? Math.max(rowCount - categorical.nullCount, 0) : 0;
  const distinctPct = nonNull > 0 && categorical ? (categorical.uniqueCount / nonNull) * 100 : 0;
  const leadingGroups = cardinalityRows.slice(0, 3).map((row) => `${renderValue(row.category)} (${formatNumber(Number(row.frequency ?? 0))})`).join(", ");

  const topSkew = distributionRows[0] ?? null;
  const skewScore = toNumber(topSkew?.skew_score) ?? 0;
  const skewSummary = distributionRows.map((row) => `${row.column_name} (${describeSkew(toNumber(row.skew_score) ?? 0)}, mean ${formatNumber(toNumber(row.mean_value) ?? 0)} vs median ${formatNumber(toNumber(row.median_value) ?? 0)})`).join("; ");

  const topAnomaly = anomalyRows[0] ?? null;
  const anomalyCount = Number(topAnomaly?.anomaly_count ?? 0);
  const anomalyRate = rowCount > 0 ? (anomalyCount / rowCount) * 100 : 0;
  const anomalySummary = anomalyRows.filter((row) => Number(row.anomaly_count ?? 0) > 0).map((row) => `${row.column_name} ${formatNumber(Number(row.anomaly_count ?? 0))} rows (max z ${(toNumber(row.max_z_score) ?? 0).toFixed(1)})`).join(", ");

  const topValues = extremesRows.filter((row) => row.bucket === "top").map((row) => renderValue(row.value));
  const bottomValues = extremesRows.filter((row) => row.bucket === "bottom").map((row) => renderValue(row.value));

  return [
    missing.length
      ? { id: "completeness", kind: "completeness", severity: (toNumber(missing[0].null_rate_pct) ?? 0) >= 20 ? "warning" : "interesting", title: `${missing[0].column_name} has the largest completeness gap`, description: `${missing.map((row) => `${row.column_name} ${formatPercent(toNumber(row.null_rate_pct) ?? 0, 1)} null`).join(", ")}. Overall cell completeness is ${formatPercent(completeness, 1)}, so these fields are the likeliest sources of biased filters and sparse joins.`, sql: sql.completeness, metric: formatPercent(completeness, 1) }
      : { id: "completeness", kind: "completeness", severity: "info", title: "Completeness is clean across scanned columns", description: `All ${formatNumber(columns.length)} columns are fully populated across ${formatNumber(rowCount)} rows, so downstream calculations should not need missing-value guards.`, sql: sql.completeness, metric: formatPercent(completeness, 1) },
    categorical
      ? { id: "cardinality", kind: "cardinality", severity: (toNumber(cardinalityRows[0]?.share_pct) ?? 0) >= 80 ? "warning" : "interesting", title: `${categorical.name} behaves like a categorical field`, description: `${categorical.name} has ${formatNumber(categorical.uniqueCount)} unique values across ${formatNumber(nonNull)} populated rows (${formatPercent(distinctPct, 1)} distinctness). Leading groups are ${leadingGroups || "not available"}, which makes this column a strong segmentation candidate.`, sql: sql.cardinality, metric: `${formatNumber(categorical.uniqueCount)} unique` }
      : { id: "cardinality", kind: "cardinality", severity: "info", title: "No categorical candidate stands out yet", description: "The current schema does not expose a populated low-cardinality column, so categorical grouping signals remain weak until more label-like values appear.", sql: sql.cardinality, metric: "0 columns" },
    topSkew
      ? { id: "distribution", kind: "distribution", severity: Math.abs(skewScore) >= 1.5 ? "warning" : Math.abs(skewScore) >= 0.75 ? "interesting" : "info", title: Math.abs(skewScore) >= 0.75 ? `${topSkew.column_name} is the most ${skewScore >= 0 ? "right-skewed" : "left-skewed"}` : "Numeric distributions look broadly balanced", description: `${skewSummary}. The strongest signal is ${skewScore >= 0 ? "+" : ""}${skewScore.toFixed(2)} on ${topSkew.column_name}, which shows how far the mean is being dragged away from the median by tail values.`, sql: sql.distribution, metric: `${skewScore >= 0 ? "+" : ""}${skewScore.toFixed(2)}` }
      : { id: "distribution", kind: "distribution", severity: "info", title: "Distribution scan is waiting on numeric columns", description: "No numeric columns with enough populated rows were available for skew analysis, so the panel skipped distribution-shape scoring.", sql: sql.distribution, metric: "No scan" },
    topAnomaly && anomalyCount > 0
      ? { id: "anomaly", kind: "anomaly", severity: anomalyRate >= 1 || (toNumber(topAnomaly.max_z_score) ?? 0) >= 6 ? "warning" : "interesting", title: `${topAnomaly.column_name} has the strongest anomaly signal`, description: `${anomalySummary}. In ${topAnomaly.column_name}, anomalous values range from ${renderValue(topAnomaly.min_anomaly)} to ${renderValue(topAnomaly.max_anomaly)}, which is the first place to inspect clipping, entry errors, or rare events.`, sql: sql.anomaly, metric: `${formatNumber(anomalyCount)} rows` }
      : { id: "anomaly", kind: "anomaly", severity: "info", title: "No >3σ anomalies surfaced in the scanned metrics", description: "The numeric columns that were checked stayed within three standard deviations of their own mean, so there is no immediate spike of extreme values to investigate.", sql: sql.anomaly, metric: "0 rows" },
    extreme && extremesRows.length
      ? { id: "extremes", kind: "extremes", severity: "interesting", title: `${extreme.name} exposes the clearest edge values`, description: `Lowest observed values for ${extreme.name} are ${bottomValues.join(", ") || "not available"}, while the upper edge reaches ${topValues.join(", ") || "not available"}. This is useful for spotting clipping, sentinel values, or unusually long tails.`, sql: sql.extremes, metric: extreme.type === "number" && typeof extreme.min === "number" && typeof extreme.max === "number" ? `${formatNumber(extreme.max - extreme.min)} span` : `${formatNumber(extreme.uniqueCount)} seen` }
      : { id: "extremes", kind: "extremes", severity: "info", title: "Top and bottom value scan is unavailable", description: "No populated column was eligible for a top/bottom value pass, so the panel could not surface edge values yet.", sql: sql.extremes, metric: "No scan" },
  ];
}

function SQLPreview({ sql }: { sql: string }) {
  const tokens = useMemo(() => highlightSQL(sql), [sql]);
  return <pre className="overflow-x-auto rounded-xl border border-gray-200/70 bg-gray-950 px-4 py-3 text-xs leading-6 dark:border-gray-700/70"><code className="font-mono">{tokens.map((token, index) => <span key={`${token.type}-${index}`} className={TOKEN_CLASS[token.type] ?? TOKEN_CLASS.plain}>{token.text}</span>)}</code></pre>;
}

export default function AIInsights({ tableName, columns, rowCount }: AIInsightsProps) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const nextInsights = await generateInsights(tableName, columns, rowCount);
        if (!cancelled) startTransition(() => {
          setInsights(nextInsights);
          setLastUpdated(Date.now());
        });
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to build AI insights.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [tableName, columns, rowCount, refreshNonce]);

  const visible = useMemo(() => (filter === "all" ? insights : insights.filter((item) => item.kind === filter)), [filter, insights]);
  const warningCount = insights.filter((item) => item.severity === "warning").length;
  const interestingCount = insights.filter((item) => item.severity === "interesting").length;

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200/70 bg-white/85 shadow-sm backdrop-blur-sm dark:border-gray-700/70 dark:bg-gray-900/65">
      <div className="border-b border-gray-200/70 px-6 py-5 dark:border-gray-700/70">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-300/40 bg-fuchsia-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-700 dark:border-fuchsia-500/20 dark:text-fuchsia-300"><Lightbulb className="h-3.5 w-3.5" />AI Insights</div>
            <h2 className="mt-3 text-xl font-semibold text-gray-900 dark:text-gray-50">Dataset findings generated from DuckDB</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300">The panel scans {formatNumber(columns.length)} columns and {formatNumber(rowCount)} rows directly in DuckDB to surface quality, distribution, anomaly, and extreme-value signals without routing through Ollama.</p>
          </div>
          <div className="rounded-xl border border-gray-200/70 bg-gray-50/80 px-4 py-3 text-sm dark:border-gray-700/70 dark:bg-gray-950/30">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Current scan</p>
            <div className="mt-2 flex items-end justify-between gap-6">
              <div><p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{formatNumber(insights.length)}</p><p className="text-xs text-gray-500 dark:text-gray-400">cards generated</p></div>
              <div className="text-right"><p className="text-lg font-semibold text-amber-600 dark:text-amber-300">{formatNumber(warningCount)}</p><p className="text-xs text-gray-500 dark:text-gray-400">{formatNumber(interestingCount)} notable signals</p></div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((option) => (
              <button key={option.value} type="button" onClick={() => setFilter(option.value)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] transition ${option.value === filter ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:text-gray-100"}`}>{option.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">{lastUpdated ? `Refreshed ${new Date(lastUpdated).toLocaleTimeString()}` : "Waiting for first scan"}</p>
            <button type="button" onClick={() => setRefreshNonce((value) => value + 1)} disabled={loading} className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900/70 dark:text-gray-200 dark:hover:border-gray-500">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        {error ? <div className="rounded-xl border border-red-200/70 bg-red-500/10 px-4 py-4 text-sm text-red-700 dark:border-red-500/20 dark:text-red-300">{error}</div> : null}
        {loading && insights.length === 0 ? (
          <div className="mt-2 grid gap-4 lg:grid-cols-2">{Array.from({ length: 4 }).map((_, index) => <SkeletonCard key={index} className="min-h-[220px]" />)}</div>
        ) : (
          <motion.div variants={listVariants} initial="hidden" animate="show" className={`grid gap-4 lg:grid-cols-2 ${loading ? "opacity-80" : ""}`}>
            <AnimatePresence mode="popLayout">
              {visible.map((insight) => {
                const meta = KIND_META[insight.kind];
                const open = Boolean(expanded[insight.id]);
                return (
                  <motion.article key={insight.id} layout variants={itemVariants} className="overflow-hidden rounded-2xl border border-gray-200/70 bg-gray-50/80 dark:border-gray-700/70 dark:bg-gray-950/25">
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div className="rounded-xl border border-gray-200/80 bg-white p-2.5 dark:border-gray-700/80 dark:bg-gray-900/80"><meta.Icon className={`h-5 w-5 ${meta.accent}`} /></div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">{meta.label}</span>
                              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${SEVERITY_META[insight.severity]}`}>{insight.severity}</span>
                            </div>
                            <h3 className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-50">{insight.title}</h3>
                          </div>
                        </div>
                        <div className="rounded-full border border-gray-200/80 bg-white px-3 py-1 text-sm font-semibold text-gray-700 dark:border-gray-700/80 dark:bg-gray-900/80 dark:text-gray-200">{insight.metric}</div>
                      </div>

                      <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">{insight.description}</p>
                      <div className="mt-4">
                        <button type="button" onClick={() => setExpanded((current) => ({ ...current, [insight.id]: !current[insight.id] }))} className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-gray-600 transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-900/80 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:text-gray-100">
                          SQL Query <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
                        </button>
                      </div>

                      <AnimatePresence initial={false}>
                        {open ? (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
                            <div className="mt-4"><SQLPreview sql={insight.sql} /></div>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  </motion.article>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </section>
  );
}
