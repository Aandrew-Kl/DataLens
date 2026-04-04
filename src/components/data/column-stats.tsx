"use client";

import { memo, useEffect, useState, type ElementType, type ReactNode } from "react";
import ReactECharts from "echarts-for-react";
import { motion } from "framer-motion";
import {
  Activity, AlertTriangle, BarChart3, Calendar, Clock3, Hash, Layers3,
  LineChart, Loader2, Search, Sigma, Type,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { SkeletonCard, SkeletonChart } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface ColumnStatsProps { tableName: string; column: ColumnProfile; rowCount: number; }
interface Bin { label: string; count: number; start?: number; end?: number; }
interface BaseStats { count: number; distinct: number; nulls: number; }
interface NumericStats extends BaseStats { kind: "number"; mean: number | null; median: number | null; mode: string | null; stddev: number | null; min: number | null; max: number | null; range: number | null; q1: number | null; q3: number | null; iqr: number | null; histogram: Bin[]; }
interface PatternMetric { label: string; count: number; }
interface StringStats extends BaseStats { kind: "string"; minLength: number | null; maxLength: number | null; avgLength: number | null; topValues: Bin[]; patterns: PatternMetric[]; }
interface Gap { start: string; end: string; days: number; }
interface DateStats extends BaseStats { kind: "date"; minDate: string | null; maxDate: string | null; rangeDays: number | null; monthly: Bin[]; dayOfWeek: Bin[]; gaps: Gap[]; }
type Stats = NumericStats | StringStats | DateStats;
const COLORS = { numeric: "#06b6d4", string: "#f97316", date: "#22c55e" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
const asNumber = (value: unknown) => { const num = value == null ? NaN : Number(value); return Number.isFinite(num) ? num : null; };
const asText = (value: unknown) => (value == null ? null : String(value));
const truncate = (value: string, max = 32) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
const formatMetric = (value: number | null, digits = 2) => value == null ? "—" : Math.abs(value) >= 1000 || Number.isInteger(value) ? formatNumber(value) : value.toFixed(digits);
function formatDateLabel(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}
function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}
function buildChart(data: Bin[], dark: boolean, color: string, options?: { horizontal?: boolean; line?: boolean }) {
  const horizontal = options?.horizontal ?? false;
  const line = options?.line ?? false;
  const labels = data.map((item) => item.label);
  const values = data.map((item) => item.count);
  const textColor = dark ? "#a1a1aa" : "#6b7280";
  const borderColor = dark ? "#27272a" : "#e5e7eb";
  const tooltipBg = dark ? "#111827ee" : "#ffffffee";
  return horizontal ? {
    animationDuration: 450,
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: tooltipBg, borderColor, textStyle: { color: dark ? "#f3f4f6" : "#111827" } },
    grid: { left: 16, right: 24, top: 12, bottom: 12, containLabel: true },
    xAxis: { type: "value", axisLabel: { color: textColor, fontSize: 11 }, splitLine: { lineStyle: { color: borderColor, type: "dashed" } } },
    yAxis: { type: "category", data: labels, axisLabel: { color: textColor, fontSize: 11, width: 120, overflow: "truncate" }, axisLine: { lineStyle: { color: borderColor } } },
    series: [{ type: "bar", data: values, barWidth: 18, itemStyle: { color, borderRadius: [0, 8, 8, 0] } }],
  } : {
    animationDuration: 450,
    tooltip: { trigger: line ? "axis" : "item", backgroundColor: tooltipBg, borderColor, textStyle: { color: dark ? "#f3f4f6" : "#111827" } },
    grid: { left: 16, right: 24, top: 20, bottom: 30, containLabel: true },
    xAxis: { type: "category", data: labels, boundaryGap: !line, axisLabel: { color: textColor, fontSize: 11, rotate: labels.length > 8 ? 25 : 0 }, axisLine: { lineStyle: { color: borderColor } } },
    yAxis: { type: "value", axisLabel: { color: textColor, fontSize: 11 }, splitLine: { lineStyle: { color: borderColor, type: "dashed" } } },
    series: [{ type: line ? "line" : "bar", smooth: line, data: values, symbol: line ? "circle" : "none", symbolSize: 6, lineStyle: { color, width: 3 }, areaStyle: line ? { color, opacity: 0.1 } : undefined, itemStyle: { color, borderRadius: [8, 8, 0, 0] } }],
  };
}
function buildBoxPlot(stats: NumericStats, dark: boolean) {
  const borderColor = dark ? "#27272a" : "#e5e7eb";
  const textColor = dark ? "#a1a1aa" : "#6b7280";
  if ([stats.min, stats.q1, stats.median, stats.q3, stats.max].some((value) => value == null)) return {};
  return {
    animationDuration: 450,
    tooltip: { trigger: "item", formatter: [`min: ${formatMetric(stats.min)}`, `Q1: ${formatMetric(stats.q1)}`, `median: ${formatMetric(stats.median)}`, `Q3: ${formatMetric(stats.q3)}`, `max: ${formatMetric(stats.max)}`].join("<br/>"), backgroundColor: dark ? "#111827ee" : "#ffffffee", borderColor, textStyle: { color: dark ? "#f3f4f6" : "#111827" } },
    grid: { left: 16, right: 24, top: 12, bottom: 24, containLabel: true },
    xAxis: { type: "category", data: ["Spread"], axisLabel: { color: textColor, fontSize: 11 }, axisLine: { lineStyle: { color: borderColor } } },
    yAxis: { type: "value", axisLabel: { color: textColor, fontSize: 11 }, splitLine: { lineStyle: { color: borderColor, type: "dashed" } } },
    series: [{ type: "boxplot", data: [[stats.min, stats.q1, stats.median, stats.q3, stats.max]], itemStyle: { color: "rgba(6, 182, 212, 0.25)", borderColor: COLORS.numeric, borderWidth: 2 } }],
  };
}
function Panel({ title, icon: Icon, accent, children }: { title: string; icon: ElementType; accent: string; children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: "easeOut" }}
      className="rounded-2xl border border-gray-200/70 bg-white/80 p-5 shadow-sm dark:border-gray-700/70 dark:bg-gray-900/60">
      <div className="mb-4 flex items-center gap-3">
        <div className={`rounded-xl p-2 ${accent}`}><Icon className="h-4 w-4" /></div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      </div>
      {children}
    </motion.div>
  );
}
function MetricGrid({ items }: { items: { label: string; value: string | number; tone?: "default" | "danger" }[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-gray-200/70 bg-gray-50/80 px-4 py-3 dark:border-gray-800/70 dark:bg-gray-950/35">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">{item.label}</p>
          <p className={`mt-1 text-xl font-semibold ${item.tone === "danger" ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-gray-100"}`}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}
function InsightList({ items }: { items: string[] }) {
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <motion.div key={item} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.03, duration: 0.22 }}
          className="rounded-xl border border-gray-200/70 bg-gray-50/80 px-4 py-3 text-sm leading-6 text-gray-700 dark:border-gray-800/70 dark:bg-gray-950/35 dark:text-gray-300">
          {item}
        </motion.div>
      ))}
    </div>
  );
}
function LoadingView({ name }: { name: string }) {
  return (
    <section className="rounded-2xl border border-gray-200/70 bg-white/80 p-6 dark:border-gray-700/70 dark:bg-gray-900/60">
      <div className="mb-6 flex items-start justify-between gap-4 border-b border-gray-200/70 pb-5 dark:border-gray-700/70">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-600 dark:text-cyan-400">Column Statistics</p>
          <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-gray-100">{name}</h2>
        </div>
        <Loader2 className="h-5 w-5 animate-spin text-cyan-500" />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6"><SkeletonCard className="min-h-[240px]" /><SkeletonChart className="min-h-[280px]" /></div>
        <div className="space-y-6"><SkeletonCard className="min-h-[240px]" /><SkeletonChart className="min-h-[280px]" /></div>
      </div>
    </section>
  );
}

