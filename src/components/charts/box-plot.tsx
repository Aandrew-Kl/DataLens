"use client";

import { Suspense, startTransition, use, useMemo, useRef, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BoxplotChart as EChartsBoxplotChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Boxes, Download, Loader2, Sigma } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
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
  EChartsBoxplotChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface BoxPlotProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface BoxPlotStat {
  metric: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  rowCount: number;
  outlierCount: number;
}

interface BoxPlotOutlier {
  metric: string;
  metricIndex: number;
  value: number;
}

interface BoxPlotResult {
  stats: BoxPlotStat[];
  outliers: BoxPlotOutlier[];
  error: string | null;
}

interface BoxPlotReadyProps {
  tableName: string;
  selectedColumns: string[];
  promise: Promise<BoxPlotResult>;
}

function buildBaseSql(tableName: string, selectedColumns: string[]) {
  return selectedColumns
    .map(
      (columnName) => `
        SELECT
          '${columnName.replaceAll("'", "''")}' AS metric_name,
          TRY_CAST(${quoteIdentifier(columnName)} AS DOUBLE) AS metric_value
        FROM ${quoteIdentifier(tableName)}
        WHERE TRY_CAST(${quoteIdentifier(columnName)} AS DOUBLE) IS NOT NULL
      `,
    )
    .join(" UNION ALL ");
}

async function loadBoxPlotData(
  tableName: string,
  selectedColumns: string[],
): Promise<BoxPlotResult> {
  if (selectedColumns.length === 0) {
    return {
      stats: [],
      outliers: [],
      error: "Choose at least one numeric column to render the box plot.",
    };
  }

  try {
    const baseSql = buildBaseSql(tableName, selectedColumns);
    const summaryRows = await runQuery(`
      WITH base AS (${baseSql}),
      stats AS (
        SELECT
          metric_name,
          COUNT(*) AS row_count,
          AVG(metric_value) AS mean_value,
          QUANTILE_CONT(metric_value, 0.25) AS q1_value,
          QUANTILE_CONT(metric_value, 0.5) AS median_value,
          QUANTILE_CONT(metric_value, 0.75) AS q3_value
        FROM base
        GROUP BY 1
      )
      SELECT
        stats.metric_name,
        MIN(
          CASE
            WHEN base.metric_value >= stats.q1_value - 1.5 * (stats.q3_value - stats.q1_value)
            THEN base.metric_value
            ELSE NULL
          END
        ) AS whisker_min,
        stats.q1_value,
        stats.median_value,
        stats.q3_value,
        MAX(
          CASE
            WHEN base.metric_value <= stats.q3_value + 1.5 * (stats.q3_value - stats.q1_value)
            THEN base.metric_value
            ELSE NULL
          END
        ) AS whisker_max,
        stats.mean_value,
        stats.row_count,
        SUM(
          CASE
            WHEN base.metric_value < stats.q1_value - 1.5 * (stats.q3_value - stats.q1_value)
              OR base.metric_value > stats.q3_value + 1.5 * (stats.q3_value - stats.q1_value)
            THEN 1
            ELSE 0
          END
        ) AS outlier_count
      FROM base
      JOIN stats ON stats.metric_name = base.metric_name
      GROUP BY
        stats.metric_name,
        stats.q1_value,
        stats.median_value,
        stats.q3_value,
        stats.mean_value,
        stats.row_count
      ORDER BY stats.metric_name
    `);

    const outlierRows = await runQuery(`
      WITH base AS (${baseSql}),
      stats AS (
        SELECT
          metric_name,
          QUANTILE_CONT(metric_value, 0.25) AS q1_value,
          QUANTILE_CONT(metric_value, 0.75) AS q3_value
        FROM base
        GROUP BY 1
      )
      SELECT
        base.metric_name,
        base.metric_value
      FROM base
      JOIN stats ON stats.metric_name = base.metric_name
      WHERE base.metric_value < stats.q1_value - 1.5 * (stats.q3_value - stats.q1_value)
         OR base.metric_value > stats.q3_value + 1.5 * (stats.q3_value - stats.q1_value)
      ORDER BY base.metric_name, base.metric_value DESC
      LIMIT 80
    `);

    const stats = summaryRows.map<BoxPlotStat>((row) => ({
      metric: String(row.metric_name ?? ""),
      min: toNumber(row.whisker_min) ?? 0,
      q1: toNumber(row.q1_value) ?? 0,
      median: toNumber(row.median_value) ?? 0,
      q3: toNumber(row.q3_value) ?? 0,
      max: toNumber(row.whisker_max) ?? 0,
      mean: toNumber(row.mean_value) ?? 0,
      rowCount: toNumber(row.row_count) ?? 0,
      outlierCount: toNumber(row.outlier_count) ?? 0,
    }));

    const outlierLookup = new Map(stats.map((stat, index) => [stat.metric, index]));
    const outliers = outlierRows.flatMap<BoxPlotOutlier>((row) => {
      const metric = String(row.metric_name ?? "");
      const value = toNumber(row.metric_value);
      const metricIndex = outlierLookup.get(metric);
      if (metricIndex === undefined || value === null) {
        return [];
      }
      return [{ metric, metricIndex, value }];
    });

    return {
      stats,
      outliers,
      error: stats.length === 0 ? "DuckDB did not return any numeric samples." : null,
    };
  } catch (error) {
    return {
      stats: [],
      outliers: [],
      error: error instanceof Error ? error.message : "Unable to render the box plot.",
    };
  }
}

