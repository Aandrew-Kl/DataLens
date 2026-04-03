"use client";

import { startTransition, useMemo, useRef, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  Activity,
  Download,
  ImageDown,
  Loader2,
  Route,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
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
import { formatNumber } from "@/lib/utils/formatters";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface SteppedLineChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

type StepChoice = "before" | "after" | "middle";

interface SeriesPoint {
  xLabel: string;
  values: Record<string, number | null>;
}

interface SummaryCardProps {
  label: string;
  value: string;
}

const STEP_TO_ECHARTS = {
  before: "start",
  after: "end",
  middle: "middle",
} as const;

const SERIES_COLORS = [
  "#06b6d4",
  "#22c55e",
  "#8b5cf6",
  "#f97316",
  "#f43f5e",
  "#14b8a6",
] as const;

function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
        {value}
      </div>
    </div>
  );
}

function csvEscape(value: string | number) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function rowsToCsv(rows: SeriesPoint[], yColumns: string[]) {
  return [
    ["x_value", ...yColumns].join(","),
    ...rows.map((row) =>
      [
        csvEscape(row.xLabel),
        ...yColumns.map((columnName) =>
          csvEscape(row.values[columnName] == null ? "" : row.values[columnName] ?? ""),
        ),
      ].join(","),
    ),
  ].join("\n");
}

function buildChartOption(
  rows: SeriesPoint[],
  yColumns: string[],
  stepChoice: StepChoice,
  dark: boolean,
): EChartsOption {
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";

  return {
    animationDuration: 420,
    grid: { left: 40, right: 24, top: 24, bottom: 56, containLabel: true },
    legend: { bottom: 0, textStyle: { color: textColor } },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const list = Array.isArray(params)
          ? (params as Array<{ axisValueLabel?: string; seriesName?: string; value?: number }>)
          : [params as { axisValueLabel?: string; seriesName?: string; value?: number }];
        const lines = [`<strong>${list[0]?.axisValueLabel ?? ""}</strong>`];
        for (const item of list) {
          lines.push(
            `${item.seriesName ?? "Series"}: ${formatNumber(Number(item.value ?? 0))}`,
          );
        }
        return lines.join("<br/>");
      },
    },
    xAxis: {
      type: "category",
      data: rows.map((row) => row.xLabel),
      axisLabel: { color: textColor, rotate: rows.length > 10 ? 20 : 0 },
      boundaryGap: true,
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: yColumns.map((columnName, index) => ({
      name: columnName,
      type: "line",
      step: STEP_TO_ECHARTS[stepChoice],
      data: rows.map((row) => row.values[columnName]),
      showSymbol: rows.length <= 20,
      lineStyle: {
        width: 3,
        color: SERIES_COLORS[index % SERIES_COLORS.length],
      },
      itemStyle: {
        color: SERIES_COLORS[index % SERIES_COLORS.length],
      },
    })),
  };
}

