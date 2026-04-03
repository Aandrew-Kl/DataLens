"use client";

import { useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { CalendarRange, Download, Gauge, Waves } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toDate,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import { standardDeviation, variance } from "@/lib/utils/statistics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface SeasonalDecompositionProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface DecompositionPoint {
  dateLabel: string;
  original: number;
  trend: number;
  seasonal: number;
  residual: number;
}

interface DecompositionResult {
  points: DecompositionPoint[];
  period: number;
  trendStrength: number;
  seasonalStrength: number;
  residualSpread: number;
}

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv(points: DecompositionPoint[]): string {
  const header = "date,original,trend,seasonal,residual";
  const body = points.map((point) =>
    [point.dateLabel, point.original, point.trend, point.seasonal, point.residual]
      .map(escapeCsv)
      .join(","),
  );
  return [header, ...body].join("\n");
}

function autocorrelation(values: number[], lag: number): number {
  if (lag <= 0 || lag >= values.length) {
    return 0;
  }

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

function detectPeriod(values: number[]): number {
  const maxLag = Math.min(24, Math.max(2, Math.floor(values.length / 2)));
  let bestLag = 2;
  let bestScore = -1;

  for (let lag = 2; lag <= maxLag; lag += 1) {
    const score = autocorrelation(values, lag);
    if (score > bestScore) {
      bestLag = lag;
      bestScore = score;
    }
  }

  return bestLag;
}

function movingAverage(values: number[], period: number): number[] {
  const radius = Math.max(1, Math.floor(period / 2));
  return values.map((_, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    const slice = values.slice(start, end + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

function buildSeasonalPattern(values: number[], trend: number[], period: number): number[] {
  const buckets = Array.from({ length: period }, () => [] as number[]);

  values.forEach((value, index) => {
    buckets[index % period].push(value - trend[index]);
  });

  return buckets.map((bucket) => {
    if (bucket.length === 0) {
      return 0;
    }
    return bucket.reduce((sum, value) => sum + value, 0) / bucket.length;
  });
}

function clampMetric(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function buildDecomposition(dateLabels: string[], values: number[]): DecompositionResult {
  const period = detectPeriod(values);
  const trend = movingAverage(values, period);
  const seasonalPattern = buildSeasonalPattern(values, trend, period);
  const seasonal = values.map((_, index) => seasonalPattern[index % period] ?? 0);
  const residual = values.map((value, index) => value - trend[index] - seasonal[index]);
  const combinedTrendResidual = trend.map((value, index) => value + residual[index]);
  const combinedSeasonalResidual = seasonal.map((value, index) => value + residual[index]);

  const points = values.map((value, index) => ({
    dateLabel: dateLabels[index] ?? "",
    original: value,
    trend: trend[index] ?? 0,
    seasonal: seasonal[index] ?? 0,
    residual: residual[index] ?? 0,
  }));

  return {
    points,
    period,
    trendStrength: clampMetric(1 - variance(residual) / Math.max(variance(combinedTrendResidual), 1e-6)),
    seasonalStrength: clampMetric(1 - variance(residual) / Math.max(variance(combinedSeasonalResidual), 1e-6)),
    residualSpread: standardDeviation(residual),
  };
}

function buildTrendOption(result: DecompositionResult | null, dark: boolean): EChartsOption {
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";

  return {
    animationDuration: 420,
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
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
      data: result?.points.map((point) => point.dateLabel) ?? [],
      axisLabel: { color: textColor, rotate: result && result.points.length > 8 ? 24 : 0 },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        name: "Original",
        type: "line",
        smooth: true,
        showSymbol: false,
        data: result?.points.map((point) => point.original) ?? [],
        lineStyle: { color: "#06b6d4", width: 3 },
      },
      {
        name: "Trend",
        type: "line",
        smooth: true,
        showSymbol: false,
        data: result?.points.map((point) => point.trend) ?? [],
        lineStyle: { color: "#22c55e", width: 3 },
      },
    ],
  };
}

function buildComponentOption(result: DecompositionResult | null, dark: boolean): EChartsOption {
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";

  return {
    animationDuration: 420,
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const points = Array.isArray(params)
          ? params as Array<{ seriesName?: string; data?: number }>
          : [];
        return points
          .map((point) => `${point.seriesName ?? "Component"}: ${formatNumber(point.data ?? 0)}`)
          .join("<br/>");
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
      data: result?.points.map((point) => point.dateLabel) ?? [],
      axisLabel: { color: textColor, rotate: result && result.points.length > 8 ? 24 : 0 },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        name: "Seasonal",
        type: "line",
        smooth: true,
        showSymbol: false,
        data: result?.points.map((point) => point.seasonal) ?? [],
        lineStyle: { color: "#a855f7", width: 3 },
      },
      {
        name: "Residual",
        type: "line",
        smooth: true,
        showSymbol: false,
        data: result?.points.map((point) => point.residual) ?? [],
        lineStyle: { color: "#f97316", width: 3 },
      },
    ],
  };
}

export default function SeasonalDecomposition({ tableName, columns }: SeasonalDecompositionProps) {
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
  const [result, setResult] = useState<DecompositionResult | null>(null);
  const [status, setStatus] = useState("Choose a date and value column to separate the series into trend, seasonal, and residual components.");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (dateColumns.length === 0 || numericColumns.length === 0) {
    return (
      <section className={`${GLASS_PANEL_CLASS} p-6`}>
        <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Seasonal decomposition</h2>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          Seasonal decomposition needs one date column and one numeric value column.
        </p>
      </section>
    );
  }

  async function handleDecompose(): Promise<void> {
    if (!dateColumn || !valueColumn) {
      setError("Choose both a date and numeric value column.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(`
        WITH parsed AS (
          SELECT
            TRY_CAST(${quoteIdentifier(dateColumn)} AS TIMESTAMP) AS series_date,
            TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE) AS series_value
          FROM ${quoteIdentifier(tableName)}
        )
        SELECT
          CAST(DATE_TRUNC('day', series_date) AS DATE) AS bucket_date,
          AVG(series_value) AS bucket_value
        FROM parsed
        WHERE series_date IS NOT NULL
          AND series_value IS NOT NULL
        GROUP BY 1
        ORDER BY 1
      `);

      const normalized = rows.flatMap<{ dateLabel: string; value: number }>((row) => {
        const dateValue = toDate(row.bucket_date);
        const numericValue = toNumber(row.bucket_value);

        if (!dateValue || numericValue === null) {
          return [];
        }

        return [
          {
            dateLabel: dateValue.toISOString().slice(0, 10),
            value: numericValue,
          },
        ];
      });

      if (normalized.length < 6) {
        throw new Error("At least 6 dated observations are required for seasonal decomposition.");
      }

      const nextResult = buildDecomposition(
        normalized.map((entry) => entry.dateLabel),
        normalized.map((entry) => entry.value),
      );
      setResult(nextResult);
      setStatus(`Decomposed ${formatNumber(nextResult.points.length)} observations with detected period ${nextResult.period}.`);
    } catch (decomposeError) {
      setError(decomposeError instanceof Error ? decomposeError.message : "Unable to decompose the selected series.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport(): void {
    if (!result) {
      setError("Run the decomposition before exporting.");
      return;
    }

    downloadFile(
      buildCsv(result.points),
      `${tableName}-${valueColumn}-seasonal-decomposition.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <motion.section
      className={`${GLASS_PANEL_CLASS} space-y-6 p-6`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: ANALYTICS_EASE }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Waves className="h-3.5 w-3.5" />
            Seasonality
          </div>
          <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
            Split the series into trend, seasonal signal, and residual noise
          </h2>
          <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">{status}</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button className={BUTTON_CLASS} disabled={loading} onClick={() => void handleDecompose()} type="button">
            <Gauge className="h-4 w-4" />
            {loading ? "Decomposing…" : "Decompose series"}
          </button>
          <button className={BUTTON_CLASS} disabled={!result} onClick={handleExport} type="button">
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} space-y-4 p-4`}>
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Date column</p>
              <div className="mt-3 space-y-2">
                {dateColumns.map((column) => (
                  <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200" key={column.name}>
                    <input checked={dateColumn === column.name} name="seasonal-date-column" onChange={() => setDateColumn(column.name)} type="radio" />
                    <span>{column.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Value column</p>
              <div className="mt-3 space-y-2">
                {numericColumns.map((column) => (
                  <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200" key={column.name}>
                    <input checked={valueColumn === column.name} name="seasonal-value-column" onChange={() => setValueColumn(column.name)} type="radio" />
                    <span>{column.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {result ? (
            <div className={`${GLASS_CARD_CLASS} grid gap-3 p-4`}>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Detected period</p>
                <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{result.period}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Trend strength</p>
                <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{(result.trendStrength * 100).toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Seasonal strength</p>
                <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{(result.seasonalStrength * 100).toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Residual spread</p>
                <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{result.residualSpread.toFixed(2)}</p>
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
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={`${GLASS_CARD_CLASS} p-4`}>
              <ReactEChartsCore option={buildTrendOption(result, dark)} style={{ height: 300 }} />
            </div>
            <div className={`${GLASS_CARD_CLASS} p-4`}>
              <ReactEChartsCore option={buildComponentOption(result, dark)} style={{ height: 300 }} />
            </div>
          </div>

          {result ? (
            <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
              <div className="border-b border-white/10 px-4 py-3">
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Decomposition table
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-950/[0.03] dark:bg-white/[0.03]">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Date</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Original</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Trend</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Seasonal</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Residual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.points.map((point) => (
                      <tr className="border-t border-white/10" key={point.dateLabel}>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{point.dateLabel}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{point.original.toFixed(2)}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{point.trend.toFixed(2)}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{point.seasonal.toFixed(2)}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{point.residual.toFixed(2)}</td>
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
