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
  ImageDown,
  Lollipop,
  Loader2,
  Rows3,
  StretchHorizontal,
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

interface LollipopChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

type SortMode = "desc" | "asc" | "alpha";
type Orientation = "vertical" | "horizontal";

interface LollipopRow {
  category: string;
  value: number;
}

const SORT_MODES = ["desc", "asc", "alpha"] as const;
const ORIENTATIONS = ["vertical", "horizontal"] as const;
const LOLLIPOP_COLOR = "#06b6d4";

function buildCsv(rows: LollipopRow[]) {
  return ["category,value", ...rows.map((row) => `${row.category},${row.value}`)].join("\n");
}

function createVerticalStemRenderItem(color: string): CustomSeriesRenderItem {
  return function renderItem(
    _params: CustomSeriesRenderItemParams,
    api: CustomSeriesRenderItemAPI,
  ) {
    const categoryIndex = Number(api.value(0));
    const value = Number(api.value(1));
    const start = api.coord([categoryIndex, 0]);
    const end = api.coord([categoryIndex, value]);
    return {
      type: "group",
      children: [
        {
          type: "line",
          shape: { x1: start[0], y1: start[1], x2: end[0], y2: end[1] },
          style: { stroke: color, lineWidth: 3, lineCap: "round" },
        },
      ],
    };
  };
}

function createHorizontalStemRenderItem(color: string): CustomSeriesRenderItem {
  return function renderItem(
    _params: CustomSeriesRenderItemParams,
    api: CustomSeriesRenderItemAPI,
  ) {
    const value = Number(api.value(0));
    const categoryIndex = Number(api.value(1));
    const start = api.coord([0, categoryIndex]);
    const end = api.coord([value, categoryIndex]);
    return {
      type: "group",
      children: [
        {
          type: "line",
          shape: { x1: start[0], y1: start[1], x2: end[0], y2: end[1] },
          style: { stroke: color, lineWidth: 3, lineCap: "round" },
        },
      ],
    };
  };
}

function buildLollipopOption(
  rows: LollipopRow[],
  orientation: Orientation,
  dark: boolean,
): EChartsOption {
  const categories = rows.map((row) => row.category);
  const verticalData = rows.map((row, index) => [index, row.value, row.category]);
  const horizontalData = rows.map((row, index) => [row.value, index, row.category]);
  const tooltipFormatter = (params: unknown) => {
    const record = params as { data?: Array<string | number> };
    const data = Array.isArray(record.data) ? record.data : [];
    const category = String(data[2] ?? "");
    const value = Number(data[orientation === "vertical" ? 1 : 0] ?? 0);
    return `${category}<br/>Value: ${formatNumber(value)}`;
  };

  return {
    animationDuration: 420,
    grid: { left: 72, right: 28, top: 24, bottom: 42, containLabel: true },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
      formatter: tooltipFormatter,
    },
    xAxis:
      orientation === "vertical"
        ? {
            type: "category",
            data: categories,
            axisLabel: { color: dark ? "#cbd5e1" : "#475569", rotate: categories.length > 6 ? 18 : 0 },
            axisLine: { lineStyle: { color: dark ? "#334155" : "#cbd5e1" } },
          }
        : {
            type: "value",
            axisLabel: { color: dark ? "#cbd5e1" : "#475569" },
            splitLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" } },
          },
    yAxis:
      orientation === "vertical"
        ? {
            type: "value",
            axisLabel: { color: dark ? "#cbd5e1" : "#475569" },
            splitLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" } },
          }
        : {
            type: "category",
            data: categories,
            axisLabel: { color: dark ? "#cbd5e1" : "#475569" },
            axisLine: { lineStyle: { color: dark ? "#334155" : "#cbd5e1" } },
          },
    series: [
      {
        type: "custom",
        renderItem:
          orientation === "vertical"
            ? createVerticalStemRenderItem(LOLLIPOP_COLOR)
            : createHorizontalStemRenderItem(LOLLIPOP_COLOR),
        data: orientation === "vertical" ? verticalData : horizontalData,
        silent: true,
      },
      {
        type: "scatter",
        data: orientation === "vertical" ? verticalData : horizontalData,
        symbolSize: 16,
        itemStyle: {
          color: LOLLIPOP_COLOR,
          borderWidth: 3,
          borderColor: dark ? "#082f49" : "#ecfeff",
        },
      },
    ],
  };
}

