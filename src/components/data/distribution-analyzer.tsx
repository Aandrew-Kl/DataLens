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
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
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
  EqualApproximately,
  Sigma,
  SlidersHorizontal,
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
  normalPdf,
  normalQuantile,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import {
  kurtosis,
  mean,
  median,
  skewness,
  standardDeviation,
} from "@/lib/utils/statistics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface DistributionAnalyzerProps {
  tableName: string;
  columns: ColumnProfile[];
}

type DistributionView = "histogram" | "qq";

interface HistogramBin {
  label: string;
  center: number;
  count: number;
  expected: number;
}

interface QuantilePoint {
  expected: number;
  observed: number;
}

interface DistributionResult {
  values: number[];
  histogram: HistogramBin[];
  qqPoints: QuantilePoint[];
  meanValue: number;
  medianValue: number;
  stddevValue: number;
  skewnessValue: number;
  kurtosisValue: number;
  classification: "normal" | "skewed left" | "skewed right" | "bimodal" | "uniform";
  normalityScore: number;
  normalityLabel: string;
  error: string | null;
}

function SummaryMetric({
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

function DistributionLoading() {
  return (
    <div
      className={`${GLASS_PANEL_CLASS} flex min-h-[30rem] items-center justify-center`}
    >
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Loading distribution analysis…
      </div>
    </div>
  );
}

function formatMetric(value: number) {
  if (!Number.isFinite(value)) return "—";
  return Math.abs(value) >= 1000 || Number.isInteger(value)
    ? formatNumber(value)
    : value.toFixed(3);
}

function buildHistogram(values: number[], binCount: number, average: number, stddev: number) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1e-6);
  const width = spread / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    lower: min + index * width,
    upper: index === binCount - 1 ? max : min + (index + 1) * width,
    count: 0,
  }));

  for (const value of values) {
    const rawIndex = Math.floor((value - min) / width);
    const index = Math.min(binCount - 1, Math.max(0, rawIndex));
    bins[index].count += 1;
  }

  return bins.map((bin) => {
    const center = (bin.lower + bin.upper) / 2;
    const expected = normalPdf(center, average, Math.max(stddev, 1e-6)) * values.length * width;
    return {
      label: `${formatMetric(bin.lower)} to ${formatMetric(bin.upper)}`,
      center,
      count: bin.count,
      expected,
    } satisfies HistogramBin;
  });
}

function buildQqPoints(values: number[], average: number, stddev: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const safeStddev = stddev > 0 ? stddev : 1;
  return sorted.map((value, index) => ({
    expected: normalQuantile((index + 0.5) / sorted.length),
    observed: (value - average) / safeStddev,
  }));
}

function histogramPeaks(histogram: HistogramBin[]) {
  let peaks = 0;
  for (let index = 1; index < histogram.length - 1; index += 1) {
    if (
      histogram[index].count > histogram[index - 1].count &&
      histogram[index].count > histogram[index + 1].count
    ) {
      peaks += 1;
    }
  }
  return peaks;
}

function classifyDistribution(
  histogram: HistogramBin[],
  skewnessValue: number,
  kurtosisValue: number,
) {
  const maxCount = Math.max(...histogram.map((bin) => bin.count), 1);
  const minCount = Math.min(...histogram.map((bin) => bin.count));
  const relativeSpread = (maxCount - minCount) / maxCount;

  if (histogramPeaks(histogram) >= 2) {
    return "bimodal";
  }
  if (relativeSpread < 0.3 && Math.abs(skewnessValue) < 0.35) {
    return "uniform";
  }
  if (skewnessValue <= -0.75) {
    return "skewed left";
  }
  if (skewnessValue >= 0.75) {
    return "skewed right";
  }
  if (Math.abs(skewnessValue) < 0.35 && Math.abs(kurtosisValue) < 0.9) {
    return "normal";
  }
  return skewnessValue < 0 ? "skewed left" : "skewed right";
}

function normalityLabel(score: number) {
  if (score >= 80) return "Strong normal fit";
  if (score >= 55) return "Moderate normal fit";
  return "Weak normal fit";
}

function buildNormalityScore(skewnessValue: number, kurtosisValue: number, count: number) {
  if (count < 3) return 0;
  const jarqueBera =
    (count / 6) *
    (skewnessValue * skewnessValue +
      ((kurtosisValue * kurtosisValue) / 4));
  return Math.max(0, Math.min(100, 100 - jarqueBera * 10));
}

