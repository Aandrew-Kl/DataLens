"use client";

import { startTransition, useMemo, useRef, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { ScatterChart } from "echarts/charts";
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
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface DotPlotProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface DotPoint {
  category: string;
  group: string;
  value: number;
  xPosition: number;
}

interface DotPlotResult {
  categories: string[];
  groups: string[];
  points: DotPoint[];
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "border border-white/20 bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 rounded-[1.75rem] shadow-xl shadow-slate-950/10";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:bg-slate-950/50 dark:text-slate-100";
const PALETTE = ["#0ea5e9", "#8b5cf6", "#10b981", "#f97316", "#ef4444"] as const;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function toNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function deterministicJitter(index: number): number {
  return ((index % 13) - 6) * 0.055;
}

function buildDotPlotResult(rows: Record<string, unknown>[], jitter: boolean): DotPlotResult {
  const categories = Array.from(
    rows.reduce((set, row) => {
      set.add(String(row.category_value ?? "Unknown"));
      return set;
    }, new Set<string>()),
  );

  const points = rows.reduce<DotPoint[]>((accumulator, row, index) => {
    const value = toNumber(row.numeric_value);
    if (value === null) return accumulator;
    const category = String(row.category_value ?? "Unknown");
    const group = String(row.group_value ?? "All rows");
    const categoryIndex = categories.indexOf(category);
    accumulator.push({
      category,
      group,
      value,
      xPosition: categoryIndex + (jitter ? deterministicJitter(index) : 0),
    });
    return accumulator;
  }, []);

  const groups = Array.from(
    points.reduce((set, point) => {
      set.add(point.group);
      return set;
    }, new Set<string>()),
  );

  return {
    categories,
    groups,
    points,
  };
}

function formatDotTooltip(params: unknown): string {
  if (!params || typeof params !== "object") return "Observation";
  const record = params as Record<string, unknown>;
  const value = Array.isArray(record.value) ? record.value : [];
  return [
    `${String(record.seriesName ?? "Group")}`,
    `Value: ${String(value[1] ?? "")}`,
    `Category: ${String(value[2] ?? "")}`,
  ].join("<br/>");
}

function buildCsv(result: DotPlotResult): string {
  const header = "category,group,value,x_position";
  const body = result.points.map((point) =>
    [point.category, point.group, point.value.toFixed(4), point.xPosition.toFixed(4)].join(","),
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

export default function DotPlot({ tableName, columns }: DotPlotProps) {
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
  const [groupColumn, setGroupColumn] = useState("");
  const [jitter, setJitter] = useState(true);
  const [result, setResult] = useState<DotPlotResult | null>(null);
  const [status, setStatus] = useState("Build the strip chart to inspect every observation.");
  const [loading, setLoading] = useState(false);

  async function handleBuild() {
    if (!categoryColumn || !valueColumn) return;
    setLoading(true);
    setStatus(`Loading ${valueColumn} by ${categoryColumn}...`);

    try {
      const groupSql = groupColumn
        ? `CAST(${quoteIdentifier(groupColumn)} AS VARCHAR) AS group_value`
        : `'All rows' AS group_value`;
      const rows = await runQuery(`
        SELECT
          CAST(${quoteIdentifier(categoryColumn)} AS VARCHAR) AS category_value,
          TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE) AS numeric_value,
          ${groupSql}
        FROM ${quoteIdentifier(tableName)}
        WHERE TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE) IS NOT NULL
        LIMIT 2000
      `);

      const nextResult = buildDotPlotResult(rows, jitter);
      startTransition(() => {
        setResult(nextResult);
        setStatus(
          `Point cloud ready with ${formatNumber(nextResult.points.length)} observations across ${formatNumber(nextResult.categories.length)} categories.`,
        );
      });
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to build the dot plot.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExportCsv() {
    if (!result) return;
    downloadFile(
      buildCsv(result),
      `${tableName}-${categoryColumn}-${valueColumn}-dot-plot.csv`,
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
      `${tableName}-${categoryColumn}-${valueColumn}-dot-plot.png`,
      "image/png",
    );
  }

  const option = useMemo(() => {
    if (!result) return {} as EChartsOption;

    const series = result.groups.map((group, index) => ({
      name: group,
      type: "scatter" as const,
      data: result.points
        .filter((point) => point.group === group)
        .map((point) => [point.xPosition, point.value, point.category, point.group]),
      symbolSize: 9,
      itemStyle: {
        color: PALETTE[index % PALETTE.length],
        opacity: 0.72,
      },
    }));

    return {
      animationDuration: 450,
      tooltip: {
        trigger: "item",
        formatter: formatDotTooltip,
      },
      legend: {
        bottom: 0,
        textStyle: {
          color: "#64748b",
        },
      },
      grid: {
        left: 48,
        right: 24,
        top: 24,
        bottom: 52,
        containLabel: true,
      },
      xAxis: {
        type: "value",
        min: -0.6,
        max: Math.max(result.categories.length - 0.4, 0.4),
        axisLabel: {
          color: "#64748b",
          formatter: (value: number) => result.categories[Math.round(value)] ?? "",
        },
        splitLine: {
          show: false,
        },
      },
      yAxis: {
        type: "value" as const,
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
      series,
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
          <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-fuchsia-700 dark:text-fuchsia-300">
            <Sigma className="h-3.5 w-3.5" />
            Dot Plot
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
              Compare observation-level spread by category
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Each point represents one row, with optional jitter to reduce overlap.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:min-w-[34rem] xl:grid-cols-3">
          <select
            aria-label="Dot plot category"
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
            aria-label="Dot plot value"
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

          <select
            aria-label="Dot plot group"
            value={groupColumn}
            onChange={(event) => setGroupColumn(event.currentTarget.value)}
            className={FIELD_CLASS}
          >
            <option value="">No color group</option>
            {columns
              .filter((column) => column.name !== valueColumn)
              .map((column) => (
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
          className="inline-flex items-center gap-2 rounded-2xl bg-fuchsia-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:bg-slate-400 dark:disabled:bg-slate-700"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Build dot plot
        </button>

        <label className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/70 px-3 py-2 text-sm text-slate-700 dark:bg-slate-900/50 dark:text-slate-200">
          <input
            type="checkbox"
            checked={jitter}
            onChange={(event) => setJitter(event.currentTarget.checked)}
          />
          Jitter
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
        {numericColumns.length === 0 ? "Add a numeric value column to render the plot." : status}
      </div>

      {result ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <div className={`${PANEL_CLASS} p-5`}>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Plot summary
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/50">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Observations
                </p>
                <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">
                  {formatNumber(result.points.length)}
                </p>
              </div>
              <div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/50">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Categories
                </p>
                <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">
                  {formatNumber(result.categories.length)}
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
