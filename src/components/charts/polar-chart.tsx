"use client";

import { Suspense, startTransition, use, useMemo, useRef, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart, LineChart } from "echarts/charts";
import {
  LegendComponent,
  PolarComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Compass, Download } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  dataUrlToBytes,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  BarChart,
  LineChart,
  PolarComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface PolarChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

type PolarMode = "bar" | "line";

interface PolarSeries {
  name: string;
  values: number[];
  total: number;
  max: number;
}

interface PolarChartResult {
  labels: string[];
  series: PolarSeries[];
  rowCount: number;
  error: string | null;
}

interface PolarChartReadyProps {
  tableName: string;
  chartMode: PolarMode;
  promise: Promise<PolarChartResult>;
}

async function loadPolarChartData(
  tableName: string,
  angleColumn: string,
  seriesColumns: string[],
): Promise<PolarChartResult> {
  if (!angleColumn || seriesColumns.length === 0) {
    return {
      labels: [],
      series: [],
      rowCount: 0,
      error: "Choose an angle column and at least one numeric radius series.",
    };
  }

  try {
    const selectList = [
      `CAST(${quoteIdentifier(angleColumn)} AS VARCHAR) AS angle_label`,
      ...seriesColumns.map((columnName) => (
        `TRY_CAST(${quoteIdentifier(columnName)} AS DOUBLE) AS ${quoteIdentifier(columnName)}`
      )),
    ].join(", ");
    const rows = await runQuery(
      `SELECT ${selectList} FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(angleColumn)} IS NOT NULL ORDER BY 1 LIMIT 72`,
    );

    const labels = rows.map((row) => String(row.angle_label ?? ""));
    const series = seriesColumns.map<PolarSeries>((columnName) => {
      const values = rows.map((row) => toNumber(row[columnName]) ?? 0);
      return {
        name: columnName,
        values,
        total: values.reduce((sum, value) => sum + value, 0),
        max: Math.max(...values, 0),
      };
    });

    return {
      labels,
      series,
      rowCount: rows.length,
      error: rows.length === 0 ? "DuckDB returned no rows for the selected fields." : null,
    };
  } catch (error) {
    return {
      labels: [],
      series: [],
      rowCount: 0,
      error: error instanceof Error ? error.message : "Unable to render the polar chart.",
    };
  }
}

function buildPolarChartOption(
  result: PolarChartResult,
  chartMode: PolarMode,
  dark: boolean,
): EChartsOption {
  return {
    animationDuration: 420,
    color: ["#38bdf8", "#14b8a6", "#f97316", "#a855f7"],
    legend: {
      top: 0,
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
    },
    polar: { radius: "72%" },
    angleAxis: {
      type: "category",
      data: result.labels,
      axisLabel: { color: dark ? "#cbd5e1" : "#334155" },
      axisLine: { lineStyle: { color: dark ? "#334155" : "#cbd5e1" } },
    },
    radiusAxis: {
      axisLabel: { color: dark ? "#cbd5e1" : "#334155" },
      splitLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" } },
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
      formatter: (params: unknown) => {
        const entries = Array.isArray(params)
          ? (params as unknown as Array<{ axisValueLabel?: string; seriesName?: string; value?: number }>)
          : [];
        if (entries.length === 0) {
          return "Polar series";
        }
        const heading = String(entries[0]?.axisValueLabel ?? "");
        const lines = entries.map((entry) => (
          `${String(entry.seriesName ?? "Series")}: ${formatNumber(Number(entry.value ?? 0))}`
        ));
        return [heading, ...lines].join("<br/>");
      },
    },
    series: result.series.map((series) => ({
      name: series.name,
      type: chartMode,
      coordinateSystem: "polar",
      data: series.values,
      smooth: chartMode === "line",
      areaStyle: chartMode === "line" ? { opacity: 0.08 } : undefined,
    })),
  };
}

function buildPolarCsv(result: PolarChartResult) {
  const lines = [["angle", ...result.series.map((series) => series.name)].join(",")];
  result.labels.forEach((label, rowIndex) => {
    lines.push(
      [
        label,
        ...result.series.map((series) => series.values[rowIndex] ?? 0),
      ].join(","),
    );
  });
  return lines.join("\n");
}

function exportChartPng(chartRef: ReactEChartsCore | null, dark: boolean, fileName: string) {
  const instance = chartRef?.getEchartsInstance();
  if (!instance) {
    return;
  }
  const output = dataUrlToBytes(
    instance.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: dark ? "#020617" : "#f8fafc",
    }),
  );
  downloadFile([output.bytes], fileName, output.mimeType);
}