function buildBoxPlotOption(result: BoxPlotResult, dark: boolean): EChartsOption {
  const categories = result.stats.map((stat) => stat.metric);
  const boxData = result.stats.map((stat) => [stat.min, stat.q1, stat.median, stat.q3, stat.max]);
  const outlierData = result.outliers.map((outlier) => [outlier.metricIndex, outlier.value]);

  return {
    animationDuration: 420,
    color: [dark ? "#38bdf8" : "#0891b2", "#f97316"],
    grid: { left: 48, right: 24, top: 24, bottom: 48 },
    legend: { top: 0, textStyle: { color: dark ? "#e2e8f0" : "#0f172a" } },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
      formatter: (params: unknown) => {
        const record = params as unknown as {
          seriesName?: string;
          name?: string;
          data?: number[];
          value?: number[];
        };
        if (record.seriesName === "Outliers") {
          const value = Array.isArray(record.value) ? record.value[1] : undefined;
          return `${String(record.name ?? "Outlier")}<br/>Value: ${formatNumber(Number(value ?? 0))}`;
        }
        if (!Array.isArray(record.data)) {
          return String(record.name ?? "Box plot");
        }
        const [min, q1, median, q3, max] = record.data;
        return [
          String(record.name ?? "Box plot"),
          `Min: ${formatNumber(Number(min ?? 0))}`,
          `Q1: ${formatNumber(Number(q1 ?? 0))}`,
          `Median: ${formatNumber(Number(median ?? 0))}`,
          `Q3: ${formatNumber(Number(q3 ?? 0))}`,
          `Max: ${formatNumber(Number(max ?? 0))}`,
        ].join("<br/>");
      },
    },
    xAxis: {
      type: "category",
      data: categories,
      axisLabel: { color: dark ? "#cbd5e1" : "#334155" },
      axisLine: { lineStyle: { color: dark ? "#334155" : "#cbd5e1" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: dark ? "#cbd5e1" : "#334155" },
      splitLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" } },
    },
    series: [
      { name: "Distribution", type: "boxplot", data: boxData },
      {
        name: "Outliers",
        type: "scatter",
        data: outlierData,
        symbolSize: 10,
        itemStyle: { color: "#f97316", opacity: 0.8 },
      },
    ],
  };
}

