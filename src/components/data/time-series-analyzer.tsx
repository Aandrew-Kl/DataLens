"use client";

import { useEffect, useMemo, useState, type ElementType, type ReactNode } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { motion } from "framer-motion";
import { Activity, Calendar, LineChart, Loader2, Sigma, TrendingUp } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { SkeletonCard, SkeletonChart } from "@/components/ui/skeleton";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface TimeSeriesAnalyzerProps { tableName: string; columns: ColumnProfile[]; }
type Frequency = "daily" | "weekly" | "monthly";
interface RawPoint { isoDate: string; value: number; count: number; }
interface TrendPoint extends RawPoint { movingAverage: number | null; trend: number; }
interface SeasonalityPoint { key: string; label: string; value: number; count: number; emphasis: "peak" | "trough" | "neutral"; }
interface AnalysisResult {
  frequency: Frequency; points: TrendPoint[]; seasonality: SeasonalityPoint[]; seasonalLabel: string;
  totalRows: number; averageValue: number | null; growthRate: number | null; recentRate: number | null;
  seasonalLift: number | null; peakSeason: string | null; startLabel: string; endLabel: string;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FREQUENCY_LABELS: Record<Frequency, string> = { daily: "Daily cadence", weekly: "Weekly cadence", monthly: "Monthly cadence" };
const selectClass = "w-full rounded-2xl border border-gray-200/80 bg-white/70 px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-500/10 dark:border-gray-800/80 dark:bg-gray-900/70 dark:text-gray-100";

const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
const toNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};
const normalizeDate = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(value.trim())) return value.trim().slice(0, 10);
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return null;
};
function parseIsoDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}
function formatDate(isoDate: string, long = false) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: long ? "numeric" : undefined }).format(parseIsoDate(isoDate));
}
function formatMetric(value: number | null, digits = 2) {
  if (value == null || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1000 || Number.isInteger(value)) return formatNumber(value);
  return value.toFixed(digits);
}
function pctChange(start: number, end: number) {
  return Number.isFinite(start) && Number.isFinite(end) && start !== 0 ? ((end - start) / Math.abs(start)) * 100 : null;
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
function detectFrequency(points: RawPoint[]): Frequency {
  if (points.length < 3) return "daily";
  const diffs = points.slice(1).map((point, index) => {
    const left = parseIsoDate(points[index].isoDate).getTime();
    const right = parseIsoDate(point.isoDate).getTime();
    return Math.round((right - left) / 86_400_000);
  }).filter((diff) => diff > 0).sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)] ?? 1;
  return median >= 26 ? "monthly" : median >= 6 ? "weekly" : "daily";
}
const buildMovingAverage = (values: number[], windowSize: number) => values.map((_, index) => {
  const slice = values.slice(Math.max(0, index - windowSize + 1), index + 1);
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
});
function buildTrendLine(values: number[]) {
  if (values.length < 2) return values;
  const meanX = (values.length - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY);
    denominator += (index - meanX) ** 2;
  });
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;
  return values.map((_, index) => intercept + slope * index);
}
function buildSeasonality(points: RawPoint[], frequency: Frequency): Pick<AnalysisResult, "seasonality" | "seasonalLabel" | "seasonalLift" | "peakSeason"> {
  const useMonths = frequency !== "daily";
  const ordered = useMonths ? MONTHS.map((_, index) => String(index)) : DAYS.map((_, index) => String(index));
  const buckets = new Map<string, { label: string; total: number; count: number }>();
  points.forEach((point) => {
    const parsed = parseIsoDate(point.isoDate);
    const key = useMonths ? String(parsed.getUTCMonth()) : String(parsed.getUTCDay());
    const label = useMonths ? MONTHS[Number(key)] : DAYS[Number(key)];
    const bucket = buckets.get(key) ?? { label, total: 0, count: 0 };
    bucket.total += point.value;
    bucket.count += 1;
    buckets.set(key, bucket);
  });
  const seasonality = ordered.flatMap<SeasonalityPoint>((key) => {
    const bucket = buckets.get(key);
    return bucket ? [{ key, label: bucket.label, value: bucket.total / bucket.count, count: bucket.count, emphasis: "neutral" }] : [];
  });
  if (seasonality.length === 0) return { seasonality: [], seasonalLabel: useMonths ? "Month-of-year pattern" : "Weekday pattern", seasonalLift: null, peakSeason: null };
  const peak = seasonality.reduce((best, point) => point.value > best.value ? point : best);
  const trough = seasonality.reduce((best, point) => point.value < best.value ? point : best);
  const mean = seasonality.reduce((sum, point) => sum + point.value, 0) / seasonality.length;
  return {
    seasonality: seasonality.map((point) => {
      const emphasis: SeasonalityPoint["emphasis"] = point.key === peak.key ? "peak" : point.key === trough.key ? "trough" : "neutral";
      return { ...point, emphasis };
    }),
    seasonalLabel: useMonths ? "Month-of-year pattern" : "Weekday pattern",
    seasonalLift: mean === 0 ? null : ((peak.value - trough.value) / Math.abs(mean)) * 100,
    peakSeason: peak.label,
  };
}
function buildAnalysis(rows: RawPoint[], windowSize: number): AnalysisResult | null {
  if (rows.length === 0) return null;
  const values = rows.map((row) => row.value);
  const frequency = detectFrequency(rows);
  const movingAverage = buildMovingAverage(values, windowSize);
  const trendLine = buildTrendLine(values);
  return {
    frequency,
    points: rows.map((row, index) => ({ ...row, movingAverage: movingAverage[index], trend: trendLine[index] })),
    totalRows: rows.reduce((sum, row) => sum + row.count, 0),
    averageValue: values.reduce((sum, value) => sum + value, 0) / values.length,
    growthRate: pctChange(values[0], values[values.length - 1]),
    recentRate: values.length > 1 ? pctChange(values[values.length - 2], values[values.length - 1]) : null,
    startLabel: formatDate(rows[0].isoDate, true),
    endLabel: formatDate(rows[rows.length - 1].isoDate, true),
    ...buildSeasonality(rows, frequency),
  };
}
function buildTrendOption(points: TrendPoint[], dark: boolean, metricLabel: string, windowSize: number): EChartsOption {
  const borderColor = dark ? "#27272a" : "#e5e7eb";
  const textColor = dark ? "#a1a1aa" : "#6b7280";
  return {
    animationDuration: 500,
    color: ["#38bdf8", "#34d399", "#f59e0b"],
    tooltip: { trigger: "axis", backgroundColor: dark ? "#111827ee" : "#ffffffee", borderColor, textStyle: { color: dark ? "#f3f4f6" : "#111827" } },
    legend: { top: 0, textStyle: { color: textColor, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 14, right: 18, top: 42, bottom: 32, containLabel: true },
    xAxis: {
      type: "category",
      data: points.map((point) => formatDate(point.isoDate)),
      boundaryGap: false,
      axisLabel: { color: textColor, fontSize: 11, rotate: points.length > 12 ? 24 : 0 },
      axisLine: { lineStyle: { color: borderColor } },
    },
    yAxis: { type: "value", axisLabel: { color: textColor, fontSize: 11 }, splitLine: { lineStyle: { color: borderColor, type: "dashed" } } },
    dataZoom: points.length > 18 ? [{ type: "inside" }, { type: "slider", height: 18, bottom: 2 }] : undefined,
    series: [
      { name: metricLabel, type: "line", smooth: true, data: points.map((point) => point.value), symbol: points.length > 60 ? "none" : "circle", symbolSize: 5, lineStyle: { width: 3 }, areaStyle: { opacity: 0.08 }, markPoint: { symbolSize: 36, label: { color: "#fff", formatter: "{b}" }, data: [{ type: "max", name: "Peak" }, { type: "min", name: "Low" }] } },
      { name: `${windowSize}-period MA`, type: "line", smooth: true, connectNulls: true, data: points.map((point) => point.movingAverage), symbol: "none", lineStyle: { width: 2, type: "dashed" } },
      { name: "Trend", type: "line", smooth: true, data: points.map((point) => point.trend), symbol: "none", lineStyle: { width: 2, type: "dotted" } },
    ],
  };
}
function buildSeasonalityOption(points: SeasonalityPoint[], dark: boolean): EChartsOption {
  const borderColor = dark ? "#27272a" : "#e5e7eb";
  const textColor = dark ? "#a1a1aa" : "#6b7280";
  return {
    animationDuration: 420,
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: dark ? "#111827ee" : "#ffffffee", borderColor, textStyle: { color: dark ? "#f3f4f6" : "#111827" } },
    grid: { left: 12, right: 18, top: 16, bottom: 20, containLabel: true },
    xAxis: { type: "category", data: points.map((point) => point.label), axisLabel: { color: textColor, fontSize: 11 }, axisLine: { lineStyle: { color: borderColor } } },
    yAxis: { type: "value", axisLabel: { color: textColor, fontSize: 11 }, splitLine: { lineStyle: { color: borderColor, type: "dashed" } } },
    series: [{
      type: "bar",
      data: points.map((point) => ({
        value: point.value,
        itemStyle: { color: point.emphasis === "peak" ? "#22c55e" : point.emphasis === "trough" ? "#f97316" : "#8b5cf6", borderRadius: [8, 8, 0, 0] },
      })),
      barMaxWidth: 32,
    }],
  };
}