async function loadNumeric(tableName: string, columnName: string): Promise<NumericStats> {
  const table = quote(tableName);
  const column = quote(columnName);
  const base = await runQuery(`
    SELECT COUNT(${column}) AS count, COUNT(DISTINCT ${column}) AS distinct_count, SUM(CASE WHEN ${column} IS NULL THEN 1 ELSE 0 END) AS nulls,
      AVG(${column}) AS mean, MEDIAN(${column}) AS median, STDDEV_SAMP(${column}) AS stddev,
      MIN(${column}) AS min_value, MAX(${column}) AS max_value, MAX(${column}) - MIN(${column}) AS range_value,
      QUANTILE_CONT(${column}, 0.25) AS q1, QUANTILE_CONT(${column}, 0.75) AS q3
    FROM ${table}
  `);
  const mode = await runQuery(`
    SELECT CAST(${column} AS VARCHAR) AS value FROM ${table}
    WHERE ${column} IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC, value LIMIT 1
  `);
  const histogram = await runQuery(`
    WITH clean AS (SELECT CAST(${column} AS DOUBLE) AS value FROM ${table} WHERE ${column} IS NOT NULL),
    bounds AS (SELECT MIN(value) AS min_value, MAX(value) AS max_value FROM clean),
    ids AS (SELECT range AS bin FROM range(0, 12)),
    binned AS (
      SELECT CASE WHEN b.max_value = b.min_value THEN 0 ELSE LEAST(CAST(FLOOR(((c.value - b.min_value) / NULLIF(b.max_value - b.min_value, 0)) * 12) AS INTEGER), 11) END AS bin,
        COUNT(*) AS count
      FROM clean c CROSS JOIN bounds b GROUP BY 1
    )
    SELECT ids.bin, b.min_value + ((b.max_value - b.min_value) / 12.0) * ids.bin AS start_value,
      CASE WHEN ids.bin = 11 THEN b.max_value ELSE b.min_value + ((b.max_value - b.min_value) / 12.0) * (ids.bin + 1) END AS end_value,
      COALESCE(binned.count, 0) AS count
    FROM ids CROSS JOIN bounds b LEFT JOIN binned ON binned.bin = ids.bin ORDER BY ids.bin
  `);
  const row = base[0] ?? {};
  const q1 = asNumber(row.q1);
  const q3 = asNumber(row.q3);
  return {
    kind: "number",
    count: asNumber(row.count) ?? 0,
    distinct: asNumber(row.distinct_count) ?? 0,
    nulls: asNumber(row.nulls) ?? 0,
    mean: asNumber(row.mean),
    median: asNumber(row.median),
    mode: asText(mode[0]?.value),
    stddev: asNumber(row.stddev),
    min: asNumber(row.min_value),
    max: asNumber(row.max_value),
    range: asNumber(row.range_value),
    q1, q3, iqr: q1 != null && q3 != null ? q3 - q1 : null,
    histogram: histogram.map((item) => ({
      label: formatMetric(asNumber(item.start_value), 1),
      count: asNumber(item.count) ?? 0,
      start: asNumber(item.start_value) ?? undefined,
      end: asNumber(item.end_value) ?? undefined,
    })),
  };
}

