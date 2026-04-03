"use client";

import { startTransition, useMemo, useRef, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type {
  CustomSeriesRenderItem,
  CustomSeriesRenderItemAPI,
  CustomSeriesRenderItemParams,
  EChartsOption,
} from "echarts";
import { CustomChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Download, Loader2, RefreshCw, Sigma } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  CustomChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface ViolinPlotProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface DensityPoint {
  x: number;
  density: number;
}

interface ViolinGroup {
  name: string;
  color: string;
  count: number;
  min: number;
  max: number;
  q1: number;
  median: number;
  q3: number;
  densityPoints: DensityPoint[];
}

interface ViolinResult {
  groups: ViolinGroup[];
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "border border-white/20 bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 rounded-[1.75rem] shadow-xl shadow-slate-950/10";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:bg-slate-950/50 dark:text-slate-100";
const PALETTE = ["#0ea5e9", "#8b5cf6", "#10b981", "#f97316", "#ef4444", "#14b8a6"] as const;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function toNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function quantile(sortedValues: number[], ratio: number): number {
  if (sortedValues.length === 0) return 0;
  const position = (sortedValues.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower] ?? 0;
  const lowerValue = sortedValues[lower] ?? 0;
  const upperValue = sortedValues[upper] ?? 0;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}

function standardDeviation(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function gaussianKernel(u: number): number {
  return Math.exp(-(u ** 2) / 2) / Math.sqrt(2 * Math.PI);
}

function buildDensityPoints(values: number[]): DensityPoint[] {
  if (values.length === 0) return [];
  const min = values[0] ?? 0;
  const max = values[values.length - 1] ?? 0;
  const deviation = standardDeviation(values);
  const span = Math.max(max - min, 1);
  const bandwidth = deviation > 0
    ? 1.06 * deviation * Math.pow(values.length, -0.2)
    : span / 6;
  const safeBandwidth = bandwidth > 0 ? bandwidth : 1;

  return Array.from({ length: 32 }, (_, index) => {
    const x = min + (span * index) / 31;
    const density =
      values.reduce(
        (sum, value) => sum + gaussianKernel((x - value) / safeBandwidth),
        0,
      ) / (values.length * safeBandwidth);
    return { x, density };
  });
}

function buildViolinResult(rows: Record<string, unknown>[]): ViolinResult {
  const groupedValues = rows.reduce((groupMap, row) => {
    const category = String(row.category_value ?? "Unknown");
    const value = toNumber(row.numeric_value);
    if (value === null) return groupMap;
    const list = groupMap.get(category) ?? [];
    list.push(value);
    groupMap.set(category, list);
    return groupMap;
  }, new Map<string, number[]>());

  const groups = Array.from(groupedValues.entries())
    .map(([name, values], index) => {
      const sorted = [...values].sort((left, right) => left - right);
      return {
        name,
        color: PALETTE[index % PALETTE.length],
        count: sorted.length,
        min: sorted[0] ?? 0,
        max: sorted[sorted.length - 1] ?? 0,
        q1: quantile(sorted, 0.25),
        median: quantile(sorted, 0.5),
        q3: quantile(sorted, 0.75),
        densityPoints: buildDensityPoints(sorted),
      } satisfies ViolinGroup;
    })
    .sort((left, right) => right.count - left.count);

  return { groups };
}

function createViolinRenderItem(groups: ViolinGroup[]): CustomSeriesRenderItem {
  return function renderItem(
    params: CustomSeriesRenderItemParams,
    api: CustomSeriesRenderItemAPI,
  ) {
    const group = groups[params.dataIndex];
    if (!group) return;
    const maxDensity = Math.max(
      ...group.densityPoints.map((point) => point.density),
      0.0001,
    );
    const slotSize = api.size ? api.size([0, 1]) : 36;
    const slotHeight =
      (Array.isArray(slotSize) ? slotSize[1] ?? 0 : slotSize) * 0.74;
    const scale = (slotHeight / 2) / maxDensity;
    const upper = group.densityPoints.map((point) => {
      const coordinate = api.coord([point.x, params.dataIndex]);
      return [coordinate[0], coordinate[1] - point.density * scale];
    });
    const lower = [...group.densityPoints].reverse().map((point) => {
      const coordinate = api.coord([point.x, params.dataIndex]);
      return [coordinate[0], coordinate[1] + point.density * scale];
    });

    return {
      type: "polygon",
      shape: {
        points: [...upper, ...lower],
      },
      style: api.style({
        fill: group.color,
        opacity: 0.24,
        stroke: group.color,
        lineWidth: 1.5,
      }),
    };
  };
}

function formatViolinTooltip(params: unknown, groups: ViolinGroup[]): string {
  if (!params || typeof params !== "object") return "Distribution";
  const record = params as Record<string, unknown>;
  const seriesName = String(record.seriesName ?? "Distribution");
  const dataIndex = Number(record.dataIndex ?? 0);
  if (seriesName === "Distribution") {
    const group = groups[dataIndex];
    if (!group) return "Distribution";
    return [
      group.name,
      `Count: ${group.count}`,
      `Median: ${group.median.toFixed(2)}`,
      `IQR: ${group.q1.toFixed(2)} - ${group.q3.toFixed(2)}`,
    ].join("<br/>");
  }
  const values = Array.isArray(record.value) ? record.value : [];
  return `${seriesName}: ${String(values[0] ?? "")}`;
}

function buildCsv(result: ViolinResult): string {
  const header = "group,count,min,q1,median,q3,max";
  const body = result.groups.map((group) =>
    [
      group.name,
      group.count,
      group.min.toFixed(4),
      group.q1.toFixed(4),
      group.median.toFixed(4),
      group.q3.toFixed(4),
      group.max.toFixed(4),
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

export default function ViolinPlot({ tableName, columns }: ViolinPlotProps) {
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const categoryColumns = useMemo(
    () => columns.filter((column) => column.type !== "number"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );

  const [categoryColumn, setCategoryColumn] = useState(categoryColumns[0]?.name ?? columns[0]?.name ?? "");
  const [valueColumn, setValueColumn] = useState(numericColumns[0]?.name ?? "");
  const [result, setResult] = useState<ViolinResult | null>(null);
  const [status, setStatus] = useState("Build the violin plot to compare distribution shapes.");
  const [loading, setLoading] = useState(false);

  async function handleBuild() {
    if (!categoryColumn || !valueColumn) return;
    setLoading(true);
    setStatus(`Sampling ${valueColumn} by ${categoryColumn}...`);

    try {
      const rows = await runQuery(`
        SELECT
          CAST(${quoteIdentifier(categoryColumn)} AS VARCHAR) AS category_value,
          TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE) AS numeric_value
        FROM ${quoteIdentifier(tableName)}
        WHERE TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE) IS NOT NULL
        LIMIT 3000
      `);
      const nextResult = buildViolinResult(rows);
      startTransition(() => {
        setResult(nextResult);
        setStatus(
          `Built ${formatNumber(nextResult.groups.length)} violin${nextResult.groups.length === 1 ? "" : "s"} for comparison.`,
        );
      });
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to build the violin plot.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExportCsv() {
    if (!result) return;
    downloadFile(
      buildCsv(result),
      `${tableName}-${categoryColumn}-${valueColumn}-violin.csv`,
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
      `${tableName}-${categoryColumn}-${valueColumn}-violin.png`,
      "image/png",
    );
  }

  const option = useMemo(() => {
    if (!result) return {} as EChartsOption;

    return {
      animationDuration: 450,
      tooltip: {
        trigger: "item",
        formatter: (params: unknown) => formatViolinTooltip(params, result.groups),
      },
      legend: {
        bottom: 0,
        textStyle: {
          color: "#64748b",
        },
      },
      grid: {
        left: 100,
        right: 24,
        top: 24,
        bottom: 52,
        containLabel: true,
      },
      xAxis: {
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
      yAxis: {
        type: "category",
        data: result.groups.map((group) => group.name),
        axisLabel: {
          color: "#64748b",
        },
      },
      series: [
        {
          name: "Distribution",
          type: "custom" as const,
          renderItem: createViolinRenderItem(result.groups),
          data: result.groups.map((group, index) => ({
            name: group.name,
            value: [index],
          })),
        },
        {
          name: "Median",
          type: "scatter" as const,
          data: result.groups.map((group, index) => [group.median, index]),
          symbolSize: 9,
          itemStyle: {
            color: "#0f172a",
          },
        },
        {
          name: "Quartile low",
          type: "scatter" as const,
          data: result.groups.map((group, index) => [group.q1, index]),
          symbolSize: 7,
          itemStyle: {
            color: "#475569",
          },
        },
        {
          name: "Quartile high",
          type: "scatter" as const,
          data: result.groups.map((group, index) => [group.q3, index]),
          symbolSize: 7,
          itemStyle: {
            color: "#475569",
          },
        },
      ],
    } as EChartsOption;
  }, [result]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE }}
      className={`${PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-4 border-b border-white/20 pb-5 dark:border-white/10 xl:flex-row xl:items-center xl:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">
            <Sigma className="h-3.5 w-3.5" />
            Violin Plot
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
              Compare distribution shapes by category
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Kernel density estimates are mirrored into violins with quartile and
              median markers.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:min-w-[28rem]">
          <select
            aria-label="Violin category"
            value={categoryColumn}
            onChange={(event) => setCategoryColumn(event.currentTarget.value)}
            className={FIELD_CLASS}
          >
            {(categoryColumns.length > 0 ? categoryColumns : columns).map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Violin value"
            value={valueColumn}
            onChange={(event) => setValueColumn(event.currentTarget.value)}
            className={FIELD_CLASS}
          >
            {numericColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            void handleBuild();
          }}
          disabled={!categoryColumn || !valueColumn || loading}
          className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-400 dark:disabled:bg-slate-700"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Build violin plot
        </button>
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
        {numericColumns.length === 0 ? "Add a numeric column to compare distributions." : status}
      </div>

      {result ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <div className={`${PANEL_CLASS} p-5`}>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Group summaries
            </p>
            <div className="mt-4 space-y-3">
              {result.groups.map((group) => (
                <div
                  key={group.name}
                  className="rounded-2xl bg-white/70 p-4 text-sm text-slate-700 dark:bg-slate-900/50 dark:text-slate-200"
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong>{group.name}</strong>
                    <span>{formatNumber(group.count)} rows</span>
                  </div>
                  <p className="mt-2">
                    Median {group.median.toFixed(2)} · IQR {group.q1.toFixed(2)} to{" "}
                    {group.q3.toFixed(2)}
                  </p>
                </div>
              ))}
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
