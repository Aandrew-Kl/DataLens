"use client";

import { startTransition, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart as EChartsBarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  Activity,
  CalendarRange,
  Download,
  Loader2,
  Sigma,
  Waves,
} from "lucide-react";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
  quoteIdentifier,
  toDate,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  LineChart,
  EChartsBarChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface TimeSeriesClassifierProps {
  tableName: string;
  columns: ColumnProfile[];
}

type PatternType = "trend" | "seasonal" | "cyclical" | "random";

interface RawPoint {
  isoDate: string;
  value: number;
  sampleCount: number;
}

interface DecompositionPoint extends RawPoint {
  trend: number;
  seasonal: number;
  residual: number;
}

interface PatternConfidence {
  pattern: PatternType;
  score: number;
}

interface ClassificationResult {
  points: DecompositionPoint[];
  detectedPeriod: number;
  classification: PatternType;
  confidence: number;
  confidences: PatternConfidence[];
  explanation: string;
}

interface MetricCardProps {
  label: string;
  value: string;
  icon: typeof Activity;
}

const PATTERN_LABELS: Record<PatternType, string> = {
  trend: "Trend-dominant",
  seasonal: "Seasonal",
  cyclical: "Cyclical",
  random: "Random / noisy",
};

const PATTERN_COPY: Record<PatternType, string> = {
  trend: "Movement is dominated by a consistent direction over time.",
  seasonal: "The series repeats a regular pattern at a stable lag.",
  cyclical: "The series swings in multi-period waves without strict repetition.",
  random: "Residual noise dominates after removing trend and repeating signals.",
};

function formatDateLabel(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1, 12)));
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function movingAverage(values: number[], windowSize: number) {
  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const slice = values.slice(start, index + 1);
    return average(slice);
  });
}

function autocorrelation(values: number[], lag: number) {
  if (lag <= 0 || lag >= values.length) return 0;
  const left = values.slice(0, values.length - lag);
  const right = values.slice(lag);
  const leftMean = average(left);
  const rightMean = average(right);
  let numerator = 0;
  let leftDenominator = 0;
  let rightDenominator = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftDenominator += leftDelta * leftDelta;
    rightDenominator += rightDelta * rightDelta;
  }

  const denominator = Math.sqrt(leftDenominator * rightDenominator);
  return denominator === 0 ? 0 : numerator / denominator;
}

function buildTrendLine(values: number[]) {
  if (values.length < 2) return values;
  const meanX = (values.length - 1) / 2;
  const meanY = average(values);
  let numerator = 0;
  let denominator = 0;

  values.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY);
    denominator += (index - meanX) ** 2;
  });

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;
  return values.map((_, index) => intercept + slope * index);
}

function detectPeriod(values: number[]) {
  if (values.length < 8) return 2;
  const maxLag = Math.min(24, Math.floor(values.length / 2));
  let bestLag = 2;
  let bestScore = -1;

  for (let lag = 2; lag <= maxLag; lag += 1) {
    const score = autocorrelation(values, lag);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  return bestLag;
}

function buildSeasonalPattern(values: number[], trend: number[], period: number) {
  const buckets = Array.from({ length: period }, () => [] as number[]);

  values.forEach((value, index) => {
    buckets[index % period].push(value - trend[index]);
  });

  return buckets.map((bucket) => average(bucket));
}

function countSignChanges(values: number[]) {
  let changes = 0;

  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1] ?? 0;
    const current = values[index] ?? 0;
    if ((previous >= 0 && current < 0) || (previous < 0 && current >= 0)) {
      changes += 1;
    }
  }

  return changes;
}

function normalizeConfidences(rawScores: Record<PatternType, number>) {
  const sum = Object.values(rawScores).reduce((acc, value) => acc + value, 0);
  const baseline = sum <= 0 ? 1 : sum;
  const confidences = (Object.keys(rawScores) as PatternType[]).map((pattern) => ({
    pattern,
    score: (rawScores[pattern] / baseline) * 100,
  }));

  return confidences.sort((left, right) => right.score - left.score);
}