async function loadString(tableName: string, columnName: string): Promise<StringStats> {
  const table = quote(tableName);
  const column = quote(columnName);
  const base = await runQuery(`
    SELECT COUNT(${column}) AS count, COUNT(DISTINCT ${column}) AS distinct_count, SUM(CASE WHEN ${column} IS NULL THEN 1 ELSE 0 END) AS nulls,
      MIN(CASE WHEN ${column} IS NOT NULL THEN LENGTH(CAST(${column} AS VARCHAR)) END) AS min_length,
      MAX(CASE WHEN ${column} IS NOT NULL THEN LENGTH(CAST(${column} AS VARCHAR)) END) AS max_length,
      AVG(CASE WHEN ${column} IS NOT NULL THEN LENGTH(CAST(${column} AS VARCHAR)) END) AS avg_length
    FROM ${table}
  `);
  const topValues = await runQuery(`
    SELECT CAST(${column} AS VARCHAR) AS value, COUNT(*) AS count
    FROM ${table} WHERE ${column} IS NOT NULL GROUP BY 1 ORDER BY count DESC, value LIMIT 10
  `);
  const patterns = await runQuery(String.raw`
    WITH clean AS (SELECT CAST(${column} AS VARCHAR) AS value FROM ${table} WHERE ${column} IS NOT NULL)
    SELECT
      SUM(CASE WHEN TRIM(value) = '' THEN 1 ELSE 0 END) AS empty_like,
      SUM(CASE WHEN regexp_matches(value, '^[0-9]+$') THEN 1 ELSE 0 END) AS numeric_like,
      SUM(CASE WHEN regexp_matches(value, '^[A-Za-z]+$') THEN 1 ELSE 0 END) AS alpha_like,
      SUM(CASE WHEN regexp_matches(value, '^[A-Za-z0-9]+$') THEN 1 ELSE 0 END) AS alphanumeric,
      SUM(CASE WHEN regexp_matches(value, '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') THEN 1 ELSE 0 END) AS email_like,
      SUM(CASE WHEN regexp_matches(value, '^(https?://|www\.)') THEN 1 ELSE 0 END) AS url_like,
      SUM(CASE WHEN value != TRIM(value) THEN 1 ELSE 0 END) AS surrounding_whitespace,
      SUM(CASE WHEN regexp_matches(value, '[0-9]') AND regexp_matches(value, '[A-Za-z]') THEN 1 ELSE 0 END) AS mixed_token
    FROM clean
  `);
  const row = base[0] ?? {};
  const patternRow = patterns[0] ?? {};
  return {
    kind: "string",
    count: asNumber(row.count) ?? 0,
    distinct: asNumber(row.distinct_count) ?? 0,
    nulls: asNumber(row.nulls) ?? 0,
    minLength: asNumber(row.min_length),
    maxLength: asNumber(row.max_length),
    avgLength: asNumber(row.avg_length),
    topValues: topValues.map((item) => ({ label: truncate(asText(item.value) ?? "null"), count: asNumber(item.count) ?? 0 })),
    patterns: [
      { label: "Empty strings", count: asNumber(patternRow.empty_like) ?? 0 },
      { label: "Numeric-like", count: asNumber(patternRow.numeric_like) ?? 0 },
      { label: "Alphabetic", count: asNumber(patternRow.alpha_like) ?? 0 },
      { label: "Alphanumeric", count: asNumber(patternRow.alphanumeric) ?? 0 },
      { label: "Email-like", count: asNumber(patternRow.email_like) ?? 0 },
      { label: "URL-like", count: asNumber(patternRow.url_like) ?? 0 },
      { label: "Leading or trailing spaces", count: asNumber(patternRow.surrounding_whitespace) ?? 0 },
      { label: "Mixed letters and numbers", count: asNumber(patternRow.mixed_token) ?? 0 },
    ],
  };
}

