"use client";

import { useMemo, useRef, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { BarChart3, Download, ImageDown, Sigma } from "lucide-react";
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
import { mean, median, standardDeviation } from "@/lib/utils/statistics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([BarChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface ColumnHistogramProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface NumericBucket {
  label: string;
  count: number;
  start: number;
  end: number;
}

interface CategoricalBucket {
  label: string;
  count: number;
}

interface NumericHistogramResult {
  kind: "numeric";
  column: string;
  totalCount: number;
  minimum: number;
  maximum: number;
  average: number;
  medianValue: number;
  deviation: number;
  buckets: NumericBucket[];
}

interface CategoricalHistogramResult {
  kind: "categorical";
  column: string;
  totalCount: number;
  uniqueValues: number;
  topCategories: CategoricalBucket[];
}

type HistogramResult = NumericHistogramResult | CategoricalHistogramResult;

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv(result: HistogramResult): string {
  if (result.kind === "numeric") {
    const header = "label,count,start,end";
    const body = result.buckets.map((bucket) =>
      [bucket.label, bucket.count, bucket.start, bucket.end].map(escapeCsv).join(","),
    );
    return [header, ...body].join("\n");
  }

  const header = "label,count";
  const body = result.topCategories.map((bucket) => [bucket.label, bucket.count].map(escapeCsv).join(","));
  return [header, ...body].join("\n");
}

function buildNumericHistogram(column: string, values: number[], binCount: number): NumericHistogramResult {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const safeBins = Math.max(1, Math.round(binCount));

  if (minimum === maximum) {
    return {
      kind: "numeric",
      column,
      totalCount: values.length,
      minimum,
      maximum,
      average: mean(values),
      medianValue: median(values),
      deviation: standardDeviation(values),
      buckets: [
        {
          label: `${minimum.toFixed(2)} - ${maximum.toFixed(2)}`,
          count: values.length,
          start: minimum,
          end: maximum,
        },
      ],
    };
  }

  const width = (maximum - minimum) / safeBins;
  const buckets = Array.from({ length: safeBins }, (_, index) => {
    const start = minimum + width * index;
    const end = index === safeBins - 1 ? maximum : minimum + width * (index + 1);
    const count = values.filter((value) =>
      index === safeBins - 1 ? value >= start && value <= end : value >= start && value < end,
    ).length;

    return {
      label: `${start.toFixed(2)} - ${end.toFixed(2)}`,
      count,
      start,
      end,
    };
  });

  return {
    kind: "numeric",
    column,
    totalCount: values.length,
    minimum,
    maximum,
    average: mean(values),
    medianValue: median(values),
    deviation: standardDeviation(values),
    buckets,
  };
}

function buildCategoricalHistogram(column: string, values: string[], topN: number): CategoricalHistogramResult {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const topCategories = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, Math.max(1, Math.round(topN)))
    .map(([label, count]) => ({ label, count }));

  return {
    kind: "categorical",
    column,
    totalCount: values.length,
    uniqueValues: counts.size,
    topCategories,
  };
}

function buildOption(result: HistogramResult | null, dark: boolean): EChartsOption {
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";

  const labels =
    result?.kind === "numeric"
      ? result.buckets.map((bucket) => bucket.label)
      : result?.kind === "categorical"
        ? result.topCategories.map((bucket) => bucket.label)
        : [];
  const data =
    result?.kind === "numeric"
      ? result.buckets.map((bucket) => bucket.count)
      : result?.kind === "categorical"
        ? result.topCategories.map((bucket) => bucket.count)
        : [];

  return {
    animationDuration: 420,
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const points = Array.isArray(params)
          ? params as Array<{ axisValueLabel?: string; data?: number }>
          : [];
        const point = points[0];
        return `${point?.axisValueLabel ?? ""}<br/>Count: ${formatNumber(point?.data ?? 0)}`;
      },
    },
    legend: {
      bottom: 0,
      textStyle: { color: textColor },
    },
    grid: {
      left: 56,
      right: 24,
      top: 24,
      bottom: 56,
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: {
        color: textColor,
        interval: 0,
        rotate: labels.length > 8 ? 24 : 0,
      },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        name: result?.kind === "numeric" ? "Bin count" : "Category count",
        type: "bar",
        barMaxWidth: 36,
        itemStyle: {
          color: result?.kind === "numeric" ? "#06b6d4" : "#8b5cf6",
          borderRadius: [12, 12, 0, 0],
        },
        data,
      },
    ],
  };
}

