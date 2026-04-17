"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { startTransition, useMemo, useRef, useState, useSyncExternalStore } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Download,
  Loader2,
  Rows3,
  Waypoints,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface WaterfallChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface WaterfallRow {
  category: string;
  value: number;
  sourceOrder: number;
}

interface WaterfallPoint extends WaterfallRow {
  base: number;
  delta: number;
  runningTotal: number;
  contributionPct: number;
}

type SortMode = "original" | "ascending" | "descending";

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 dark:bg-slate-950/45 dark:text-slate-100";

function subscribeDarkMode(listener: () => void) {
  if (typeof document === "undefined") return () => undefined;
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getDarkModeSnapshot() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}
function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildWaterfallQuery(tableName: string, categoryColumn: string, valueColumn: string) {
  const safeTable = quoteIdentifier(tableName);
  const safeCategory = quoteIdentifier(categoryColumn);
  const safeValue = quoteIdentifier(valueColumn);

  return `
    WITH base AS (
      SELECT
        row_number() OVER () AS source_order,
        CAST(${safeCategory} AS VARCHAR) AS category,
        TRY_CAST(${safeValue} AS DOUBLE) AS metric
      FROM ${safeTable}
      WHERE ${safeCategory} IS NOT NULL
        AND ${safeValue} IS NOT NULL
        AND TRY_CAST(${safeValue} AS DOUBLE) IS NOT NULL
    )
    SELECT
      category,
      SUM(metric) AS value,
      MIN(source_order) AS source_order
    FROM base
    GROUP BY 1
    HAVING SUM(metric) IS NOT NULL
    ORDER BY source_order
    LIMIT 48
  `;
}

function sortRows(rows: WaterfallRow[], sortMode: SortMode) {
  const next = [...rows];
  if (sortMode === "ascending") {
    next.sort((left, right) => left.value - right.value || left.category.localeCompare(right.category));
  } else if (sortMode === "descending") {
    next.sort((left, right) => right.value - left.value || left.category.localeCompare(right.category));
  } else {
    next.sort((left, right) => left.sourceOrder - right.sourceOrder);
  }
  return next;
}

function buildWaterfallPoints(rows: WaterfallRow[]) {
  let runningTotal = 0;
  const finalTotal = rows.reduce((sum, row) => sum + row.value, 0);

  const points: WaterfallPoint[] = rows.map((row) => {
    const start = runningTotal;
    const nextTotal = runningTotal + row.value;
    const point: WaterfallPoint = {
      ...row,
      base: Math.min(start, nextTotal),
      delta: Math.abs(row.value),
      runningTotal: nextTotal,
      contributionPct: finalTotal === 0 ? 0 : (row.value / finalTotal) * 100,
    };
    runningTotal = nextTotal;
    return point;
  });

  return {
    points,
    finalTotal,
    positiveCount: rows.filter((row) => row.value >= 0).length,
    negativeCount: rows.filter((row) => row.value < 0).length,
  };
}

function exportChartImage(chartRef: ReactEChartsCore | null, dark: boolean, fileName: string) {
  const instance = chartRef?.getEchartsInstance();
  if (!instance) return;
  const url = instance.getDataURL({
    type: "png",
    pixelRatio: 2,
    backgroundColor: dark ? "#020617" : "#f8fafc",
  });
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
}