async function loadDistribution(
  tableName: string,
  columnName: string,
  binCount: number,
): Promise<DistributionResult> {
  if (!columnName) {
    return {
      values: [],
      histogram: [],
      qqPoints: [],
      meanValue: 0,
      medianValue: 0,
      stddevValue: 0,
      skewnessValue: 0,
      kurtosisValue: 0,
      classification: "normal",
      normalityScore: 0,
      normalityLabel: "Weak normal fit",
      error: "Choose a numeric column to analyze its distribution.",
    };
  }

  const rows = await runQuery(`
    SELECT TRY_CAST(${quoteIdentifier(columnName)} AS DOUBLE) AS value
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(columnName)} IS NOT NULL
      AND TRY_CAST(${quoteIdentifier(columnName)} AS DOUBLE) IS NOT NULL
    LIMIT 4000
  `);

  const values = rows
    .map((row) => toNumber(row.value))
    .filter((value): value is number => value !== null);

  if (values.length < 3) {
    return {
      values,
      histogram: [],
      qqPoints: [],
      meanValue: 0,
      medianValue: 0,
      stddevValue: 0,
      skewnessValue: 0,
      kurtosisValue: 0,
      classification: "normal",
      normalityScore: 0,
      normalityLabel: "Weak normal fit",
      error:
        "At least three numeric values are required to profile the distribution.",
    };
  }

  const meanValue = mean(values);
  const medianValue = median(values);
  const stddevValue = standardDeviation(values);
  const skewnessValue = skewness(values);
  const kurtosisValue = kurtosis(values);
  const histogram = buildHistogram(values, binCount, meanValue, stddevValue);
  const qqPoints = buildQqPoints(values, meanValue, stddevValue);
  const normalityScore = buildNormalityScore(
    skewnessValue,
    kurtosisValue,
    values.length,
  );

  return {
    values,
    histogram,
    qqPoints,
    meanValue,
    medianValue,
    stddevValue,
    skewnessValue,
    kurtosisValue,
    classification: classifyDistribution(
      histogram,
      skewnessValue,
      kurtosisValue,
    ),
    normalityScore,
    normalityLabel: normalityLabel(normalityScore),
    error: null,
  };
}

