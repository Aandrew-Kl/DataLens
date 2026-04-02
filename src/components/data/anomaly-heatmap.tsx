"use client";
import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, AlertTriangle, Loader2, Sigma } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";
interface AnomalyHeatmapProps { tableName: string; columns: ColumnProfile[]; }
interface ColumnStats { name: string; mean: number | null; stddev: number | null; nonNullCount: number; anomalyCount: number; }
interface SampleRow { rowId: number; values: Record<string, number | null>; }
interface HeatCell { rowIndex: number; columnIndex: number; rowLabel: string; columnName: string; rawValue: number | null; zScore: number | null; absZScore: number; isAnomaly: boolean; }
interface HeatmapDatum { value: [number, number, number]; rowLabel: string; columnName: string; rawValue: number | null; zScore: number | null; absZScore: number; isAnomaly: boolean; itemStyle?: { color: string }; }
const SAMPLE_SIZE = 18;
const ANOMALY_THRESHOLD = 2.5;
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
const formatCellValue = (value: number | null) => {
  if (value === null) return "Missing";
  if (Math.abs(value) >= 1000 || Number.isInteger(value)) return formatNumber(value);
  if (Math.abs(value) >= 100) return value.toFixed(1);
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value.toFixed(3);
};
const formatZScore = (value: number | null) => value == null || Number.isNaN(value) ? "n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}σ`;
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
function buildHeatmapOption(cells: HeatCell[], rowLabels: string[], columnLabels: string[], dark: boolean): EChartsOption {
  const borderColor = dark ? "#1f2937" : "#e5e7eb";
  const textColor = dark ? "#cbd5e1" : "#64748b";
  const missingColor = dark ? "#0f172a" : "#f8fafc";
  const maxIntensity = Math.max(4, ...cells.map((cell) => cell.absZScore));
  const showLabels = rowLabels.length <= 10 && columnLabels.length <= 8;
  const data: HeatmapDatum[] = cells.map((cell) => ({
    value: [cell.columnIndex, cell.rowIndex, cell.absZScore],
    rowLabel: cell.rowLabel,
    columnName: cell.columnName,
    rawValue: cell.rawValue,
    zScore: cell.zScore,
    absZScore: cell.absZScore,
    isAnomaly: cell.isAnomaly,
    itemStyle: cell.rawValue === null ? { color: missingColor } : undefined,
  }));
  const readDatum = (params: unknown) => ((params as { data?: HeatmapDatum | null }).data ?? undefined);
  return {
    animationDuration: 420,
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#0f172ae8" : "#fffffff0",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const datum = readDatum(params);
        if (!datum) return "";
        return [
          `<strong>${datum.columnName}</strong>`,
          datum.rowLabel,
          `Value: ${formatCellValue(datum.rawValue)}`,
          `Z-score: ${formatZScore(datum.zScore)}`,
          `Status: ${datum.isAnomaly ? "Flagged anomaly" : "Within expected range"}`,
        ].join("<br/>");
      },
    },
    grid: { left: 86, right: 18, top: 44, bottom: 78, containLabel: true },
    xAxis: {
      type: "category",
      data: columnLabels,
      splitArea: { show: true },
      axisLabel: { color: textColor, fontSize: 11, rotate: columnLabels.length > 6 ? 28 : 0, interval: 0 },
      axisLine: { lineStyle: { color: borderColor } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "category",
      data: rowLabels,
      splitArea: { show: true },
      axisLabel: { color: textColor, fontSize: 11 },
      axisLine: { lineStyle: { color: borderColor } },
      axisTick: { show: false },
    },
    visualMap: {
      min: 0,
      max: maxIntensity,
      orient: "horizontal",
      left: "center",
      bottom: 18,
      calculable: false,
      text: ["Extreme", "Normal"],
      textGap: 10,
      textStyle: { color: textColor, fontSize: 11 },
      inRange: { color: dark ? ["#166534", "#facc15", "#dc2626"] : ["#22c55e", "#facc15", "#ef4444"] },
    },
    series: [{
      type: "heatmap",
      data,
      progressive: 0,
      label: {
        show: showLabels,
        color: "#fff",
        fontSize: 10,
        fontWeight: 700,
        formatter: (params: unknown) => {
          const datum = readDatum(params);
          return !datum || datum.zScore === null || datum.absZScore < ANOMALY_THRESHOLD ? "" : datum.zScore.toFixed(1);
        },
      },
      itemStyle: { borderColor, borderWidth: 1, borderRadius: 8 },
      emphasis: { itemStyle: { shadowBlur: 16, shadowColor: dark ? "rgba(15, 23, 42, 0.5)" : "rgba(148, 163, 184, 0.45)" } },
    }],
  };
}
function StatCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-gray-200/70 bg-white/80 p-4 shadow-sm dark:border-gray-700/70 dark:bg-gray-950/35">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-3 text-2xl font-semibold ${tone}`}>{value}</p>
    </div>
  );
}
export default function AnomalyHeatmap({ tableName, columns }: AnomalyHeatmapProps) {
  const numericColumns = useMemo(() => columns.filter((column) => column.type === "number"), [columns]);
  const dark = useDarkMode();
  const [stats, setStats] = useState<ColumnStats[]>([]);
  const [sampleRows, setSampleRows] = useState<SampleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (numericColumns.length === 0) {
      setStats([]);
      setSampleRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    async function fetchHeatmapData() {
      setLoading(true);
      setError(null);
      const safeTable = quote(tableName);
      const statsCte = numericColumns.flatMap((column, index) => {
        const safeColumn = quote(column.name);
        return [
          `AVG(CAST(${safeColumn} AS DOUBLE)) AS c${index}_mean`,
          `STDDEV_SAMP(CAST(${safeColumn} AS DOUBLE)) AS c${index}_stddev`,
          `COUNT(${safeColumn}) AS c${index}_count`,
        ];
      });
      const statsSelect = numericColumns.flatMap((column, index) => {
        const safeColumn = quote(column.name);
        return [
          `stats.c${index}_mean AS c${index}_mean`,
          `stats.c${index}_stddev AS c${index}_stddev`,
          `stats.c${index}_count AS c${index}_count`,
          `(SELECT COUNT(*) FROM ${safeTable}
            WHERE ${safeColumn} IS NOT NULL
              AND stats.c${index}_stddev IS NOT NULL
              AND stats.c${index}_stddev > 0
              AND ABS((CAST(${safeColumn} AS DOUBLE) - stats.c${index}_mean) / stats.c${index}_stddev) > ${ANOMALY_THRESHOLD}
          ) AS c${index}_anomaly_count`,
        ];
      });
      const numericSelect = numericColumns.map((column) => quote(column.name)).join(", ");
      const nonNullPredicate = numericColumns.map((column) => `${quote(column.name)} IS NOT NULL`).join(" OR ");
      try {
        const [statRows, rawRows] = await Promise.all([
          runQuery(`
            WITH stats AS (
              SELECT
                ${statsCte.join(",\n                ")}
              FROM ${safeTable}
            )
            SELECT
              ${statsSelect.join(",\n              ")}
            FROM stats
          `),
          runQuery(`
            WITH indexed AS (
              SELECT row_number() OVER () AS row_id, ${numericSelect}
              FROM ${safeTable}
            )
            SELECT *
            FROM indexed
            WHERE ${nonNullPredicate}
            ORDER BY random()
            LIMIT ${SAMPLE_SIZE}
          `),
        ]);
        if (cancelled) return;
        const statRow = statRows[0] ?? {};
        setStats(numericColumns.map((column, index) => ({
          name: column.name,
          mean: toNumber(statRow[`c${index}_mean`]),
          stddev: toNumber(statRow[`c${index}_stddev`]),
          nonNullCount: Number(statRow[`c${index}_count`] ?? 0),
          anomalyCount: Number(statRow[`c${index}_anomaly_count`] ?? 0),
        })));
        setSampleRows(rawRows.map((row) => ({
          rowId: Number(row.row_id ?? 0),
          values: Object.fromEntries(numericColumns.map((column) => [column.name, toNumber(row[column.name])])),
        })).sort((left, right) => left.rowId - right.rowId));
      } catch (fetchError) {
        if (cancelled) return;
        setStats([]);
        setSampleRows([]);
        setError(fetchError instanceof Error ? fetchError.message : "Failed to compute anomaly heatmap.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchHeatmapData();
    return () => { cancelled = true; };
  }, [numericColumns, tableName]);
  const cells = useMemo(() => sampleRows.flatMap((row, rowIndex) => stats.map((column, columnIndex) => {
    const rawValue = row.values[column.name] ?? null;
    const zScore = rawValue !== null && column.mean !== null && (column.stddev ?? 0) > 0 ? (rawValue - column.mean) / (column.stddev ?? 1) : null;
    const absZScore = zScore === null ? 0 : Math.abs(zScore);
    return { rowIndex, columnIndex, rowLabel: `Row ${row.rowId}`, columnName: column.name, rawValue, zScore, absZScore, isAnomaly: absZScore > ANOMALY_THRESHOLD } satisfies HeatCell;
  })), [sampleRows, stats]);
  const anomalyCells = useMemo(() => [...cells].filter((cell) => cell.isAnomaly).sort((a, b) => b.absZScore - a.absZScore), [cells]);
  const hottestColumns = useMemo(() => [...stats].sort((a, b) => b.anomalyCount - a.anomalyCount || a.name.localeCompare(b.name)).slice(0, 5), [stats]);
  const totalFlagged = stats.reduce((sum, column) => sum + column.anomalyCount, 0);
  const stableColumns = stats.filter((column) => (column.stddev ?? 0) <= 0 || column.nonNullCount <= 1).length;
  const chartHeight = Math.max(320, sampleRows.length * 30 + 120);
  const option = useMemo(() => buildHeatmapOption(cells, sampleRows.map((row) => `Row ${row.rowId}`), stats.map((column) => column.name), dark), [cells, sampleRows, stats, dark]);
  if (numericColumns.length === 0) {
    return (
      <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-gray-200/50 bg-white/60 p-6 shadow-xl shadow-slate-900/5 dark:border-gray-700/50 dark:bg-gray-900/60">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">Anomaly Heatmap</p>
        <h3 className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">No numeric columns available</h3>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Add numeric fields to compare cell-level deviations against each column&apos;s mean and standard deviation.</p>
      </motion.section>
    );
  }
  return (
    <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-gray-200/50 bg-white/60 p-6 shadow-xl shadow-slate-900/5 dark:border-gray-700/50 dark:bg-gray-900/60">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">Anomaly Heatmap</p>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Z-score scan across {numericColumns.length} numeric columns</h3>
            <span className="rounded-full border border-gray-200/70 bg-white/70 px-3 py-1 text-xs font-medium text-gray-600 dark:border-gray-700/70 dark:bg-gray-950/40 dark:text-gray-300">{sampleRows.length} sampled rows</span>
          </div>
          <p className="max-w-3xl text-sm text-gray-600 dark:text-gray-400">Green cells stay near the column mean, yellow cells drift, and red cells cross {ANOMALY_THRESHOLD} standard deviations.</p>
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-amber-200/70 bg-amber-500/10 px-4 py-3 text-amber-800 dark:border-amber-500/20 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm font-medium">{formatNumber(totalFlagged)} flagged cells across the table</span>
        </div>
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-4">
        <StatCard label="Numeric Columns" value={String(numericColumns.length)} tone="text-sky-600 dark:text-sky-400" />
        <StatCard label="Sampled Rows" value={String(sampleRows.length)} tone="text-emerald-600 dark:text-emerald-400" />
        <StatCard label="Sample Anomalies" value={String(anomalyCells.length)} tone="text-amber-600 dark:text-amber-400" />
        <StatCard label="Stable Columns" value={String(stableColumns)} tone="text-violet-600 dark:text-violet-400" />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-2xl border border-gray-200/70 bg-white/75 p-4 shadow-sm dark:border-gray-700/70 dark:bg-gray-950/35">
          {loading ? (
            <div className="flex h-[360px] items-center justify-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Computing z-score baselines and sampling rows...
            </div>
          ) : error ? (
            <div className="flex h-[360px] items-center justify-center rounded-2xl border border-red-200/70 bg-red-500/10 px-6 text-center text-sm text-red-700 dark:border-red-500/20 dark:text-red-300">{error}</div>
          ) : sampleRows.length === 0 ? (
            <div className="flex h-[360px] items-center justify-center text-sm text-gray-500 dark:text-gray-400">No numeric sample rows were available for anomaly scoring.</div>
          ) : (
            <ReactECharts option={option} style={{ height: chartHeight, width: "100%" }} opts={{ renderer: "svg" }} notMerge lazyUpdate />
          )}
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200/70 bg-white/75 p-5 shadow-sm dark:border-gray-700/70 dark:bg-gray-950/35">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
              <Sigma className="h-4 w-4 text-sky-500" />
              Column risk ranking
            </div>
            <div className="mt-4 space-y-3">
              {hottestColumns.map((column) => (
                <div key={column.name} className="rounded-xl bg-gray-50/90 p-3 dark:bg-gray-900/70">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{column.name}</p>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{formatNumber(column.anomalyCount)} flagged</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200/80 dark:bg-gray-800/80">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(100, totalFlagged === 0 ? 0 : (column.anomalyCount / totalFlagged) * 100)}%` }} transition={{ duration: 0.45, ease: "easeOut" }} className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-red-500" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-gray-200/70 bg-white/75 p-5 shadow-sm dark:border-gray-700/70 dark:bg-gray-950/35">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
              <Activity className="h-4 w-4 text-rose-500" />
              Strongest sampled deviations
            </div>
            <AnimatePresence mode="wait">
              {anomalyCells.length > 0 ? (
                <motion.div key="anomalies" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-4 space-y-3">
                  {anomalyCells.slice(0, 6).map((cell) => (
                    <motion.div key={`${cell.rowLabel}-${cell.columnName}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-red-200/70 bg-red-500/10 p-3 dark:border-red-500/20">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{cell.columnName}</p>
                        <span className="text-xs font-semibold text-red-700 dark:text-red-300">{formatZScore(cell.zScore)}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{cell.rowLabel}</p>
                      <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{formatCellValue(cell.rawValue)}</p>
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <motion.div key="clear" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-4 rounded-xl border border-emerald-200/70 bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:border-emerald-500/20 dark:text-emerald-300">
                  The sampled window did not contain any cells beyond {ANOMALY_THRESHOLD} standard deviations.
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
