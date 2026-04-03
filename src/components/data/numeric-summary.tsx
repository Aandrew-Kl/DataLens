"use client";

import { useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart, BoxplotChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { BarChart3, Download, Sigma, Waves } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import {
  mean,
  median,
  quartiles,
  skewness,
  standardDeviation,
  kurtosis,
} from "@/lib/utils/statistics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  BarChart,
  BoxplotChart,
  GridComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface NumericSummaryProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface HistogramBin {
  label: string;
  count: number;
}

interface NumericSummaryResult {
  values: number[];
  min: number;
  max: number;
  mean: number;
  median: number;
  stddev: number;
  q1: number;
  q3: number;
  histogram: HistogramBin[];
  shape: string;
  skewnessValue: number;
  kurtosisValue: number;
}

function buildHistogram(values: number[]) {
  if (values.length === 0) return [];
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const spread = Math.max(maxValue - minValue, 1e-6);
  const binCount = Math.min(12, Math.max(6, Math.round(Math.sqrt(values.length))));
  const width = spread / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    lower: minValue + width * index,
    upper: index === binCount - 1 ? maxValue : minValue + width * (index + 1),
    count: 0,
  }));

  values.forEach((value) => {
    const rawIndex = Math.floor((value - minValue) / width);
    const index = Math.min(binCount - 1, Math.max(0, rawIndex));
    bins[index].count += 1;
  });

  return bins.map((bin) => ({
    label: `${bin.lower.toFixed(1)}-${bin.upper.toFixed(1)}`,
    count: bin.count,
  }));
}

function classifyShape(skewValue: number, kurtosisValue: number) {
  if (skewValue >= 0.85) return "right-skewed";
  if (skewValue <= -0.85) return "left-skewed";
  if (kurtosisValue >= 1.25) return "heavy-tailed";
  if (Math.abs(skewValue) < 0.35 && Math.abs(kurtosisValue) < 1) return "near-normal";
  return "broad";
}

function buildHistogramOption(bins: HistogramBin[], dark: boolean): EChartsOption {
  return {
    animationDuration: 420,
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => {
        if (!Array.isArray(params)) return "";
        const first = params[0];
        if (!isRecord(first)) return "";
        const axisValue = typeof first.axisValue === "string" ? first.axisValue : "";
        const value = Array.isArray(first.data) ? first.data[1] : first.data ?? first.value;
        const count = toNumber(value);
        return `${axisValue}<br/>Count: ${count ?? 0}`;
      },
      backgroundColor: dark ? "#020617f2" : "#ffffffee",
      borderColor: dark ? "#1e293b" : "#e2e8f0",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    grid: { left: 18, right: 20, top: 16, bottom: 28, containLabel: true },
    xAxis: {
      type: "category",
      data: bins.map((bin) => bin.label),
      axisLabel: { color: dark ? "#cbd5e1" : "#64748b", rotate: bins.length > 8 ? 18 : 0 },
      axisLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: dark ? "#cbd5e1" : "#64748b" },
      splitLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" } },
    },
    series: [
      {
        type: "bar",
        data: bins.map((bin) => bin.count),
        itemStyle: { color: "#0ea5e9", borderRadius: [10, 10, 0, 0] },
        barMaxWidth: 32,
      },
    ],
  };
}

function buildBoxplotOption(result: NumericSummaryResult | null, dark: boolean): EChartsOption {
  if (!result) {
    return {
      xAxis: { type: "category", data: [] },
      yAxis: { type: "value" },
      series: [],
    };
  }

  return {
    animationDuration: 420,
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617f2" : "#ffffffee",
      borderColor: dark ? "#1e293b" : "#e2e8f0",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    grid: { left: 18, right: 20, top: 16, bottom: 28, containLabel: true },
    xAxis: {
      type: "category",
      data: ["Distribution"],
      axisLabel: { color: dark ? "#cbd5e1" : "#64748b" },
      axisLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: dark ? "#cbd5e1" : "#64748b" },
      splitLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" } },
    },
    series: [
      {
        type: "boxplot",
        data: [[result.min, result.q1, result.median, result.q3, result.max]],
        itemStyle: {
          color: "rgba(14, 165, 233, 0.18)",
          borderColor: "#0284c7",
          borderWidth: 2,
        },
      },
    ],
  };
}

