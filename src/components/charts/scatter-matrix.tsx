"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { motion } from "framer-motion";
import { AlertTriangle, Check, Loader2, Palette, ScatterChart, Sigma, SlidersHorizontal } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface ScatterMatrixProps { tableName: string; columns: ColumnProfile[]; }
interface MatrixRow { values: Record<string, number | null>; category: string | null; }
interface ScatterPoint { x: number; y: number; category: string | null; }

const MIN_SELECTED = 2;
const MAX_SELECTED = 4;
const DEFAULT_SELECTED = 3;
const SAMPLE_ROWS = 320;
const MAX_CATEGORY_BUCKETS = 8;
const PANEL = "rounded-2xl border border-gray-200/70 bg-white/85 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-900/80";
const CATEGORY_COLORS = ["#38bdf8", "#34d399", "#f59e0b", "#f472b6", "#818cf8", "#fb7185", "#2dd4bf", "#f97316"];

function quoteIdentifier(value: string) { return `"${value.replaceAll('"', '""')}"`; }
function isCategoricalCandidate(column: ColumnProfile) {
  if (column.type === "string" || column.type === "boolean") return true;
  return (column.type === "number" || column.type === "unknown") && column.uniqueCount > 1 && column.uniqueCount <= 12;
}
function toNumber(value: unknown) {
  const numeric = value == null ? Number.NaN : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
function toCategory(value: unknown) {
  if (value == null) return null;
  const label = String(value).trim();
  return label ? label : null;
}
function formatValue(value: number) {
  return Math.abs(value) >= 1000 || Number.isInteger(value) ? formatNumber(value) : value.toFixed(2);
}
function formatCorrelation(value: number | null) {
  return value == null || Number.isNaN(value) ? "—" : value.toFixed(3);
}
function computeCorrelation(points: ScatterPoint[]) {
  if (points.length < 3) return null;
  let sumX = 0; let sumY = 0; let sumXY = 0; let sumXX = 0; let sumYY = 0;
  for (const point of points) {
    sumX += point.x; sumY += point.y; sumXY += point.x * point.y; sumXX += point.x * point.x; sumYY += point.y * point.y;
  }
  const count = points.length;
  const numerator = count * sumXY - sumX * sumY;
  const denominator = Math.sqrt((count * sumXX - sumX * sumX) * (count * sumYY - sumY * sumY));
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  return Math.max(-1, Math.min(1, numerator / denominator));
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

function buildScatterOption(points: ScatterPoint[], dark: boolean, xLabel: string, yLabel: string, legend: string[]): EChartsOption {
  const gridColor = dark ? "#334155" : "#cbd5e1";
  const colors = legend.length ? CATEGORY_COLORS : [dark ? "#22d3ee" : "#0f766e"];
  const grouped = new Map<string, Array<[number, number]>>();
  const labels = legend.length ? legend : ["All rows"];
  for (const label of labels) grouped.set(label, []);
  for (const point of points) {
    const bucket = legend.length ? point.category ?? "Unspecified" : "All rows";
    if (!grouped.has(bucket)) grouped.set(bucket, []);
    grouped.get(bucket)?.push([point.x, point.y]);
  }
  return {
    animationDuration: 260,
    color: colors,
    grid: { left: 10, right: 10, top: 10, bottom: 10 },
    tooltip: {
      trigger: "item",
      padding: [7, 9],
      backgroundColor: dark ? "#0f172ae8" : "#ffffffe8",
      borderColor: gridColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a", fontSize: 11 },
      formatter: (params: unknown) => {
        const point = params as { value?: [number, number]; seriesName?: string };
        if (!point.value) return "No point";
        const groupLine = legend.length ? `<br/>Group: ${point.seriesName}` : "";
        return `${xLabel}: ${formatValue(point.value[0])}<br/>${yLabel}: ${formatValue(point.value[1])}${groupLine}`;
      },
    },
    xAxis: { type: "value", scale: true, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: gridColor, opacity: 0.35, type: "dashed" } } },
    yAxis: { type: "value", scale: true, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: gridColor, opacity: 0.35, type: "dashed" } } },
    series: Array.from(grouped.entries()).map(([name, data], index) => ({ name, type: "scatter", data, symbolSize: 6, large: data.length > 140, largeThreshold: 180, emphasis: { scale: 1.15 }, itemStyle: { color: colors[index % colors.length], opacity: 0.72 } })),
  };
}

