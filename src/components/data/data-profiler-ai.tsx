"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Copy,
  Database,
  Hash,
  KeyRound,
  Link2,
  Loader2,
  Sparkles,
  ToggleLeft,
  Type,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile, ColumnType } from "@/types/dataset";

interface DataProfilerAIProps { tableName: string; columns: ColumnProfile[]; rowCount: number; }
type InsightTone = "good" | "warn" | "info";
interface Insight {
  id: string;
  scope: "dataset" | "column";
  title: string;
  summary: string;
  detail: string;
  confidence: number;
  tone: InsightTone;
  icon: React.ElementType;
  columnName?: string;
}

const EASE = [0.16, 1, 0.3, 1] as const;
const CARD = "rounded-3xl border border-white/15 bg-white/10 backdrop-blur-xl shadow-[0_22px_70px_-40px_rgba(15,23,42,0.85)] dark:border-white/10 dark:bg-slate-950/40";
const TONES: Record<InsightTone, string> = {
  good: "border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warn: "border-amber-400/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  info: "border-cyan-400/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
};
const ICONS: Record<ColumnType, React.ElementType> = { number: Hash, string: Type, date: Calendar, boolean: ToggleLeft, unknown: Sparkles };

const quoteId = (value: string) => `"${value.replaceAll('"', '""')}"`;
const readNumber = (value: unknown) => typeof value === "number" ? (Number.isFinite(value) ? value : 0) : typeof value === "bigint" ? Number(value) : Number(value ?? 0) || 0;
const readText = (value: unknown) => value === null || value === undefined ? "" : String(value);
const distributionLabel = (skewness: number, peaks: number) => peaks >= 2 ? "bimodal" : skewness >= 0.85 ? "right-skewed" : skewness <= -0.85 ? "left-skewed" : Math.abs(skewness) <= 0.35 ? "roughly normal" : "moderately skewed";
const hashExpr = (columns: string[]) => columns.length ? columns.map((column) => `COALESCE(CAST(${quoteId(column)} AS VARCHAR), '∅')`).join(` || '¦' || `) : "'row'";
const copyPayload = (dataset: Insight[], columns: Insight[]) => {
  const sections: Array<[string, Insight[]]> = [["Dataset insights", dataset], ["Column insights", columns]];
  return sections
    .map(([label, items]) => `${label}\n${items.map((item) => `- ${item.columnName ? `${item.columnName}: ` : ""}${item.title} (${item.confidence}%)\n  ${item.summary}\n  ${item.detail}`).join("\n")}`)
    .join("\n\n");
};

function SummaryStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className={`${CARD} px-4 py-3`}>
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">{value}</div>
      <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{detail}</div>
    </div>
  );
}

