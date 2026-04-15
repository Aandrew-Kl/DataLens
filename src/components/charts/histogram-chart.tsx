"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { startTransition, useMemo, useRef, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { BarChart3, Download, Loader2, RefreshCw } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface HistogramChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface HistogramBin {
  label: string;
  start: number;
  end: number;
  count: number;
  density: number;
}

interface HistogramResult {
  columnName: string;
  sampleSize: number;
  mean: number;
  median: number;
  meanLabel: string;
  medianLabel: string;
  bins: HistogramBin[];
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "border border-white/20 bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 rounded-[1.75rem] shadow-xl shadow-slate-950/10";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:bg-slate-950/50 dark:text-slate-100";
function toNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const midpoint = Math.floor(values.length / 2);
  if (values.length % 2 === 0) {
    return (values[midpoint - 1] + values[midpoint]) / 2;
  }
  return values[midpoint];
}

function buildHistogram(values: number[], binCount: number, columnName: string): HistogramResult {
  const sorted = [...values].sort((left, right) => left - right);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const safeBinCount = Math.max(1, binCount);
  const span = max - min || 1;
  const width = span / safeBinCount;

  const bins = Array.from({ length: safeBinCount }, (_, index) => {
    const start = min + index * width;
    const end = index === safeBinCount - 1 ? max : start + width;
    const count = sorted.filter((value) =>
      index === safeBinCount - 1
        ? value >= start && value <= end
        : value >= start && value < end,
    ).length;

    return {
      label: `${start.toFixed(1)}-${end.toFixed(1)}`,
      start,
      end,
      count,
      density: count / sorted.length,
    } satisfies HistogramBin;
  });

  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const median = calculateMedian(sorted);
  const meanLabel =
    bins.find((bin) => mean >= bin.start && mean <= bin.end)?.label ?? bins[0]?.label ?? "";
  const medianLabel =
    bins.find((bin) => median >= bin.start && median <= bin.end)?.label
      ?? bins[0]?.label
      ?? "";

  return {
    columnName,
    sampleSize: sorted.length,
    mean,
    median,
    meanLabel,
    medianLabel,
    bins,
  };
}

function formatHistogramTooltip(params: unknown): string {
  const items = Array.isArray(params) ? params : [params];
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      return `${String(record.seriesName ?? "Series")}: ${String(record.data ?? "")}`;
    })
    .filter((item) => item.length > 0)
    .join("<br/>");
}

