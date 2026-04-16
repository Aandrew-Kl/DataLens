"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import {
  Suspense,
  startTransition,
  use,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
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
import {
  Activity,
  CalendarRange,
  Download,
  Gauge,
  LineChart as LineChartIcon,
  Loader2,
  Sigma,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface DataForecastProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface TimePoint {
  isoDate: string;
  value: number;
}

type ForecastMethod = "moving_average" | "exp_smoothing" | "linear";
type SeriesFrequency = "daily" | "weekly" | "monthly";

interface ForecastSeries {
  actual: TimePoint[];
  fitted: Array<number | null>;
  forecast: Array<{ isoDate: string; value: number; lower: number; upper: number }>;
  mae: number;
  rmse: number;
  mape: number;
  frequency: SeriesFrequency;
  residualStd: number;
}

interface ForecastResult {
  series: ForecastSeries | null;
  error: string | null;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100";

function subscribeDarkMode(listener: () => void) {
  if (typeof document === "undefined") return () => undefined;
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getDarkModeSnapshot() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

function useDarkMode() {
  return useSyncExternalStore(subscribeDarkMode, getDarkModeSnapshot, () => false);
}
function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1, 12));
}

function formatDate(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(parseDate(isoDate));
}

function detectFrequency(points: TimePoint[]): SeriesFrequency {
  if (points.length < 3) return "daily";
  const diffs = points
    .slice(1)
    .map((point, index) => {
      const left = parseDate(points[index]?.isoDate ?? points[0].isoDate).getTime();
      const right = parseDate(point.isoDate).getTime();
      return Math.round((right - left) / 86_400_000);
    })
    .filter((diff) => diff > 0)
    .sort((left, right) => left - right);
  const median = diffs[Math.floor(diffs.length / 2)] ?? 1;
  return median >= 26 ? "monthly" : median >= 6 ? "weekly" : "daily";
}

function addPeriod(isoDate: string, frequency: SeriesFrequency, step: number) {
  const base = parseDate(isoDate);
  if (frequency === "daily") {
    base.setUTCDate(base.getUTCDate() + step);
  } else if (frequency === "weekly") {
    base.setUTCDate(base.getUTCDate() + step * 7);
  } else {
    base.setUTCMonth(base.getUTCMonth() + step);
  }
  return base.toISOString().slice(0, 10);
}

function roundMetric(value: number) {
  return Math.abs(value) >= 1000 ? formatNumber(value) : value.toFixed(2);
}

function computeMetrics(actual: number[], predicted: Array<number | null>) {
  const pairs = actual.flatMap((value, index) => {
    const estimate = predicted[index];
    return typeof estimate === "number" ? [{ actual: value, predicted: estimate }] : [];
  });

  if (pairs.length === 0) {
    return { mae: 0, rmse: 0, mape: 0, residualStd: 0 };
  }

  const mae =
    pairs.reduce((sum, pair) => sum + Math.abs(pair.actual - pair.predicted), 0) /
    pairs.length;
  const rmse = Math.sqrt(
    pairs.reduce((sum, pair) => sum + (pair.actual - pair.predicted) ** 2, 0) /
      pairs.length,
  );
  const mape =
    pairs.reduce((sum, pair) => {
      if (pair.actual === 0) return sum;
      return sum + Math.abs((pair.actual - pair.predicted) / pair.actual);
    }, 0) /
    pairs.length *
    100;

  return {
    mae,
    rmse,
    mape,
    residualStd: rmse,
  };
}

function buildMovingAverage(values: number[], horizon: number) {
  const windowSize = Math.min(5, Math.max(2, Math.floor(values.length / 4) || 2));
  const fitted = values.map((_, index) => {
    if (index === 0) return null;
    const slice = values.slice(Math.max(0, index - windowSize), index);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });

  const working = [...values];
  const forecast: number[] = [];
  for (let index = 0; index < horizon; index += 1) {
    const slice = working.slice(Math.max(0, working.length - windowSize));
    const nextValue = slice.reduce((sum, value) => sum + value, 0) / slice.length;
    forecast.push(nextValue);
    working.push(nextValue);
  }

  return { fitted, forecast };
}

