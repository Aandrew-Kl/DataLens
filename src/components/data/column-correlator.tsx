"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useMemo, useState, useSyncExternalStore } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, CalendarDays, GitCompareArrows, Loader2, Sigma, Sparkles, Table2, TrendingUp } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface ColumnCorrelatorProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

type AnalysisKind =
  | "numeric-numeric"
  | "categorical-categorical"
  | "numeric-categorical"
  | "date-numeric";

interface NumericPoint {
  x: number;
  y: number;
}

interface HeatCell {
  left: string;
  right: string;
  count: number;
}

interface GroupStat {
  category: string;
  count: number;
  mean: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

interface TrendPoint {
  label: string;
  value: number;
  count: number;
}

interface AnalysisCard {
  label: string;
  value: string;
}

interface AnalysisResult {
  kind: AnalysisKind;
  title: string;
  metricLabel: string;
  metricValue: string;
  interpretation: string;
  coverage: number;
  cards: AnalysisCard[];
  chartOption: EChartsOption;
}

type StatusState = { kind: "error"; message: string } | null;

const ease = [0.16, 1, 0.3, 1] as const;
const panelClass =
  "overflow-hidden rounded-[28px] border border-white/20 bg-white/70 shadow-[0_24px_90px_-48px_rgba(15,23,42,0.7)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const fieldClass =
  "w-full rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700/70 dark:bg-slate-950/60 dark:text-slate-100";

function subscribeDarkMode(callback: () => void) {
  if (typeof document === "undefined") return () => undefined;
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function getDarkModeSnapshot() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

function useDarkMode() {
  return useSyncExternalStore(subscribeDarkMode, getDarkModeSnapshot, () => false);
}
function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function columnFamily(column: ColumnProfile | undefined) {
  if (!column) return "unsupported";
  if (column.type === "number") return "numeric";
  if (column.type === "date") return "date";
  if (column.type === "string" || column.type === "boolean" || column.type === "unknown") {
    return "categorical";
  }
  return "unsupported";
}

function inferAnalysisKind(left: ColumnProfile | undefined, right: ColumnProfile | undefined) {
  const leftFamily = columnFamily(left);
  const rightFamily = columnFamily(right);
  if (leftFamily === "numeric" && rightFamily === "numeric") return "numeric-numeric";
  if (leftFamily === "categorical" && rightFamily === "categorical") return "categorical-categorical";
  if (
    (leftFamily === "numeric" && rightFamily === "categorical") ||
    (leftFamily === "categorical" && rightFamily === "numeric")
  ) {
    return "numeric-categorical";
  }
  if (
    (leftFamily === "date" && rightFamily === "numeric") ||
    (leftFamily === "numeric" && rightFamily === "date")
  ) {
    return "date-numeric";
  }
  return null;
}

function correlationLabel(value: number | null) {
  if (value == null || Number.isNaN(value)) return "No significant relationship";
  const strength = Math.abs(value);
  if (strength >= 0.75) return value > 0 ? "Strong positive correlation" : "Strong negative correlation";
  if (strength >= 0.45) return value > 0 ? "Moderate positive correlation" : "Moderate negative correlation";
  if (strength >= 0.2) return value > 0 ? "Weak positive relationship" : "Weak negative relationship";
  return "No significant relationship";
}

function associationLabel(value: number | null) {
  if (value == null || Number.isNaN(value)) return "No significant relationship";
  if (value >= 0.5) return "Strong categorical association";
  if (value >= 0.3) return "Moderate categorical association";
  if (value >= 0.15) return "Weak categorical association";
  return "No significant relationship";
}

function groupEffectLabel(value: number | null) {
  if (value == null || Number.isNaN(value)) return "No significant relationship";
  if (value >= 0.14) return "Strong category-driven separation";
  if (value >= 0.06) return "Moderate category-driven separation";
  if (value >= 0.01) return "Weak category-driven separation";
  return "No significant relationship";
}

function trendLabel(value: number | null) {
  if (value == null || Number.isNaN(value)) return "No significant relationship";
  const strength = Math.abs(value);
  if (strength >= 0.7) return value > 0 ? "Strong upward trend" : "Strong downward trend";
  if (strength >= 0.35) return value > 0 ? "Moderate upward trend" : "Moderate downward trend";
  return "No significant relationship";
}

function buildScatterOption(points: NumericPoint[], slope: number | null, intercept: number | null, dark: boolean, xName: string, yName: string): EChartsOption {
  const textColor = dark ? "#94a3b8" : "#64748b";
  const borderColor = dark ? "#1e293b" : "#e2e8f0";
  const xValues = points.map((point) => point.x);
  const lineData =
    slope == null || intercept == null || xValues.length === 0
      ? []
      : [
          [Math.min(...xValues), slope * Math.min(...xValues) + intercept],
          [Math.max(...xValues), slope * Math.max(...xValues) + intercept],
        ];

  return {
    animationDuration: 500,
    color: ["#06b6d4", "#f97316"],
    tooltip: { trigger: "item", backgroundColor: dark ? "#0f172aee" : "#ffffffee", borderColor, textStyle: { color: dark ? "#e2e8f0" : "#0f172a" } },
    grid: { left: 24, right: 24, top: 18, bottom: 32, containLabel: true },
    xAxis: { type: "value", name: xName, nameTextStyle: { color: textColor }, axisLabel: { color: textColor }, splitLine: { lineStyle: { color: borderColor, type: "dashed" } } },
    yAxis: { type: "value", name: yName, nameTextStyle: { color: textColor }, axisLabel: { color: textColor }, splitLine: { lineStyle: { color: borderColor, type: "dashed" } } },
    series: [
      { type: "scatter", data: points.map((point) => [point.x, point.y]), symbolSize: 8, itemStyle: { opacity: 0.75 } },
      { type: "line", data: lineData, symbol: "none", lineStyle: { width: 2, type: "dashed" } },
    ],
  };
}

function buildHeatmapOption(cells: HeatCell[], dark: boolean): EChartsOption {
  const leftLabels = Array.from(new Set(cells.map((cell) => cell.left)));
  const rightLabels = Array.from(new Set(cells.map((cell) => cell.right)));
  const maxCount = Math.max(...cells.map((cell) => cell.count), 1);
  const textColor = dark ? "#94a3b8" : "#64748b";

  return {
    animationDuration: 420,
    tooltip: { position: "top" },
    grid: { left: 80, right: 24, top: 18, bottom: 48 },
    xAxis: { type: "category", data: rightLabels, axisLabel: { color: textColor, rotate: rightLabels.length > 6 ? 28 : 0 } },
    yAxis: { type: "category", data: leftLabels, axisLabel: { color: textColor } },
    visualMap: { min: 0, max: maxCount, calculable: true, orient: "horizontal", left: "center", bottom: 0, inRange: { color: ["#0f172a", "#06b6d4", "#a3e635"] }, textStyle: { color: textColor } },
    series: [{
      type: "heatmap",
      data: cells.map((cell) => [rightLabels.indexOf(cell.right), leftLabels.indexOf(cell.left), cell.count]),
      label: { show: true, color: "#e2e8f0", fontSize: 11 },
      itemStyle: { borderColor: dark ? "#020617" : "#ffffff", borderWidth: 1 },
    }],
  };
}

function buildBoxplotOption(groups: GroupStat[], dark: boolean): EChartsOption {
  const textColor = dark ? "#94a3b8" : "#64748b";
  const borderColor = dark ? "#1e293b" : "#e2e8f0";
  return {
    animationDuration: 460,
    tooltip: { trigger: "item" },
    legend: { top: 0, textStyle: { color: textColor } },
    grid: { left: 32, right: 24, top: 40, bottom: 42, containLabel: true },
    xAxis: { type: "category", data: groups.map((group) => group.category), axisLabel: { color: textColor, rotate: groups.length > 5 ? 22 : 0 } },
    yAxis: { type: "value", axisLabel: { color: textColor }, splitLine: { lineStyle: { color: borderColor, type: "dashed" } } },
    series: [
      { name: "Distribution", type: "boxplot", data: groups.map((group) => [group.min, group.q1, group.median, group.q3, group.max]), itemStyle: { color: "#22c55e", borderColor: "#15803d" } },
      { name: "Mean", type: "scatter", data: groups.map((group) => [group.category, group.mean]), symbolSize: 12, itemStyle: { color: "#f97316" } },
    ],
  };
}

function buildTrendOption(points: TrendPoint[], dark: boolean): EChartsOption {
  const textColor = dark ? "#94a3b8" : "#64748b";
  const borderColor = dark ? "#1e293b" : "#e2e8f0";
  return {
    animationDuration: 500,
    color: ["#38bdf8", "#a78bfa"],
    tooltip: { trigger: "axis" },
    legend: { top: 0, textStyle: { color: textColor } },
    grid: { left: 26, right: 24, top: 38, bottom: 40, containLabel: true },
    xAxis: { type: "category", data: points.map((point) => point.label), axisLabel: { color: textColor, rotate: points.length > 10 ? 26 : 0 } },
    yAxis: [
      { type: "value", axisLabel: { color: textColor }, splitLine: { lineStyle: { color: borderColor, type: "dashed" } } },
      { type: "value", axisLabel: { color: textColor }, splitLine: { show: false } },
    ],
    series: [
      { name: "Average value", type: "line", smooth: true, data: points.map((point) => point.value), symbolSize: 6, lineStyle: { width: 3 }, areaStyle: { opacity: 0.08 } },
      { name: "Rows", type: "bar", yAxisIndex: 1, data: points.map((point) => point.count), itemStyle: { opacity: 0.45, borderRadius: [8, 8, 0, 0] } },
    ],
  };
}

function computeCramersV(cells: HeatCell[]) {
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  const matrix = new Map<string, number>();
  let total = 0;
  for (const cell of cells) {
    rowTotals.set(cell.left, (rowTotals.get(cell.left) ?? 0) + cell.count);
    colTotals.set(cell.right, (colTotals.get(cell.right) ?? 0) + cell.count);
    matrix.set(`${cell.left}__${cell.right}`, cell.count);
    total += cell.count;
  }
  const rowCount = rowTotals.size;
  const colCount = colTotals.size;
  if (total === 0 || rowCount < 2 || colCount < 2) return null;

  let chiSquare = 0;
  for (const left of rowTotals.keys()) {
    for (const right of colTotals.keys()) {
      const observed = matrix.get(`${left}__${right}`) ?? 0;
      const expected = ((rowTotals.get(left) ?? 0) * (colTotals.get(right) ?? 0)) / total;
      if (expected > 0) chiSquare += ((observed - expected) ** 2) / expected;
    }
  }
  return Math.sqrt(chiSquare / (total * Math.min(rowCount - 1, colCount - 1)));
}

async function analyzeNumericPair(tableName: string, left: string, right: string, dark: boolean, rowCount: number): Promise<AnalysisResult> {
  const safeTable = quoteIdentifier(tableName);
  const safeLeft = quoteIdentifier(left);
  const safeRight = quoteIdentifier(right);
  const summarySql = `
    WITH clean AS (
      SELECT TRY_CAST(${safeLeft} AS DOUBLE) AS x_value, TRY_CAST(${safeRight} AS DOUBLE) AS y_value
      FROM ${safeTable}
      WHERE ${safeLeft} IS NOT NULL AND ${safeRight} IS NOT NULL
    )
    SELECT corr(x_value, y_value) AS pearson, regr_slope(y_value, x_value) AS slope, regr_intercept(y_value, x_value) AS intercept, COUNT(*) AS pair_count
    FROM clean
  `;
  const sampleSql = `
    WITH clean AS (
      SELECT TRY_CAST(${safeLeft} AS DOUBLE) AS x_value, TRY_CAST(${safeRight} AS DOUBLE) AS y_value
      FROM ${safeTable}
      WHERE ${safeLeft} IS NOT NULL AND ${safeRight} IS NOT NULL
    )
    SELECT x_value, y_value
    FROM clean
    ORDER BY RANDOM()
    LIMIT 320
  `;
  const [summaryRows, pointRows] = await Promise.all([runQuery(summarySql), runQuery(sampleSql)]);
  const pearson = toNumber(summaryRows[0]?.pearson);
  const slope = toNumber(summaryRows[0]?.slope);
  const intercept = toNumber(summaryRows[0]?.intercept);
  const pairCount = Number(summaryRows[0]?.pair_count ?? 0);
  const points = pointRows.flatMap<NumericPoint>((row) => {
    const x = toNumber(row.x_value);
    const y = toNumber(row.y_value);
    return x != null && y != null ? [{ x, y }] : [];
  });
  return {
    kind: "numeric-numeric",
    title: `${left} vs ${right}`,
    metricLabel: "Pearson correlation",
    metricValue: pearson == null ? "—" : pearson.toFixed(3),
    interpretation: correlationLabel(pearson),
    coverage: rowCount > 0 ? pairCount / rowCount : 0,
    cards: [
      { label: "Pairs analyzed", value: formatNumber(pairCount) },
      { label: "Regression slope", value: slope == null ? "—" : slope.toFixed(3) },
      { label: "Coverage", value: formatPercent((rowCount > 0 ? pairCount / rowCount : 0) * 100, 1) },
    ],
    chartOption: buildScatterOption(points, slope, intercept, dark, left, right),
  };
}

async function analyzeCategoricalPair(tableName: string, left: string, right: string, dark: boolean, rowCount: number): Promise<AnalysisResult> {
  const safeTable = quoteIdentifier(tableName);
  const safeLeft = quoteIdentifier(left);
  const safeRight = quoteIdentifier(right);
  const query = `
    WITH base AS (
      SELECT CAST(${safeLeft} AS VARCHAR) AS left_value, CAST(${safeRight} AS VARCHAR) AS right_value
      FROM ${safeTable}
      WHERE ${safeLeft} IS NOT NULL AND ${safeRight} IS NOT NULL
    ),
    left_top AS (SELECT left_value FROM base GROUP BY 1 ORDER BY COUNT(*) DESC, left_value LIMIT 8),
    right_top AS (SELECT right_value FROM base GROUP BY 1 ORDER BY COUNT(*) DESC, right_value LIMIT 8)
    SELECT left_value, right_value, COUNT(*) AS cell_count
    FROM base
    WHERE left_value IN (SELECT left_value FROM left_top) AND right_value IN (SELECT right_value FROM right_top)
    GROUP BY 1, 2
    ORDER BY 1, 2
  `;
  const countRows = await runQuery(`
    SELECT COUNT(*) AS pair_count
    FROM ${safeTable}
    WHERE ${safeLeft} IS NOT NULL AND ${safeRight} IS NOT NULL
  `);
  const cells = (await runQuery(query)).flatMap<HeatCell>((row) => {
    const count = toNumber(row.cell_count);
    if (count == null) return [];
    return [{ left: String(row.left_value ?? ""), right: String(row.right_value ?? ""), count }];
  });
  const pairCount = Number(countRows[0]?.pair_count ?? 0);
  const metric = computeCramersV(cells);
  const strongest = cells.reduce<HeatCell | null>((best, cell) => (best == null || cell.count > best.count ? cell : best), null);
  return {
    kind: "categorical-categorical",
    title: `${left} x ${right}`,
    metricLabel: "Cramér's V",
    metricValue: metric == null ? "—" : metric.toFixed(3),
    interpretation: associationLabel(metric),
    coverage: rowCount > 0 ? pairCount / rowCount : 0,
    cards: [
      { label: "Pairs analyzed", value: formatNumber(pairCount) },
      { label: "Dominant intersection", value: strongest ? `${strongest.left} · ${strongest.right}` : "—" },
      { label: "Coverage", value: formatPercent((rowCount > 0 ? pairCount / rowCount : 0) * 100, 1) },
    ],
    chartOption: buildHeatmapOption(cells, dark),
  };
}

async function analyzeNumericCategoryPair(tableName: string, numeric: string, categorical: string, dark: boolean, rowCount: number): Promise<AnalysisResult> {
  const safeTable = quoteIdentifier(tableName);
  const safeNumeric = quoteIdentifier(numeric);
  const safeCategorical = quoteIdentifier(categorical);
  const query = `
    WITH base AS (
      SELECT CAST(${safeCategorical} AS VARCHAR) AS category, TRY_CAST(${safeNumeric} AS DOUBLE) AS metric_value
      FROM ${safeTable}
      WHERE ${safeCategorical} IS NOT NULL AND ${safeNumeric} IS NOT NULL
    ),
    top_categories AS (SELECT category FROM base GROUP BY 1 ORDER BY COUNT(*) DESC, category LIMIT 8),
    scoped AS (SELECT * FROM base WHERE category IN (SELECT category FROM top_categories))
    SELECT category, COUNT(*) AS pair_count, AVG(metric_value) AS mean_value, MIN(metric_value) AS min_value,
      quantile_cont(metric_value, 0.25) AS q1_value, median(metric_value) AS median_value,
      quantile_cont(metric_value, 0.75) AS q3_value, MAX(metric_value) AS max_value
    FROM scoped
    GROUP BY 1
    ORDER BY mean_value DESC
  `;
  const totals = await runQuery(`
    WITH base AS (
      SELECT CAST(${safeCategorical} AS VARCHAR) AS category, TRY_CAST(${safeNumeric} AS DOUBLE) AS metric_value
      FROM ${safeTable}
      WHERE ${safeCategorical} IS NOT NULL AND ${safeNumeric} IS NOT NULL
    ),
    top_categories AS (SELECT category FROM base GROUP BY 1 ORDER BY COUNT(*) DESC, category LIMIT 8),
    scoped AS (SELECT * FROM base WHERE category IN (SELECT category FROM top_categories))
    SELECT COUNT(*) AS pair_count, AVG(metric_value) AS overall_mean, var_pop(metric_value) AS overall_var
    FROM scoped
  `);
  const groups = (await runQuery(query)).flatMap<GroupStat>((row) => {
    const count = toNumber(row.pair_count);
    const mean = toNumber(row.mean_value);
    const min = toNumber(row.min_value);
    const q1 = toNumber(row.q1_value);
    const median = toNumber(row.median_value);
    const q3 = toNumber(row.q3_value);
    const max = toNumber(row.max_value);
    if ([count, mean, min, q1, median, q3, max].some((value) => value == null)) return [];
    return [{ category: String(row.category ?? ""), count: count ?? 0, mean: mean ?? 0, min: min ?? 0, q1: q1 ?? 0, median: median ?? 0, q3: q3 ?? 0, max: max ?? 0 }];
  });
  const pairCount = Number(totals[0]?.pair_count ?? 0);
  const overallMean = toNumber(totals[0]?.overall_mean);
  const overallVar = toNumber(totals[0]?.overall_var);
  const between = overallMean == null ? 0 : groups.reduce((sum, group) => sum + group.count * (group.mean - overallMean) ** 2, 0);
  const etaSquared = overallVar && pairCount > 0 ? between / (overallVar * pairCount) : null;
  const widest = groups.reduce<GroupStat | null>((best, group) => (best == null || group.mean > best.mean ? group : best), null);

  return {
    kind: "numeric-categorical",
    title: `${numeric} by ${categorical}`,
    metricLabel: "Eta squared",
    metricValue: etaSquared == null ? "—" : etaSquared.toFixed(3),
    interpretation: groupEffectLabel(etaSquared),
    coverage: rowCount > 0 ? pairCount / rowCount : 0,
    cards: [
      { label: "Groups compared", value: formatNumber(groups.length) },
      { label: "Top mean", value: widest ? `${widest.category}: ${widest.mean.toFixed(2)}` : "—" },
      { label: "Coverage", value: formatPercent((rowCount > 0 ? pairCount / rowCount : 0) * 100, 1) },
    ],
    chartOption: buildBoxplotOption(groups, dark),
  };
}

async function analyzeDateTrend(tableName: string, dateColumn: string, numericColumn: string, dark: boolean, rowCount: number): Promise<AnalysisResult> {
  const safeTable = quoteIdentifier(tableName);
  const safeDate = quoteIdentifier(dateColumn);
  const safeNumeric = quoteIdentifier(numericColumn);
  const seriesSql = `
    WITH parsed AS (
      SELECT TRY_CAST(${safeDate} AS TIMESTAMP) AS ts_value, TRY_CAST(${safeNumeric} AS DOUBLE) AS metric_value
      FROM ${safeTable}
      WHERE ${safeDate} IS NOT NULL AND ${safeNumeric} IS NOT NULL
    ),
    clean AS (
      SELECT CAST(DATE_TRUNC('day', ts_value) AS DATE) AS bucket_date, metric_value
      FROM parsed
      WHERE ts_value IS NOT NULL AND metric_value IS NOT NULL
    )
    SELECT bucket_date, AVG(metric_value) AS avg_value, COUNT(*) AS bucket_count
    FROM clean
    GROUP BY 1
    ORDER BY 1
  `;
  const summarySql = `
    WITH series AS (${seriesSql}),
    indexed AS (SELECT bucket_date, avg_value, bucket_count, ROW_NUMBER() OVER (ORDER BY bucket_date) AS point_index FROM series)
    SELECT corr(point_index, avg_value) AS time_corr, regr_slope(avg_value, point_index) AS slope, COUNT(*) AS point_count, SUM(bucket_count) AS pair_count
    FROM indexed
  `;
  const [seriesRows, summaryRows] = await Promise.all([runQuery(seriesSql), runQuery(summarySql)]);
  const points = seriesRows.flatMap<TrendPoint>((row) => {
    const value = toNumber(row.avg_value);
    const count = toNumber(row.bucket_count);
    return value != null && count != null
      ? [{ label: String(row.bucket_date ?? "").slice(0, 10), value, count }]
      : [];
  });
  const timeCorr = toNumber(summaryRows[0]?.time_corr);
  const slope = toNumber(summaryRows[0]?.slope);
  const pairCount = Number(summaryRows[0]?.pair_count ?? 0);

  return {
    kind: "date-numeric",
    title: `${numericColumn} over ${dateColumn}`,
    metricLabel: "Time correlation",
    metricValue: timeCorr == null ? "—" : timeCorr.toFixed(3),
    interpretation: trendLabel(timeCorr),
    coverage: rowCount > 0 ? pairCount / rowCount : 0,
    cards: [
      { label: "Buckets", value: formatNumber(points.length) },
      { label: "Trend slope", value: slope == null ? "—" : slope.toFixed(3) },
      { label: "Coverage", value: formatPercent((rowCount > 0 ? pairCount / rowCount : 0) * 100, 1) },
    ],
    chartOption: buildTrendOption(points, dark),
  };
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/65 p-4 shadow-sm backdrop-blur-sm dark:border-slate-700/70 dark:bg-slate-950/35">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

export default function ColumnCorrelator({ tableName, columns, rowCount }: ColumnCorrelatorProps) {
  const dark = useDarkMode();
  const eligibleColumns = useMemo(
    () => columns.filter((column) => column.type !== "unknown" || column.uniqueCount > 0),
    [columns],
  );
  const [columnA, setColumnA] = useState(eligibleColumns[0]?.name ?? "");
  const [columnB, setColumnB] = useState(eligibleColumns[1]?.name ?? eligibleColumns[0]?.name ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [status, setStatus] = useState<StatusState>(null);
  const activeColumnA = eligibleColumns.some((column) => column.name === columnA)
    ? columnA
    : (eligibleColumns[0]?.name ?? "");
  const defaultB = eligibleColumns.find((column) => column.name !== activeColumnA)?.name ?? activeColumnA;
  const activeColumnB = eligibleColumns.some((column) => column.name === columnB) && columnB !== activeColumnA
    ? columnB
    : defaultB;
  const profileA = eligibleColumns.find((column) => column.name === activeColumnA);
  const profileB = eligibleColumns.find((column) => column.name === activeColumnB);
  const analysisKind = inferAnalysisKind(profileA, profileB);

  async function handleAnalyze() {
    if (!profileA || !profileB || !analysisKind) {
      setStatus({ kind: "error", message: "Choose a supported column pair before running analysis." });
      setResult(null);
      return;
    }
    setLoading(true);
    setStatus(null);
    try {
      const analysis =
        analysisKind === "numeric-numeric"
          ? await analyzeNumericPair(tableName, profileA.name, profileB.name, dark, rowCount)
          : analysisKind === "categorical-categorical"
            ? await analyzeCategoricalPair(tableName, profileA.name, profileB.name, dark, rowCount)
            : analysisKind === "numeric-categorical"
              ? await analyzeNumericCategoryPair(
                  tableName,
                  columnFamily(profileA) === "numeric" ? profileA.name : profileB.name,
                  columnFamily(profileA) === "categorical" ? profileA.name : profileB.name,
                  dark,
                  rowCount,
                )
              : await analyzeDateTrend(
                  tableName,
                  columnFamily(profileA) === "date" ? profileA.name : profileB.name,
                  columnFamily(profileA) === "numeric" ? profileA.name : profileB.name,
                  dark,
                  rowCount,
                );
      setResult(analysis);
    } catch (error) {
      setResult(null);
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Correlation analysis failed.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease }}
      className={`${panelClass} bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.78),rgba(248,250,252,0.72))] dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_26%),linear-gradient(180deg,rgba(2,6,23,0.88),rgba(15,23,42,0.82))]`}
    >
      <div className="border-b border-white/30 px-6 py-5 dark:border-white/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
              <Sparkles className="h-3.5 w-3.5" />
              Column Correlator
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">
              Deep relationship analysis for {tableName}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Compare any two columns and switch automatically between Pearson correlation, contingency
              heatmaps, grouped distributions, and time trends based on the column types.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Rows" value={formatNumber(rowCount)} />
            <StatCard label="Columns" value={formatNumber(eligibleColumns.length)} />
            <StatCard label="Mode" value={analysisKind ?? "Unsupported"} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 px-6 py-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-5">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Column A</span>
            <select value={activeColumnA} onChange={(event) => setColumnA(event.target.value)} className={fieldClass}>
              {eligibleColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Column B</span>
            <select value={activeColumnB} onChange={(event) => setColumnB(event.target.value)} className={fieldClass}>
              {eligibleColumns
                .filter((column) => column.name !== activeColumnA)
                .map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
            </select>
          </label>

          <div className="rounded-2xl border border-white/25 bg-white/55 p-5 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-slate-950/30">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <GitCompareArrows className="h-4 w-4 text-cyan-500" />
              Expected analysis
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {analysisKind === "numeric-numeric"
                ? "Pearson correlation, sampled scatter plot, and a regression line."
                : analysisKind === "categorical-categorical"
                  ? "Contingency heatmap with Cramér's V for association strength."
                  : analysisKind === "numeric-categorical"
                    ? "Box plot per category plus mean comparison across the top groups."
                    : analysisKind === "date-numeric"
                      ? "Daily trend aggregation with a time-correlation summary."
                      : "This pair is not supported by the correlation engine."}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleAnalyze()}
            disabled={loading || !analysisKind}
            className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-400 dark:disabled:bg-slate-700"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
            Analyze columns
          </button>

          <AnimatePresence mode="wait">
            {status ? (
              <motion.div
                key={status.message}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300"
              >
                {status.message}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <div className="space-y-5">
          {!result ? (
            <div className="rounded-[26px] border border-white/25 bg-white/55 px-6 py-10 text-center shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-slate-950/30">
              <BarChart3 className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
              <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
                No correlation run yet
              </h3>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Pick two columns and run analysis to generate metrics, interpretation text, and a chart.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-[26px] border border-white/25 bg-white/55 p-5 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-slate-950/30">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {result.kind === "categorical-categorical" ? <Table2 className="h-4 w-4 text-cyan-500" /> : result.kind === "date-numeric" ? <CalendarDays className="h-4 w-4 text-cyan-500" /> : <Sigma className="h-4 w-4 text-cyan-500" />}
                      {result.title}
                    </div>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{result.interpretation}</p>
                  </div>
                  <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-right text-cyan-700 dark:text-cyan-300">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em]">{result.metricLabel}</p>
                    <p className="mt-2 text-3xl font-semibold">{result.metricValue}</p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  {result.cards.map((card) => (
                    <StatCard key={card.label} label={card.label} value={card.value} />
                  ))}
                </div>

                <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                  Coverage: {formatPercent(result.coverage * 100, 1)} of the source table contributed valid
                  pairs to this analysis.
                </p>
              </div>

              <div className="rounded-[26px] border border-white/25 bg-white/55 p-4 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-slate-950/30">
                <ReactECharts
                  option={result.chartOption}
                  style={{ height: 420, width: "100%" }}
                  opts={{ renderer: "svg" }}
                  notMerge
                  lazyUpdate
                />
              </div>
            </>
          )}
        </div>
      </div>
    </motion.section>
  );
}