function InsightCard({ insight, expanded, onToggle }: { insight: Insight; expanded: boolean; onToggle: () => void }) {
  const Icon = insight.icon;
  return (
    <motion.article layout initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE }} className={`${CARD} overflow-hidden`}>
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-4 px-5 py-4 text-left">
        <div className={`mt-1 rounded-2xl border px-3 py-3 ${TONES[insight.tone]}`}><Icon className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {insight.columnName ? <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{insight.columnName}</span> : null}
            <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Confidence {insight.confidence}%</span>
          </div>
          <h3 className="mt-3 text-base font-semibold text-slate-950 dark:text-slate-50">{insight.title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{insight.summary}</p>
        </div>
        <ChevronDown className={`mt-1 h-5 w-5 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div key="detail" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: EASE }} className="overflow-hidden border-t border-white/10 px-5 py-4">
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{insight.detail}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  );
}

async function analyzeNumeric(tableName: string, column: ColumnProfile): Promise<Insight[]> {
  const field = quoteId(column.name);
  const table = quoteId(tableName);
  const [statsRows, histogramRows, outlierRows] = await Promise.all([
    runQuery(`WITH source AS (SELECT CAST(${field} AS DOUBLE) AS value FROM ${table} WHERE ${field} IS NOT NULL), stats AS (SELECT COUNT(*) AS non_null_count, AVG(value) AS mean_value, STDDEV_POP(value) AS stddev_value, QUANTILE_CONT(value, 0.25) AS q1, QUANTILE_CONT(value, 0.75) AS q3 FROM source), shape AS (SELECT AVG(POWER(source.value - stats.mean_value, 3)) / NULLIF(POWER(stats.stddev_value, 3), 0) AS skewness FROM source, stats) SELECT * FROM stats, shape`),
    runQuery(`WITH source AS (SELECT CAST(${field} AS DOUBLE) AS value FROM ${table} WHERE ${field} IS NOT NULL), bounds AS (SELECT MIN(value) AS min_value, MAX(value) AS max_value FROM source) SELECT CASE WHEN bounds.max_value = bounds.min_value THEN 0 ELSE LEAST(7, GREATEST(0, CAST(FLOOR(((source.value - bounds.min_value) / NULLIF(bounds.max_value - bounds.min_value, 0)) * 8) AS INTEGER))) END AS bin_id, COUNT(*) AS bucket_count FROM source, bounds GROUP BY 1 ORDER BY 1`),
    runQuery(`WITH source AS (SELECT CAST(${field} AS DOUBLE) AS value FROM ${table} WHERE ${field} IS NOT NULL), stats AS (SELECT QUANTILE_CONT(value, 0.25) AS q1, QUANTILE_CONT(value, 0.75) AS q3 FROM source), bounds AS (SELECT q1 - 1.5 * (q3 - q1) AS lower_bound, q3 + 1.5 * (q3 - q1) AS upper_bound FROM stats) SELECT COUNT(*) FILTER (WHERE source.value < bounds.lower_bound OR source.value > bounds.upper_bound) AS outlier_count, COUNT(*) FILTER (WHERE source.value > bounds.upper_bound) AS high_outliers, COUNT(*) FILTER (WHERE source.value < bounds.lower_bound) AS low_outliers FROM source, bounds`),
  ]);
  const stats = statsRows[0] ?? {};
  const nonNull = readNumber(stats.non_null_count);
  const skewness = readNumber(stats.skewness);
  const peaks = histogramRows.filter((row, index, rows) => {
    const current = readNumber(row.bucket_count);
    const left = index === 0 ? 0 : readNumber(rows[index - 1].bucket_count);
    const right = index === rows.length - 1 ? 0 : readNumber(rows[index + 1].bucket_count);
    return current > left && current > right;
  }).length;
  const outliers = outlierRows[0] ?? {};
  const confidence = Math.min(96, Math.round(58 + Math.min(nonNull, 5000) / 120));
  const bins = Math.max(5, Math.min(24, Math.round(Math.log2(Math.max(nonNull, 2)) + 1)));

  return [
    {
      id: `${column.name}:distribution`, scope: "column", columnName: column.name, icon: Hash, tone: peaks >= 2 ? "warn" : "info", confidence,
      title: "Distribution profile",
      summary: `${column.name} looks ${distributionLabel(skewness, peaks)} based on DuckDB histogram buckets and skewness.`,
      detail: `DuckDB estimated skewness at ${skewness.toFixed(2)} across ${formatNumber(nonNull)} non-null rows. The bucket scan found ${peaks} local peak${peaks === 1 ? "" : "s"}, which is why the profile leans ${distributionLabel(skewness, peaks)}.`,
    },
    {
      id: `${column.name}:outliers`, scope: "column", columnName: column.name, icon: AlertTriangle, tone: readNumber(outliers.outlier_count) > 0 ? "warn" : "good", confidence: Math.min(98, confidence + 2),
      title: "Outlier envelope",
      summary: readNumber(outliers.outlier_count) > 0 ? `${formatNumber(readNumber(outliers.outlier_count))} rows fall outside the IQR fence, with ${formatNumber(readNumber(outliers.high_outliers))} on the high side.` : "DuckDB did not detect meaningful IQR outliers in this numeric column.",
      detail: `The bounds use Tukey fences from Q1/Q3 computed in DuckDB. Suggested binning: start with ${bins} bins for dashboards or ${Math.max(4, Math.round(Math.sqrt(Math.max(nonNull, 1))))} bins for dense histograms.`,
    },
  ];
}

async function analyzeText(tableName: string, column: ColumnProfile, rowCount: number): Promise<Insight[]> {
  const field = quoteId(column.name);
  const table = quoteId(tableName);
  const [patternRows, topRows] = await Promise.all([
    runQuery(`SELECT COUNT(*) FILTER (WHERE ${field} IS NOT NULL) AS non_null_count, COUNT(*) FILTER (WHERE regexp_matches(CAST(${field} AS VARCHAR), '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$')) AS email_count, COUNT(*) FILTER (WHERE regexp_matches(LOWER(CAST(${field} AS VARCHAR)), '^(https?://|www\\.)')) AS url_count, COUNT(*) FILTER (WHERE regexp_matches(CAST(${field} AS VARCHAR), '^[A-Z][a-z]+(?: [A-Z][a-z]+){1,2}$')) AS name_count, COUNT(*) FILTER (WHERE regexp_matches(CAST(${field} AS VARCHAR), '(Ã.|Â.|â.|�)')) AS encoding_issue_count FROM ${table}`),
    runQuery(`SELECT CAST(${field} AS VARCHAR) AS value, COUNT(*) AS value_count FROM ${table} WHERE ${field} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1 ASC LIMIT 5`),
  ]);
  const stats = patternRows[0] ?? {};
  const nonNull = readNumber(stats.non_null_count);
  const ratios = { email: nonNull ? readNumber(stats.email_count) / nonNull : 0, url: nonNull ? readNumber(stats.url_count) / nonNull : 0, name: nonNull ? readNumber(stats.name_count) / nonNull : 0 };
  const dominant = ratios.email >= ratios.url && ratios.email >= ratios.name ? "email addresses" : ratios.url >= ratios.name ? "URLs" : "human names";
  const encodingIssues = readNumber(stats.encoding_issue_count);
  const lowCardinality = rowCount > 0 ? column.uniqueCount / rowCount <= 0.12 : false;
  const topPreview = topRows.map((row) => `${readText(row.value)} (${formatNumber(readNumber(row.value_count))})`).join(", ");

  return [
    {
      id: `${column.name}:patterns`, scope: "column", columnName: column.name, icon: Type, tone: "info", confidence: Math.min(95, Math.round(52 + Math.min(nonNull, 4000) / 100)),
      title: "Dominant text pattern",
      summary: `${column.name} mostly behaves like ${dominant}, which changes how it should be normalized or grouped.`,
      detail: `DuckDB pattern checks found ${formatPercent(ratios.email * 100)} emails, ${formatPercent(ratios.url * 100)} URLs, and ${formatPercent(ratios.name * 100)} title-cased names. ${topPreview ? `Top values: ${topPreview}.` : "No dominant top values were returned."}`,
    },
    {
      id: `${column.name}:quality`, scope: "column", columnName: column.name, icon: encodingIssues > 0 ? AlertTriangle : CheckCircle2, tone: encodingIssues > 0 ? "warn" : "good", confidence: encodingIssues > 0 ? 93 : 79,
      title: "Encoding and category advice",
      summary: encodingIssues > 0 ? `${formatNumber(encodingIssues)} rows show likely mojibake or replacement-character issues.` : lowCardinality ? `${column.name} is low-cardinality enough to behave like a categorical dimension.` : "This column looks safer as free text than as a strict category list.",
      detail: encodingIssues > 0 ? "DuckDB found byte-sequence artifacts such as Ã, Â, â, or replacement characters. Clean the encoding before tokenization or model training." : lowCardinality ? `Only ${formatNumber(column.uniqueCount)} distinct values appear across ${formatNumber(rowCount)} rows, so a dimension table or enum-like grouping is reasonable.` : "Distinct-value density is high enough that forcing categories now would likely create unstable labels.",
    },
  ];
}

async function analyzeDate(tableName: string, column: ColumnProfile): Promise<Insight[]> {
  const field = quoteId(column.name);
  const table = quoteId(tableName);
  const rows = await runQuery(`WITH dates AS (SELECT DISTINCT DATE_TRUNC('day', CAST(${field} AS TIMESTAMP)) AS day_value FROM ${table} WHERE ${field} IS NOT NULL), gaps AS (SELECT DATE_DIFF('day', day_value, LEAD(day_value) OVER (ORDER BY day_value)) AS gap_days FROM dates) SELECT (SELECT MIN(day_value)::VARCHAR FROM dates) AS start_date, (SELECT MAX(day_value)::VARCHAR FROM dates) AS end_date, (SELECT COUNT(*) FROM dates) AS distinct_days, (SELECT AVG(gap_days) FROM gaps WHERE gap_days IS NOT NULL) AS avg_gap_days, (SELECT MAX(gap_days) FROM gaps WHERE gap_days IS NOT NULL) AS max_gap_days, (SELECT COUNT(*) FROM gaps WHERE gap_days > 1) AS gap_count`);
  const stats = rows[0] ?? {};
  const avgGap = readNumber(stats.avg_gap_days);
  const cadence = avgGap <= 1.5 ? "daily" : avgGap <= 8 ? "weekly" : avgGap <= 35 ? "monthly" : "irregular";
  return [
    {
      id: `${column.name}:range`, scope: "column", columnName: column.name, icon: Calendar, tone: "info", confidence: 87,
      title: "Time range and cadence",
      summary: `${column.name} spans ${readText(stats.start_date)} to ${readText(stats.end_date)} and behaves like a ${cadence} series.`,
      detail: `DuckDB found ${formatNumber(readNumber(stats.distinct_days))} distinct calendar days with an average gap of ${avgGap.toFixed(2)} days between observations.`,
    },
    {
      id: `${column.name}:gaps`, scope: "column", columnName: column.name, icon: readNumber(stats.gap_count) > 0 ? AlertTriangle : CheckCircle2, tone: readNumber(stats.gap_count) > 0 ? "warn" : "good", confidence: 90,
      title: "Coverage gaps",
      summary: readNumber(stats.gap_count) > 0 ? `${formatNumber(readNumber(stats.gap_count))} breaks appear in the sequence, with the largest gap reaching ${formatNumber(readNumber(stats.max_gap_days))} days.` : "The observed dates are contiguous enough that no major missing intervals stand out.",
      detail: "This gap count comes from distinct day-level observations, so duplicate timestamps do not inflate the signal. Use it to decide whether forward-fill or calendar scaffolding is needed.",
    },
  ];
}

async function analyzeBoolean(tableName: string, column: ColumnProfile, rowCount: number): Promise<Insight[]> {
  const field = quoteId(column.name);
  const table = quoteId(tableName);
  const rows = await runQuery(`SELECT COUNT(*) FILTER (WHERE ${field} = TRUE) AS true_count, COUNT(*) FILTER (WHERE ${field} = FALSE) AS false_count, COUNT(*) FILTER (WHERE ${field} IS NOT NULL) AS non_null_count FROM ${table}`);
  const stats = rows[0] ?? {};
  const trueCount = readNumber(stats.true_count);
  const falseCount = readNumber(stats.false_count);
  const nonNull = readNumber(stats.non_null_count);
  const ratio = nonNull ? trueCount / nonNull : 0;
  const looksLikeLabel = /(target|label|flag|active|converted|churn|fraud|success|is_|has_)/i.test(column.name) || (rowCount > 0 && ratio >= 0.05 && ratio <= 0.95);
  return [
    {
      id: `${column.name}:balance`, scope: "column", columnName: column.name, icon: ToggleLeft, tone: ratio <= 0.02 || ratio >= 0.98 ? "warn" : "good", confidence: Math.min(94, 66 + Math.round(nonNull / 120)),
      title: "Boolean balance",
      summary: `${formatPercent(ratio * 100)} true vs ${formatPercent((1 - ratio) * 100)} false across populated rows.`,
      detail: `DuckDB counted ${formatNumber(trueCount)} true values and ${formatNumber(falseCount)} false values. Severe imbalance can be useful for anomaly flags, but it weakens sampling and modeling stability.`,
    },
    {
      id: `${column.name}:label`, scope: "column", columnName: column.name, icon: Sparkles, tone: looksLikeLabel ? "info" : "good", confidence: looksLikeLabel ? 78 : 64,
      title: "Potential label signal",
      summary: looksLikeLabel ? `${column.name} looks usable as a label or outcome column.` : `${column.name} behaves more like a feature flag than a supervised target.`,
      detail: "The heuristic combines balance, null rate, and naming cues. Treat this as a modeling prompt rather than a hard classification.",
    },
  ];
}

async function analyzeDataset(tableName: string, columns: ColumnProfile[], rowCount: number): Promise<Insight[]> {
  const uniqueCandidates = columns.filter((column) => column.nullCount === 0 && column.uniqueCount >= Math.max(1, rowCount - 1));
  const joinCandidates = columns.filter((column) => /(_id|_key|code)$/i.test(column.name));
  const primaryChecks = await Promise.all(uniqueCandidates.slice(0, 4).map(async (column) => ({ column, stats: (await runQuery(`SELECT COUNT(*) AS total_rows, COUNT(DISTINCT ${quoteId(column.name)}) AS distinct_rows FROM ${quoteId(tableName)}`))[0] ?? {} })));
  const primaryKey = primaryChecks.find((item) => readNumber(item.stats.total_rows) === readNumber(item.stats.distinct_rows))?.column ?? null;
  const distinctHashes = readNumber((await runQuery(`SELECT COUNT(DISTINCT md5(${hashExpr(columns.slice(0, Math.min(columns.length, 6)).map((column) => column.name))})) AS distinct_hashes FROM ${quoteId(tableName)}`))[0]?.distinct_hashes);
  const dateCount = columns.filter((column) => column.type === "date").length;
  const numericCount = columns.filter((column) => column.type === "number").length;
  const categoricalCount = columns.filter((column) => column.type === "string" && rowCount > 0 && column.uniqueCount / rowCount <= 0.12).length;

  return [
    {
      id: "dataset:primary", scope: "dataset", icon: KeyRound, tone: primaryKey ? "good" : "warn", confidence: primaryKey ? 96 : 74,
      title: "Potential primary key",
      summary: primaryKey ? `${primaryKey.name} is a strong primary-key candidate with full uniqueness and no nulls.` : "No single column proved to be a clean primary key from the current schema profile.",
      detail: primaryKey ? `DuckDB validated ${primaryKey.name} with ${formatNumber(rowCount)} distinct values across ${formatNumber(rowCount)} rows.` : `The sampled row signature still produced ${formatNumber(distinctHashes)} distinct row hashes, so uniqueness likely comes from multi-column combinations.`,
    },
    {
      id: "dataset:joins", scope: "dataset", icon: Link2, tone: "info", confidence: joinCandidates.length ? 82 : 60,
      title: "Suggested join surfaces",
      summary: joinCandidates.length ? `${joinCandidates.map((column) => column.name).join(", ")} look like dimension or fact-table join columns.` : "This table does not expose obvious foreign-key style columns by name.",
      detail: joinCandidates.length ? "Columns ending in _id, _key, or code typically anchor joins to dimensions such as customers, products, or regions. Pair them with lookup tables before denormalizing." : "If joins still exist, they likely depend on business-specific names rather than common key suffixes.",
    },
    {
      id: "dataset:modeling", scope: "dataset", icon: Database, tone: "info", confidence: 80,
      title: "Data modeling advice",
      summary: dateCount > 0 && numericCount >= 2 && categoricalCount >= 1 ? "This schema reads like an analytic fact table: keep measures wide and push repeated text dimensions into lookups." : categoricalCount >= 3 ? "Repeated low-cardinality strings suggest a dimension-heavy model with reusable lookup tables." : "The table behaves more like an operational extract than a clean reporting star schema.",
      detail: `Profile mix: ${numericCount} numeric, ${dateCount} date, ${categoricalCount} low-cardinality text columns. Use that mix to decide whether metrics stay in a central fact table or should be split into slower-changing dimensions.`,
    },
  ];
}

export default function DataProfilerAI({ tableName, columns, rowCount }: DataProfilerAIProps) {
  const [datasetInsights, setDatasetInsights] = useState<Insight[]>([]);
  const [columnInsights, setColumnInsights] = useState<Insight[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const signature = useMemo(() => `${tableName}:${rowCount}:${columns.map((column) => `${column.name}:${column.type}:${column.uniqueCount}:${column.nullCount}`).join("|")}`, [columns, rowCount, tableName]);
  const grouped = useMemo(() => {
    const groups = new Map<string, Insight[]>();
    for (const insight of columnInsights) groups.set(insight.columnName ?? "unknown", [...(groups.get(insight.columnName ?? "unknown") ?? []), insight]);
    return Array.from(groups.entries());
  }, [columnInsights]);
  const typeCounts = useMemo(() => ({
    numeric: columns.filter((column) => column.type === "number").length,
    text: columns.filter((column) => column.type === "string").length,
    date: columns.filter((column) => column.type === "date").length,
    boolean: columns.filter((column) => column.type === "boolean").length,
  }), [columns]);
  const joinReady = useMemo(() => columns.filter((column) => /(_id|_key|code)$/i.test(column.name)).map((column) => column.name), [columns]);

  useEffect(() => {
    let cancelled = false;
    async function runAnalysis() {
      setLoading(true);
      setNotice(null);
      try {
        const dataset = await analyzeDataset(tableName, columns, rowCount);
        const perColumn = await Promise.all(columns.map(async (column) => column.type === "number" ? analyzeNumeric(tableName, column) : column.type === "string" ? analyzeText(tableName, column, rowCount) : column.type === "date" ? analyzeDate(tableName, column) : column.type === "boolean" ? analyzeBoolean(tableName, column, rowCount) : [{ id: `${column.name}:fallback`, scope: "column" as const, columnName: column.name, title: "Limited profile coverage", summary: `${column.name} could not be confidently typed beyond the existing schema hint.`, detail: "DuckDB can still query this field, but the profiler does not have a richer rule set for the detected type yet.", confidence: 42, tone: "warn" as const, icon: ICONS[column.type] }]));
        if (cancelled) return;
        const flat = perColumn.flat();
        startTransition(() => {
          setDatasetInsights(dataset);
          setColumnInsights(flat);
          setExpanded(Object.fromEntries([...dataset, ...flat].slice(0, 2).map((item) => [item.id, true])));
        });
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : "Profiling failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void runAnalysis();
    return () => { cancelled = true; };
  }, [signature, tableName, columns, rowCount]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(copyPayload(datasetInsights, columnInsights));
      setNotice("Copied all insights to the clipboard.");
    } catch {
      setNotice("Clipboard access failed in this browser context.");
    }
  }

  return (
    <section className="overflow-hidden rounded-[30px] border border-white/15 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_30%),linear-gradient(135deg,rgba(248,250,252,0.92),rgba(226,232,240,0.75))] shadow-[0_30px_120px_-50px_rgba(15,23,42,0.9)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_26%),linear-gradient(135deg,rgba(2,6,23,0.94),rgba(15,23,42,0.88))]">
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300"><Sparkles className="h-3.5 w-3.5" />AI Data Profiler</div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Rule-based DuckDB insights for {tableName}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">Numeric, text, date, and boolean columns are profiled with DuckDB queries, then summarized into confidence-scored cards you can expand or export.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className={`${CARD} px-4 py-3`}><div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Rows</div><div className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">{formatNumber(rowCount)}</div></div>
            <div className={`${CARD} px-4 py-3`}><div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Columns</div><div className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">{formatNumber(columns.length)}</div></div>
            <button type="button" onClick={() => void handleCopy()} disabled={loading || (!datasetInsights.length && !columnInsights.length)} className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-200"><Copy className="h-4 w-4" />Copy all insights</button>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-6 py-6">
        {loading ? <div className={`${CARD} flex min-h-44 items-center justify-center gap-3 px-6 py-10 text-slate-600 dark:text-slate-300`}><Loader2 className="h-5 w-5 animate-spin" />Running DuckDB profiling queries...</div> : null}
        {notice ? <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-800 dark:text-cyan-200">{notice}</div> : null}
        {!loading ? (
          <div className="grid gap-3 lg:grid-cols-4">
            <SummaryStat label="Insight cards" value={formatNumber(datasetInsights.length + columnInsights.length)} detail="DuckDB-backed findings rendered below." />
            <SummaryStat label="Numeric + text" value={`${typeCounts.numeric} / ${typeCounts.text}`} detail="Measures and descriptive attributes." />
            <SummaryStat label="Temporal + boolean" value={`${typeCounts.date} / ${typeCounts.boolean}`} detail="Time coverage and label-like flags." />
            <SummaryStat label="Join candidates" value={formatNumber(joinReady.length)} detail={joinReady.length ? joinReady.slice(0, 3).join(", ") : "No obvious join keys by name."} />
          </div>
        ) : null}
        {!loading ? (
          <div className={`${CARD} p-5`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h4 className="text-base font-semibold text-slate-950 dark:text-slate-50">What deserves attention first</h4>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  High-confidence warnings generally indicate the fastest wins: encoding problems, large temporal gaps, strong skew, or outlier-heavy numeric measures.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <SummaryStat label="Warnings" value={formatNumber([...datasetInsights, ...columnInsights].filter((item) => item.tone === "warn").length)} detail="Issues likely to need cleanup or modeling caution." />
                <SummaryStat label="High confidence" value={formatNumber([...datasetInsights, ...columnInsights].filter((item) => item.confidence >= 85).length)} detail="Signals with stronger query support." />
                <SummaryStat label="Key-like fields" value={formatNumber(columns.filter((column) => /(_id|_key|code)$/i.test(column.name)).length)} detail="Likely candidates for joins or dimensions." />
              </div>
            </div>
          </div>
        ) : null}
        {!loading ? (
          <>
            <div className="space-y-4">
              <div className="flex items-center gap-3"><Database className="h-5 w-5 text-cyan-600 dark:text-cyan-300" /><h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Overall dataset insights</h3></div>
            <div className="grid gap-4 xl:grid-cols-3">
                {datasetInsights.map((insight) => <InsightCard key={insight.id} insight={insight} expanded={Boolean(expanded[insight.id])} onToggle={() => setExpanded((current) => ({ ...current, [insight.id]: !current[insight.id] }))} />)}
              </div>
            </div>

            <div className="space-y-5">
              <div className="flex items-center gap-3"><Sparkles className="h-5 w-5 text-cyan-600 dark:text-cyan-300" /><h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Column-level intelligence</h3></div>
              <div className="space-y-5">
                {grouped.map(([columnName, items]) => {
                  const Icon = ICONS[columns.find((entry) => entry.name === columnName)?.type ?? "unknown"];
                  return (
                    <div key={columnName} className={`${CARD} p-5`}>
                      <div className="mb-4 flex items-center gap-3">
                        <div className="rounded-2xl border border-white/15 bg-white/10 p-3"><Icon className="h-5 w-5 text-cyan-700 dark:text-cyan-300" /></div>
                        <div><h4 className="text-base font-semibold text-slate-950 dark:text-slate-50">{columnName}</h4><p className="text-sm text-slate-500 dark:text-slate-400">{columns.find((entry) => entry.name === columnName)?.type ?? "unknown"} column</p></div>
                      </div>
                      <div className="grid gap-4 xl:grid-cols-2">
                        {items.map((insight) => <InsightCard key={insight.id} insight={insight} expanded={Boolean(expanded[insight.id])} onToggle={() => setExpanded((current) => ({ ...current, [insight.id]: !current[insight.id] }))} />)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className={`${CARD} p-5`}>
              <div className="flex items-start gap-3">
                <div className="rounded-2xl border border-white/15 bg-white/10 p-3"><Sparkles className="h-5 w-5 text-cyan-700 dark:text-cyan-300" /></div>
                <div>
                  <h4 className="text-base font-semibold text-slate-950 dark:text-slate-50">How the profiler is reasoning</h4>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    Every card above is generated from DuckDB queries against <span className="font-mono text-slate-900 dark:text-slate-100">{tableName}</span>. Numeric fields use histogram, skewness, and IQR checks; text fields use regex-based pattern detection; date fields use gap analysis; boolean fields use balance and naming heuristics.
                  </p>
                  <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    Confidence is a pragmatic score based on row coverage and signal strength rather than a statistical guarantee. Treat it as ranking guidance for where to investigate first.
                  </p>
                  <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    For operational use, start with warnings that touch join keys, date coverage, or encoding. Those usually have the highest downstream blast radius in dashboards, models, and exports.
                  </p>
                  <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    If you need stricter validation, the next step is to convert the highest-risk cards into saved checks: null thresholds, cardinality drift checks, or freshness alerts around time columns.
                  </p>
                  <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    The component is intentionally opinionated: it favors concise investigative guidance over exhaustive statistical output, so analysts can move from profiling to action without leaving the workspace.
                  </p>
                  <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    Use the copy action when you want to move these findings into notes, tickets, or a QA handoff.
                  </p>

                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