function buildExponentialSmoothing(values: number[], horizon: number) {
  const alpha = 0.35;
  let level = values[0] ?? 0;
  const fitted = values.map((value, index) => {
    if (index === 0) {
      level = value;
      return null;
    }
    const prediction = level;
    level = alpha * value + (1 - alpha) * level;
    return prediction;
  });
  return {
    fitted,
    forecast: new Array(horizon).fill(level),
  };
}

function buildLinearProjection(values: number[], horizon: number) {
  if (values.length === 0) {
    return { fitted: [], forecast: [] };
  }

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
  return {
    fitted: values.map((_, index) => intercept + slope * index),
    forecast: new Array(horizon)
      .fill(null)
      .map((_, index) => intercept + slope * (values.length + index)),
  };
}

function buildForecastSeries(
  points: TimePoint[],
  method: ForecastMethod,
  horizon: number,
): ForecastSeries {
  const values = points.map((point) => point.value);
  const frequency = detectFrequency(points);
  const builder =
    method === "exp_smoothing"
      ? buildExponentialSmoothing
      : method === "linear"
        ? buildLinearProjection
        : buildMovingAverage;
  const { fitted, forecast } = builder(values, horizon);
  const metrics = computeMetrics(values, fitted);
  const lastDate = points[points.length - 1]?.isoDate ?? new Date().toISOString().slice(0, 10);

  return {
    actual: points,
    fitted,
    forecast: forecast.map((value, index) => {
      const spread = metrics.residualStd * 1.96 * Math.sqrt(index + 1);
      return {
        isoDate: addPeriod(lastDate, frequency, index + 1),
        value,
        lower: value - spread,
        upper: value + spread,
      };
    }),
    mae: metrics.mae,
    rmse: metrics.rmse,
    mape: metrics.mape,
    frequency,
    residualStd: metrics.residualStd,
  };
}

async function loadForecastData(
  tableName: string,
  dateColumn: string,
  valueColumn: string,
  method: ForecastMethod,
  horizon: number,
): Promise<ForecastResult> {
  if (!dateColumn || !valueColumn) {
    return { series: null, error: "Choose a date column and a numeric value column." };
  }

  const rows = await runQuery(`
    WITH parsed AS (
      SELECT
        TRY_CAST(${quoteIdentifier(dateColumn)} AS TIMESTAMP) AS ts,
        TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE) AS metric_value
      FROM ${quoteIdentifier(tableName)}
    ),
    grouped AS (
      SELECT
        CAST(DATE_TRUNC('day', ts) AS DATE) AS bucket_date,
        AVG(metric_value) AS bucket_value
      FROM parsed
      WHERE ts IS NOT NULL
        AND metric_value IS NOT NULL
      GROUP BY 1
    )
    SELECT bucket_date, bucket_value
    FROM grouped
    ORDER BY bucket_date
  `);

  const points = rows.flatMap<TimePoint>((row) => {
    const value = toNumber(row.bucket_value);
    const isoDate = String(row.bucket_date ?? "");
    if (!isoDate || value == null) return [];
    return [{ isoDate, value }];
  });

  if (points.length < 3) {
    return {
      series: null,
      error: "Forecasting needs at least three non-null time periods.",
    };
  }

  return {
    series: buildForecastSeries(points, method, horizon),
    error: null,
  };
}