async function loadDate(tableName: string, columnName: string): Promise<DateStats> {
  const table = quote(tableName);
  const column = quote(columnName);
  const parsed = `TRY_CAST(${column} AS TIMESTAMP)`;
  const base = await runQuery(`
    WITH parsed AS (SELECT ${column} AS raw_value, ${parsed} AS value FROM ${table}),
    clean AS (SELECT value FROM parsed WHERE value IS NOT NULL)
    SELECT (SELECT COUNT(*) FROM clean) AS count, (SELECT COUNT(DISTINCT value) FROM clean) AS distinct_count,
      (SELECT SUM(CASE WHEN raw_value IS NULL THEN 1 ELSE 0 END) FROM parsed) AS nulls,
      (SELECT MIN(value) FROM clean) AS min_date, (SELECT MAX(value) FROM clean) AS max_date,
      (SELECT DATE_DIFF('day', CAST(MIN(value) AS DATE), CAST(MAX(value) AS DATE)) FROM clean) AS range_days
  `);
  const monthly = await runQuery(`
    WITH clean AS (SELECT DATE_TRUNC('month', ${parsed}) AS bucket FROM ${table} WHERE ${parsed} IS NOT NULL)
    SELECT STRFTIME(bucket, '%Y-%m') AS label, COUNT(*) AS count FROM clean GROUP BY 1 ORDER BY 1
  `);
  const dayOfWeek = await runQuery(`
    WITH clean AS (SELECT ${parsed} AS value FROM ${table} WHERE ${parsed} IS NOT NULL)
    SELECT CAST(STRFTIME(value, '%w') AS INTEGER) AS idx, STRFTIME(value, '%A') AS label, COUNT(*) AS count
    FROM clean GROUP BY 1, 2 ORDER BY 1
  `);
  const gaps = await runQuery(`
    WITH clean AS (SELECT DISTINCT CAST(${parsed} AS DATE) AS day_value FROM ${table} WHERE ${parsed} IS NOT NULL),
    lagged AS (
      SELECT LAG(day_value) OVER (ORDER BY day_value) AS previous_day, day_value AS current_day,
        DATE_DIFF('day', LAG(day_value) OVER (ORDER BY day_value), day_value) AS gap_days
      FROM clean
    )
    SELECT CAST(previous_day AS VARCHAR) AS start_date, CAST(current_day AS VARCHAR) AS end_date, gap_days
    FROM lagged WHERE previous_day IS NOT NULL AND gap_days > 1 ORDER BY gap_days DESC, current_day LIMIT 8
  `);
  const row = base[0] ?? {};
  const weekdayMap = new Map(dayOfWeek.map((item) => [asText(item.label) ?? "", asNumber(item.count) ?? 0]));
  return {
    kind: "date",
    count: asNumber(row.count) ?? 0,
    distinct: asNumber(row.distinct_count) ?? 0,
    nulls: asNumber(row.nulls) ?? 0,
    minDate: asText(row.min_date),
    maxDate: asText(row.max_date),
    rangeDays: asNumber(row.range_days),
    monthly: monthly.map((item) => ({ label: asText(item.label) ?? "", count: asNumber(item.count) ?? 0 })),
    dayOfWeek: DAYS.map((day) => ({ label: day, count: weekdayMap.get(day) ?? 0 })),
    gaps: gaps.map((item) => ({ start: asText(item.start_date) ?? "", end: asText(item.end_date) ?? "", days: asNumber(item.gap_days) ?? 0 })),
  };
}