export default function LollipopChart({
  tableName,
  columns,
}: LollipopChartProps) {
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
  const [valueColumn, setValueColumn] = useState(numericColumns[0]?.name ?? "");
  const [sortMode, setSortMode] = useState<SortMode>("desc");
  const [orientation, setOrientation] = useState<Orientation>("vertical");
  const [rows, setRows] = useState<LollipopRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(
    "Choose a category and value field, then render a lollipop view with custom ECharts stems.",
  );

  const option = useMemo(
    () => buildLollipopOption(rows, orientation, dark),
    [dark, orientation, rows],
  );

  async function handleBuild() {
    if (!categoryColumn || !valueColumn) {
      setNotice("Choose both a category and numeric value column.");
      return;
    }
    setLoading(true);
    setNotice("Rendering lollipop chart...");

    try {
      const orderBy =
        sortMode === "alpha"
          ? "category_label ASC"
          : sortMode === "asc"
            ? "metric_value ASC"
            : "metric_value DESC";

      const resultRows = await runQuery(`
        SELECT
          CAST(${quoteIdentifier(categoryColumn)} AS VARCHAR) AS category_label,
          SUM(TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE)) AS metric_value
        FROM ${quoteIdentifier(tableName)}
        WHERE ${quoteIdentifier(categoryColumn)} IS NOT NULL
          AND TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE) IS NOT NULL
        GROUP BY 1
        ORDER BY ${orderBy}
        LIMIT 18
      `);

      const nextRows = resultRows.flatMap<LollipopRow>((row) => {
        const category =
          typeof row.category_label === "string"
            ? row.category_label
            : String(row.category_label ?? "");
        const value = toNumber(row.metric_value);
        if (!category || value == null) return [];
        return [{ category, value }];
      });

      setRows(nextRows);
      setNotice(`Rendered ${formatNumber(nextRows.length)} lollipops.`);
    } catch (error) {
      setRows([]);
      setNotice(error instanceof Error ? error.message : "Lollipop chart query failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleExportCsv() {
    downloadFile(buildCsv(rows), `${tableName}-lollipop-chart.csv`, "text/csv;charset=utf-8;");
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
    downloadFile([output.bytes], `${tableName}-lollipop-chart.png`, output.mimeType);
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
            <Lollipop className="h-3.5 w-3.5" />
            Lollipop Chart
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
              Rank categories with stems and dots instead of full bars
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Use custom ECharts rendering for the stems, swap between horizontal and vertical
              orientation, and export both the chart image and the summarized data.
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <select aria-label="Lollipop category column" value={categoryColumn} onChange={(event) => setCategoryColumn(event.currentTarget.value)} className={FIELD_CLASS}>
            {categoryColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <select aria-label="Lollipop value column" value={valueColumn} onChange={(event) => setValueColumn(event.currentTarget.value)} className={FIELD_CLASS}>
            {numericColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <select aria-label="Lollipop sort mode" value={sortMode} onChange={(event) => setSortMode(event.currentTarget.value as SortMode)} className={FIELD_CLASS}>
            {SORT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
          <select aria-label="Lollipop orientation" value={orientation} onChange={(event) => setOrientation(event.currentTarget.value as Orientation)} className={FIELD_CLASS}>
            {ORIENTATIONS.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={handleBuild} className={BUTTON_CLASS}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rows3 className="h-4 w-4" />}
          Build lollipop chart
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Categories
          </p>
          <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
            {formatNumber(rows.length)}
          </div>
        </div>
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Top Value
          </p>
          <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
            {formatNumber(rows[0]?.value ?? 0)}
          </div>
        </div>
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Orientation
          </p>
          <div className="mt-3 text-xl font-semibold capitalize text-slate-950 dark:text-white">
            {orientation}
          </div>
        </div>
      </div>

      <div className={`${GLASS_CARD_CLASS} p-5`}>
        <div className="mb-4 flex items-center gap-2">
          {orientation === "vertical" ? (
            <Lollipop className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
          ) : (
            <StretchHorizontal className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
          )}
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Lollipop Plot</p>
        </div>
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