function buildHistogramOption(
  result: DistributionResult,
  dark: boolean,
): EChartsOption {
  return {
    animationDuration: 520,
    legend: {
      top: 0,
      textStyle: { color: dark ? "#cbd5e1" : "#475569" },
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    grid: { left: 46, right: 24, top: 44, bottom: 28 },
    xAxis: {
      type: "category",
      data: result.histogram.map((bin) => bin.label),
      axisLabel: { color: dark ? "#cbd5e1" : "#475569", rotate: 28 },
      axisLine: { lineStyle: { color: dark ? "#334155" : "#cbd5e1" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: dark ? "#cbd5e1" : "#475569" },
      splitLine: {
        lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" },
      },
    },
    series: [
      {
        name: "Observed",
        type: "bar",
        data: result.histogram.map((bin) => bin.count),
        itemStyle: { color: "#38bdf8", borderRadius: [8, 8, 0, 0] },
      },
      {
        name: "Normal curve",
        type: "line",
        smooth: true,
        data: result.histogram.map((bin) => Number(bin.expected.toFixed(3))),
        symbol: "none",
        lineStyle: { color: "#fb7185", width: 3 },
      },
    ],
  };
}

function buildQqOption(result: DistributionResult, dark: boolean): EChartsOption {
  const diagonal = result.qqPoints.map((point) => point.expected);
  const min = Math.min(...diagonal, ...result.qqPoints.map((point) => point.observed));
  const max = Math.max(...diagonal, ...result.qqPoints.map((point) => point.observed));

  return {
    animationDuration: 520,
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    grid: { left: 48, right: 22, top: 28, bottom: 34 },
    xAxis: {
      type: "value",
      name: "Expected Z",
      min,
      max,
      nameTextStyle: { color: dark ? "#cbd5e1" : "#475569" },
      axisLabel: { color: dark ? "#cbd5e1" : "#475569" },
      splitLine: {
        lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" },
      },
    },
    yAxis: {
      type: "value",
      name: "Observed Z",
      min,
      max,
      nameTextStyle: { color: dark ? "#cbd5e1" : "#475569" },
      axisLabel: { color: dark ? "#cbd5e1" : "#475569" },
      splitLine: {
        lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" },
      },
    },
    series: [
      {
        type: "scatter",
        data: result.qqPoints.map((point) => [point.expected, point.observed]),
        symbolSize: 8,
        itemStyle: { color: "#22c55e" },
      },
      {
        type: "line",
        data: [
          [min, min],
          [max, max],
        ],
        symbol: "none",
        lineStyle: { color: "#f97316", width: 2, type: "dashed" },
      },
    ],
  };
}

function DistributionAnalyzerReady({
  tableName,
  columns,
}: DistributionAnalyzerProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [columnName, setColumnName] = useState(numericColumns[0]?.name ?? "");
  const [binCount, setBinCount] = useState(24);
  const [view, setView] = useState<DistributionView>("histogram");

  const safeColumn = numericColumns.some((column) => column.name === columnName)
    ? columnName
    : numericColumns[0]?.name ?? "";

  const resultPromise = useMemo(
    () =>
      loadDistribution(tableName, safeColumn, binCount).catch((error) => ({
        values: [],
        histogram: [],
        qqPoints: [],
        meanValue: 0,
        medianValue: 0,
        stddevValue: 0,
        skewnessValue: 0,
        kurtosisValue: 0,
        classification: "normal" as const,
        normalityScore: 0,
        normalityLabel: "Weak normal fit",
        error:
          error instanceof Error
            ? error.message
            : "Unable to load the distribution.",
      })),
    [binCount, safeColumn, tableName],
  );

  const result = use(resultPromise);
  const option = useMemo(
    () =>
      view === "histogram"
        ? buildHistogramOption(result, dark)
        : buildQqOption(result, dark),
    [dark, result, view],
  );

  function exportPng() {
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance || result.error) return;
    const { bytes, mimeType } = dataUrlToBytes(
      instance.getDataURL({
        type: "png",
        pixelRatio: 2,
        backgroundColor: dark ? "#020617" : "#f8fafc",
      }),
    );
    downloadFile(bytes, `${tableName}-${safeColumn}-distribution.png`, mimeType);
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-violet-700 dark:text-violet-300">
              <Activity className="h-4 w-4" />
              Distribution Shape Profiler
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Compare observed spread against a normal reference curve
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Switch between a histogram overlay and a QQ plot to judge shape,
              symmetry, heavy tails, and possible multimodality.
            </p>
          </div>
          <button type="button" onClick={exportPng} className={BUTTON_CLASS}>
            <Download className="h-4 w-4" />
            Export PNG
          </button>
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.2fr_0.9fr_0.9fr]">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Numeric column
            </label>
            <select
              value={safeColumn}
              onChange={(event) =>
                startTransition(() => setColumnName(event.target.value))
              }
              className={FIELD_CLASS}
            >
              {numericColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </div>
          <label className={`${GLASS_CARD_CLASS} flex items-center gap-3 px-4 py-3`}>
            <SlidersHorizontal className="h-4 w-4 text-cyan-500" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Bin count
              </div>
              <input
                aria-label="Bin count"
                type="range"
                min={10}
                max={100}
                step={1}
                value={binCount}
                onChange={(event) =>
                  startTransition(() => setBinCount(Number(event.target.value)))
                }
                className="mt-2 w-full accent-cyan-500"
              />
            </div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              {binCount}
            </div>
          </label>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              View
            </label>
            <select
              value={view}
              onChange={(event) =>
                startTransition(() =>
                  setView(event.target.value as DistributionView),
                )
              }
              className={FIELD_CLASS}
            >
              <option value="histogram">Histogram</option>
              <option value="qq">QQ plot</option>
            </select>
          </div>
        </div>

        {result.error ? (
          <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-5 text-sm text-rose-700 dark:text-rose-300">
            {result.error}
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <SummaryMetric label="Mean" value={formatMetric(result.meanValue)} />
              <SummaryMetric
                label="Median"
                value={formatMetric(result.medianValue)}
              />
              <SummaryMetric
                label="Std dev"
                value={formatMetric(result.stddevValue)}
              />
              <SummaryMetric
                label="Skewness"
                value={result.skewnessValue.toFixed(2)}
              />
              <SummaryMetric
                label="Kurtosis"
                value={result.kurtosisValue.toFixed(2)}
              />
              <SummaryMetric
                label="Type"
                value={result.classification}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
              <div className={`${GLASS_CARD_CLASS} p-4`}>
                <ReactEChartsCore
                  ref={chartRef}
                  echarts={echarts}
                  option={option}
                  notMerge
                  lazyUpdate
                  style={{ height: 420 }}
                />
              </div>
              <div className="grid gap-4">
                <div className={`${GLASS_CARD_CLASS} p-5`}>
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    <EqualApproximately className="h-4 w-4" />
                    Simplified normality
                  </div>
                  <div className="mt-4 text-3xl font-semibold text-slate-950 dark:text-white">
                    {Math.round(result.normalityScore)}/100
                  </div>
                  <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                    {result.normalityLabel}. The score blends skewness and excess
                    kurtosis into a Shapiro-style quick indicator.
                  </p>
                </div>
                <div className={`${GLASS_CARD_CLASS} p-5`}>
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    <Activity className="h-4 w-4" />
                    Interpretation
                  </div>
                  <ul className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                    <li>
                      {result.classification === "normal"
                        ? "The center and tails line up closely with a Gaussian reference."
                        : `The shape reads as ${result.classification}, which suggests the center is being pulled by asymmetric tails or multiple modes.`}
                    </li>
                    <li>
                      Mean vs median gap:{" "}
                      <strong className="text-slate-900 dark:text-white">
                        {formatMetric(result.meanValue - result.medianValue)}
                      </strong>
                    </li>
                    <li>
                      Values sampled:{" "}
                      <strong className="text-slate-900 dark:text-white">
                        {formatNumber(result.values.length)}
                      </strong>
                    </li>
                    <li>
                      QQ alignment threshold:{" "}
                      <strong className="text-slate-900 dark:text-white">
                        {formatPercent(result.normalityScore)}
                      </strong>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </motion.section>
  );
}

export default function DistributionAnalyzer(
  props: DistributionAnalyzerProps,
) {
  return (
    <Suspense fallback={<DistributionLoading />}>
      <DistributionAnalyzerReady {...props} />
    </Suspense>
  );
}
