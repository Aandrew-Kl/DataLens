"use client";
import { startTransition, useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { motion } from "framer-motion";
import { Activity, AlertTriangle, Database, Hash, Loader2, Sigma, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile, ColumnType } from "@/types/dataset";
interface SparklineGridProps { tableName: string; columns: ColumnProfile[]; }
type SparklineMap = Record<string, number[]>;
const SAMPLE_ROWS = 120;
const MAX_POINTS = 24;
const GRID_CLASS = "grid grid-cols-[minmax(0,1.9fr)_136px_112px_repeat(3,minmax(0,0.9fr))]";
const TYPE_META: Record<ColumnType, { icon: LucideIcon; label: string; tone: string }> = {
  string: { icon: Database, label: "String", tone: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300" },
  number: { icon: Hash, label: "Number", tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" },
  date: { icon: TrendingUp, label: "Date", tone: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" },
  boolean: { icon: Activity, label: "Boolean", tone: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-300" },
  unknown: { icon: Sigma, label: "Unknown", tone: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
};
function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}
function toNumber(value: unknown) {
  const numeric = value == null ? Number.NaN : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
function downsample(values: number[]) {
  if (values.length <= MAX_POINTS) return values;
  const step = (values.length - 1) / (MAX_POINTS - 1);
  return Array.from({ length: MAX_POINTS }, (_, index) => values[Math.round(index * step)] ?? values[values.length - 1]);
}
function formatMetric(value: number | string | undefined) {
  if (typeof value === "number") {
    return Math.abs(value) >= 1000 || Number.isInteger(value) ? formatNumber(value) : value.toFixed(2);
  }
  return typeof value === "string" && value.trim() ? value : "—";
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
function buildSparklineOption(values: number[], dark: boolean): EChartsOption {
  return {
    animationDuration: 260,
    grid: { left: 0, right: 0, top: 2, bottom: 2 },
    xAxis: { type: "category", show: false, data: values.map((_, index) => index) },
    yAxis: { type: "value", show: false, scale: true },
    tooltip: {
      trigger: "axis",
      padding: [6, 8],
      backgroundColor: dark ? "#111827f4" : "#fffffff4",
      borderColor: dark ? "#374151" : "#d1d5db",
      textStyle: { color: dark ? "#f9fafb" : "#111827", fontSize: 11 },
      formatter: (params: unknown) => {
        const point = Array.isArray(params) ? (params[0] as { data?: number } | undefined) : undefined;
        return point?.data != null ? `Value ${formatMetric(point.data)}` : "No value";
      },
    },
    series: [{
      type: "line",
      data: values,
      smooth: true,
      symbol: "none",
      showSymbol: false,
      lineStyle: { color: dark ? "#22d3ee" : "#0891b2", width: 1.8 },
      areaStyle: { color: dark ? "rgba(34, 211, 238, 0.18)" : "rgba(8, 145, 178, 0.12)" },
    }],
  };
}
function TypeBadge({ type }: { type: ColumnType }) {
  const meta = TYPE_META[type];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${meta.tone}`}>
      <Icon className="h-3.5 w-3.5" />
      {meta.label}
    </span>
  );
}
function StatCell({ value }: { value: string }) {
  return <div className="px-4 py-3 text-sm font-medium tabular-nums text-gray-700 dark:text-gray-200">{value}</div>;
}
export default function SparklineGrid({ tableName, columns }: SparklineGridProps) {
  const dark = useDarkMode();
  const numericColumns = useMemo(() => columns.filter((column) => column.type === "number"), [columns]);
  const [seriesByColumn, setSeriesByColumn] = useState<SparklineMap>({});
  const [sampleCounts, setSampleCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!numericColumns.length) {
      setSeriesByColumn({});
      setSampleCounts({});
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    async function loadSparklines() {
      setLoading(true);
      setError(null);
      try {
        const selectList = numericColumns.map((column) => {
          const identifier = quoteIdentifier(column.name);
          return `CAST(${identifier} AS DOUBLE) AS ${identifier}`;
        }).join(", ");
        const sampleRows = await runQuery(
          `SELECT ${selectList} FROM ${quoteIdentifier(tableName)} USING SAMPLE ${SAMPLE_ROWS} ROWS`
        );
        if (cancelled) return;
        const nextSeries: SparklineMap = {};
        const nextCounts: Record<string, number> = {};
        for (const column of numericColumns) {
          const values = sampleRows.map((row) => toNumber(row[column.name])).filter((value): value is number => value !== null);
          nextSeries[column.name] = downsample(values);
          nextCounts[column.name] = values.length;
        }
        startTransition(() => {
          setSeriesByColumn(nextSeries);
          setSampleCounts(nextCounts);
        });
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Unable to sample data.");
        startTransition(() => {
          setSeriesByColumn({});
          setSampleCounts({});
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadSparklines();
    return () => { cancelled = true; };
  }, [numericColumns, tableName]);
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="rounded-2xl border border-gray-200/70 bg-white/85 p-5 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-900/80"
    >
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 dark:border-gray-800">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Sparkline Grid</h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Numeric columns from <span className="font-medium text-gray-900 dark:text-white">{tableName}</span> with
              sampled trend lines plus profiled min, max, and mean values.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-medium">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-gray-700 dark:bg-gray-800 dark:text-gray-200">
              <Hash className="h-3.5 w-3.5" />
              {numericColumns.length} numeric columns
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-100 px-3 py-1.5 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300">
              <Database className="h-3.5 w-3.5" />
              sampled {SAMPLE_ROWS} rows
            </span>
          </div>
        </div>
        {error ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </motion.div>
        ) : null}
      </div>
      {!numericColumns.length ? (
        <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
          <Sigma className="h-8 w-8 text-gray-400 dark:text-gray-500" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-900 dark:text-white">No numeric columns available</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">Load a dataset with numeric fields to render sparklines.</p>
          </div>
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <div className="min-w-[820px] overflow-hidden rounded-2xl border border-gray-200/70 dark:border-gray-800">
            <div className={`${GRID_CLASS} bg-gray-50/80 text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:bg-gray-950/60 dark:text-gray-400`}>
              {["Column", "Type", "Sparkline", "Min", "Max", "Mean"].map((label) => <div key={label} className="px-4 py-3">{label}</div>)}
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {numericColumns.map((column, index) => {
                const values = seriesByColumn[column.name] ?? [];
                const ready = values.length > 1;
                return (
                  <motion.div
                    key={column.name}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03, duration: 0.22 }}
                    className={`${GRID_CLASS} items-center bg-white/70 dark:bg-gray-900/40`}
                  >
                    <div className="flex min-w-0 items-center gap-3 px-4 py-3">
                      <div className="rounded-xl bg-cyan-100 p-2 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300">
                        <Hash className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{column.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{sampleCounts[column.name] ?? 0} sampled values</p>
                      </div>
                    </div>
                    <div className="px-4 py-3"><TypeBadge type={column.type} /></div>
                    <div className="px-4 py-3">
                      {loading && !ready ? (
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-20 animate-pulse rounded-md bg-gray-200/80 dark:bg-gray-800/80" />
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-500" />
                        </div>
                      ) : ready ? (
                        <ReactECharts option={buildSparklineOption(values, dark)} notMerge lazyUpdate opts={{ renderer: "svg" }} style={{ width: 80, height: 24 }} />
                      ) : (
                        <span className="text-xs font-medium text-gray-400 dark:text-gray-500">insufficient data</span>
                      )}
                    </div>
                    <StatCell value={formatMetric(column.min)} />
                    <StatCell value={formatMetric(column.max)} />
                    <StatCell value={formatMetric(column.mean)} />
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </motion.section>
  );
}