function buildOption(
  dark: boolean,
  points: WaterfallPoint[],
  finalTotal: number,
  showConnectors: boolean,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const categories = [...points.map((point) => point.category), "Total"];
  const placeholderSeries = [...points.map((point) => point.base), 0];
  const deltaSeries = [...points.map((point) => point.delta), null];
  const totalSeries = [...points.map(() => null), finalTotal];
  const connectorSeries = [...points.map((point) => point.runningTotal), finalTotal];

  return {
    animationDuration: 520,
    legend: {
      bottom: 0,
      textStyle: { color: textColor },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params) => {
        const primary = Array.isArray(params)
          ? params.find((entry) => entry.seriesName === "Contribution" || entry.seriesName === "Total")
          : params;
        if (!primary) return "";
        const category = String(("name" in primary ? primary.name : "") ?? "");
        if (category === "Total") {
          return [
            `<strong>${category}</strong>`,
            `Running total: ${formatNumber(finalTotal)}`,
          ].join("<br/>");
        }
        const point = points.find((entry) => entry.category === category);
        if (!point) return "";
        return [
          `<strong>${point.category}</strong>`,
          `Contribution: ${formatNumber(point.value)}`,
          `Running total: ${formatNumber(point.runningTotal)}`,
          `Share of total: ${point.contributionPct.toFixed(1)}%`,
        ].join("<br/>");
      },
    },
    grid: {
      left: 56,
      right: 28,
      top: 24,
      bottom: 62,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: categories,
      axisLabel: { color: textColor },
      axisLine: { lineStyle: { color: borderColor } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        name: "Offset",
        type: "bar",
        stack: "total",
        silent: true,
        itemStyle: {
          color: "transparent",
          borderColor: "transparent",
        },
        emphasis: { disabled: true },
        data: placeholderSeries,
      },
      {
        name: "Contribution",
        type: "bar",
        stack: "total",
        barMaxWidth: 40,
        data: deltaSeries,
        itemStyle: {
          borderRadius: [14, 14, 6, 6],
          color: (params) => {
            const point = points[params.dataIndex];
            return point && point.value < 0 ? "#ef4444" : "#22c55e";
          },
        },
        label: {
          show: true,
          position: "top",
          color: textColor,
          formatter: (params) => {
            const point = points[params.dataIndex];
            return point ? formatNumber(point.value) : "";
          },
        },
      },
      {
        name: "Total",
        type: "bar",
        stack: "total",
        barMaxWidth: 40,
        data: totalSeries,
        itemStyle: {
          borderRadius: [14, 14, 6, 6],
          color: "#2563eb",
        },
        label: {
          show: true,
          position: "top",
          color: textColor,
          formatter: () => formatNumber(finalTotal),
        },
      },
      {
        name: "Connectors",
        type: "line",
        showSymbol: false,
        smooth: false,
        silent: true,
        data: showConnectors ? connectorSeries : [],
        lineStyle: {
          color: dark ? "#94a3b8" : "#64748b",
          type: "dashed",
          width: 2,
        },
      },
    ],
  };
}