function classifySeries(points: RawPoint[]): ClassificationResult {
  const values = points.map((point) => point.value);
  const trendLine = buildTrendLine(values);
  const detectedPeriod = detectPeriod(values);
  const seasonalPattern = buildSeasonalPattern(values, trendLine, detectedPeriod);
  const seasonal = values.map((_, index) => seasonalPattern[index % detectedPeriod] ?? 0);
  const residual = values.map(
    (value, index) => value - (trendLine[index] ?? value) - (seasonal[index] ?? 0),
  );
  const seriesStd = Math.max(standardDeviation(values), 1e-6);
  const residualStd = standardDeviation(residual);
  const slopeStrength =
    Math.abs((trendLine[trendLine.length - 1] ?? 0) - (trendLine[0] ?? 0)) / seriesStd;
  const seasonalStrength = Math.max(autocorrelation(values, detectedPeriod), 0);
  const cycleWave = movingAverage(residual, Math.max(2, Math.floor(detectedPeriod * 1.5)));
  const cycleStrength =
    countSignChanges(cycleWave) / Math.max(1, Math.floor(values.length / detectedPeriod));
  const randomness = residualStd / seriesStd;

  const confidences = normalizeConfidences({
    trend: Math.max(10, slopeStrength * 35),
    seasonal: Math.max(10, seasonalStrength * 100),
    cyclical: Math.max(8, cycleStrength * 30 + randomness * 20),
    random: Math.max(8, (1 - Math.min(1, seasonalStrength)) * 25 + randomness * 45),
  });

  const primary = confidences[0] ?? { pattern: "random" as PatternType, score: 25 };
  const explanation = `${PATTERN_COPY[primary.pattern]} Residual spread is ${formatPercent(
    randomness * 100,
    1,
  )} of the series deviation, and the strongest repeating lag is ${detectedPeriod} buckets.`;

  return {
    points: points.map((point, index) => ({
      ...point,
      trend: trendLine[index] ?? point.value,
      seasonal: seasonal[index] ?? 0,
      residual: residual[index] ?? 0,
    })),
    detectedPeriod,
    classification: primary.pattern,
    confidence: primary.score,
    confidences,
    explanation,
  };
}

function isRawPointRow(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

async function loadSeries(
  tableName: string,
  dateColumn: string,
  valueColumn: string,
): Promise<RawPoint[]> {
  const rows = await runQuery(`
    WITH parsed AS (
      SELECT
        TRY_CAST(${quoteIdentifier(dateColumn)} AS TIMESTAMP) AS series_ts,
        TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE) AS series_value
      FROM ${quoteIdentifier(tableName)}
    )
    SELECT
      CAST(DATE_TRUNC('day', series_ts) AS DATE) AS bucket_date,
      AVG(series_value) AS bucket_value,
      COUNT(*) AS sample_count
    FROM parsed
    WHERE series_ts IS NOT NULL
      AND series_value IS NOT NULL
    GROUP BY 1
    ORDER BY 1
  `);

  return rows
    .filter(isRawPointRow)
    .map((row) => {
      const dateValue = toDate(row.bucket_date);
      const numericValue = toNumber(row.bucket_value);
      const sampleCount = toNumber(row.sample_count);

      if (!dateValue || numericValue === null || sampleCount === null) {
        return null;
      }

      return {
        isoDate: dateValue.toISOString().slice(0, 10),
        value: numericValue,
        sampleCount: sampleCount,
      } satisfies RawPoint;
    })
    .filter((point): point is RawPoint => point !== null);
}

function buildDecompositionOption(
  result: ClassificationResult | null,
  dark: boolean,
): EChartsOption {
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";
  const points = result?.points ?? [];

  return {
    animationDuration: 420,
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const items = Array.isArray(params)
          ? (params as Array<{
              axisValueLabel?: string;
              seriesName?: string;
              value?: number;
            }>)
          : [
              params as {
                axisValueLabel?: string;
                seriesName?: string;
                value?: number;
              },
            ];

        return items
          .map((item, index) =>
            index === 0
              ? `<strong>${item.axisValueLabel ?? ""}</strong><br/>${item.seriesName ?? "Series"}: ${formatNumber(Number(item.value ?? 0))}`
              : `${item.seriesName ?? "Series"}: ${formatNumber(Number(item.value ?? 0))}`,
          )
          .join("<br/>");
      },
    },
    legend: {
      bottom: 0,
      textStyle: { color: textColor },
    },
    grid: {
      left: 28,
      right: 20,
      top: 24,
      bottom: 58,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: points.map((point) => formatDateLabel(point.isoDate)),
      axisLabel: { color: textColor, rotate: points.length > 12 ? 24 : 0 },
      boundaryGap: false,
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        name: "Observed",
        type: "line",
        smooth: true,
        data: points.map((point) => point.value),
        lineStyle: { color: "#06b6d4", width: 3 },
        areaStyle: { color: "rgba(6, 182, 212, 0.08)" },
        symbol: points.length > 60 ? "none" : "circle",
      },
      {
        name: "Trend",
        type: "line",
        smooth: true,
        data: points.map((point) => point.trend),
        lineStyle: { color: "#22c55e", width: 2, type: "dashed" },
        symbol: "none",
      },
      {
        name: "Seasonal",
        type: "line",
        smooth: true,
        data: points.map((point) => point.seasonal),
        lineStyle: { color: "#8b5cf6", width: 2 },
        symbol: "none",
      },
      {
        name: "Residual",
        type: "line",
        smooth: true,
        data: points.map((point) => point.residual),
        lineStyle: { color: "#f97316", width: 2, type: "dotted" },
        symbol: "none",
      },
    ],
  };
}