function buildCsv(result: HistogramResult): string {
  const header = "bin_start,bin_end,label,count,density";
  const body = result.bins.map((bin) =>
    [
      bin.start.toFixed(4),
      bin.end.toFixed(4),
      bin.label,
      bin.count,
      bin.density.toFixed(6),
    ].join(","),
  );
  return [header, ...body].join("\n");
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const encoded = dataUrl.split(",")[1] ?? "";
  const binary = window.atob(encoded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

export default function HistogramChart({
  tableName,
  columns,
}: HistogramChartProps) {
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );

  const [selectedColumn, setSelectedColumn] = useState(numericColumns[0]?.name ?? "");
  const [binCount, setBinCount] = useState(12);
  const [showDensity, setShowDensity] = useState(true);
  const [showReferenceLines, setShowReferenceLines] = useState(true);
  const [result, setResult] = useState<HistogramResult | null>(null);
  const [status, setStatus] = useState("Build a histogram to inspect skew, spread, and concentration.");
  const [loading, setLoading] = useState(false);

  async function handleBuild() {
    if (!selectedColumn) return;
    setLoading(true);
    setStatus(`Querying ${selectedColumn} values from DuckDB...`);

    try {
      const rows = await runQuery(`
        SELECT TRY_CAST(${quoteIdentifier(selectedColumn)} AS DOUBLE) AS numeric_value
        FROM ${quoteIdentifier(tableName)}
        WHERE TRY_CAST(${quoteIdentifier(selectedColumn)} AS DOUBLE) IS NOT NULL
        LIMIT 5000
      `);
      const values = rows
        .map((row) => toNumber(row.numeric_value))
        .filter((value): value is number => value !== null);

      if (values.length === 0) {
        setStatus("No numeric values were available for the selected column.");
        setResult(null);
        return;
      }

      const nextResult = buildHistogram(values, binCount, selectedColumn);
      startTransition(() => {
        setResult(nextResult);
        setStatus(
          `Built ${nextResult.bins.length} bins from ${formatNumber(nextResult.sampleSize)} observations.`,
        );
      });
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to build the histogram.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExportCsv() {
    if (!result) return;
    downloadFile(
      buildCsv(result),
      `${tableName}-${result.columnName}-histogram.csv`,
      "text/csv;charset=utf-8",
    );
  }

  function handleExportPng() {
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance || !result) return;
    const dataUrl = instance.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: "#ffffff",
    });
    downloadFile(
      dataUrlToArrayBuffer(dataUrl),
      `${tableName}-${result.columnName}-histogram.png`,
      "image/png",
    );
  }

  const option = useMemo(() => {
    if (!result) return {} as EChartsOption;

    return {
      animationDuration: 500,
      tooltip: {
        trigger: "axis",
        formatter: formatHistogramTooltip,
      },
      legend: {
        bottom: 0,
        textStyle: {
          color: "#64748b",
        },
      },
      grid: {
        left: 48,
        right: showDensity ? 56 : 24,
        top: 24,
        bottom: 52,
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: result.bins.map((bin) => bin.label),
        axisLabel: {
          color: "#64748b",
          rotate: result.bins.length > 10 ? 18 : 0,
        },
        axisLine: {
          lineStyle: {
            color: "#cbd5e1",
          },
        },
      },
      yAxis: [
        {
          type: "value",
          axisLabel: {
            color: "#64748b",
          },
          splitLine: {
            lineStyle: {
              color: "#e2e8f0",
              type: "dashed",
            },
          },
        },
        ...(showDensity
          ? [
              {
                type: "value" as const,
                position: "right" as const,
                axisLabel: {
                  color: "#64748b",
                  formatter: "{value}%",
                },
                splitLine: {
                  show: false,
                },
              },
            ]
          : []),
      ],
      series: [
        {
          name: "Count",
          type: "bar" as const,
          data: result.bins.map((bin) => bin.count),
          barWidth: "78%",
          itemStyle: {
            color: "#0ea5e9",
            borderRadius: [10, 10, 0, 0],
          },
          markLine: showReferenceLines
            ? {
                symbol: "none",
                label: {
                  formatter: "{b}",
                },
                lineStyle: {
                  type: "dashed",
                },
                data: [
                  { name: "Mean", xAxis: result.meanLabel },
                  { name: "Median", xAxis: result.medianLabel },
                ],
              }
            : undefined,
        },
        ...(showDensity
          ? [
              {
                name: "Density",
                type: "line" as const,
                yAxisIndex: 1,
                smooth: true,
                data: result.bins.map((bin) => Number((bin.density * 100).toFixed(2))),
                lineStyle: {
                  width: 2,
                  color: "#8b5cf6",
                },
                itemStyle: {
                  color: "#8b5cf6",
                },
              },
            ]
          : []),
      ],
    } as EChartsOption;
  }, [result, showDensity, showReferenceLines]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE }}
      className={`${PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-4 border-b border-white/20 pb-5 dark:border-white/10 xl:flex-row xl:items-center xl:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-700 dark:text-sky-300">
            <BarChart3 className="h-3.5 w-3.5" />
            Histogram Chart
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
              Explore numeric distributions with configurable bins
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Overlay a density curve, then export the chart or its bin table.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:min-w-[30rem] xl:grid-cols-[1fr_0.8fr]">
          <select
            aria-label="Histogram column"
            value={selectedColumn}
            onChange={(event) => setSelectedColumn(event.currentTarget.value)}
            className={FIELD_CLASS}
          >
            {numericColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-700 dark:bg-slate-900/50 dark:text-slate-200">
            <span>Bins</span>
            <input
              aria-label="Histogram bin count"
              type="number"
              min={4}
              max={40}
              value={binCount}
              onChange={(event) => setBinCount(Number(event.currentTarget.value))}
              className="w-24 rounded-xl border border-white/20 bg-white/80 px-3 py-2 dark:bg-slate-950/50"
            />
          </label>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            void handleBuild();
          }}
          disabled={!selectedColumn || loading}
          className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-400 dark:disabled:bg-slate-700"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Build histogram
        </button>

        <label className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/70 px-3 py-2 text-sm text-slate-700 dark:bg-slate-900/50 dark:text-slate-200">
          <input
            type="checkbox"
            checked={showDensity}
            onChange={(event) => setShowDensity(event.currentTarget.checked)}
          />
          Density curve
        </label>

        <label className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/70 px-3 py-2 text-sm text-slate-700 dark:bg-slate-900/50 dark:text-slate-200">
          <input
            type="checkbox"
            checked={showReferenceLines}
            onChange={(event) => setShowReferenceLines(event.currentTarget.checked)}
          />
          Mean / median lines
        </label>

        <button
          type="button"
          onClick={handleExportPng}
          disabled={!result}
          className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-900/50 dark:text-slate-200"
        >
          <Download className="h-4 w-4" />
          Export PNG
        </button>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={!result}
          className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-900/50 dark:text-slate-200"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      <div className="mt-4 rounded-2xl bg-white/60 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
        {numericColumns.length === 0
          ? "Add at least one numeric column to render a histogram."
          : status}
      </div>

      {result ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <div className={`${PANEL_CLASS} p-5`}>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Distribution summary
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/50">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Sample size
                </p>
                <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">
                  {formatNumber(result.sampleSize)}
                </p>
              </div>
              <div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/50">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Bins
                </p>
                <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">
                  {formatNumber(result.bins.length)}
                </p>
              </div>
              <div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/50">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Mean
                </p>
                <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">
                  {result.mean.toFixed(2)}
                </p>
              </div>
              <div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/50">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Median
                </p>
                <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">
                  {result.median.toFixed(2)}
                </p>
              </div>
            </div>
          </div>

          <div className={`${PANEL_CLASS} p-5`}>
            <div className="h-[24rem]">
              <ReactEChartsCore
                ref={chartRef}
                echarts={echarts}
                option={option}
                notMerge
                lazyUpdate
                style={{ height: "100%", width: "100%" }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </motion.section>
  );
}
