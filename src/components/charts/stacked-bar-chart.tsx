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
import { BarChart as EChartsBarChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Download, Layers, Sparkles } from "lucide-react";
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
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface StackedBarChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface StackedBarRow {
  category: string;
  series: string;
  value: number;
}

interface StackedBarSummary {
  rows: StackedBarRow[];
  categories: string[];
  seriesNames: string[];
  error: string | null;
}

const STACKED_COLORS = [
  "#22d3ee",
  "#34d399",
  "#f59e0b",
  "#f97316",
  "#a78bfa",
  "#f43f5e",
  "#2dd4bf",
  "#60a5fa",
] as const;

function StackedBarLoading() {
  return (
    <div className={`${GLASS_PANEL_CLASS} flex min-h-[30rem] items-center justify-center`}>
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Rendering stacked bar chart...
      </div>
    </div>
  );
}

function StackedBarEmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <Layers className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Stacked Bar Chart
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

async function loadStackedBarData(
  tableName: string,
  categoryColumn: string,
  seriesColumn: string,
  valueColumn: string,
): Promise<StackedBarSummary> {
  if (!categoryColumn || !seriesColumn || !valueColumn) {
    return {
      rows: [],
      categories: [],
      seriesNames: [],
      error: "Choose category, series, and value columns to render the chart.",
    };
  }

  const queryRows = await runQuery(`
    SELECT
      CAST(${quoteIdentifier(categoryColumn)} AS VARCHAR) AS category,
      CAST(${quoteIdentifier(seriesColumn)} AS VARCHAR) AS series,
      SUM(TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE)) AS value
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(categoryColumn)} IS NOT NULL
      AND ${quoteIdentifier(seriesColumn)} IS NOT NULL
    GROUP BY 1, 2
    ORDER BY 1, 2
    LIMIT 500
  `);

  const rows = queryRows.flatMap<StackedBarRow>((row) => {
    const category = typeof row.category === "string" ? row.category : null;
    const series = typeof row.series === "string" ? row.series : null;
    const value = toNumber(row.value);
    if (category === null || series === null || value === null) return [];
    return [{ category, series, value }];
  });

  if (rows.length === 0) {
    return {
      rows: [],
      categories: [],
      seriesNames: [],
      error: "No aggregated rows were available for the selected columns.",
    };
  }

  const categories = Array.from(new Set(rows.map((r) => r.category)));
  const seriesNames = Array.from(new Set(rows.map((r) => r.series)));

  return { rows, categories, seriesNames, error: null };
}

function buildStackedBarOption(
  result: StackedBarSummary,
  dark: boolean,
  stacked: boolean,
  categoryColumn: string,
  valueColumn: string,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";

  const dataMap = new Map<string, Map<string, number>>();
  for (const row of result.rows) {
    let seriesMap = dataMap.get(row.series);
    if (!seriesMap) {
      seriesMap = new Map<string, number>();
      dataMap.set(row.series, seriesMap);
    }
    seriesMap.set(row.category, row.value);
  }

  return {
    animationDuration: 520,
    color: [...STACKED_COLORS],
    legend: {
      top: 0,
      data: result.seriesNames,
      textStyle: { color: textColor },
    },
    grid: {
      left: 20,
      right: 20,
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
        for (const item of params) {
          if (!isRecord(item)) continue;
          const name = typeof item.seriesName === "string" ? item.seriesName : "";
          const val = Array.isArray(item.value) ? toNumber(item.value[1]) : toNumber(item.value);
          lines.push(`${name}: ${formatNumber(val ?? 0)}`);
        }
        const first = params[0];
        const catName = isRecord(first) && typeof first.name === "string" ? first.name : "";
        return `<strong>${catName}</strong><br/>${lines.join("<br/>")}`;
      },
    },
    xAxis: {
      type: "category",
      data: result.categories,
      name: categoryColumn,
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor, rotate: result.categories.length > 10 ? 30 : 0 },
    },
    yAxis: {
      type: "value",
      name: valueColumn,
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
    },
    series: result.seriesNames.map((seriesName) => {
      const seriesMap = dataMap.get(seriesName);
      return {
        type: "bar" as const,
        name: seriesName,
        stack: stacked ? "total" : undefined,
        data: result.categories.map((cat) => seriesMap?.get(cat) ?? 0),
        emphasis: { focus: "series" as const },
      };
    }),
  };
}