function buildConfidenceOption(
  result: ClassificationResult | null,
  dark: boolean,
): EChartsOption {
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";
  const confidences = result?.confidences ?? [];

  return {
    animationDuration: 360,
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const item = params as { name?: string; value?: number };
        return `${item.name ?? "Pattern"}: ${formatPercent(Number(item.value ?? 0), 1)}`;
      },
    },
    grid: {
      left: 18,
      right: 18,
      top: 18,
      bottom: 18,
      containLabel: true,
    },
    xAxis: {
      type: "value",
      max: 100,
      axisLabel: { color: textColor, formatter: "{value}%" },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    yAxis: {
      type: "category",
      data: confidences.map((item) => PATTERN_LABELS[item.pattern]),
      axisLabel: { color: textColor },
    },
    series: [
      {
        type: "bar",
        data: confidences.map((item) => ({
          name: PATTERN_LABELS[item.pattern],
          value: Number(item.score.toFixed(1)),
          itemStyle: {
            color:
              item.pattern === "trend"
                ? "#06b6d4"
                : item.pattern === "seasonal"
                  ? "#8b5cf6"
                  : item.pattern === "cyclical"
                    ? "#22c55e"
                    : "#f97316",
            borderRadius: [0, 12, 12, 0],
          },
        })),
        barWidth: 18,
      },
    ],
  };
}

function MetricCard({ label, value, icon: Icon }: MetricCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
        {value}
      </p>
    </div>
  );
}

