"use client";

import React, { startTransition, useMemo, useState } from "react";
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
  CalendarDays,
  Download,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { forecast } from "@/lib/api/analytics";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
  quoteIdentifier,
  toCount,
  toIsoDate,
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

interface TimeSeriesForecastProps {
  tableName: string;
  columns: ColumnProfile[];
}

type ForecastMethod = "moving_average" | "exponential_smoothing";

interface TimePoint {
  isoDate: string;
  value: number;
}

interface BackendForecastResult {
  forecast: number[];
  lower_bound: number[];
  upper_bound: number[];
}

interface ForecastPoint {
  isoDate: string;
  forecast: number;
  lower: number;
  upper: number;
}

interface ForecastResult {
  history: TimePoint[];
  fitted: Array<number | null>;
  forecast: ForecastPoint[];
  method: ForecastMethod;
  horizon: number;
  mae: number;
  rmse: number;
  confidenceWidth: number;
}

const METHOD_OPTIONS = [
  { value: "moving_average", label: "Simple moving average" },
  { value: "exponential_smoothing", label: "Exponential smoothing" },
] as const;

function parseIsoDate(isoDate: string) {
  return new Date(`${isoDate}T12:00:00Z`);
}

function formatDateLabel(isoDate: string) {
  return parseIsoDate(isoDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function median(values: number[]) {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 1;
}

function inferStepDays(points: TimePoint[]) {
  if (points.length < 2) return 1;
  const diffs = points
    .slice(1)
    .map((point, index) => {
      const left = parseIsoDate(points[index]?.isoDate ?? point.isoDate).getTime();
      const right = parseIsoDate(point.isoDate).getTime();
      return Math.max(1, Math.round((right - left) / 86_400_000));
    })
    .filter((value) => value > 0);

  return Math.max(1, median(diffs));
}

function addStepDays(isoDate: string, stepDays: number, multiplier: number) {
  const next = parseIsoDate(isoDate);
  next.setUTCDate(next.getUTCDate() + stepDays * multiplier);
  return next.toISOString().slice(0, 10);
}

function buildMovingAverage(values: number[], horizon: number) {
  const windowSize = Math.min(5, Math.max(2, Math.round(values.length / 4)));
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

function computeErrorMetrics(values: number[], fitted: Array<number | null>) {
  const errors = values.flatMap((value, index) => {
    const prediction = fitted[index];
    return typeof prediction === "number" ? [value - prediction] : [];
  });

  if (errors.length === 0) {
    return { mae: 0, rmse: 0, confidenceWidth: 0 };
  }

  const mae = errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length;
  const rmse = Math.sqrt(
    errors.reduce((sum, error) => sum + error * error, 0) / errors.length,
  );

  return {
    mae,
    rmse,
    confidenceWidth: rmse * 1.96,
  };
}

function buildForecast(points: TimePoint[], method: ForecastMethod, horizon: number): ForecastResult {
  const values = points.map((point) => point.value);
  const stepDays = inferStepDays(points);
  const { fitted, forecast } =
    method === "exponential_smoothing"
      ? buildExponentialSmoothing(values, horizon)
      : buildMovingAverage(values, horizon);
  const metrics = computeErrorMetrics(values, fitted);
  const lastDate = points[points.length - 1]?.isoDate ?? new Date().toISOString().slice(0, 10);

  return {
    history: points,
    fitted,
    forecast: forecast.map((value, index) => {
      const spread = metrics.confidenceWidth * Math.sqrt(index + 1);
      return {
        isoDate: addStepDays(lastDate, stepDays, index + 1),
        forecast: value,
        lower: value - spread,
        upper: value + spread,
      };
    }),
    method,
    horizon,
    mae: metrics.mae,
    rmse: metrics.rmse,
    confidenceWidth: metrics.confidenceWidth,
  };
}

function formatMetric(value: number) {
  if (!Number.isFinite(value)) return "0";
  return Math.abs(value) >= 1000 ? formatNumber(value) : value.toFixed(2);
}

function formatForecastTooltip(params: unknown) {
  if (!Array.isArray(params)) return "";

  const lines = params.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const seriesName = typeof entry.seriesName === "string" ? entry.seriesName : "Series";
    const value = Array.isArray(entry.data)
      ? entry.data[1]
      : isRecord(entry.data)
        ? entry.data.value
        : entry.value;
    const numericValue = toNumber(value);
    if (numericValue == null) return [];
    return [`${seriesName}: ${formatMetric(numericValue)}`];
  });

  return lines.join("<br/>");
}

function buildChartOption(result: ForecastResult | null, dark: boolean): EChartsOption {
  const axisColor = dark ? "#94a3b8" : "#64748b";
  const borderColor = dark ? "#1e293b" : "#e2e8f0";

  if (!result) {
    return {
      animationDuration: 300,
      xAxis: { type: "category", data: [] },
      yAxis: { type: "value" },
      series: [],
    };
  }

  const historyLabels = result.history.map((point) => point.isoDate);
  const forecastLabels = result.forecast.map((point) => point.isoDate);
  const labels = [...historyLabels, ...forecastLabels];
  const historyValues = result.history.map((point) => point.value);
  const fittedValues = [...result.fitted, ...new Array(result.forecast.length).fill(null)];
  const forecastValues = [
    ...new Array(Math.max(0, result.history.length - 1)).fill(null),
    result.history[result.history.length - 1]?.value ?? null,
    ...result.forecast.map((point) => point.forecast),
  ];
  const lowerValues = [
    ...new Array(result.history.length).fill(null),
    ...result.forecast.map((point) => point.lower),
  ];
  const bandValues = [
    ...new Array(result.history.length).fill(null),
    ...result.forecast.map((point) => point.upper - point.lower),
  ];

  return {
    animationDuration: 480,
    color: ["#0f766e", "#38bdf8", "#f97316", "#38bdf8", "#38bdf8"],
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => formatForecastTooltip(params),
      backgroundColor: dark ? "#020617f2" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    legend: {
      top: 0,
      textStyle: { color: axisColor },
    },
    grid: { left: 18, right: 20, top: 42, bottom: 28, containLabel: true },
    xAxis: {
      type: "category",
      data: labels.map((label) => formatDateLabel(label)),
      boundaryGap: false,
      axisLabel: { color: axisColor, rotate: labels.length > 10 ? 24 : 0 },
      axisLine: { lineStyle: { color: borderColor } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: axisColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        name: "Historical",
        type: "line",
        data: [...historyValues, ...new Array(result.forecast.length).fill(null)],
        smooth: true,
        lineStyle: { width: 3 },
        symbol: labels.length > 30 ? "none" : "circle",
      },
      {
        name: "Fitted",
        type: "line",
        data: fittedValues,
        smooth: true,
        connectNulls: true,
        symbol: "none",
        lineStyle: { width: 2, type: "dashed" },
      },
      {
        name: "Forecast",
        type: "line",
        data: forecastValues,
        smooth: true,
        connectNulls: true,
        symbol: "circle",
        lineStyle: { width: 3 },
      },
      {
        name: "Lower band",
        type: "line",
        data: lowerValues,
        stack: "confidence-band",
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
      },
      {
        name: "Confidence band",
        type: "line",
        data: bandValues,
        stack: "confidence-band",
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: "rgba(56, 189, 248, 0.18)" },
      },
    ],
  };
}