function buildForecastOption(series: ForecastSeries, dark: boolean): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const historyLabels = series.actual.map((point) => formatDate(point.isoDate));
  const futureLabels = series.forecast.map((point) => formatDate(point.isoDate));
  const labels = [...historyLabels, ...futureLabels];
  const actualValues = [...series.actual.map((point) => point.value), ...new Array(series.forecast.length).fill(null)];
  const fittedValues = [...series.fitted, ...new Array(series.forecast.length).fill(null)];
  const forecastValues = [
    ...new Array(Math.max(series.actual.length - 1, 0)).fill(null),
    series.actual[series.actual.length - 1]?.value ?? null,
    ...series.forecast.map((point) => point.value),
  ];
  const lowerValues = [
    ...new Array(series.actual.length).fill(null),
    ...series.forecast.map((point) => point.lower),
  ];
  const bandValues = [
    ...new Array(series.actual.length).fill(null),
    ...series.forecast.map((point) => point.upper - point.lower),
  ];

  return {
    animationDuration: 560,
    color: ["#38bdf8", "#94a3b8", "#f59e0b", "#22c55e"],
    legend: {
      top: 0,
      textStyle: { color: textColor },
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    grid: {
      left: 40,
      right: 24,
      top: 44,
      bottom: 32,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: {
        color: textColor,
        rotate: labels.length > 12 ? 28 : 0,
      },
      axisLine: {
        lineStyle: { color: borderColor },
      },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: {
        lineStyle: {
          color: borderColor,
          type: "dashed",
        },
      },
    },
    series: [
      {
        name: "Actual",
        type: "line",
        smooth: true,
        data: actualValues,
        symbol: labels.length > 40 ? "none" : "circle",
        lineStyle: { width: 3 },
      },
      {
        name: "Fitted",
        type: "line",
        smooth: true,
        data: fittedValues,
        symbol: "none",
        lineStyle: {
          width: 2,
          type: "dashed",
        },
      },
      {
        name: "Lower bound",
        type: "line",
        stack: "confidence",
        data: lowerValues,
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
      },
      {
        name: "Confidence band",
        type: "line",
        stack: "confidence",
        data: bandValues,
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: {
          color: "rgba(34,197,94,0.18)",
        },
      },
      {
        name: "Forecast",
        type: "line",
        smooth: true,
        data: forecastValues,
        symbol: "circle",
        lineStyle: { width: 3 },
      },
    ],
  };
}

function ForecastLoading() {
  return (
    <div className={`${PANEL_CLASS} flex min-h-[28rem] items-center justify-center`}>
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        Building forecast…
      </div>
    </div>
  );
}