function PolarChartLoading() {
  return (
    <div className={`${GLASS_CARD_CLASS} flex min-h-[24rem] items-center justify-center p-6 text-sm text-slate-600 dark:text-slate-300`}>
      Loading polar chart…
    </div>
  );
}

function PolarChartReady({ tableName, chartMode, promise }: PolarChartReadyProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const result = use(promise);
  const option = useMemo(() => buildPolarChartOption(result, chartMode, dark), [chartMode, dark, result]);

  if (result.error) {
    return (
      <div className={`${GLASS_CARD_CLASS} p-6 text-sm text-slate-600 dark:text-slate-300`}>
        {result.error}
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
      <div className={`${GLASS_CARD_CLASS} p-5`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Compare multiple series in polar coordinates
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Switch between bar and line mode without changing the underlying query.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => downloadFile(buildPolarCsv(result), `${tableName}-polar.csv`, "text/csv;charset=utf-8;")}
              className={BUTTON_CLASS}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => exportChartPng(chartRef.current, dark, `${tableName}-polar.png`)}
              className={BUTTON_CLASS}
            >
              <Download className="h-4 w-4" />
              Export PNG
            </button>
          </div>
        </div>

        <div className="mt-5 h-[24rem]">
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

      <div className="space-y-4">
        {result.series.map((series) => (
          <div key={series.name} className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {series.name}
            </div>
            <div className="mt-3 grid gap-2">
              <div className="rounded-2xl border border-white/20 p-3 text-sm text-slate-700 dark:text-slate-200">
                Total: {formatNumber(series.total)}
              </div>
              <div className="rounded-2xl border border-white/20 p-3 text-sm text-slate-700 dark:text-slate-200">
                Peak radius: {formatNumber(series.max)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PolarChart({ tableName, columns }: PolarChartProps) {
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [angleColumn, setAngleColumn] = useState("");
  const [seriesColumns, setSeriesColumns] = useState<string[]>(
    numericColumns.slice(0, Math.min(2, numericColumns.length)).map((column) => column.name),
  );
  const [chartMode, setChartMode] = useState<PolarMode>("bar");

  const activeAngleColumn =
    columns.find((column) => column.name === angleColumn)?.name ?? columns[0]?.name ?? "";
  const activeSeriesColumns = useMemo(() => {
    const available = new Set(numericColumns.map((column) => column.name));
    const kept = seriesColumns.filter((columnName) => available.has(columnName));
    if (kept.length > 0) {
      return kept;
    }
    return numericColumns.slice(0, Math.min(2, numericColumns.length)).map((column) => column.name);
  }, [numericColumns, seriesColumns]);
  const promise = useMemo(
    () => loadPolarChartData(tableName, activeAngleColumn, activeSeriesColumns),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeAngleColumn, activeSeriesColumns.length, tableName],
  );

  function toggleSeries(columnName: string) {
    startTransition(() => {
      setSeriesColumns((current) => (
        current.includes(columnName)
          ? current.filter((entry) => entry !== columnName)
          : [...current, columnName]
      ));
    });
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
              <Compass className="h-4 w-4" />
              Polar Chart
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Plot one angle dimension against multiple radius series
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Use category labels around the circle and switch between polar bar and polar line views.
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
          <label>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Angle column
            </span>
            <select
              aria-label="Angle column"
              value={activeAngleColumn}
              onChange={(event) => setAngleColumn(event.target.value)}
              className={FIELD_CLASS}
            >
              {columns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Radius series
            </div>
            <div className="flex flex-wrap gap-2">
              {numericColumns.map((column) => {
                const selected = activeSeriesColumns.includes(column.name);
                return (
                  <button
                    key={column.name}
                    type="button"
                    onClick={() => toggleSeries(column.name)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      selected
                        ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                        : "border-white/20 bg-white/50 text-slate-700 dark:bg-slate-950/40 dark:text-slate-200"
                    }`}
                  >
                    {column.name}
                  </button>
                );
              })}
            </div>
          </div>
          <label>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Mode
            </span>
            <select
              aria-label="Polar chart mode"
              value={chartMode}
              onChange={(event) => setChartMode(event.target.value as PolarMode)}
              className={FIELD_CLASS}
            >
              <option value="bar">Bar</option>
              <option value="line">Line</option>
            </select>
          </label>
        </div>

        <Suspense fallback={<PolarChartLoading />}>
          <PolarChartReady tableName={tableName} chartMode={chartMode} promise={promise} />
        </Suspense>
      </div>
    </motion.section>
  );
}
