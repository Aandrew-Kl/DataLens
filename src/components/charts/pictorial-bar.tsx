"use client";

import { useMemo, useRef, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { PictorialBarChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  BarChart3,
  ImageDown,
  Loader2,
  Shapes,
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

echarts.use([PictorialBarChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface PictorialBarProps {
  tableName: string;
  columns: ColumnProfile[];
}

type SymbolShape = "circle" | "rect" | "triangle" | "arrow";

interface PictorialRow {
  category: string;
  value: number;
}

interface SummaryCardProps {
  label: string;
  value: string;
}

const SYMBOL_MAP = {
  circle: "circle",
  rect: "rect",
  triangle: "triangle",
  arrow: "path://M0,6 L12,0 L12,4 L24,4 L24,8 L12,8 L12,12 Z",
} as const;

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

function buildOption(
  rows: PictorialRow[],
  symbolShape: SymbolShape,
  dark: boolean,
): EChartsOption {
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";
  const maxValue = Math.max(...rows.map((row) => row.value), 1);

  return {
    animationDuration: 420,
    grid: { left: 40, right: 24, top: 24, bottom: 40, containLabel: true },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const point = params as {
          name?: string;
          value?: number;
        };
        return `<strong>${point.name ?? ""}</strong><br/>Value: ${formatNumber(Number(point.value ?? 0))}`;
      },
    },
    xAxis: {
      type: "category",
      data: rows.map((row) => row.category),
      axisLabel: { color: textColor, rotate: rows.length > 6 ? 18 : 0 },
      axisLine: { lineStyle: { color: borderColor } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        type: "pictorialBar",
        name: "Value",
        data: rows.map((row) => row.value),
        symbol: SYMBOL_MAP[symbolShape],
        symbolRepeat: true,
        symbolClip: true,
        symbolBoundingData: maxValue,
        symbolSize: [24, 14],
        symbolMargin: 2,
        itemStyle: { color: "#06b6d4" },
      },
    ],
  };
}

export default function PictorialBar({
  tableName,
  columns,
}: PictorialBarProps) {
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
  const [categoryColumn, setCategoryColumn] = useState(
    categoryColumns[0]?.name ?? columns[0]?.name ?? "",
  );
  const [valueColumn, setValueColumn] = useState(numericColumns[0]?.name ?? "");
  const [symbolShape, setSymbolShape] = useState<SymbolShape>("circle");
  const [rows, setRows] = useState<PictorialRow[]>([]);
  const [status, setStatus] = useState(
    "Select a category and numeric value field, then render a symbolic bar chart.",
  );
  const [loading, setLoading] = useState(false);

  const option = useMemo(
    () => buildOption(rows, symbolShape, dark),
    [dark, rows, symbolShape],
  );

  async function handleRenderChart() {
    if (!categoryColumn || !valueColumn) {
      setStatus("Choose both a category column and a numeric value column.");
      return;
    }

    setLoading(true);
    setStatus("Loading pictorial bar data...");

    try {
      const queryRows = await runQuery(`
        SELECT
          COALESCE(CAST(${quoteIdentifier(categoryColumn)} AS VARCHAR), 'Unknown') AS category_label,
          SUM(TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE)) AS metric_value
        FROM ${quoteIdentifier(tableName)}
        WHERE ${quoteIdentifier(valueColumn)} IS NOT NULL
        GROUP BY 1
        HAVING SUM(TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE)) IS NOT NULL
        ORDER BY metric_value DESC
        LIMIT 12
      `);

      const nextRows = queryRows.flatMap<PictorialRow>((row) => {
        const value = toNumber(row.metric_value);
        const category =
          typeof row.category_label === "string"
            ? row.category_label
            : String(row.category_label ?? "");
        if (!category || value == null) return [];
        return [{ category, value }];
      });

      setRows(nextRows);
      setStatus(
        `Rendered ${formatNumber(nextRows.length)} categories with ${symbolShape} symbols.`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to build the pictorial bar chart.",
      );
    } finally {
      setLoading(false);
    }
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
    downloadFile(bytes, `${tableName}-pictorial-bar.png`, "image/png");
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
            <Shapes className="h-3.5 w-3.5" />
            Pictorial Bar
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
              Encode magnitude with repeated symbols instead of solid bars
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Switch between circles, rectangles, triangles, and arrows while
              aggregating values by category.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <select
            aria-label="Category column"
            value={categoryColumn}
            onChange={(event) => setCategoryColumn(event.currentTarget.value)}
            className={FIELD_CLASS}
          >
            {categoryColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Value column"
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
            aria-label="Symbol shape"
            value={symbolShape}
            onChange={(event) => setSymbolShape(event.currentTarget.value as SymbolShape)}
            className={FIELD_CLASS}
          >
            <option value="circle">Circle</option>
            <option value="rect">Rectangle</option>
            <option value="triangle">Triangle</option>
            <option value="arrow">Arrow</option>
          </select>

          <button
            type="button"
            onClick={() => {
              void handleRenderChart();
            }}
            disabled={loading}
            className={`${BUTTON_CLASS} bg-cyan-600 text-white hover:bg-cyan-500 dark:bg-cyan-600 dark:text-white`}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <BarChart3 className="h-4 w-4" />
            )}
            Render chart
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-white/60 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
        {status}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.84fr_1.16fr]">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryCard label="Categories" value={formatNumber(rows.length)} />
            <SummaryCard
              label="Largest Value"
              value={formatNumber(Math.max(...rows.map((row) => row.value), 0))}
            />
          </div>

          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <button
              type="button"
              onClick={handleExportPng}
              disabled={rows.length === 0}
              className={BUTTON_CLASS}
            >
              <ImageDown className="h-4 w-4" />
              Export PNG
            </button>
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