export default function TimeSeriesClassifier({
  tableName,
  columns,
}: TimeSeriesClassifierProps) {
  const dark = useDarkMode();
  const dateColumns = useMemo(
    () => columns.filter((column) => column.type === "date"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [selectedDateColumn, setSelectedDateColumn] = useState("");
  const [selectedValueColumn, setSelectedValueColumn] = useState("");
  const [result, setResult] = useState<ClassificationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const activeDateColumn =
    dateColumns.find((column) => column.name === selectedDateColumn)?.name ??
    dateColumns[0]?.name ??
    "";
  const activeValueColumn =
    numericColumns.find((column) => column.name === selectedValueColumn)?.name ??
    numericColumns[0]?.name ??
    "";

  async function handleClassify() {
    if (!activeDateColumn || !activeValueColumn) {
      setStatus("Select both a date column and a numeric value column.");
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      const points = await loadSeries(tableName, activeDateColumn, activeValueColumn);
      if (points.length < 8) {
        setResult(null);
        setStatus("At least 8 daily buckets are required for pattern classification.");
        return;
      }

      const nextResult = classifySeries(points);
      startTransition(() => {
        setResult(nextResult);
      });
      setStatus(
        `${PATTERN_LABELS[nextResult.classification]} detected with ${formatPercent(
          nextResult.confidence,
          1,
        )} confidence.`,
      );
    } catch (error) {
      setResult(null);
      setStatus(
        error instanceof Error
          ? error.message
          : "Time-series classification failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;

    const csv = [
      "iso_date,value,trend,seasonal,residual,classification,confidence",
      ...result.points.map((point) =>
        [
          csvEscape(point.isoDate),
          csvEscape(point.value),
          csvEscape(point.trend),
          csvEscape(point.seasonal),
          csvEscape(point.residual),
          csvEscape(result.classification),
          csvEscape(result.confidence.toFixed(1)),
        ].join(","),
      ),
    ].join("\n");

    downloadFile(
      csv,
      `${tableName}-time-series-classification.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  const decompositionOption = useMemo(
    () => buildDecompositionOption(result, dark),
    [dark, result],
  );
  const confidenceOption = useMemo(
    () => buildConfidenceOption(result, dark),
    [dark, result],
  );

  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Waves className="h-3.5 w-3.5" />
            Time-series classifier
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Classify trend, seasonality, cycles, and residual noise
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Aggregate {tableName} by day, decompose the signal, then compare the
            strength of directional, repeating, cyclical, and random patterns.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleClassify()}
            disabled={loading || !activeDateColumn || !activeValueColumn}
            className={BUTTON_CLASS}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Activity className="h-4 w-4" />
            )}
            Classify pattern
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={!result}
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export analysis CSV
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Date column
          </span>
          <select
            aria-label="Date column"
            value={activeDateColumn}
            onChange={(event) => setSelectedDateColumn(event.target.value)}
            className={FIELD_CLASS}
          >
            {dateColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Value column
          </span>
          <select
            aria-label="Value column"
            value={activeValueColumn}
            onChange={(event) => setSelectedValueColumn(event.target.value)}
            className={FIELD_CLASS}
          >
            {numericColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {status ? (
        <p className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-700 dark:text-cyan-300">
          {status}
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-4">
        <MetricCard
          label="Pattern"
          value={result ? PATTERN_LABELS[result.classification] : "Waiting"}
          icon={Activity}
        />
        <MetricCard
          label="Confidence"
          value={result ? formatPercent(result.confidence, 1) : "0.0%"}
          icon={Sigma}
        />
        <MetricCard
          label="Detected lag"
          value={result ? `${result.detectedPeriod} buckets` : "—"}
          icon={CalendarRange}
        />
        <MetricCard
          label="Buckets"
          value={result ? formatNumber(result.points.length) : "0"}
          icon={Waves}
        />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
          className={`${GLASS_CARD_CLASS} p-4`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-slate-950 dark:text-white">
                Decomposition preview
              </h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Observed values are split into trend, seasonal lift, and residual
                noise.
              </p>
            </div>
            <span className="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 dark:bg-white/10 dark:text-slate-300">
              {result ? PATTERN_LABELS[result.classification] : "No run yet"}
            </span>
          </div>

          <div className="mt-4">
            <ReactEChartsCore
              echarts={echarts}
              option={decompositionOption}
              style={{ height: 340 }}
              notMerge
              lazyUpdate
            />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, ease: ANALYTICS_EASE }}
          className="space-y-4"
        >
          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <h3 className="text-base font-semibold text-slate-950 dark:text-white">
              Classification confidence
            </h3>
            <div className="mt-4">
              <ReactEChartsCore
                echarts={echarts}
                option={confidenceOption}
                style={{ height: 220 }}
                notMerge
                lazyUpdate
              />
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <h3 className="text-base font-semibold text-slate-950 dark:text-white">
              Interpretation
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {result?.explanation ??
                "Run classification to see the strongest signal and the decomposition rationale."}
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