function WaterfallSummary({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 dark:bg-slate-950/45">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

export default function WaterfallChart({ tableName, columns }: WaterfallChartProps) {
  const dark = useSyncExternalStore(subscribeDarkMode, getDarkModeSnapshot, () => false);
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const categoryColumns = useMemo(
    () => columns.filter((column) => column.type !== "unknown"),
    [columns],
  );

  const [categoryColumn, setCategoryColumn] = useState(categoryColumns[0]?.name ?? "");
  const [valueColumn, setValueColumn] = useState(numericColumns[0]?.name ?? "");
  const [sortMode, setSortMode] = useState<SortMode>("original");
  const [showConnectors, setShowConnectors] = useState(true);
  const [rows, setRows] = useState<WaterfallRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedRows = useMemo(() => sortRows(rows, sortMode), [rows, sortMode]);
  const { points, finalTotal, positiveCount, negativeCount } = useMemo(
    () => buildWaterfallPoints(sortedRows),
    [sortedRows],
  );
  const option = useMemo(
    () => buildOption(dark, points, finalTotal, showConnectors),
    [dark, finalTotal, points, showConnectors],
  );

  async function loadWaterfall() {
    if (!categoryColumn || !valueColumn) {
      setError("Select both a category column and a numeric value column.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const queryRows = await runQuery(buildWaterfallQuery(tableName, categoryColumn, valueColumn));
      const nextRows = queryRows
        .map((row) => ({
          category: String(row.category ?? "Untitled"),
          value: toNumber(row.value),
          sourceOrder: toNumber(row.source_order),
        }))
        .filter((row) => Number.isFinite(row.value));

      startTransition(() => {
        setRows(nextRows);
      });
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to build the waterfall chart.");
    } finally {
      setLoading(false);
    }
  }

  const hasColumns = categoryColumns.length > 0 && numericColumns.length > 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: EASE }}
      className={`${PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
            <Waypoints className="h-4 w-4" />
            Waterfall Chart
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">Track step-by-step contribution to a running total</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
            Select a category and numeric measure, then compare gains, losses, and the final total in sequence.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <WaterfallSummary label="Net total" value={formatNumber(finalTotal)} />
          <WaterfallSummary label="Positive bars" value={formatNumber(positiveCount)} />
          <WaterfallSummary label="Negative bars" value={formatNumber(negativeCount)} />
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.1fr_0.9fr_0.6fr_0.7fr_auto]">
        <select value={categoryColumn} onChange={(event) => setCategoryColumn(event.target.value)} className={FIELD_CLASS}>
          <option value="">Category column</option>
          {categoryColumns.map((column) => (
            <option key={column.name} value={column.name}>
              {column.name}
            </option>
          ))}
        </select>
        <select value={valueColumn} onChange={(event) => setValueColumn(event.target.value)} className={FIELD_CLASS}>
          <option value="">Value column</option>
          {numericColumns.map((column) => (
            <option key={column.name} value={column.name}>
              {column.name}
            </option>
          ))}
        </select>
        <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className={FIELD_CLASS}>
          <option value="original">Original order</option>
          <option value="ascending">Ascending</option>
          <option value="descending">Descending</option>
        </select>
        <label className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/45 dark:text-slate-200">
          <input
            type="checkbox"
            checked={showConnectors}
            onChange={(event) => setShowConnectors(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-cyan-500 focus:ring-cyan-400"
          />
          Show connectors
        </label>
        <button
          type="button"
          onClick={() => void loadWaterfall()}
          disabled={!hasColumns || loading}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rows3 className="h-4 w-4" />}
          Build chart
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/65 px-3 py-1 dark:bg-slate-950/35">
          <ArrowDownAZ className="h-4 w-4 text-emerald-500" />
          Positive bars are green
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/65 px-3 py-1 dark:bg-slate-950/35">
          <ArrowUpAZ className="h-4 w-4 text-rose-500" />
          Negative bars are red
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/65 px-3 py-1 dark:bg-slate-950/35">
          <Download className="h-4 w-4 text-blue-500" />
          Total bar is blue
        </span>
      </div>

      {error ? (
        <div className="mt-5 rounded-2xl border border-rose-300/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.5fr_0.75fr]">
        <div className="rounded-[1.5rem] border border-white/15 bg-white/65 p-4 dark:bg-slate-950/35">
          {points.length === 0 ? (
            <div className="flex min-h-[360px] items-center justify-center rounded-[1.25rem] border border-dashed border-white/20 text-center text-sm text-slate-500 dark:text-slate-400">
              {hasColumns ? "Build the chart to calculate the running totals." : "Add at least one dimension column and one numeric column to use the waterfall chart."}
            </div>
          ) : (
            <ReactEChartsCore
              ref={chartRef}
              echarts={echarts}
              option={option}
              notMerge
              lazyUpdate
              style={{ height: 420 }}
            />
          )}
        </div>

        <div className="space-y-4 rounded-[1.5rem] border border-white/15 bg-white/65 p-4 dark:bg-slate-950/35">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Contribution ledger</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Each step includes its running total and percentage impact.</p>
            </div>
            <button
              type="button"
              onClick={() => exportChartImage(chartRef.current, dark, `${tableName}-waterfall.png`)}
              disabled={points.length === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-950/45 dark:text-slate-200 dark:hover:bg-slate-950/65"
            >
              <Download className="h-4 w-4" />
              Export PNG
            </button>
          </div>

          <div className="max-h-[340px] space-y-3 overflow-y-auto pr-1">
            {points.map((point) => (
              <div key={point.category} className="rounded-2xl border border-white/15 bg-white/70 p-4 dark:bg-slate-950/45">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{point.category}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Running total {formatNumber(point.runningTotal)}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${point.value < 0 ? "bg-rose-500/10 text-rose-600 dark:text-rose-300" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"}`}>
                    {point.value < 0 ? "" : "+"}
                    {formatNumber(point.value)}
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-800/70">
                  <div
                    className={`h-full rounded-full ${point.value < 0 ? "bg-rose-500" : "bg-emerald-500"}`}
                    style={{ width: `${Math.min(100, Math.abs(point.contributionPct))}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {point.contributionPct.toFixed(1)}% of the final total
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
