"use client";

import {
  Suspense,
  startTransition,
  use,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart as EChartsBarChart, LineChart as EChartsLineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Download, Sparkles, TrendingUp } from "lucide-react";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_PANEL_CLASS,
  dataUrlToBytes,
  isRecord,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  EChartsBarChart,
  EChartsLineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface ComboChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface ComboRow {
  category: string;
  barValue: number;
  lineValue: number;
}

interface ComboSummary {
  rows: ComboRow[];
  categories: string[];
  error: string | null;
}

const COMBO_BAR_COLOR = "#22d3ee";
const COMBO_LINE_COLOR = "#f59e0b";

function ComboChartLoading() {
  return (
    <div className={`${GLASS_PANEL_CLASS} flex min-h-[30rem] items-center justify-center`}>
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Rendering combo chart...
      </div>
    </div>
  );
}

function ComboChartEmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <TrendingUp className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Combo Chart
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {message}
          </p>
        </div>
      </div>
    </section>
  );
}

function escapeCsvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n") ||
    stringValue.includes("\r")
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

async function loadComboData(
  tableName: string,
  categoryColumn: string,
  barColumn: string,
  lineColumn: string,
): Promise<ComboSummary> {
  if (!categoryColumn || !barColumn || !lineColumn) {
    return {
      rows: [],
      categories: [],
      error: "Choose category, bar, and line columns to render the chart.",
    };
  }

  const queryRows = await runQuery(`
    SELECT
      CAST(${quoteIdentifier(categoryColumn)} AS VARCHAR) AS category,
      SUM(TRY_CAST(${quoteIdentifier(barColumn)} AS DOUBLE)) AS bar_value,
      SUM(TRY_CAST(${quoteIdentifier(lineColumn)} AS DOUBLE)) AS line_value
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(categoryColumn)} IS NOT NULL
    GROUP BY 1
    ORDER BY 1
    LIMIT 200
  `);

  const rows = queryRows.flatMap<ComboRow>((row) => {
    const category = typeof row.category === "string" ? row.category : null;
    const barValue = toNumber(row.bar_value);
    const lineValue = toNumber(row.line_value);
    if (category === null || barValue === null || lineValue === null) return [];
    return [{ category, barValue, lineValue }];
  });

  if (rows.length === 0) {
    return {
      rows: [],
      categories: [],
      error: "No aggregated rows were available for the selected columns.",
    };
  }

  const categories = rows.map((r) => r.category);
  return { rows, categories, error: null };
}

function buildComboOption(
  result: ComboSummary,
  dark: boolean,
  dualAxis: boolean,
  barColumn: string,
  lineColumn: string,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";

  const yAxisList: EChartsOption["yAxis"] = dualAxis
    ? [
        {
          type: "value" as const,
          name: barColumn,
          nameTextStyle: { color: textColor },
          axisLabel: { color: textColor },
          splitLine: { lineStyle: { color: dark ? "#334155" : "#e2e8f0" } },
        },
        {
          type: "value" as const,
          name: lineColumn,
          nameTextStyle: { color: textColor },
          axisLabel: { color: textColor },
          splitLine: { show: false },
        },
      ]
    : {
        type: "value" as const,
        nameTextStyle: { color: textColor },
        axisLabel: { color: textColor },
        splitLine: { lineStyle: { color: dark ? "#334155" : "#e2e8f0" } },
      };

  return {
    animationDuration: 520,
    color: [COMBO_BAR_COLOR, COMBO_LINE_COLOR],
    legend: {
      top: 0,
      data: [barColumn, lineColumn],
      textStyle: { color: textColor },
    },
    grid: {
      left: 20,
      right: dualAxis ? 60 : 20,
      top: 48,
      bottom: 24,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        if (!Array.isArray(params)) return "";
        const lines: string[] = [];
        let catName = "";
        for (const item of params) {
          if (!isRecord(item)) continue;
          if (!catName && typeof item.name === "string") catName = item.name;
          const name = typeof item.seriesName === "string" ? item.seriesName : "";
          const val = toNumber(item.value) ?? 0;
          lines.push(`${name}: ${formatNumber(val)}`);
        }
        return `<strong>${catName}</strong><br/>${lines.join("<br/>")}`;
      },
    },
    xAxis: {
      type: "category",
      data: result.categories,
      axisLabel: {
        color: textColor,
        rotate: result.categories.length > 12 ? 30 : 0,
      },
    },
    yAxis: yAxisList,
    series: [
      {
        type: "bar" as const,
        name: barColumn,
        data: result.rows.map((r) => r.barValue),
        yAxisIndex: 0,
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: COMBO_BAR_COLOR,
        },
        emphasis: { focus: "series" as const },
      },
      {
        type: "line" as const,
        name: lineColumn,
        data: result.rows.map((r) => r.lineValue),
        yAxisIndex: dualAxis ? 1 : 0,
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { width: 2.5, color: COMBO_LINE_COLOR },
        itemStyle: { color: COMBO_LINE_COLOR },
        emphasis: { focus: "series" as const },
      },
    ],
  };
}

function buildComboCsv(result: ComboSummary, barColumn: string, lineColumn: string) {
  const header = ["category", barColumn, lineColumn].map(escapeCsvCell).join(",");
  const rows = result.rows.map((r) =>
    [escapeCsvCell(r.category), escapeCsvCell(r.barValue), escapeCsvCell(r.lineValue)].join(","),
  );
  return [header, ...rows].join("\n");
}