export default function ColumnHistogram({ tableName, columns }: ColumnHistogramProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const [selectedColumn, setSelectedColumn] = useState(columns[0]?.name ?? "");
  const [binCount, setBinCount] = useState(8);
  const [topN, setTopN] = useState(6);
  const [result, setResult] = useState<HistogramResult | null>(null);
  const [status, setStatus] = useState("Pick a column to profile its distribution and then export the histogram.");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const currentColumn = useMemo(
    () => columns.find((column) => column.name === selectedColumn) ?? null,
    [columns, selectedColumn],
  );

  if (columns.length === 0) {
    return (
      <section className={`${GLASS_PANEL_CLASS} p-6`}>
        <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Column histogram</h2>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          Histograms require at least one profiled column.
        </p>
      </section>
    );
  }

  async function handleAnalyze(): Promise<void> {
    if (!currentColumn) {
      setError("Choose a column to analyze.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(`
        SELECT ${quoteIdentifier(currentColumn.name)} AS value
        FROM ${quoteIdentifier(tableName)}
        WHERE ${quoteIdentifier(currentColumn.name)} IS NOT NULL
      `);

      if (currentColumn.type === "number") {
        const numericValues = rows
          .map((row) => toNumber(row.value))
          .filter((value): value is number => value !== null);

        if (numericValues.length === 0) {
          throw new Error("The selected numeric column does not contain usable values.");
        }

        const numericResult = buildNumericHistogram(currentColumn.name, numericValues, binCount);
        setResult(numericResult);
        setStatus(`Binned ${formatNumber(numericValues.length)} numeric values from ${currentColumn.name}.`);
      } else {
        const categoricalValues = rows
          .map((row) => String(row.value ?? "").trim())
          .filter((value) => value.length > 0);

        if (categoricalValues.length === 0) {
          throw new Error("The selected column does not contain usable category values.");
        }

        const categoricalResult = buildCategoricalHistogram(currentColumn.name, categoricalValues, topN);
        setResult(categoricalResult);
        setStatus(`Counted ${formatNumber(categoricalValues.length)} categorical values from ${currentColumn.name}.`);
      }
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "Unable to analyze the selected column.");
    } finally {
      setLoading(false);
    }
  }

  function handleExportCsv(): void {
    if (!result) {
      setError("Analyze the column before exporting.");
      return;
    }

    downloadFile(
      buildCsv(result),
      `${tableName}-${result.column}-histogram.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  function handleExportPng(): void {
    if (!result) {
      setError("Analyze the column before exporting.");
      return;
    }

    const instance = chartRef.current?.getEchartsInstance();
    const dataUrl = instance?.getDataURL({
      backgroundColor: dark ? "#020617" : "#ffffff",
      pixelRatio: 2,
    });

    if (!dataUrl) {
      setError("The chart is not ready to export yet.");
      return;
    }

    const { bytes, mimeType } = dataUrlToBytes(dataUrl);
    downloadFile(bytes, `${tableName}-${result.column}-histogram.png`, mimeType);
  }

  const option = useMemo(() => buildOption(result, dark), [dark, result]);

  return (
    <motion.section
      className={`${GLASS_PANEL_CLASS} space-y-6 p-6`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: ANALYTICS_EASE }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-fuchsia-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-700 dark:text-fuchsia-300">
            <BarChart3 className="h-3.5 w-3.5" />
            Distribution
          </div>
          <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
            Inspect numeric bins or categorical top-N frequencies
          </h2>
          <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">{status}</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button className={BUTTON_CLASS} disabled={loading} onClick={() => void handleAnalyze()} type="button">
            <Sigma className="h-4 w-4" />
            {loading ? "Analyzing…" : "Analyze column"}
          </button>
          <button className={BUTTON_CLASS} disabled={!result} onClick={handleExportCsv} type="button">
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          <button className={BUTTON_CLASS} disabled={!result} onClick={handleExportPng} type="button">
            <ImageDown className="h-4 w-4" />
            Export PNG
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} space-y-4 p-4`}>
            <label className="block space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <span>Column</span>
              <select className={FIELD_CLASS} onChange={(event) => setSelectedColumn(event.target.value)} value={selectedColumn}>
                {columns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            {currentColumn?.type === "number" ? (
              <label className="block space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                <span>Numeric bins</span>
                <input
                  className={FIELD_CLASS}
                  min={1}
                  onChange={(event) => setBinCount(Math.max(1, Number(event.target.value) || 1))}
                  type="number"
                  value={binCount}
                />
              </label>
            ) : (
              <label className="block space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                <span>Top categories</span>
                <input
                  className={FIELD_CLASS}
                  min={1}
                  onChange={(event) => setTopN(Math.max(1, Number(event.target.value) || 1))}
                  type="number"
                  value={topN}
                />
              </label>
            )}
          </div>

          {result?.kind === "numeric" ? (
            <div className={`${GLASS_CARD_CLASS} grid gap-3 p-4`}>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Mean</p>
                <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{result.average.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Median</p>
                <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{result.medianValue.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Std. deviation</p>
                <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{result.deviation.toFixed(2)}</p>
              </div>
            </div>
          ) : result?.kind === "categorical" ? (
            <div className={`${GLASS_CARD_CLASS} grid gap-3 p-4`}>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Observed rows</p>
                <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{formatNumber(result.totalCount)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Unique values</p>
                <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{formatNumber(result.uniqueValues)}</p>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          ) : null}
        </aside>

        <div className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <ReactEChartsCore option={option} ref={chartRef} style={{ height: 360 }} />
          </div>

          {result ? (
            <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
              <div className="border-b border-white/10 px-4 py-3">
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Distribution table
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-950/[0.03] dark:bg-white/[0.03]">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Bucket</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(result.kind === "numeric" ? result.buckets : result.topCategories).map((bucket) => (
                      <tr className="border-t border-white/10" key={bucket.label}>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{bucket.label}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatNumber(bucket.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </motion.section>
  );
}