export default function ScatterMatrix({ tableName, columns }: ScatterMatrixProps) {
  const dark = useDarkMode();
  const numericColumns = useMemo(() => columns.filter((column) => column.type === "number"), [columns]);
  const categoricalColumns = useMemo(() => columns.filter(isCategoricalCandidate), [columns]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>(() => numericColumns.slice(0, Math.min(DEFAULT_SELECTED, numericColumns.length, MAX_SELECTED)).map((column) => column.name));
  const [categoryColumn, setCategoryColumn] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deferredColumns = useDeferredValue(selectedColumns);
  const deferredCategory = useDeferredValue(categoryColumn);

  useEffect(() => {
    const available = numericColumns.map((column) => column.name);
    const kept = selectedColumns.filter((name) => available.includes(name));
    const next = [...kept];
    for (const name of available) {
      if (next.length >= Math.min(MAX_SELECTED, available.length)) break;
      if (!next.includes(name) && next.length < Math.min(MIN_SELECTED, available.length)) next.push(name);
    }
    if (next.join("\u0001") !== selectedColumns.join("\u0001")) startTransition(() => setSelectedColumns(next));
    if (categoryColumn && !categoricalColumns.some((column) => column.name === categoryColumn)) setCategoryColumn("");
  }, [categoryColumn, categoricalColumns, numericColumns, selectedColumns]);

  const activeColumns = useMemo(
    () => deferredColumns.map((name) => numericColumns.find((column) => column.name === name)).filter((column): column is ColumnProfile => Boolean(column)),
    [deferredColumns, numericColumns],
  );

  useEffect(() => {
    if (activeColumns.length < MIN_SELECTED) {
      setRows([]); setLoading(false); setError(null); return;
    }
    let cancelled = false;
    async function loadRows() {
      setLoading(true); setError(null);
      try {
        const selectList = activeColumns.map((column) => {
          const safe = quoteIdentifier(column.name);
          return `CAST(${safe} AS DOUBLE) AS ${safe}`;
        }).concat(deferredCategory ? `CAST(${quoteIdentifier(deferredCategory)} AS VARCHAR) AS "__category"` : []);
        const result = await runQuery(`SELECT ${selectList.join(", ")} FROM ${quoteIdentifier(tableName)} USING SAMPLE ${SAMPLE_ROWS} ROWS`);
        if (cancelled) return;
        startTransition(() => setRows(result));
      } catch (cause) {
        if (cancelled) return;
        startTransition(() => setRows([]));
        setError(cause instanceof Error ? cause.message : "Unable to load matrix sample.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadRows();
    return () => { cancelled = true; };
  }, [activeColumns, deferredCategory, tableName]);

  const matrixRows = useMemo<MatrixRow[]>(
    () => rows
      .map((row) => ({ values: Object.fromEntries(activeColumns.map((column) => [column.name, toNumber(row[column.name])])) as Record<string, number | null>, category: toCategory(row.__category) }))
      .filter((row) => Object.values(row.values).filter((value) => value != null).length >= 2),
    [activeColumns, rows],
  );

  const categoryLegend = useMemo(() => {
    if (!deferredCategory) return [];
    const counts = new Map<string, number>();
    for (const row of matrixRows) {
      const label = row.category ?? "Unspecified";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort((left, right) => right[1] - left[1]).map(([label]) => label);
    return sorted.length > MAX_CATEGORY_BUCKETS ? [...sorted.slice(0, MAX_CATEGORY_BUCKETS - 1), "Other"] : sorted;
  }, [deferredCategory, matrixRows]);

  const cellData = useMemo(() => {
    const lookup = new Map<string, { points: ScatterPoint[]; correlation: number | null }>();
    for (const rowColumn of activeColumns) {
      for (const column of activeColumns) {
        const points = matrixRows.flatMap((row) => {
          const x = row.values[column.name];
          const y = row.values[rowColumn.name];
          if (x == null || y == null) return [];
          const label = row.category ?? "Unspecified";
          const category = categoryLegend.includes("Other") && !categoryLegend.includes(label) ? "Other" : label;
          return [{ x, y, category }];
        });
        lookup.set(`${rowColumn.name}::${column.name}`, { points, correlation: rowColumn.name === column.name ? 1 : computeCorrelation(points) });
      }
    }
    return lookup;
  }, [activeColumns, categoryLegend, matrixRows]);

  if (numericColumns.length < MIN_SELECTED) {
    return (
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={`${PANEL} p-6`}>
        <div className="flex min-h-44 flex-col items-center justify-center gap-3 text-center">
          <Sigma className="h-8 w-8 text-gray-400 dark:text-gray-500" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Scatter matrix needs at least two numeric columns</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">This dataset does not have enough numeric fields to build pairwise scatter plots.</p>
          </div>
        </div>
      </motion.section>
    );
  }

  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: "easeOut" }} className={`${PANEL} p-5`}>
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 dark:border-gray-800">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ScatterChart className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Scatter Plot Matrix</h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Compare 2 to 4 numeric fields from <span className="font-medium text-gray-900 dark:text-white">{tableName}</span>, with Pearson correlation in each cell and optional categorical coloring.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-medium">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-100 px-3 py-1.5 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300"><SlidersHorizontal className="h-3.5 w-3.5" />{activeColumns.length} selected</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-gray-700 dark:bg-gray-800 dark:text-gray-200"><Palette className="h-3.5 w-3.5" />{deferredCategory || "single series"}</span>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.6fr_minmax(0,240px)]">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Numeric columns</p>
            <div className="flex flex-wrap gap-2">
              {numericColumns.map((column) => {
                const selected = selectedColumns.includes(column.name);
                const disabled = !selected && selectedColumns.length >= MAX_SELECTED;
                return (
                  <button
                    key={column.name}
                    type="button"
                    disabled={disabled}
                    onClick={() => setSelectedColumns((current) => selected ? (current.length > MIN_SELECTED ? current.filter((name) => name !== column.name) : current) : (current.length < MAX_SELECTED ? [...current, column.name] : current))}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${selected ? "border-cyan-400/60 bg-cyan-500/12 text-cyan-700 dark:border-cyan-400/40 dark:bg-cyan-500/12 dark:text-cyan-300" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:text-gray-100"} ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
                  >
                    {selected ? <Check className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5 rounded-full border border-current/40" />}
                    {column.name}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Keep at least two columns selected. Up to four columns are shown at once.</p>
          </div>

          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Color by category</span>
            <div className="relative">
              <Palette className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <select value={categoryColumn} onChange={(event) => setCategoryColumn(event.target.value)} className="w-full appearance-none rounded-2xl border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm text-gray-700 outline-none transition focus:border-cyan-400 dark:border-gray-700 dark:bg-gray-950/70 dark:text-gray-200">
                <option value="">None</option>
                {categoricalColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
              </select>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{categoricalColumns.length ? "Series are grouped into the dominant sample labels." : "No low-cardinality categorical fields were detected."}</p>
          </label>
        </div>

        {error ? (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />{error}
          </motion.div>
        ) : null}
      </div>

      <div className="mt-5 space-y-4">
        {categoryLegend.length ? (
          <div className="flex flex-wrap gap-2">
            {categoryLegend.map((label, index) => (
              <span key={label} className="inline-flex items-center gap-2 rounded-full border border-gray-200/80 bg-white/80 px-3 py-1 text-xs font-medium text-gray-600 dark:border-gray-700 dark:bg-gray-950/40 dark:text-gray-300">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }} />
                {label}
              </span>
            ))}
          </div>
        ) : null}

        {loading && !matrixRows.length ? (
          <div className="flex min-h-72 items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-300/80 bg-gray-50/70 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-950/30 dark:text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />Sampling rows for the matrix
          </div>
        ) : matrixRows.length ? (
          <div className="overflow-x-auto">
            <div className="grid min-w-[560px] gap-3" style={{ gridTemplateColumns: `repeat(${activeColumns.length}, minmax(0, 1fr))` }}>
              {activeColumns.flatMap((rowColumn, rowIndex) => activeColumns.map((column, columnIndex) => {
                const entry = cellData.get(`${rowColumn.name}::${column.name}`);
                const points = entry?.points ?? [];
                const diagonal = rowIndex === columnIndex;
                return (
                  <motion.div key={`${rowColumn.name}:${column.name}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: rowIndex * 0.04 + columnIndex * 0.02, duration: 0.2 }} className="relative aspect-square overflow-hidden rounded-2xl border border-gray-200/80 bg-white/80 shadow-sm dark:border-gray-800 dark:bg-gray-950/40">
                    <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 p-2">
                      <span className="rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-gray-700 shadow-sm dark:bg-gray-950/80 dark:text-gray-200">r {formatCorrelation(entry?.correlation ?? null)}</span>
                      <span className="rounded-full bg-white/85 px-2.5 py-1 text-[11px] text-gray-500 shadow-sm dark:bg-gray-950/80 dark:text-gray-400">{formatNumber(points.length)} pts</span>
                    </div>

                    {diagonal ? (
                      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.14),_transparent_60%)] px-6 text-center">
                        <ScatterChart className="h-6 w-6 text-cyan-600 dark:text-cyan-400" />
                        <div className="space-y-1">
                          <p className="text-base font-semibold text-gray-900 dark:text-white">{column.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{formatNumber(matrixRows.filter((row) => row.values[column.name] != null).length)} non-null sampled values</p>
                        </div>
                      </div>
                    ) : (
                      <div className="h-full w-full pt-8">
                        <ReactECharts option={buildScatterOption(points, dark, column.name, rowColumn.name, categoryLegend)} notMerge lazyUpdate opts={{ renderer: "svg" }} style={{ width: "100%", height: "100%" }} />
                      </div>
                    )}
                  </motion.div>
                );
              }))}
            </div>
          </div>
        ) : (
          <div className="flex min-h-60 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-300/80 bg-gray-50/70 text-center dark:border-gray-700 dark:bg-gray-950/30">
            <Sigma className="h-8 w-8 text-gray-400 dark:text-gray-500" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-900 dark:text-white">No pairwise points available</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">The current sample does not contain enough overlapping numeric values to draw a scatter matrix.</p>
            </div>
          </div>
        )}
      </div>
    </motion.section>
  );
}