function Panel({ title, icon: Icon, children }: { title: string; icon: ElementType; children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: "easeOut" }} className="rounded-2xl border border-gray-200/70 bg-white/80 p-5 shadow-sm dark:border-gray-700/70 dark:bg-gray-900/60">
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-xl bg-sky-500/10 p-2 text-sky-600 dark:text-sky-400"><Icon className="h-4 w-4" /></div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      </div>
      {children}
    </motion.div>
  );
}
function StatTile({ label, value, icon: Icon }: { label: string; value: string; icon: ElementType }) {
  return (
    <div className="rounded-2xl border border-gray-200/70 bg-gray-50/80 p-4 dark:border-gray-800/70 dark:bg-gray-950/35">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400"><Icon className="h-3.5 w-3.5" />{label}</div>
      <p className="mt-3 text-xl font-semibold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  );
}

export default function TimeSeriesAnalyzer({ tableName, columns }: TimeSeriesAnalyzerProps) {
  const dateColumns = useMemo(() => columns.filter((column) => column.type === "date"), [columns]);
  const numericColumns = useMemo(() => columns.filter((column) => column.type === "number"), [columns]);
  const dark = useDarkMode();
  const [dateColumn, setDateColumn] = useState("");
  const [numericColumn, setNumericColumn] = useState("");
  const [movingAverageWindow, setMovingAverageWindow] = useState(7);
  const [rows, setRows] = useState<RawPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDateColumn((current) => dateColumns.some((column) => column.name === current) ? current : dateColumns[0]?.name ?? "");
    setNumericColumn((current) => numericColumns.some((column) => column.name === current) ? current : numericColumns[0]?.name ?? "");
  }, [dateColumns, numericColumns]);

  useEffect(() => {
    if (!dateColumn || !numericColumn) {
      setRows([]);
      setError(null);
      return;
    }
    let cancelled = false;
    async function fetchSeries() {
      setLoading(true);
      setError(null);
      try {
        const result = await runQuery(`
          WITH parsed AS (
            SELECT TRY_CAST(${quote(dateColumn)} AS TIMESTAMP) AS ts, TRY_CAST(${quote(numericColumn)} AS DOUBLE) AS metric_value
            FROM ${quote(tableName)}
          ),
          clean AS (
            SELECT CAST(DATE_TRUNC('day', ts) AS DATE) AS bucket_date, metric_value
            FROM parsed
            WHERE ts IS NOT NULL AND metric_value IS NOT NULL
          )
          SELECT bucket_date, AVG(metric_value) AS bucket_value, COUNT(*) AS row_count
          FROM clean
          GROUP BY 1
          ORDER BY 1
        `);
        if (cancelled) return;
        setRows(result.map((row) => {
          const isoDate = normalizeDate(row.bucket_date);
          const value = toNumber(row.bucket_value);
          const count = toNumber(row.row_count);
          return isoDate && value != null && count != null ? { isoDate, value, count } : null;
        }).filter((row): row is RawPoint => row !== null));
      } catch (fetchError) {
        if (!cancelled) {
          setRows([]);
          setError(fetchError instanceof Error ? fetchError.message : "Failed to analyze the series.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void fetchSeries();
    return () => { cancelled = true; };
  }, [dateColumn, numericColumn, tableName]);

  const maxWindow = Math.max(2, Math.min(30, rows.length || 2));
  const windowSize = Math.min(Math.max(movingAverageWindow, 2), maxWindow);
  const analysis = useMemo(() => buildAnalysis(rows, windowSize), [rows, windowSize]);

  if (dateColumns.length === 0 || numericColumns.length === 0) {
    return (
      <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-gray-200/50 bg-white/60 p-6 shadow-xl shadow-slate-900/5 backdrop-blur-xl dark:border-gray-700/50 dark:bg-gray-900/60">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">Time Series Analysis</p>
        <h3 className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">Insufficient columns</h3>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">This tool needs at least one date column and one numeric column.</p>
      </motion.section>
    );
  }

  return (
    <section className="rounded-2xl border border-gray-200/50 bg-white/60 p-6 shadow-xl shadow-slate-900/5 backdrop-blur-xl dark:border-gray-700/50 dark:bg-gray-900/60">
      <div className="flex flex-col gap-5 border-b border-gray-200/70 pb-5 dark:border-gray-700/70 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-600 dark:text-sky-400">Time Series Analysis</p>
          <h2 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">Trend, seasonality, and growth</h2>
          <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-400">Analyze {tableName} with automatic cadence detection, a configurable moving average, and a seasonal profile built from {numericColumn || "your metric"}.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Date column</span>
            <select value={dateColumn} onChange={(event) => setDateColumn(event.target.value)} className={selectClass}>{dateColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select>
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Numeric column</span>
            <select value={numericColumn} onChange={(event) => setNumericColumn(event.target.value)} className={selectClass}>{numericColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select>
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Moving average</span>
            <div className="rounded-2xl border border-gray-200/80 bg-white/70 px-4 py-3 shadow-sm dark:border-gray-800/80 dark:bg-gray-900/70">
              <input type="range" min={2} max={maxWindow} value={windowSize} disabled={rows.length < 2} onChange={(event) => setMovingAverageWindow(Number(event.target.value))} className="w-full accent-sky-500 disabled:cursor-not-allowed disabled:opacity-50" />
              <div className="mt-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400"><span>2</span><span>{windowSize} periods</span><span>{maxWindow}</span></div>
            </div>
          </label>
        </div>
      </div>

      {loading ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.45fr_0.95fr]">
          <div className="space-y-6"><SkeletonChart className="min-h-[360px]" /><SkeletonCard className="min-h-[180px]" /></div>
          <div className="space-y-6"><SkeletonCard className="min-h-[220px]" /><SkeletonChart className="min-h-[280px]" /></div>
        </div>
      ) : error ? (
        <div className="mt-6 rounded-2xl border border-red-300/50 bg-red-500/10 p-5 text-sm text-red-700 dark:border-red-500/30 dark:text-red-300">{error}</div>
      ) : !analysis || analysis.points.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-gray-200/70 bg-gray-50/80 p-5 text-sm text-gray-600 dark:border-gray-800/70 dark:bg-gray-950/35 dark:text-gray-400">No valid time-series rows were found for the selected columns.</div>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.45fr_0.95fr]">
          <div className="space-y-6">
            <Panel title="Trend Chart" icon={LineChart}>
              <ReactECharts option={buildTrendOption(analysis.points, dark, numericColumn, windowSize)} style={{ height: 360, width: "100%" }} opts={{ renderer: "svg" }} notMerge lazyUpdate />
            </Panel>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Frequency" value={FREQUENCY_LABELS[analysis.frequency]} icon={Calendar} />
              <StatTile label="Growth Rate" value={analysis.growthRate == null ? "—" : formatPercent(analysis.growthRate, 1)} icon={TrendingUp} />
              <StatTile label="Recent Change" value={analysis.recentRate == null ? "—" : formatPercent(analysis.recentRate, 1)} icon={Activity} />
              <StatTile label="Average Value" value={formatMetric(analysis.averageValue)} icon={Sigma} />
            </div>
          </div>
          <div className="space-y-6">
            <Panel title="Seasonality" icon={Calendar}>
              <ReactECharts option={buildSeasonalityOption(analysis.seasonality, dark)} style={{ height: 280, width: "100%" }} opts={{ renderer: "svg" }} notMerge lazyUpdate />
              <div className="mt-4 rounded-2xl border border-gray-200/70 bg-gray-50/80 p-4 text-sm leading-6 text-gray-700 dark:border-gray-800/70 dark:bg-gray-950/35 dark:text-gray-300">
                <p><span className="font-semibold text-gray-900 dark:text-gray-100">{analysis.seasonalLabel}:</span> strongest lift appears in <span className="font-semibold text-emerald-600 dark:text-emerald-400">{analysis.peakSeason ?? "—"}</span>.</p>
                <p className="mt-2">Seasonal swing: <span className="font-semibold text-gray-900 dark:text-gray-100">{analysis.seasonalLift == null ? "—" : formatPercent(analysis.seasonalLift, 1)}</span> between the highest and lowest recurring bucket.</p>
              </div>
            </Panel>
            <Panel title="Series Summary" icon={Sigma}>
              <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
                <div className="rounded-2xl border border-gray-200/70 bg-gray-50/80 p-4 dark:border-gray-800/70 dark:bg-gray-950/35">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Coverage</p>
                  <p className="mt-2 text-base font-semibold text-gray-900 dark:text-gray-100">{analysis.startLabel} to {analysis.endLabel}</p>
                  <p className="mt-1 text-gray-600 dark:text-gray-400">{formatNumber(analysis.points.length)} buckets from {formatNumber(analysis.totalRows)} non-null rows.</p>
                </div>
                <div className="rounded-2xl border border-gray-200/70 bg-gray-50/80 p-4 dark:border-gray-800/70 dark:bg-gray-950/35">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Interpretation</p>
                  <p className="mt-2">The chart overlays the raw series with a <span className="font-semibold text-gray-900 dark:text-gray-100">{windowSize}-period moving average</span> and a fitted trend line to separate noise from direction.</p>
                  <p className="mt-2">Cadence is inferred from the median spacing between dates so sparse weekly and monthly datasets are labeled correctly.</p>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {loading && <div className="mt-4 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400"><Loader2 className="h-4 w-4 animate-spin" />Querying DuckDB for time-series buckets.</div>}
    </section>
  );
}
