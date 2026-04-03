"use client";

import { startTransition, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { LineChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { BarChart3, Download, Loader2, Sparkles, Target } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  LineChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface ModelComparisonProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface ComparisonMetric {
  modelName: string;
  rSquared: number;
  rmse: number;
  mae: number;
  residuals: Array<[number, number]>;
}

interface ComparisonSnapshot {
  metrics: ComparisonMetric[];
  bestModel: string | null;
  sampleCount: number;
}

const MODEL_COLORS = ["#06b6d4", "#22c55e", "#f97316", "#a855f7"] as const;
const SAMPLE_LIMIT = 600;

function buildModelComparisonQuery(
  tableName: string,
  actualColumn: string,
  modelColumns: string[],
) {
  const safeActual = quoteIdentifier(actualColumn);
  const safeModels = modelColumns.map((column) => quoteIdentifier(column));

  return `
    SELECT
      TRY_CAST(${safeActual} AS DOUBLE) AS actual_value,
      ${safeModels
        .map(
          (column, index) =>
            `TRY_CAST(${column} AS DOUBLE) AS ${quoteIdentifier(modelColumns[index] ?? "")}`,
        )
        .join(",\n      ")}
    FROM ${quoteIdentifier(tableName)}
    WHERE TRY_CAST(${safeActual} AS DOUBLE) IS NOT NULL
      ${safeModels
        .map((column) => `AND TRY_CAST(${column} AS DOUBLE) IS NOT NULL`)
        .join("\n      ")}
    LIMIT ${SAMPLE_LIMIT}
  `;
}

function buildResidualOption(
  dark: boolean,
  metrics: ComparisonMetric[],
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const residualValues = metrics.flatMap((metric) =>
    metric.residuals.map((entry) => entry[1]),
  );
  const predictionValues = metrics.flatMap((metric) =>
    metric.residuals.map((entry) => entry[0]),
  );
  const minPrediction =
    predictionValues.length > 0 ? Math.min(...predictionValues) : 0;
  const maxPrediction =
    predictionValues.length > 0 ? Math.max(...predictionValues) : 1;

  return {
    animationDuration: 420,
    legend: {
      bottom: 0,
      textStyle: { color: textColor },
    },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      formatter: (params: unknown) => {
        const point = params as {
          seriesName?: string;
          value?: [number, number];
        };
        const prediction = point.value?.[0] ?? 0;
        const residual = point.value?.[1] ?? 0;

        return [
          `<strong>${point.seriesName ?? "Model"}</strong>`,
          `Prediction: ${formatNumber(prediction)}`,
          `Residual: ${formatNumber(residual)}`,
        ].join("<br/>");
      },
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    grid: { left: 56, right: 24, top: 28, bottom: 60 },
    xAxis: {
      type: "value",
      name: "Predicted value",
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    yAxis: {
      type: "value",
      name: "Residual",
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      ...metrics.map((metric, index) => ({
        name: metric.modelName,
        type: "scatter" as const,
        data: metric.residuals,
        symbolSize: 8,
        itemStyle: {
          color: MODEL_COLORS[index % MODEL_COLORS.length],
          opacity: 0.82,
        },
      })),
      {
        name: "Residual baseline",
        type: "line" as const,
        data:
          residualValues.length > 0
            ? [
                [minPrediction, 0],
                [maxPrediction, 0],
              ]
            : [],
        showSymbol: false,
        lineStyle: { color: "#94a3b8", type: "dashed", width: 2 },
      },
    ],
  };
}

function buildComparisonCsv(metrics: ComparisonMetric[]) {
  const lines = [
    "model,r_squared,rmse,mae",
    ...metrics.map(
      (metric) =>
        `${metric.modelName},${metric.rSquared.toFixed(6)},${metric.rmse.toFixed(6)},${metric.mae.toFixed(6)}`,
    ),
  ];

  return lines.join("\n");
}

function compareMetrics(left: ComparisonMetric, right: ComparisonMetric) {
  if (left.rSquared !== right.rSquared) {
    return right.rSquared - left.rSquared;
  }
  if (left.rmse !== right.rmse) {
    return left.rmse - right.rmse;
  }
  return left.mae - right.mae;
}

function computeMetric(
  modelName: string,
  rows: Record<string, unknown>[],
): ComparisonMetric | null {
  const points = rows.flatMap((row) => {
    const actual = toNumber(row.actual_value);
    const predicted = toNumber(row[modelName]);

    if (actual === null || predicted === null) {
      return [];
    }

    return [{ actual, predicted }];
  });

  if (points.length === 0) {
    return null;
  }

  const meanActual =
    points.reduce((sum, point) => sum + point.actual, 0) / points.length;
  const totalVariance = points.reduce(
    (sum, point) => sum + (point.actual - meanActual) ** 2,
    0,
  );
  const residualSum = points.reduce(
    (sum, point) => sum + (point.actual - point.predicted) ** 2,
    0,
  );
  const absoluteSum = points.reduce(
    (sum, point) => sum + Math.abs(point.actual - point.predicted),
    0,
  );
  const rSquared =
    totalVariance <= 0
      ? residualSum === 0
        ? 1
        : 0
      : 1 - residualSum / totalVariance;

  return {
    modelName,
    rSquared,
    rmse: Math.sqrt(residualSum / points.length),
    mae: absoluteSum / points.length,
    residuals: points.map((point) => [
      point.predicted,
      point.actual - point.predicted,
    ]),
  };
}

function buildSnapshot(
  rows: Record<string, unknown>[],
  modelColumns: string[],
): ComparisonSnapshot {
  const metrics = modelColumns
    .map((modelName) => computeMetric(modelName, rows))
    .filter((metric): metric is ComparisonMetric => metric !== null)
    .sort(compareMetrics);

  return {
    metrics,
    bestModel: metrics[0]?.modelName ?? null,
    sampleCount: rows.length,
  };
}

function getDefaultActualColumn(columns: ColumnProfile[]) {
  return columns.find((column) => column.type === "number")?.name ?? "";
}

function getDefaultModelColumns(
  columns: ColumnProfile[],
  actualColumn: string,
) {
  return columns
    .filter((column) => column.type === "number" && column.name !== actualColumn)
    .slice(0, 4)
    .map((column) => column.name);
}

export default function ModelComparison({
  tableName,
  columns,
}: ModelComparisonProps) {
  const dark = useDarkMode();
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [actualColumn, setActualColumn] = useState(
    getDefaultActualColumn(columns),
  );
  const [modelColumns, setModelColumns] = useState(() =>
    getDefaultModelColumns(columns, getDefaultActualColumn(columns)),
  );
  const [snapshot, setSnapshot] = useState<ComparisonSnapshot | null>(null);
  const [status, setStatus] = useState(
    "Select a target column and compare stored prediction columns.",
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const chartOption = useMemo(
    () => buildResidualOption(dark, snapshot?.metrics ?? []),
    [dark, snapshot],
  );

  function handleActualColumnChange(nextValue: string) {
    const nextModels = modelColumns.filter((column) => column !== nextValue);
    const fallbackModels =
      nextModels.length > 0
        ? nextModels
        : getDefaultModelColumns(columns, nextValue).slice(0, 1);

    setActualColumn(nextValue);
    setModelColumns(fallbackModels);
    setSnapshot(null);
    setStatus("Target column updated. Run comparison to refresh metrics.");
  }

  function handleToggleModelColumn(columnName: string) {
    setModelColumns((current) => {
      if (current.includes(columnName)) {
        return current.filter((entry) => entry !== columnName);
      }
      return [...current, columnName];
    });
    setSnapshot(null);
    setStatus("Prediction columns updated. Run comparison to refresh metrics.");
  }

  async function handleRunComparison() {
    if (!actualColumn || modelColumns.length === 0) {
      setError("Choose one target column and at least one prediction column.");
      return;
    }

    setLoading(true);
    setError(null);
    setStatus("Loading model metrics from DuckDB…");

    try {
      const rows = await runQuery(
        buildModelComparisonQuery(tableName, actualColumn, modelColumns),
      );
      const nextSnapshot = buildSnapshot(rows, modelColumns);

      startTransition(() => {
        setSnapshot(nextSnapshot);
        setStatus(
          nextSnapshot.metrics.length > 0
            ? `Compared ${nextSnapshot.metrics.length} models across ${formatNumber(nextSnapshot.sampleCount)} rows.`
            : "No comparable rows were found for the selected columns.",
        );
      });
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Model comparison failed.";
      setError(message);
      setSnapshot(null);
      setStatus("Comparison failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!snapshot || snapshot.metrics.length === 0) {
      return;
    }

    downloadFile(
      buildComparisonCsv(snapshot.metrics),
      `${tableName}-${actualColumn}-model-comparison.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  if (numericColumns.length < 2) {
    return (
      <section className={`${GLASS_PANEL_CLASS} p-6`}>
        <div className="flex items-center gap-3 text-slate-700 dark:text-slate-100">
          <Target className="h-5 w-5 text-cyan-500" />
          <div>
            <h2 className="text-lg font-semibold">Model comparison</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Add at least two numeric columns to compare predictions against an
              observed target.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <motion.section
      className={`${GLASS_PANEL_CLASS} space-y-6 p-6`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, ease: ANALYTICS_EASE }}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-cyan-500/10 p-3 text-cyan-600 dark:text-cyan-300">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                ML model comparison
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Compare saved prediction columns, score fit quality, and inspect
                residual drift.
              </p>
            </div>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {status}
          </p>
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={BUTTON_CLASS}
            onClick={() => void handleRunComparison()}
            disabled={loading || modelColumns.length === 0}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Run comparison
          </button>
          <button
            type="button"
            className={BUTTON_CLASS}
            onClick={handleExport}
            disabled={!snapshot || snapshot.metrics.length === 0}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,19rem)_1fr]">
        <div className={`${GLASS_CARD_CLASS} space-y-4 p-5`}>
          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Observed target
            </span>
            <select
              className={FIELD_CLASS}
              value={actualColumn}
              onChange={(event) => handleActualColumnChange(event.currentTarget.value)}
            >
              {numericColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Prediction columns
            </div>
            <div className="space-y-2">
              {numericColumns
                .filter((column) => column.name !== actualColumn)
                .map((column) => {
                  const selected = modelColumns.includes(column.name);

                  return (
                    <label
                      key={column.name}
                      className="flex cursor-pointer items-center justify-between rounded-2xl border border-white/15 bg-white/50 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/25 dark:text-slate-200"
                    >
                      <span>{column.name}</span>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-white/20 text-cyan-500"
                        checked={selected}
                        onChange={() => handleToggleModelColumn(column.name)}
                      />
                    </label>
                  );
                })}
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className={`${GLASS_CARD_CLASS} overflow-hidden p-5`}>
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                  Model scorecard
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  R² favors stronger fit. RMSE and MAE favor smaller error.
                </p>
              </div>
              {snapshot?.bestModel ? (
                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-300">
                  Best: {snapshot.bestModel}
                </span>
              ) : null}
            </div>

            {snapshot && snapshot.metrics.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="pb-3 pr-4">Model</th>
                      <th className="pb-3 pr-4">R²</th>
                      <th className="pb-3 pr-4">RMSE</th>
                      <th className="pb-3">MAE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.metrics.map((metric) => {
                      const best = metric.modelName === snapshot.bestModel;

                      return (
                        <tr
                          key={metric.modelName}
                          className={`border-t border-white/10 ${best ? "bg-emerald-500/5" : ""}`}
                        >
                          <th className="py-3 pr-4 font-medium text-slate-900 dark:text-white">
                            {metric.modelName}
                          </th>
                          <td className="py-3 pr-4 text-slate-600 dark:text-slate-300">
                            {formatPercent(metric.rSquared * 100, 1)}
                          </td>
                          <td className="py-3 pr-4 text-slate-600 dark:text-slate-300">
                            {formatNumber(metric.rmse)}
                          </td>
                          <td className="py-3 text-slate-600 dark:text-slate-300">
                            {formatNumber(metric.mae)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/20 px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                Run a comparison to populate the scorecard.
              </div>
            )}
          </div>

          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                Residual overlay
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Inspect bias and spread across prediction ranges.
              </p>
            </div>

            {snapshot && snapshot.metrics.length > 0 ? (
              <ReactEChartsCore
                echarts={echarts}
                option={chartOption}
                notMerge
                lazyUpdate
                style={{ height: 340 }}
              />
            ) : (
              <div className="flex h-[340px] items-center justify-center rounded-2xl border border-dashed border-white/20 text-sm text-slate-500 dark:text-slate-400">
                Residual plot will appear after a comparison run.
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