function getInsights(rowCount: number, stats: Stats) {
  const nullRate = pct(stats.nulls, rowCount);
  if (stats.kind === "number") {
    return [
      `Coverage is ${formatMetric(pct(stats.count, rowCount), 1)}% non-null with ${formatNumber(stats.distinct)} distinct numeric values.`,
      stats.mean != null && stats.median != null
        ? `Mean is ${formatMetric(stats.mean)} versus median ${formatMetric(stats.median)}; ${Math.abs(stats.mean - stats.median) > (stats.stddev ?? 0) * 0.2 ? "the separation suggests skew or long tails." : "the closeness suggests a comparatively balanced center."}`
        : "Central tendency is limited because mean or median could not be estimated.",
      stats.iqr != null && stats.range != null
        ? `Spread runs from ${formatMetric(stats.min)} to ${formatMetric(stats.max)} with IQR ${formatMetric(stats.iqr)} across a total range of ${formatMetric(stats.range)}.`
        : "Quartile spread is not available for this numeric field.",
      nullRate > 15 ? `${formatMetric(nullRate, 1)}% missingness is material and can distort aggregate comparisons.` : "Missingness is modest enough that the distribution should stay stable under light filtering.",
    ];
  }
  if (stats.kind === "string") {
    const dominant = [...stats.patterns].sort((a, b) => b.count - a.count)[0];
    return [
      `Distinct ratio is ${formatMetric(pct(stats.distinct, Math.max(stats.count, 1)), 1)}% of non-null rows, so this field ${stats.distinct > Math.max(stats.count * 0.5, 20) ? "behaves more like identifiers or free text." : "looks more categorical than unique."}`,
      stats.avgLength != null
        ? `Observed lengths range from ${formatMetric(stats.minLength, 0)} to ${formatMetric(stats.maxLength, 0)} characters with an average of ${formatMetric(stats.avgLength)}.`
        : "Text length metrics are unavailable for this field.",
      dominant ? `The strongest detected pattern is ${dominant.label.toLowerCase()} with ${formatNumber(dominant.count)} matches.` : "No dominant string pattern was detected.",
      nullRate > 15 ? `${formatMetric(nullRate, 1)}% nulls indicates the field is often omitted or sparsely collected.` : "Null exposure is limited, which makes top-value comparisons more trustworthy.",
    ];
  }
  return [
    `Coverage is ${formatMetric(pct(stats.count, rowCount), 1)}% non-null with a span from ${formatDateLabel(stats.minDate)} to ${formatDateLabel(stats.maxDate)}.`,
    stats.rangeDays != null ? `The timeline spans ${formatNumber(stats.rangeDays)} days, which is enough to inspect seasonality and dormant periods.` : "The temporal range could not be measured.",
    stats.monthly.length > 1 ? `Monthly activity covers ${formatNumber(stats.monthly.length)} buckets, revealing whether the field arrives in bursts or sustained flows.` : "Activity is concentrated in a single monthly bucket, limiting trend analysis.",
    stats.gaps.length > 0 ? `Largest gap is ${formatNumber(stats.gaps[0].days)} days between ${formatDateLabel(stats.gaps[0].start)} and ${formatDateLabel(stats.gaps[0].end)}.` : "No multi-day gaps were detected between consecutive observed dates.",
  ];
}