function ForecastReady({ tableName, columns }: DataForecastProps) {
  const dark = useDarkMode();
  const dateColumns = useMemo(
    () => columns.filter((column) => column.type === "date"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [dateColumn, setDateColumn] = useState(dateColumns[0]?.name ?? "");
  const [valueColumn, setValueColumn] = useState(numericColumns[0]?.name ?? "");
  const [method, setMethod] = useState<ForecastMethod>("moving_average");
  const [horizon, setHorizon] = useState(12);

  const safeDate = dateColumns.some((column) => column.name === dateColumn)
    ? dateColumn
    : dateColumns[0]?.name ?? "";
  const safeValue = numericColumns.some((column) => column.name === valueColumn)
    ? valueColumn
    : numericColumns[0]?.name ?? "";

  const resultPromise = useMemo(
    () =>
      loadForecastData(tableName, safeDate, safeValue, method, horizon).catch((error) => ({
        series: null,
        error:
          error instanceof Error
            ? error.message
            : "Unable to compute the forecast.",
      })),
    [horizon, method, safeDate, safeValue, tableName],
  );

  const result = use(resultPromise);
  const option = useMemo(
    () => (result.series ? buildForecastOption(result.series, dark) : null),
    [dark, result.series],
  );

  function handleExport() {
    if (!result.series) return;
    const headers = ["date", "actual", "fitted", "forecast", "lower", "upper"];
    const rows = [
      ...result.series.actual.map((point, index) => [
        point.isoDate,
        point.value,
        result.series?.fitted[index] ?? "",
        "",
        "",
        "",
      ]),
      ...result.series.forecast.map((point) => [
        point.isoDate,
        "",
        "",
        point.value,
        point.lower,
        point.upper,
      ]),
    ];
    const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    downloadFile(csv, `${tableName}-forecast.csv`, "text/csv;charset=utf-8;");
  }

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: EASE }}
        className={`${PANEL_CLASS} p-5`}
      >
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
                <LineChartIcon className="h-3.5 w-3.5" />
                Time series forecasting
              </div>
              <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                Compare fitted history against future projections
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                The chart renders historical actuals, a fitted baseline, forecast horizon, and a 95% confidence band.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Date column
                </span>
                <select
                  value={safeDate}
                  onChange={(event) =>
                    startTransition(() => setDateColumn(event.target.value))
                  }
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
                  value={safeValue}
                  onChange={(event) =>
                    startTransition(() => setValueColumn(event.target.value))
                  }
                  className={FIELD_CLASS}
                >
                  {numericColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Forecast method
                </span>
                <select
                  value={method}
                  onChange={(event) =>
                    startTransition(() =>
                      setMethod(
                        event.target.value === "exp_smoothing"
                          ? "exp_smoothing"
                          : event.target.value === "linear"
                            ? "linear"
                            : "moving_average",
                      ),
                    )
                  }
                  className={FIELD_CLASS}
                >
                  <option value="moving_average">Simple moving average</option>
                  <option value="exp_smoothing">Exponential smoothing</option>
                  <option value="linear">Linear extrapolation</option>
                </select>
              </label>
            </div>

            <label className="block rounded-2xl border border-white/15 bg-white/45 px-4 py-4 dark:bg-slate-950/35">
              <span className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <span>Forecast horizon</span>
                <span>{horizon} periods</span>
              </span>
              <input
                type="range"
                min={1}
                max={30}
                value={horizon}
                onChange={(event) =>
                  startTransition(() => setHorizon(Number(event.target.value)))
                }
                className="mt-3 h-2 w-full accent-cyan-500"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <CalendarRange className="h-3.5 w-3.5" />
                Horizon
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
                {horizon}
              </div>
            </div>
            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <Activity className="h-3.5 w-3.5" />
                Method
              </div>
              <div className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">
                {method === "exp_smoothing"
                  ? "Exponential smoothing"
                  : method === "linear"
                    ? "Linear extrapolation"
                    : "Moving average"}
              </div>
            </div>

            {result.series ? (
              <>
                <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    <Gauge className="h-3.5 w-3.5" />
                    MAE
                  </div>
                  <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
                    {roundMetric(result.series.mae)}
                  </div>
                </div>
                <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    <Sigma className="h-3.5 w-3.5" />
                    RMSE / MAPE
                  </div>
                  <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
                    {roundMetric(result.series.rmse)} / {result.series.mape.toFixed(1)}%
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className={`${PANEL_CLASS} p-5`}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Forecast view
            </div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Export the computed forecast series with lower and upper confidence bounds.
            </div>
          </div>
          <button
            type="button"
            onClick={handleExport}
            className="rounded-2xl border border-white/20 bg-white/55 px-3 py-2 text-sm text-slate-600 transition hover:border-cyan-300/40 dark:bg-slate-950/35 dark:text-slate-200"
          >
            <span className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Export forecast
            </span>
          </button>
        </div>

        {result.error || !option ? (
          <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 px-4 py-5 text-sm text-rose-700 dark:text-rose-300">
            {result.error ?? "No forecast available."}
          </div>
        ) : (
          <ReactEChartsCore
            echarts={echarts}
            option={option}
            notMerge
            lazyUpdate
            style={{ height: 540 }}
          />
        )}
      </motion.section>
    </div>
  );
}

export default function DataForecast({ tableName, columns }: DataForecastProps) {
  return (
    <Suspense fallback={<ForecastLoading />}>
      <ForecastReady tableName={tableName} columns={columns} />
    </Suspense>
  );
}