function exportComboPng(chartRef: ReactEChartsCore | null, fileName: string, dark: boolean) {
  const instance = chartRef?.getEchartsInstance();
  if (!instance) return;
  const dataUrl = instance.getDataURL({
    type: "png",
    pixelRatio: 2,
    backgroundColor: dark ? "#020617" : "#f8fafc",
  });
  const output = dataUrlToBytes(dataUrl);
  downloadFile([output.bytes], fileName, output.mimeType);
}

function ComboChartReady({ tableName, columns }: ComboChartProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const [dualAxis, setDualAxis] = useState(false);

  const categoryColumns = useMemo(() => columns.filter((c) => c.type !== "number"), [columns]);
  const numericColumns = useMemo(() => columns.filter((c) => c.type === "number"), [columns]);

  const [categoryColumn, setCategoryColumn] = useState(categoryColumns[0]?.name ?? "");
  const [barColumn, setBarColumn] = useState(numericColumns[0]?.name ?? "");
  const [lineColumn, setLineColumn] = useState(
    numericColumns[1]?.name ?? numericColumns[0]?.name ?? "",
  );

  const safeCat = categoryColumns.some((c) => c.name === categoryColumn)
    ? categoryColumn
    : categoryColumns[0]?.name ?? "";
  const safeBar = numericColumns.some((c) => c.name === barColumn)
    ? barColumn
    : numericColumns[0]?.name ?? "";
  const safeLine = numericColumns.some((c) => c.name === lineColumn)
    ? lineColumn
    : numericColumns[1]?.name ?? numericColumns[0]?.name ?? "";

  const resource = useMemo(
    () =>
      loadComboData(tableName, safeCat, safeBar, safeLine).catch((error) => ({
        rows: [],
        categories: [],
        error: error instanceof Error ? error.message : "Unable to build the combo chart.",
      })),
    [safeBar, safeCat, safeLine, tableName],
  );

  const result = use(resource);
  const option = useMemo(
    () => buildComboOption(result, dark, dualAxis, safeBar, safeLine),
    [dark, dualAxis, result, safeBar, safeLine],
  );

  if (numericColumns.length < 2) {
    return (
      <ComboChartEmptyState message="At least two numeric columns are required for bar and line series." />
    );
  }

  if (categoryColumns.length === 0) {
    return (
      <ComboChartEmptyState message="At least one category column is required for the X-axis." />
    );
  }

  return (
    <div className="space-y-5">
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: ANALYTICS_EASE }}
        className={`${GLASS_PANEL_CLASS} p-5`}
      >
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
              <Sparkles className="h-3.5 w-3.5" />
              Combo chart
            </div>
            <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              Overlay bar and line series on one plot
            </h3>
          </div>

          <div className="grid gap-3 md:grid-cols-5">
            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Category
              </span>
              <select
                aria-label="Combo category"
                value={safeCat}
                onChange={(e) => startTransition(() => setCategoryColumn(e.target.value))}
                className={FIELD_CLASS}
              >
                {categoryColumns.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Bar series
              </span>
              <select
                aria-label="Combo bar series"
                value={safeBar}
                onChange={(e) => startTransition(() => setBarColumn(e.target.value))}
                className={FIELD_CLASS}
              >
                {numericColumns.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Line series
              </span>
              <select
                aria-label="Combo line series"
                value={safeLine}
                onChange={(e) => startTransition(() => setLineColumn(e.target.value))}
                className={FIELD_CLASS}
              >
                {numericColumns.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Y-axis mode
              </span>
              <select
                aria-label="Dual axis toggle"
                value={dualAxis ? "dual" : "single"}
                onChange={(e) => setDualAxis(e.target.value === "dual")}
                className={FIELD_CLASS}
              >
                <option value="single">Single Y-axis</option>
                <option value="dual">Dual Y-axis</option>
              </select>
            </label>
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: ANALYTICS_EASE }}
        className={`${GLASS_PANEL_CLASS} p-5`}
      >
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {dualAxis ? "Dual-axis" : "Single-axis"} combo plot
            </div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Showing {formatNumber(result.categories.length)} categories with bars and trend line.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-label="Export combo chart PNG"
              onClick={() => exportComboPng(chartRef.current, `${tableName}-combo.png`, dark)}
              className={BUTTON_CLASS}
            >
              <Download className="h-4 w-4" />
              Export PNG
            </button>
            <button
              type="button"
              aria-label="Export combo chart CSV"
              onClick={() =>
                downloadFile(
                  buildComboCsv(result, safeBar, safeLine),
                  `${tableName}-combo.csv`,
                  "text/csv;charset=utf-8;",
                )
              }
              className={BUTTON_CLASS}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>

        {result.error ? (
          <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 px-4 py-5 text-sm text-rose-700 dark:text-rose-300">
            {result.error}
          </div>
        ) : (
          <ReactEChartsCore
            ref={chartRef}
            echarts={echarts}
            option={option}
            notMerge
            lazyUpdate
            style={{ height: 520 }}
          />
        )}
      </motion.section>
    </div>
  );
}

export default function ComboChart({ tableName, columns }: ComboChartProps) {
  return (
    <Suspense fallback={<ComboChartLoading />}>
      <ComboChartReady tableName={tableName} columns={columns} />
    </Suspense>
  );
}