function buildCsv(result: ForecastResult) {
  const rows = [
    "iso_date,type,actual,fitted,forecast,lower,upper",
    ...result.history.map((point, index) => {
      const fitted = result.fitted[index];
      return [
        point.isoDate,
        "history",
        point.value,
        fitted == null ? "" : fitted.toFixed(4),
        "",
        "",
        "",
      ].join(",");
    }),
    ...result.forecast.map((point) =>
      [
        point.isoDate,
        "forecast",
        "",
        "",
        point.forecast.toFixed(4),
        point.lower.toFixed(4),
        point.upper.toFixed(4),
      ].join(","),
    ),
  ];

  return rows.join("\n");
}

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Activity;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
        {value}
      </div>
    </div>
  );
}

function ForecastTable({ result }: { result: ForecastResult }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/20">
      <table className="min-w-full text-left text-sm text-slate-700 dark:text-slate-200">
        <thead className="bg-slate-950/5 text-xs uppercase tracking-[0.16em] text-slate-500 dark:bg-white/5 dark:text-slate-400">
          <tr>
            <th className="px-4 py-3">Period</th>
            <th className="px-4 py-3">Forecast</th>
            <th className="px-4 py-3">Lower</th>
            <th className="px-4 py-3">Upper</th>
          </tr>
        </thead>
        <tbody>
          {result.forecast.map((point) => (
            <tr key={point.isoDate} className="border-t border-white/15">
              <td className="px-4 py-3">{formatDateLabel(point.isoDate)}</td>
              <td className="px-4 py-3">{formatMetric(point.forecast)}</td>
              <td className="px-4 py-3">{formatMetric(point.lower)}</td>
              <td className="px-4 py-3">{formatMetric(point.upper)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TimeSeriesForecast({
  tableName,
  columns,
}: TimeSeriesForecastProps): React.ReactNode {
  const dark = useDarkMode();
  const dateColumns = useMemo(
    () => columns.filter((column) => column.type === "date"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [dateColumnName, setDateColumnName] = useState("");
  const [valueColumnName, setValueColumnName] = useState("");
  const [method, setMethod] = useState<ForecastMethod>("moving_average");
  const [horizon, setHorizon] = useState(6);
  const [result, setResult] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useBackend, setUseBackend] = useState(true);
  const [backendFailed, setBackendFailed] = useState(false);

  const activeDateColumn =
    dateColumns.find((column) => column.name === dateColumnName)?.name ??
    dateColumns[0]?.name ??
    "";
  const activeValueColumn =
    numericColumns.find((column) => column.name === valueColumnName)?.name ??
    numericColumns[0]?.name ??
    "";

  async function handleForecast() {
    if (!activeDateColumn || !activeValueColumn) {
      setResult(null);
      setError("Choose a date column and numeric column to build a forecast.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(`
        WITH parsed AS (
          SELECT
            TRY_CAST(${quoteIdentifier(activeDateColumn)} AS TIMESTAMP) AS ts,
            TRY_CAST(${quoteIdentifier(activeValueColumn)} AS DOUBLE) AS metric_value
          FROM ${quoteIdentifier(tableName)}
        )
        SELECT
          CAST(DATE_TRUNC('day', ts) AS DATE) AS bucket_date,
          AVG(metric_value) AS metric_value
        FROM parsed
        WHERE ts IS NOT NULL AND metric_value IS NOT NULL
        GROUP BY 1
        ORDER BY 1
      `);

      const timeSeriesData = rows.flatMap<TimePoint>((row) => {
        const isoDate = toIsoDate(row.bucket_date);
        const value = toNumber(row.metric_value);
        if (!isoDate || value == null) return [];
        return [{ isoDate, value }];
      });

      if (timeSeriesData.length < 4) {
        setResult(null);
        setError("At least 4 time buckets are required to forecast future periods.");
        return;
      }

      const forecastPeriods = Math.max(1, horizon);
      const shouldUseBackend = useBackend && !backendFailed;

      if (shouldUseBackend) {
        try {
          const recordData = timeSeriesData.map((d) => ({
            [activeDateColumn]: d.isoDate,
            [activeValueColumn]: d.value,
          }));
          const result = await forecast(recordData, activeDateColumn, activeValueColumn, forecastPeriods);
          const backendForecast = result.predictions.map((p) => ({
            isoDate: p.date,
            forecast: p.value,
            lower: p.value * 0.9,
            upper: p.value * 1.1,
          }));

          setResult({
            history: timeSeriesData,
            fitted: new Array(timeSeriesData.length).fill(null) as null[],
            forecast: backendForecast,
            method,
            horizon: forecastPeriods,
            mae: 0,
            rmse: 0,
            confidenceWidth: 0,
          });
          return;
        } catch {
          startTransition(() => {
            setBackendFailed(true);
          });
        }
      }

      setResult(buildForecast(timeSeriesData, method, forecastPeriods));
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : "Forecasting failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;
    downloadFile(
      buildCsv(result),
      `${tableName}-${activeValueColumn}-forecast.csv`,
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
            <TrendingUp className="h-4 w-4" />
            Time Series Forecast
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            Project future periods from historical trends
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
            Select a date column and metric, then forecast future buckets with
            moving averages or exponential smoothing.
          </p>
        </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setUseBackend((previous) => !previous)}
              className={`${BUTTON_CLASS} px-3 text-xs ${
                useBackend ? "border-cyan-500/60 text-cyan-600 dark:text-cyan-300" : "opacity-70"
              }`}
              title="Toggle backend forecasting"
            >
              Backend: {useBackend ? "On" : "Off"}
            </button>
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
        </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_140px_auto]">
        <label className="text-sm text-slate-600 dark:text-slate-300">
          <span className="mb-2 block">Date column</span>
          <select
            aria-label="Date column"
            value={activeDateColumn}
            onChange={(event) => setDateColumnName(event.target.value)}
            className={FIELD_CLASS}
          >
            {dateColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-600 dark:text-slate-300">
          <span className="mb-2 block">Value column</span>
          <select
            aria-label="Value column"
            value={activeValueColumn}
            onChange={(event) => setValueColumnName(event.target.value)}
            className={FIELD_CLASS}
          >
            {numericColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-600 dark:text-slate-300">
          <span className="mb-2 block">Method</span>
          <select
            aria-label="Forecast method"
            value={method}
            onChange={(event) => setMethod(event.target.value as ForecastMethod)}
            className={FIELD_CLASS}
          >
            {METHOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-600 dark:text-slate-300">
          <span className="mb-2 block">Horizon</span>
          <input
            aria-label="Forecast horizon"
            type="number"
            min={1}
            max={24}
            value={horizon}
            onChange={(event) => setHorizon(toCount(event.target.value) || 1)}
            className={FIELD_CLASS}
          />
        </label>
        <button
          type="button"
          onClick={handleForecast}
          disabled={loading || !activeDateColumn || !activeValueColumn}
          className={`${BUTTON_CLASS} self-end`}
        >
          <Sparkles className="h-4 w-4" />
          {loading ? "Forecasting…" : "Generate forecast"}
        </button>
      </div>

      {!dateColumns.length || !numericColumns.length ? (
        <div className="mt-6 rounded-3xl border border-dashed border-white/25 px-4 py-6 text-sm text-slate-600 dark:text-slate-300">
          Choose a date column and numeric column to build a forecast.
        </div>
      ) : null}

      {error ? (
        <div className="mt-6 rounded-3xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="History points"
          value={result ? formatNumber(result.history.length) : "—"}
          icon={CalendarDays}
        />
        <SummaryCard
          label="Forecast horizon"
          value={result ? `${result.horizon} periods` : "—"}
          icon={TrendingUp}
        />
        <SummaryCard
          label="MAE"
          value={result ? formatMetric(result.mae) : "—"}
          icon={Activity}
        />
        <SummaryCard
          label="RMSE"
          value={result ? formatMetric(result.rmse) : "—"}
          icon={Sparkles}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <ReactEChartsCore
            echarts={echarts}
            option={buildChartOption(result, dark)}
            style={{ height: 360 }}
          />
        </div>
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Forecast preview
          </h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {result
              ? `Projected ${result.forecast.length} future periods using ${METHOD_OPTIONS.find((option) => option.value === result.method)?.label.toLowerCase()}.`
              : "Run the forecast to inspect projected values and confidence bands."}
          </p>
          {result ? <div className="mt-4"><ForecastTable result={result} /></div> : null}
        </div>
      </div>
    </motion.section>
  );
}