function buildStackedBarCsv(result: StackedBarSummary) {
  const header = ["category", "series", "value"].map(escapeCsvCell).join(",");
  const rows = result.rows.map((r) =>
    [escapeCsvCell(r.category), escapeCsvCell(r.series), escapeCsvCell(r.value)].join(","),
  );
  return [header, ...rows].join("\n");
}

function exportStackedBarPng(chartRef: ReactEChartsCore | null, fileName: string, dark: boolean) {
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

function StackedBarChartReady({ tableName, columns }: StackedBarChartProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const [stacked, setStacked] = useState(true);

  const categoryColumns = useMemo(() => columns.filter((c) => c.type !== "number"), [columns]);
  const numericColumns = useMemo(() => columns.filter((c) => c.type === "number"), [columns]);
  const seriesColumns = useMemo(() => columns.filter((c) => c.type === "string"), [columns]);

  const [categoryColumn, setCategoryColumn] = useState(categoryColumns[0]?.name ?? "");
  const [seriesColumn, setSeriesColumn] = useState(seriesColumns[1]?.name ?? seriesColumns[0]?.name ?? "");
  const [valueColumn, setValueColumn] = useState(numericColumns[0]?.name ?? "");

  const safeCat = categoryColumns.some((c) => c.name === categoryColumn)
    ? categoryColumn
    : categoryColumns[0]?.name ?? "";
  const safeSeries = seriesColumns.some((c) => c.name === seriesColumn)
    ? seriesColumn
    : seriesColumns[0]?.name ?? "";
  const safeValue = numericColumns.some((c) => c.name === valueColumn)
    ? valueColumn
    : numericColumns[0]?.name ?? "";

  const resource = useMemo(
    () =>
      loadStackedBarData(tableName, safeCat, safeSeries, safeValue).catch((error) => ({
        rows: [],
        categories: [],
        seriesNames: [],
        error: error instanceof Error ? error.message : "Unable to build the stacked bar chart.",
      })),
    [safeCat, safeSeries, safeValue, tableName],
  );

  const result = use(resource);
  const option = useMemo(
    () => buildStackedBarOption(result, dark, stacked, safeCat, safeValue),
    [dark, result, safeCat, safeValue, stacked],
  );

  if (numericColumns.length === 0 || categoryColumns.length === 0) {
    return (
      <StackedBarEmptyState message="At least one category column and one numeric column are required." />
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
              Stacked bar chart
            </div>
            <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              Compare grouped totals across categories
            </h3>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Category
              </span>
              <select
                aria-label="Stacked bar category"
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
                Series
              </span>
              <select
                aria-label="Stacked bar series"
                value={safeSeries}
                onChange={(e) => startTransition(() => setSeriesColumn(e.target.value))}
                className={FIELD_CLASS}
              >
                {seriesColumns.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Value
              </span>
              <select
                aria-label="Stacked bar value"
                value={safeValue}
                onChange={(e) => startTransition(() => setValueColumn(e.target.value))}
                className={FIELD_CLASS}
              >
                {numericColumns.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Mode
              </span>
              <select
                aria-label="Stack or group mode"
                value={stacked ? "stack" : "group"}
                onChange={(e) => setStacked(e.target.value === "stack")}
                className={FIELD_CLASS}
              >
                <option value="stack">Stacked</option>
                <option value="group">Grouped</option>
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
              {stacked ? "Stacked" : "Grouped"} bar plot
            </div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Showing {formatNumber(result.seriesNames.length)} series across{" "}
              {formatNumber(result.categories.length)} categories.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-label="Export stacked bar chart PNG"
              onClick={() => exportStackedBarPng(chartRef.current, `${tableName}-stacked-bar.png`, dark)}
              className={BUTTON_CLASS}
            >
              <Download className="h-4 w-4" />
              Export PNG
            </button>
            <button
              type="button"
              aria-label="Export stacked bar chart CSV"
              onClick={() =>
                downloadFile(
                  buildStackedBarCsv(result),
                  `${tableName}-stacked-bar.csv`,
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

export default function StackedBarChart({ tableName, columns }: StackedBarChartProps) {
  return (
    <Suspense fallback={<StackedBarLoading />}>
      <StackedBarChartReady tableName={tableName} columns={columns} />
    </Suspense>
  );
}