export default function SteppedLineChart({
  tableName,
  columns,
}: SteppedLineChartProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const xOptions = useMemo(
    () => columns.filter((column) => column.type !== "unknown"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [xColumn, setXColumn] = useState(
    xOptions[0]?.name ?? columns[0]?.name ?? "",
  );
  const [yColumns, setYColumns] = useState(
    numericColumns.slice(0, 2).map((column) => column.name),
  );
  const [stepChoice, setStepChoice] = useState<StepChoice>("before");
  const [rows, setRows] = useState<SeriesPoint[]>([]);
  const [status, setStatus] = useState(
    "Choose an X column and one or more numeric series to draw stepped transitions.",
  );
  const [loading, setLoading] = useState(false);

  const option = useMemo(
    () => buildChartOption(rows, yColumns, stepChoice, dark),
    [dark, rows, stepChoice, yColumns],
  );

  function toggleYColumn(columnName: string) {
    setYColumns((current) =>
      current.includes(columnName)
        ? current.filter((value) => value !== columnName)
        : [...current, columnName],
    );
  }

  async function handleBuildChart() {
    if (!xColumn || yColumns.length === 0) {
      setStatus("Select one X column and at least one Y series.");
      return;
    }

    setLoading(true);
    setStatus("Loading stepped line data...");

    try {
      const query = `
        SELECT
          CAST(${quoteIdentifier(xColumn)} AS VARCHAR) AS x_value,
          ${yColumns
            .map(
              (columnName) =>
                `TRY_CAST(${quoteIdentifier(columnName)} AS DOUBLE) AS ${quoteIdentifier(columnName)}`,
            )
            .join(",\n          ")}
        FROM ${quoteIdentifier(tableName)}
        WHERE ${quoteIdentifier(xColumn)} IS NOT NULL
        ORDER BY 1
        LIMIT 120
      `;
      const queryRows = await runQuery(query);
      const nextRows = queryRows.flatMap<SeriesPoint>((row) => {
        const xLabel = typeof row.x_value === "string" ? row.x_value : String(row.x_value ?? "");
        if (!xLabel) return [];

        const values = yColumns.reduce<Record<string, number | null>>(
          (accumulator, columnName) => {
            accumulator[columnName] = toNumber(row[columnName]);
            return accumulator;
          },
          {},
        );

        return [{ xLabel, values }];
      });

      startTransition(() => {
        setRows(nextRows);
        setStatus(
          `Rendered ${formatNumber(nextRows.length)} stepped points across ${formatNumber(yColumns.length)} series.`,
        );
      });
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to build the stepped line chart.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExportCsv() {
    if (rows.length === 0) return;
    downloadFile(
      rowsToCsv(rows, yColumns),
      `${tableName}-stepped-line-chart.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  function handleExportPng() {
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance) {
      setStatus("Render the chart before exporting PNG.");
      return;
    }

    const dataUrl = instance.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: dark ? "#020617" : "#ffffff",
    });
    const { bytes } = dataUrlToBytes(dataUrl);
    downloadFile(bytes, `${tableName}-stepped-line-chart.png`, "image/png");
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-4 border-b border-white/20 pb-5 dark:border-white/10 xl:flex-row xl:items-center xl:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
            <Route className="h-3.5 w-3.5" />
            Stepped Line Chart
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
              Compare series transitions with explicit step boundaries
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Plot one shared X-axis against multiple numeric series and choose
              whether each step changes before, after, or in the middle.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <select
            aria-label="X column"
            value={xColumn}
            onChange={(event) => setXColumn(event.currentTarget.value)}
            className={FIELD_CLASS}
          >
            {xOptions.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Step type"
            value={stepChoice}
            onChange={(event) => setStepChoice(event.currentTarget.value as StepChoice)}
            className={FIELD_CLASS}
          >
            <option value="before">Before</option>
            <option value="after">After</option>
            <option value="middle">Middle</option>
          </select>

          <button
            type="button"
            onClick={() => {
              void handleBuildChart();
            }}
            disabled={loading}
            className={`${BUTTON_CLASS} bg-cyan-600 text-white hover:bg-cyan-500 dark:bg-cyan-600 dark:text-white`}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Activity className="h-4 w-4" />
            )}
            Build chart
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-white/60 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
        {status}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
        <div className="space-y-6">
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Series selection
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {numericColumns.map((column) => {
                const active = yColumns.includes(column.name);
                return (
                  <button
                    key={column.name}
                    type="button"
                    onClick={() => toggleYColumn(column.name)}
                    className={`rounded-full border px-3 py-2 text-sm transition ${
                      active
                        ? "border-cyan-400 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                        : "border-white/20 bg-white/70 text-slate-700 dark:border-white/10 dark:bg-slate-950/45 dark:text-slate-200"
                    }`}
                  >
                    {column.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryCard
              label="Loaded Points"
              value={formatNumber(rows.length)}
            />
            <SummaryCard
              label="Visible Series"
              value={formatNumber(yColumns.length)}
            />
          </div>

          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleExportPng}
                disabled={rows.length === 0}
                className={BUTTON_CLASS}
              >
                <ImageDown className="h-4 w-4" />
                Export PNG
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={rows.length === 0}
                className={BUTTON_CLASS}
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            </div>
          </div>
        </div>

        <div className={`${GLASS_CARD_CLASS} overflow-hidden p-4`}>
          <ReactEChartsCore
            ref={chartRef}
            echarts={echarts}
            option={option}
            notMerge
            lazyUpdate
            style={{ height: 420 }}
          />
        </div>
      </div>
    </motion.section>
  );
}
