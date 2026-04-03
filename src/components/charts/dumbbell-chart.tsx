"use client";

import { useMemo, useRef, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type {
  CustomSeriesRenderItem,
  CustomSeriesRenderItemAPI,
  CustomSeriesRenderItemParams,
  EChartsOption,
} from "echarts";
import { CustomChart, ScatterChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  Download,
  Gauge,
  ImageDown,
  Loader2,
  StretchHorizontal,
  Waypoints,
} from "lucide-react";
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

echarts.use([CustomChart, ScatterChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface DumbbellChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface DumbbellRow {
  category: string;
  minValue: number;
  maxValue: number;
  spread: number;
}

const MIN_DOT_COLOR = "#0ea5e9";
const MAX_DOT_COLOR = "#f97316";

function createRangeRenderItem(color: string): CustomSeriesRenderItem {
  return function renderItem(
    _params: CustomSeriesRenderItemParams,
    api: CustomSeriesRenderItemAPI,
  ) {
    const startValue = Number(api.value(0));
    const endValue = Number(api.value(1));
    const categoryIndex = Number(api.value(2));
    const start = api.coord([startValue, categoryIndex]);
    const end = api.coord([endValue, categoryIndex]);
    return {
      type: "group",
      children: [
        {
          type: "line",
          shape: { x1: start[0], y1: start[1], x2: end[0], y2: end[1] },
          style: { stroke: color, lineWidth: 4, lineCap: "round" },
        },
      ],
    };
  };
}

function buildCsv(rows: DumbbellRow[]) {
  return [
    "category,min_value,max_value,spread",
    ...rows.map((row) => `${row.category},${row.minValue},${row.maxValue},${row.spread}`),
  ].join("\n");
}

function buildDumbbellOption(rows: DumbbellRow[], dark: boolean): EChartsOption {
  const categories = rows.map((row) => row.category);
  const rangeData = rows.map((row, index) => [row.minValue, row.maxValue, index, row.category]);
  const minData = rows.map((row, index) => [row.minValue, index, row.category]);
  const maxData = rows.map((row, index) => [row.maxValue, index, row.category]);
  const tooltipFormatter = (params: unknown) => {
    const record = params as { data?: Array<string | number> };
    const data = Array.isArray(record.data) ? record.data : [];
    const category = String(data[3] ?? data[2] ?? "");
    const minValue = Number(data[0] ?? 0);
    const maxValue = Number(data[1] ?? data[0] ?? 0);
    return [
      category,
      `Min: ${formatNumber(minValue)}`,
      `Max: ${formatNumber(maxValue)}`,
      `Spread: ${formatNumber(maxValue - minValue)}`,
    ].join("<br/>");
  };

  return {
    animationDuration: 420,
    grid: { left: 90, right: 28, top: 24, bottom: 42, containLabel: true },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
      formatter: tooltipFormatter,
    },
    xAxis: {
      type: "value",
      axisLabel: { color: dark ? "#cbd5e1" : "#475569" },
      splitLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" } },
    },
    yAxis: {
      type: "category",
      data: categories,
      axisLabel: { color: dark ? "#cbd5e1" : "#475569" },
      axisLine: { lineStyle: { color: dark ? "#334155" : "#cbd5e1" } },
    },
    series: [
      {
        type: "custom",
        renderItem: createRangeRenderItem(dark ? "#e2e8f0" : "#475569"),
        data: rangeData,
        silent: true,
      },
      {
        type: "scatter",
        name: "Minimum",
        data: minData,
        symbolSize: 14,
        itemStyle: { color: MIN_DOT_COLOR, borderWidth: 3, borderColor: dark ? "#0c4a6e" : "#e0f2fe" },
      },
      {
        type: "scatter",
        name: "Maximum",
        data: maxData,
        symbolSize: 14,
        itemStyle: { color: MAX_DOT_COLOR, borderWidth: 3, borderColor: dark ? "#7c2d12" : "#ffedd5" },
      },
    ],
  };
}

export default function DumbbellChart({
  tableName,
  columns,
}: DumbbellChartProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const categoryColumns = useMemo(
    () => columns.filter((column) => column.type !== "number"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [categoryColumn, setCategoryColumn] = useState(categoryColumns[0]?.name ?? "");
  const [minColumn, setMinColumn] = useState(numericColumns[0]?.name ?? "");
  const [maxColumn, setMaxColumn] = useState(numericColumns[1]?.name ?? numericColumns[0]?.name ?? "");
  const [rows, setRows] = useState<DumbbellRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(
    "Select a category plus start and end value columns to render endpoint ranges.",
  );

  const option = useMemo(() => buildDumbbellOption(rows, dark), [dark, rows]);
  const widestSpread = rows.reduce((max, row) => Math.max(max, row.spread), 0);
  const averageSpread =
    rows.length > 0
      ? rows.reduce((sum, row) => sum + row.spread, 0) / rows.length
      : 0;

  async function handleBuild() {
    if (!categoryColumn || !minColumn || !maxColumn) {
      setNotice("Choose a category plus minimum and maximum value columns.");
      return;
    }
    setLoading(true);
    setNotice("Building dumbbell chart...");

    try {
      const resultRows = await runQuery(`
        SELECT
          CAST(${quoteIdentifier(categoryColumn)} AS VARCHAR) AS category_label,
          AVG(TRY_CAST(${quoteIdentifier(minColumn)} AS DOUBLE)) AS min_value,
          AVG(TRY_CAST(${quoteIdentifier(maxColumn)} AS DOUBLE)) AS max_value
        FROM ${quoteIdentifier(tableName)}
        WHERE ${quoteIdentifier(categoryColumn)} IS NOT NULL
        GROUP BY 1
        HAVING AVG(TRY_CAST(${quoteIdentifier(minColumn)} AS DOUBLE)) IS NOT NULL
          AND AVG(TRY_CAST(${quoteIdentifier(maxColumn)} AS DOUBLE)) IS NOT NULL
        ORDER BY ABS(AVG(TRY_CAST(${quoteIdentifier(maxColumn)} AS DOUBLE)) - AVG(TRY_CAST(${quoteIdentifier(minColumn)} AS DOUBLE))) DESC
        LIMIT 18
      `);

      const nextRows = resultRows.flatMap<DumbbellRow>((row) => {
        const category =
          typeof row.category_label === "string"
            ? row.category_label
            : String(row.category_label ?? "");
        const startValue = toNumber(row.min_value);
        const endValue = toNumber(row.max_value);
        if (!category || startValue == null || endValue == null) return [];
        const minValue = Math.min(startValue, endValue);
        const maxValue = Math.max(startValue, endValue);
        return [{ category, minValue, maxValue, spread: maxValue - minValue }];
      });

      setRows(nextRows);
      setNotice(`Rendered ${formatNumber(nextRows.length)} dumbbells.`);
    } catch (error) {
      setRows([]);
      setNotice(error instanceof Error ? error.message : "Dumbbell chart query failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleExportCsv() {
    downloadFile(buildCsv(rows), `${tableName}-dumbbell-chart.csv`, "text/csv;charset=utf-8;");
  }

  function handleExportPng() {
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance) return;
    const output = dataUrlToBytes(
      instance.getDataURL({
        type: "png",
        pixelRatio: 2,
        backgroundColor: dark ? "#020617" : "#ffffff",
      }),
    );
    downloadFile([output.bytes], `${tableName}-dumbbell-chart.png`, output.mimeType);
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} space-y-6 p-6`}
    >
      <div className="flex flex-col gap-4 border-b border-white/20 pb-6 dark:border-white/10 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
            <Waypoints className="h-3.5 w-3.5" />
            Dumbbell Chart
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
              Show the gap between two values for every category
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Each row is rendered as a range with two endpoint dots, making it easy to compare
              spread, drift, and overlap across categories.
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <select aria-label="Dumbbell category column" value={categoryColumn} onChange={(event) => setCategoryColumn(event.currentTarget.value)} className={FIELD_CLASS}>
            {categoryColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <select aria-label="Dumbbell min column" value={minColumn} onChange={(event) => setMinColumn(event.currentTarget.value)} className={FIELD_CLASS}>
            {numericColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <select aria-label="Dumbbell max column" value={maxColumn} onChange={(event) => setMaxColumn(event.currentTarget.value)} className={FIELD_CLASS}>
            {numericColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={handleBuild} className={BUTTON_CLASS}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <StretchHorizontal className="h-4 w-4" />}
          Build dumbbell chart
        </button>
        <button type="button" onClick={handleExportCsv} disabled={rows.length === 0} className={BUTTON_CLASS}>
          <Download className="h-4 w-4" />
          Export CSV
        </button>
        <button type="button" onClick={handleExportPng} disabled={rows.length === 0} className={BUTTON_CLASS}>
          <ImageDown className="h-4 w-4" />
          Export PNG
        </button>
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-300">{notice}</p>

      <div className="grid gap-4 md:grid-cols-3">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <Gauge className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
            Categories
          </div>
          <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">{formatNumber(rows.length)}</div>
        </div>
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <Waypoints className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
            Widest Spread
          </div>
          <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">{formatNumber(widestSpread)}</div>
        </div>
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <Gauge className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
            Average Spread
          </div>
          <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">{formatNumber(averageSpread)}</div>
        </div>
      </div>

      <div className={`${GLASS_CARD_CLASS} p-5`}>
        <ReactEChartsCore
          ref={chartRef}
          echarts={echarts}
          option={option}
          notMerge
          lazyUpdate
          style={{ height: 420 }}
        />
      </div>
    </motion.section>
  );
}
