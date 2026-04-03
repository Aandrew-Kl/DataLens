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
import { Download, GitCompareArrows, Sparkles } from "lucide-react";
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

interface DivergingBarChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface DivergingBarRow {
  label: string;
  value: number;
}

interface DivergingBarSummary {
  rows: DivergingBarRow[];
  error: string | null;
}

const POSITIVE_COLOR = "#34d399";
const NEGATIVE_COLOR = "#f43f5e";

function DivergingBarLoading() {
  return (
    <div className={`${GLASS_PANEL_CLASS} flex min-h-[30rem] items-center justify-center`}>
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Rendering diverging bar chart...
      </div>
    </div>
  );
}

function DivergingBarEmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <GitCompareArrows className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Diverging Bar Chart
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

async function loadDivergingBarData(
  tableName: string,
  labelColumn: string,
  valueColumn: string,
): Promise<DivergingBarSummary> {
  if (!labelColumn || !valueColumn) {
    return {
      rows: [],
      error: "Choose label and value columns to render the chart.",
    };
  }

  const queryRows = await runQuery(`
    SELECT
      CAST(${quoteIdentifier(labelColumn)} AS VARCHAR) AS label,
      SUM(TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE)) AS value
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(labelColumn)} IS NOT NULL
    GROUP BY 1
    ORDER BY value ASC
    LIMIT 100
  `);

  const rows = queryRows.flatMap<DivergingBarRow>((row) => {
    const label = typeof row.label === "string" ? row.label : null;
    const value = toNumber(row.value);
    if (label === null || value === null) return [];
    return [{ label, value }];
  });

  if (rows.length === 0) {
    return {
      rows: [],
      error: "No aggregated rows were available for the selected columns.",
    };
  }

  return { rows, error: null };
}

function buildDivergingBarOption(
  result: DivergingBarSummary,
  dark: boolean,
  valueColumn: string,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";

  return {
    animationDuration: 520,
    grid: {
      left: 20,
      right: 20,
      top: 24,
      bottom: 24,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        if (!Array.isArray(params)) return "";
        const item = params[0];
        if (!isRecord(item)) return "";
        const name = typeof item.name === "string" ? item.name : "";
        const val = toNumber(item.value) ?? 0;
        return `<strong>${name}</strong><br/>${valueColumn}: ${formatNumber(val)}`;
      },
    },
    xAxis: {
      type: "value",
      name: valueColumn,
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
      splitLine: {
        lineStyle: { color: dark ? "#334155" : "#e2e8f0" },
      },
    },
    yAxis: {
      type: "category",
      data: result.rows.map((r) => r.label),
      axisLabel: { color: textColor },
    },
    series: [
      {
        type: "bar",
        data: result.rows.map((r) => ({
          value: r.value,
          itemStyle: {
            color: r.value >= 0 ? POSITIVE_COLOR : NEGATIVE_COLOR,
            borderRadius: r.value >= 0 ? [0, 6, 6, 0] : [6, 0, 0, 6],
          },
        })),
        emphasis: {
          itemStyle: { opacity: 0.85 },
        },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: textColor, type: "dashed" },
          data: [{ xAxis: 0 }],
        },
      },
    ],
  };
}

function buildDivergingBarCsv(result: DivergingBarSummary) {
  const header = ["label", "value"].map(escapeCsvCell).join(",");
  const rows = result.rows.map((r) =>
    [escapeCsvCell(r.label), escapeCsvCell(r.value)].join(","),
  );
  return [header, ...rows].join("\n");
}

function exportDivergingBarPng(chartRef: ReactEChartsCore | null, fileName: string, dark: boolean) {
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

function DivergingBarChartReady({ tableName, columns }: DivergingBarChartProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);

  const labelColumns = useMemo(() => columns.filter((c) => c.type !== "number"), [columns]);
  const numericColumns = useMemo(() => columns.filter((c) => c.type === "number"), [columns]);

  const [labelColumn, setLabelColumn] = useState(labelColumns[0]?.name ?? "");
  const [valueColumn, setValueColumn] = useState(numericColumns[0]?.name ?? "");

  const safeLabel = labelColumns.some((c) => c.name === labelColumn)
    ? labelColumn
    : labelColumns[0]?.name ?? "";
  const safeValue = numericColumns.some((c) => c.name === valueColumn)
    ? valueColumn
    : numericColumns[0]?.name ?? "";

  const resource = useMemo(
    () =>
      loadDivergingBarData(tableName, safeLabel, safeValue).catch((error) => ({
        rows: [],
        error: error instanceof Error ? error.message : "Unable to build the diverging bar chart.",
      })),
    [safeLabel, safeValue, tableName],
  );

  const result = use(resource);
  const option = useMemo(
    () => buildDivergingBarOption(result, dark, safeValue),
    [dark, result, safeValue],
  );

  if (numericColumns.length === 0 || labelColumns.length === 0) {
    return (
      <DivergingBarEmptyState message="At least one label column and one numeric column are required." />
    );
  }

  const positiveCount = result.rows.filter((r) => r.value >= 0).length;
  const negativeCount = result.rows.filter((r) => r.value < 0).length;

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
              Diverging bar chart
            </div>
            <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              Visualize positive and negative deviations
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {formatNumber(positiveCount)} positive, {formatNumber(negativeCount)} negative values centered at zero.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Label
              </span>
              <select
                aria-label="Diverging bar label"
                value={safeLabel}
                onChange={(e) => startTransition(() => setLabelColumn(e.target.value))}
                className={FIELD_CLASS}
              >
                {labelColumns.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Value
              </span>
              <select
                aria-label="Diverging bar value"
                value={safeValue}
                onChange={(e) => startTransition(() => setValueColumn(e.target.value))}
                className={FIELD_CLASS}
              >
                {numericColumns.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
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
              Diverging bar plot
            </div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Green bars extend right for positive values, red bars extend left for negative values.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-label="Export diverging bar chart PNG"
              onClick={() => exportDivergingBarPng(chartRef.current, `${tableName}-diverging-bar.png`, dark)}
              className={BUTTON_CLASS}
            >
              <Download className="h-4 w-4" />
              Export PNG
            </button>
            <button
              type="button"
              aria-label="Export diverging bar chart CSV"
              onClick={() =>
                downloadFile(
                  buildDivergingBarCsv(result),
                  `${tableName}-diverging-bar.csv`,
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
            style={{ height: Math.max(400, result.rows.length * 28) }}
          />
        )}
      </motion.section>
    </div>
  );
}

export default function DivergingBarChart({ tableName, columns }: DivergingBarChartProps) {
  return (
    <Suspense fallback={<DivergingBarLoading />}>
      <DivergingBarChartReady tableName={tableName} columns={columns} />
    </Suspense>
  );
}