function buildBoxPlotCsv(result: BoxPlotResult) {
  const lines = ["metric,min,q1,median,q3,max,mean,row_count,outlier_count"];
  for (const stat of result.stats) {
    lines.push(
      [
        stat.metric,
        stat.min,
        stat.q1,
        stat.median,
        stat.q3,
        stat.max,
        stat.mean,
        stat.rowCount,
        stat.outlierCount,
      ].join(","),
    );
  }
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

function BoxPlotLoading() {
  return (
    <div className={`${GLASS_CARD_CLASS} flex min-h-[24rem] items-center justify-center p-6 text-sm text-slate-600 dark:text-slate-300`}>
      Loading box plot…
    </div>
  );
}

function BoxPlotReady({ tableName, selectedColumns, promise }: BoxPlotReadyProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const result = use(promise);
  const option = useMemo(() => buildBoxPlotOption(result, dark), [dark, result]);

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
              Compare min, Q1, median, Q3, and max for each numeric field
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Outlier dots show points outside the 1.5 IQR whiskers.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => downloadFile(buildBoxPlotCsv(result), `${tableName}-box-plot.csv`, "text/csv;charset=utf-8;")}
              className={BUTTON_CLASS}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => exportChartPng(chartRef.current, dark, `${tableName}-box-plot.png`)}
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
        {result.stats.map((stat) => (
          <div key={stat.metric} className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {stat.metric}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/20 p-3 text-sm text-slate-700 dark:text-slate-200">
                Min: {formatNumber(stat.min)}
              </div>
              <div className="rounded-2xl border border-white/20 p-3 text-sm text-slate-700 dark:text-slate-200">
                Q1: {formatNumber(stat.q1)}
              </div>
              <div className="rounded-2xl border border-white/20 p-3 text-sm text-slate-700 dark:text-slate-200">
                Median: {formatNumber(stat.median)}
              </div>
              <div className="rounded-2xl border border-white/20 p-3 text-sm text-slate-700 dark:text-slate-200">
                Q3: {formatNumber(stat.q3)}
              </div>
              <div className="rounded-2xl border border-white/20 p-3 text-sm text-slate-700 dark:text-slate-200">
                Max: {formatNumber(stat.max)}
              </div>
              <div className="rounded-2xl border border-white/20 p-3 text-sm text-slate-700 dark:text-slate-200">
                Outliers: {formatNumber(stat.outlierCount)}
              </div>
            </div>
          </div>
        ))}

        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Current selection
          </div>
          <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">
            {selectedColumns.join(", ")}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BoxPlot({ tableName, columns }: BoxPlotProps) {
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [selectedColumns, setSelectedColumns] = useState<string[]>(
    numericColumns.slice(0, Math.min(3, numericColumns.length)).map((column) => column.name),
  );

  const activeColumns = useMemo(() => {
    const available = new Set(numericColumns.map((column) => column.name));
    const kept = selectedColumns.filter((columnName) => available.has(columnName));
    if (kept.length > 0) {
      return kept;
    }
    return numericColumns.slice(0, Math.min(3, numericColumns.length)).map((column) => column.name);
  }, [numericColumns, selectedColumns]);

  const promise = useMemo(
    () => loadBoxPlotData(tableName, activeColumns),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeColumns.length, tableName],
  );

  function toggleColumn(columnName: string) {
    startTransition(() => {
      setSelectedColumns((current) => (
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
              <Boxes className="h-4 w-4" />
              Box Plot
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Compare numeric distributions side by side
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Build an ECharts box plot with whiskers, quartiles, medians, and
              explicit outlier dots for multiple numeric columns.
            </p>
          </div>
          <div className="rounded-full border border-white/20 px-3 py-1 text-sm text-slate-600 dark:text-slate-300">
            {formatNumber(activeColumns.length)} selected
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {numericColumns.length === 0 ? (
            <div className="rounded-full border border-white/20 px-4 py-2 text-sm text-slate-500 dark:text-slate-400">
              No numeric columns available
            </div>
          ) : (
            numericColumns.map((column) => {
              const selected = activeColumns.includes(column.name);
              return (
                <button
                  key={column.name}
                  type="button"
                  onClick={() => toggleColumn(column.name)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    selected
                      ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                      : "border-white/20 bg-white/50 text-slate-700 dark:bg-slate-950/40 dark:text-slate-200"
                  }`}
                >
                  {column.name}
                </button>
              );
            })
          )}
        </div>

        <Suspense fallback={<BoxPlotLoading />}>
          <BoxPlotReady
            tableName={tableName}
            selectedColumns={activeColumns}
            promise={promise}
          />
        </Suspense>
      </div>
    </motion.section>
  );
}