function ColumnStats({ tableName, column, rowCount }: ColumnStatsProps) {
  const dark = useDarkMode();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result =
          column.type === "number" ? await loadNumeric(tableName, column.name)
          : column.type === "string" ? await loadString(tableName, column.name)
          : column.type === "date" ? await loadDate(tableName, column.name)
          : (() => { throw new Error("Detailed statistics are only supported for numeric, string, and date columns."); })();
        if (!cancelled) setStats(result);
      } catch (fetchError) {
        if (!cancelled) {
          setStats(null);
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load column statistics.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [column.name, column.type, tableName]);

  if (loading) return <LoadingView name={column.name} />;
  if (error || !stats) {
    return (
      <section className="rounded-2xl border border-red-200/70 bg-red-500/10 p-6 dark:border-red-500/30 dark:bg-red-500/10">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600 dark:text-red-400" />
          <div>
            <h2 className="text-base font-semibold text-red-700 dark:text-red-300">Column statistics unavailable</h2>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">{error ?? "No statistics were returned."}</p>
          </div>
        </div>
      </section>
    );
  }

  const insights = getInsights(rowCount, stats);
  const summary = [
    { label: "Rows", value: formatNumber(rowCount) },
    { label: "Non-null", value: formatNumber(stats.count) },
    { label: "Distinct", value: formatNumber(stats.distinct) },
    { label: "Nulls", value: formatNumber(stats.nulls), tone: stats.nulls > 0 ? "danger" as const : "default" as const },
  ];

  return (
    <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: "easeOut" }}
      className="overflow-hidden rounded-2xl border border-gray-200/70 bg-white/80 dark:border-gray-700/70 dark:bg-gray-900/60">
      <div className="border-b border-gray-200/70 px-6 py-5 dark:border-gray-700/70">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:border-cyan-500/20 dark:text-cyan-300">
              {column.type === "number" ? <Hash className="h-3.5 w-3.5" /> : column.type === "string" ? <Type className="h-3.5 w-3.5" /> : <Calendar className="h-3.5 w-3.5" />}
              Column Statistics
            </div>
            <h2 className="mt-3 text-xl font-semibold text-gray-900 dark:text-gray-100">{column.name}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
              Deep profile for <span className="font-semibold text-gray-900 dark:text-gray-100">{column.name}</span> in{" "}
              <span className="font-semibold text-gray-900 dark:text-gray-100">{tableName}</span>, covering distribution, quality signals, and type-specific diagnostics.
            </p>
            {column.sampleValues.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {column.sampleValues.slice(0, 5).map((sample, index) => (
                  <span key={`${column.name}-sample-${index}`} className="rounded-full border border-gray-200/70 bg-gray-50/80 px-3 py-1 text-xs text-gray-600 dark:border-gray-800/70 dark:bg-gray-950/35 dark:text-gray-300">
                    {sample == null ? "null" : truncate(String(sample), 28)}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:w-[360px]">
            {summary.map((card) => (
              <div key={card.label} className="rounded-xl border border-gray-200/70 bg-gray-50/80 px-4 py-3 dark:border-gray-800/70 dark:bg-gray-950/35">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">{card.label}</p>
                <p className={`mt-1 text-xl font-semibold ${card.tone === "danger" ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-gray-100"}`}>{card.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 px-6 py-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Panel title="Analyst Notes" icon={Search} accent="bg-cyan-500/15 text-cyan-600 dark:text-cyan-400"><InsightList items={insights} /></Panel>
          {stats.kind === "number" && (
            <>
              <Panel title="Core Metrics" icon={Sigma} accent="bg-cyan-500/15 text-cyan-600 dark:text-cyan-400"><MetricGrid items={[{ label: "Mean", value: formatMetric(stats.mean) }, { label: "Median", value: formatMetric(stats.median) }, { label: "Mode", value: stats.mode ?? "—" }, { label: "Std Dev", value: formatMetric(stats.stddev) }, { label: "Min", value: formatMetric(stats.min) }, { label: "Max", value: formatMetric(stats.max) }, { label: "Range", value: formatMetric(stats.range) }, { label: "Null Rate", value: `${formatMetric(pct(stats.nulls, rowCount), 1)}%` }]} /></Panel>
              <Panel title="Histogram" icon={BarChart3} accent="bg-cyan-500/15 text-cyan-600 dark:text-cyan-400"><ReactECharts option={buildChart(stats.histogram, dark, COLORS.numeric)} style={{ height: 300 }} notMerge lazyUpdate /></Panel>
            </>
          )}
          {stats.kind === "string" && (
            <>
              <Panel title="Text Shape" icon={Type} accent="bg-orange-500/15 text-orange-600 dark:text-orange-400"><MetricGrid items={[{ label: "Min Length", value: formatMetric(stats.minLength, 0) }, { label: "Max Length", value: formatMetric(stats.maxLength, 0) }, { label: "Avg Length", value: formatMetric(stats.avgLength) }, { label: "Null Rate", value: `${formatMetric(pct(stats.nulls, rowCount), 1)}%` }]} /></Panel>
              <Panel title="Top 10 Values" icon={BarChart3} accent="bg-orange-500/15 text-orange-600 dark:text-orange-400"><ReactECharts option={buildChart(stats.topValues, dark, COLORS.string, { horizontal: true })} style={{ height: 320 }} notMerge lazyUpdate /></Panel>
            </>
          )}
          {stats.kind === "date" && (
            <>
              <Panel title="Temporal Coverage" icon={Clock3} accent="bg-green-500/15 text-green-600 dark:text-green-400"><MetricGrid items={[{ label: "Min Date", value: formatDateLabel(stats.minDate) }, { label: "Max Date", value: formatDateLabel(stats.maxDate) }, { label: "Range", value: stats.rangeDays != null ? `${formatNumber(stats.rangeDays)} days` : "—" }, { label: "Null Rate", value: `${formatMetric(pct(stats.nulls, rowCount), 1)}%` }]} /></Panel>
              <Panel title="Monthly Activity" icon={LineChart} accent="bg-green-500/15 text-green-600 dark:text-green-400"><ReactECharts option={buildChart(stats.monthly, dark, COLORS.date, { line: true })} style={{ height: 300 }} notMerge lazyUpdate /></Panel>
            </>
          )}
        </div>
        <div className="space-y-6">
          {stats.kind === "number" && (
            <>
              <Panel title="Quartiles & Spread" icon={Layers3} accent="bg-cyan-500/15 text-cyan-600 dark:text-cyan-400"><MetricGrid items={[{ label: "Q1", value: formatMetric(stats.q1) }, { label: "Median", value: formatMetric(stats.median) }, { label: "Q3", value: formatMetric(stats.q3) }, { label: "IQR", value: formatMetric(stats.iqr) }]} /></Panel>
              <Panel title="Box Plot" icon={Activity} accent="bg-cyan-500/15 text-cyan-600 dark:text-cyan-400"><ReactECharts option={buildBoxPlot(stats, dark)} style={{ height: 300 }} notMerge lazyUpdate /></Panel>
            </>
          )}
          {stats.kind === "string" && (
            <Panel title="Pattern Analysis" icon={Search} accent="bg-orange-500/15 text-orange-600 dark:text-orange-400">
              <div className="space-y-3">
                {stats.patterns.map((pattern) => (
                  <div key={pattern.label}>
                    <div className="mb-1 flex items-center justify-between gap-4 text-sm text-gray-700 dark:text-gray-300">
                      <span>{pattern.label}</span>
                      <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{formatNumber(pattern.count)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"><div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(100, pct(pattern.count, Math.max(stats.count, 1)))}%` }} /></div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          {stats.kind === "date" && (
            <>
              <Panel title="Day Of Week" icon={Calendar} accent="bg-green-500/15 text-green-600 dark:text-green-400"><ReactECharts option={buildChart(stats.dayOfWeek, dark, COLORS.date)} style={{ height: 300 }} notMerge lazyUpdate /></Panel>
              <Panel title="Gap Detection" icon={AlertTriangle} accent="bg-green-500/15 text-green-600 dark:text-green-400">
                {stats.gaps.length === 0 ? (
                  <p className="text-sm text-gray-600 dark:text-gray-300">No multi-day gaps detected between consecutive observed dates.</p>
                ) : (
                  <div className="space-y-3">
                    {stats.gaps.map((gap) => (
                      <div key={`${gap.start}-${gap.end}`} className="rounded-xl border border-gray-200/70 bg-gray-50/80 px-4 py-3 dark:border-gray-800/70 dark:bg-gray-950/35">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{formatDateLabel(gap.start)} → {formatDateLabel(gap.end)}</p>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Gap between consecutive observed dates</p>
                          </div>
                          <span className="rounded-full bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-700 dark:text-green-300">{formatNumber(gap.days)} days</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </>
          )}
        </div>
      </div>
    </motion.section>
  );
}

export default memo(ColumnStats);