function buildCsv(result: NumericSummaryResult) {
  return [
    "metric,value",
    `min,${result.min}`,
    `max,${result.max}`,
    `mean,${result.mean}`,
    `median,${result.median}`,
    `stddev,${result.stddev}`,
    `q1,${result.q1}`,
    `q3,${result.q3}`,
    `skewness,${result.skewnessValue}`,
    `kurtosis,${result.kurtosisValue}`,
    `shape,${result.shape}`,
  ].join("\n");
}

function formatMetric(value: number) {
  return Math.abs(value) >= 1000 ? formatNumber(value) : value.toFixed(2);
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
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

export default function NumericSummary({ tableName, columns }: NumericSummaryProps) {
  const dark = useDarkMode();
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [columnName, setColumnName] = useState("");
  const [result, setResult] = useState<NumericSummaryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeColumn =
    numericColumns.find((column) => column.name === columnName)?.name ??
    numericColumns[0]?.name ??
    "";

  async function handleAnalyze() {
    if (!activeColumn) {
      setResult(null);
      setError("Choose a numeric column to summarize.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(`
        SELECT TRY_CAST(${quoteIdentifier(activeColumn)} AS DOUBLE) AS value
        FROM ${quoteIdentifier(tableName)}
        WHERE ${quoteIdentifier(activeColumn)} IS NOT NULL
          AND TRY_CAST(${quoteIdentifier(activeColumn)} AS DOUBLE) IS NOT NULL
        LIMIT 4000
      `);

      const values = rows
        .map((row) => toNumber(row.value))
        .filter((value): value is number => value != null);

      if (!values.length) {
        setResult(null);
        setError("No numeric values were parsed from the selected column.");
        return;
      }

      const { q1, q2, q3 } = quartiles(values);
      const skewValue = skewness(values);
      const kurtosisValue = kurtosis(values);

      setResult({
        values,
        min: Math.min(...values),
        max: Math.max(...values),
        mean: mean(values),
        median: q2 ?? median(values),
        stddev: standardDeviation(values),
        q1,
        q3,
        histogram: buildHistogram(values),
        shape: classifyShape(skewValue, kurtosisValue),
        skewnessValue: skewValue,
        kurtosisValue,
      });
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : "Numeric summary failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;
    downloadFile(
      buildCsv(result),
      `${tableName}-${activeColumn}-numeric-summary.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} p-6`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
            <Sigma className="h-4 w-4" />
            Numeric Summary
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            Comprehensive descriptive statistics for one metric
          </h2>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={!result}
          className={BUTTON_CLASS}
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <label className="text-sm text-slate-600 dark:text-slate-300">
          <span className="mb-2 block">Numeric column</span>
          <select
            aria-label="Numeric column"
            value={activeColumn}
            onChange={(event) => setColumnName(event.target.value)}
            className={FIELD_CLASS}
          >
            {numericColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={loading || !activeColumn}
          className={`${BUTTON_CLASS} self-end`}
        >
          {loading ? "Summarizing…" : "Analyze distribution"}
        </button>
      </div>

      {!numericColumns.length ? (
        <div className="mt-6 rounded-3xl border border-dashed border-white/25 px-4 py-6 text-sm text-slate-600 dark:text-slate-300">
          Choose a numeric column to summarize.
        </div>
      ) : null}

      {error ? (
        <div className="mt-6 rounded-3xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Min / Max" value={result ? `${formatMetric(result.min)} / ${formatMetric(result.max)}` : "—"} />
        <MetricCard label="Mean" value={result ? formatMetric(result.mean) : "—"} />
        <MetricCard label="Median" value={result ? formatMetric(result.median) : "—"} />
        <MetricCard label="Shape" value={result ? result.shape : "—"} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <BarChart3 className="h-4 w-4" />
            Histogram
          </h3>
          <ReactEChartsCore
            echarts={echarts}
            option={buildHistogramOption(result?.histogram ?? [], dark)}
            style={{ height: 300 }}
          />
        </div>
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <Waves className="h-4 w-4" />
            Box plot
          </h3>
          <ReactEChartsCore
            echarts={echarts}
            option={buildBoxplotOption(result, dark)}
            style={{ height: 300 }}
          />
        </div>
      </div>

      <div className={`${GLASS_CARD_CLASS} mt-6 p-4`}>
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          Distribution shape indicator
        </h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {result
            ? `${result.shape} distribution with skewness ${result.skewnessValue.toFixed(2)} and kurtosis ${result.kurtosisValue.toFixed(2)}.`
            : "Run the summary to classify the distribution shape."}
        </p>
      </div>
    </motion.section>
  );
}
