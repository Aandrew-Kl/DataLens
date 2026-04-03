"use client";

import { startTransition, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Download, Loader2, TrendingDown, TrendingUp, Waves } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toDate,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface TrendAnalyzerProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface TrendPoint {
  isoDate: string;
  value: number;
  movingAverage: number;
  trendLine: number;
  seasonalIndex: number;
}

interface ChangePoint {
  isoDate: string;
  magnitude: number;
}

interface TrendResult {
  points: TrendPoint[];
  trendDirection: "up" | "down" | "stable";
  seasonalStrength: number;
  period: number;
  changePoints: ChangePoint[];
}

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

function movingAverage(values: number[], windowSize: number) {
  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const slice = values.slice(start, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

function buildTrendLine(values: number[]) {
  if (values.length < 2) return values;
  const meanX = (values.length - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / values.length;
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

function autocorrelation(values: number[], lag: number) {
  if (lag <= 0 || lag >= values.length) return 0;

  const left = values.slice(0, values.length - lag);
  const right = values.slice(lag);
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / Math.max(left.length, 1);
  const meanRight = right.reduce((sum, value) => sum + value, 0) / Math.max(right.length, 1);
  let numerator = 0;
  let leftDenominator = 0;
  let rightDenominator = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - meanLeft;
    const rightDelta = right[index] - meanRight;
    numerator += leftDelta * rightDelta;
    leftDenominator += leftDelta * leftDelta;
    rightDenominator += rightDelta * rightDelta;
  }

  const denominator = Math.sqrt(leftDenominator * rightDenominator);
  return denominator === 0 ? 0 : numerator / denominator;
}

function detectSeasonalPeriod(values: number[]) {
  if (values.length < 6) return 2;
  const maxLag = Math.min(24, Math.floor(values.length / 2));
  let bestLag = 2;
  let bestScore = 0;

  for (let lag = 2; lag <= maxLag; lag += 1) {
    const score = autocorrelation(values, lag);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  return bestLag;
}

function buildSeasonalIndices(values: number[], trend: number[], period: number) {
  const buckets = Array.from({ length: period }, () => [] as number[]);

  values.forEach((value, index) => {
    buckets[index % period].push(value - (trend[index] ?? value));
  });

  return buckets.map((bucket) =>
    bucket.length === 0
      ? 0
      : bucket.reduce((sum, value) => sum + value, 0) / bucket.length,
  );
}

function detectChangePoints(values: number[], windowSize: number, labels: string[]) {
  const scores = values.flatMap<ChangePoint>((_, index) => {
    if (index < windowSize || index >= values.length - windowSize) return [];

    const left = values.slice(index - windowSize, index);
    const right = values.slice(index, index + windowSize);
    const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
    const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
    const magnitude = Math.abs(rightMean - leftMean);

    return [
      {
        isoDate: labels[index] ?? labels[0] ?? "",
        magnitude,
      },
    ];
  });

  return scores
    .sort((left, right) => right.magnitude - left.magnitude)
    .slice(0, 3);
}

function buildTrendOption(result: TrendResult | null, dark: boolean): EChartsOption {
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";
  const points = result?.points ?? [];

  return {
    animationDuration: 420,
    legend: {
      bottom: 0,
      textStyle: { color: textColor },
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const list = Array.isArray(params)
          ? (params as Array<{ axisValueLabel?: string; seriesName?: string; value?: number }>)
          : [params as { axisValueLabel?: string; seriesName?: string; value?: number }];
        const lines = [`<strong>${list[0]?.axisValueLabel ?? ""}</strong>`];
        for (const item of list) {
          lines.push(
            `${item.seriesName ?? "Series"}: ${formatNumber(Number(item.value ?? 0))}`,
          );
        }
        return lines.join("<br/>");
      },
    },
    grid: {
      left: 32,
      right: 24,
      top: 24,
      bottom: 56,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: points.map((point) => formatDateLabel(point.isoDate)),
      boundaryGap: false,
      axisLabel: { color: textColor, rotate: points.length > 14 ? 24 : 0 },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        name: "Metric",
        type: "line",
        smooth: true,
        data: points.map((point) => point.value),
        symbol: points.length > 60 ? "none" : "circle",
        lineStyle: { color: "#06b6d4", width: 3 },
        areaStyle: { color: "rgba(6, 182, 212, 0.08)" },
        markPoint: {
          symbolSize: 40,
          data: (result?.changePoints ?? []).map((changePoint) => ({
            name: "Change",
            xAxis: formatDateLabel(changePoint.isoDate),
            yAxis:
              points.find((point) => point.isoDate === changePoint.isoDate)?.value ?? 0,
          })),
        },
      },
      {
        name: "Moving average",
        type: "line",
        smooth: true,
        data: points.map((point) => point.movingAverage),
        symbol: "none",
        lineStyle: { color: "#8b5cf6", width: 2, type: "dashed" },
      },
      {
        name: "Trend line",
        type: "line",
        smooth: true,
        data: points.map((point) => point.trendLine),
        symbol: "none",
        lineStyle: { color: "#22c55e", width: 2, type: "dotted" },
      },
    ],
  };
}

async function loadTrendResult(
  tableName: string,
  dateColumn: string,
  metricColumn: string,
): Promise<TrendResult> {
  const rows = await runQuery(`
    WITH parsed AS (
      SELECT
        TRY_CAST(${quoteIdentifier(dateColumn)} AS TIMESTAMP) AS ts_value,
        TRY_CAST(${quoteIdentifier(metricColumn)} AS DOUBLE) AS metric_value
      FROM ${quoteIdentifier(tableName)}
    )
    SELECT
      CAST(DATE_TRUNC('day', ts_value) AS DATE) AS bucket_date,
      AVG(metric_value) AS metric_avg
    FROM parsed
    WHERE ts_value IS NOT NULL
      AND metric_value IS NOT NULL
    GROUP BY 1
    ORDER BY 1
  `);

  const normalized = rows.flatMap<{ isoDate: string; value: number }>((row) => {
    const date = toDate(row.bucket_date);
    const value = toNumber(row.metric_avg);
    if (!date || value === null) return [];
    return [
      {
        isoDate: date.toISOString().slice(0, 10),
        value,
      },
    ];
  });

  if (normalized.length < 8) {
    throw new Error("At least 8 daily buckets are required for trend analysis.");
  }

  const values = normalized.map((point) => point.value);
  const moving = movingAverage(values, Math.min(7, values.length));
  const trendLine = buildTrendLine(values);
  const period = detectSeasonalPeriod(values);
  const seasonalPattern = buildSeasonalIndices(values, trendLine, period);
  const seasonalStrength =
    seasonalPattern.reduce((sum, value) => sum + Math.abs(value), 0) /
    Math.max(seasonalPattern.length, 1);
  const slope = trendLine[trendLine.length - 1] - trendLine[0];
  const trendDirection =
    Math.abs(slope) < Math.max(Math.abs(values[0] ?? 0), 1) * 0.05
      ? "stable"
      : slope > 0
        ? "up"
        : "down";
  const changePoints = detectChangePoints(
    values,
    Math.max(2, Math.floor(period / 2)),
    normalized.map((point) => point.isoDate),
  );

  return {
    points: normalized.map((point, index) => ({
      isoDate: point.isoDate,
      value: point.value,
      movingAverage: moving[index] ?? point.value,
      trendLine: trendLine[index] ?? point.value,
      seasonalIndex: seasonalPattern[index % period] ?? 0,
    })),
    trendDirection,
    seasonalStrength,
    period,
    changePoints,
  };
}

export default function TrendAnalyzer({
  tableName,
  columns,
}: TrendAnalyzerProps) {
  const dark = useDarkMode();
  const dateColumns = useMemo(
    () => columns.filter((column) => column.type === "date"),
    [columns],
  );
  const metricColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const defaultDate = dateColumns[0]?.name ?? "";
  const defaultMetric = metricColumns[0]?.name ?? "";
  const [dateColumn, setDateColumn] = useState(defaultDate);
  const [metricColumn, setMetricColumn] = useState(defaultMetric);
  const activeDateColumn = dateColumns.some((column) => column.name === dateColumn)
    ? dateColumn
    : defaultDate;
  const activeMetricColumn = metricColumns.some((column) => column.name === metricColumn)
    ? metricColumn
    : defaultMetric;
  const [result, setResult] = useState<TrendResult | null>(null);
  const [status, setStatus] = useState(
    "Choose a date field and a numeric metric, then detect movement patterns.",
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const chartOption = useMemo(
    () => buildTrendOption(result, dark),
    [dark, result],
  );

  async function handleAnalyze() {
    if (!activeDateColumn || !activeMetricColumn) {
      setError("Choose both a date column and a numeric metric column.");
      return;
    }

    setLoading(true);
    setError(null);
    setStatus("Aggregating a daily series and scoring trend, seasonality, and change points.");

    try {
      const nextResult = await loadTrendResult(
        tableName,
        activeDateColumn,
        activeMetricColumn,
      );
      startTransition(() => {
        setResult(nextResult);
        setStatus(
          `Detected a ${nextResult.trendDirection} trend with ${nextResult.changePoints.length} highlighted change point${nextResult.changePoints.length === 1 ? "" : "s"}.`,
        );
      });
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Trend analysis failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;
    const lines = [
      "iso_date,metric_value,moving_average,trend_line,seasonal_index",
      ...result.points.map(
        (point) =>
          [
            csvEscape(point.isoDate),
            point.value,
            point.movingAverage,
            point.trendLine,
            point.seasonalIndex,
          ].join(","),
      ),
    ];

    downloadFile(
      lines.join("\n"),
      `${tableName}-trend-analysis.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Waves className="h-3.5 w-3.5" />
            Trend analyzer
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Detect momentum, seasonality, and change points in a time series
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            The analyzer aggregates a daily series from DuckDB, overlays a moving average, estimates
            a seasonal pattern, and highlights the strongest structural changes.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Trend direction
            </p>
            <p className="mt-2 flex items-center gap-2 text-2xl font-semibold text-slate-950 dark:text-white">
              {result?.trendDirection === "down" ? (
                <TrendingDown className="h-5 w-5 text-rose-500" />
              ) : (
                <TrendingUp className="h-5 w-5 text-emerald-500" />
              )}
              {result?.trendDirection ?? "—"}
            </p>
          </div>
          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Seasonality strength
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
              {result ? formatNumber(result.seasonalStrength) : "—"}
            </p>
          </div>
          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Detected period
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
              {result ? `${result.period} buckets` : "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Date column
            </span>
            <select
              value={activeDateColumn}
              onChange={(event) => setDateColumn(event.target.value)}
              className={FIELD_CLASS}
            >
              {dateColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-4 block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Metric column
            </span>
            <select
              value={activeMetricColumn}
              onChange={(event) => setMetricColumn(event.target.value)}
              className={FIELD_CLASS}
            >
              {metricColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={handleAnalyze} disabled={loading} className={BUTTON_CLASS}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
              Analyze trends
            </button>
            <button type="button" onClick={handleExport} disabled={!result} className={BUTTON_CLASS}>
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>

          <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{status}</p>
          {error ? (
            <p className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </p>
          ) : null}

          <div className="mt-5">
            <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
              Seasonal decomposition preview
            </div>
            <div className="space-y-3">
              {(result?.changePoints ?? []).map((changePoint) => (
                <div
                  key={changePoint.isoDate}
                  className="rounded-[1.15rem] border border-white/15 bg-white/55 px-4 py-3 text-sm dark:bg-slate-950/35"
                >
                  <div className="font-medium text-slate-900 dark:text-white">
                    {changePoint.isoDate}
                  </div>
                  <div className="mt-1 text-slate-600 dark:text-slate-300">
                    Change magnitude: {formatNumber(changePoint.magnitude)}
                  </div>
                </div>
              ))}
              {result?.changePoints.length === 0 ? (
                <div className="rounded-[1.15rem] border border-white/15 bg-white/55 px-4 py-3 text-sm text-slate-600 dark:bg-slate-950/35 dark:text-slate-300">
                  No change points highlighted yet.
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
          className={`${GLASS_CARD_CLASS} p-5`}
        >
          <div className="mb-4 text-sm font-semibold text-slate-900 dark:text-white">
            Metric series with moving average
          </div>
          <ReactEChartsCore
            echarts={echarts}
            option={chartOption}
            notMerge
            lazyUpdate
            style={{ height: 400 }}
          />
        </motion.div>
      </div>
    </section>
  );
}
