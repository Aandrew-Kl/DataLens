"use client";

import { startTransition, useCallback, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { HeatmapChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { CheckSquare, Download, Loader2, Monitor, Rows4, Server, Target } from "lucide-react";
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
import { classify as apiClassify } from "@/lib/api/ml";
import type { ClassificationResult as ApiClassificationResult } from "@/lib/api/types";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

interface ClassificationViewProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface ClassificationSample {
  label: string;
  features: number[];
}

interface PredictionRow {
  actual: string;
  predicted: string;
  correct: boolean;
}

interface ClassificationResult {
  labels: string[];
  predictions: PredictionRow[];
  confusion: number[][];
  accuracy: number;
  precision: number;
  recall: number;
}

const SAMPLE_LIMIT = 240;

function createSeededRandom(seed: number) {
  let value = seed;
  return function next() {
    value = (value * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return value / 4_294_967_296;
  };
}

function standardize(samples: ClassificationSample[]) {
  const dimensions = samples[0]?.features.length ?? 0;
  const means = Array.from({ length: dimensions }, (_, index) => {
    const values = samples.map((sample) => sample.features[index] ?? 0);
    return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  });
  const deviations = Array.from({ length: dimensions }, (_, index) => {
    const values = samples.map((sample) => sample.features[index] ?? 0);
    const average = means[index] ?? 0;
    const variance =
      values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
      Math.max(values.length, 1);
    return Math.max(Math.sqrt(variance), 1e-6);
  });

  return samples.map((sample) => ({
    label: sample.label,
    features: sample.features.map(
      (value, index) => (value - (means[index] ?? 0)) / (deviations[index] ?? 1),
    ),
  }));
}

function squaredDistance(left: number[], right: number[]) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    total += delta * delta;
  }
  return total;
}

function predictLabel(
  training: ClassificationSample[],
  point: ClassificationSample,
  neighbors: number,
) {
  const counts = new Map<string, number>();

  const nearest = training
    .map((sample) => ({
      label: sample.label,
      distance: squaredDistance(sample.features, point.features),
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, Math.min(neighbors, training.length));

  for (const neighbor of nearest) {
    counts.set(neighbor.label, (counts.get(neighbor.label) ?? 0) + 1);
  }

  return [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0]?.[0] ?? "";
}

function buildConfusionOption(
  labels: string[],
  matrix: number[][],
  dark: boolean,
): EChartsOption {
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";
  const maxValue = Math.max(...matrix.flatMap((row) => row), 1);

  return {
    animationDuration: 420,
    tooltip: {
      position: "top",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const point = params as {
          value?: [number, number, number];
        };
        const xIndex = point.value?.[0] ?? 0;
        const yIndex = point.value?.[1] ?? 0;
        const count = point.value?.[2] ?? 0;
        return [
          `<strong>Actual: ${labels[yIndex] ?? ""}</strong>`,
          `Predicted: ${labels[xIndex] ?? ""}`,
          `Count: ${formatNumber(count)}`,
        ].join("<br/>");
      },
    },
    grid: {
      left: 80,
      right: 24,
      top: 20,
      bottom: 52,
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { color: textColor, rotate: labels.length > 6 ? 20 : 0 },
    },
    yAxis: {
      type: "category",
      data: labels,
      axisLabel: { color: textColor },
    },
    visualMap: {
      min: 0,
      max: maxValue,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      textStyle: { color: textColor },
      inRange: {
        color: ["#dbeafe", "#60a5fa", "#1d4ed8"],
      },
    },
    series: [
      {
        type: "heatmap",
        data: matrix.flatMap((row, yIndex) =>
          row.map((value, xIndex) => [xIndex, yIndex, value] as [number, number, number]),
        ),
        label: { show: true, color: dark ? "#f8fafc" : "#0f172a" },
        itemStyle: { borderColor, borderWidth: 1 },
      },
    ],
  };
}

async function loadClassificationResult(
  tableName: string,
  targetColumn: string,
  featureColumns: string[],
  neighbors: number,
): Promise<ClassificationResult> {
  const query = `
    SELECT
      CAST(${quoteIdentifier(targetColumn)} AS VARCHAR) AS target_label,
      ${featureColumns
        .map(
          (feature) =>
            `TRY_CAST(${quoteIdentifier(feature)} AS DOUBLE) AS ${quoteIdentifier(feature)}`,
        )
        .join(",\n      ")}
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(targetColumn)} IS NOT NULL
      ${featureColumns
        .map(
          (feature) =>
            `AND TRY_CAST(${quoteIdentifier(feature)} AS DOUBLE) IS NOT NULL`,
        )
        .join("\n      ")}
    LIMIT ${SAMPLE_LIMIT}
  `;

  const rows = await runQuery(query);
  const samples = rows.flatMap<ClassificationSample>((row) => {
    const label =
      typeof row.target_label === "string" && row.target_label.trim().length > 0
        ? row.target_label
        : null;
    const features = featureColumns.map((feature) => toNumber(row[feature]));
    if (!label || features.some((value) => value === null)) return [];

    return [
      {
        label,
        features: features as number[],
      },
    ];
  });

  if (samples.length < 18) {
    throw new Error("At least 18 rows with non-null labels and feature values are required.");
  }

  const standardized = standardize(samples);
  const shuffledIndices = standardized.map((_, index) => index);
  const random = createSeededRandom(31);

  for (let index = shuffledIndices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffledIndices[index], shuffledIndices[swapIndex]] = [
      shuffledIndices[swapIndex] ?? 0,
      shuffledIndices[index] ?? 0,
    ];
  }

  const splitIndex = Math.max(6, Math.floor(standardized.length * 0.7));
  const train = shuffledIndices
    .slice(0, splitIndex)
    .map((index) => standardized[index])
    .filter((sample): sample is ClassificationSample => Boolean(sample));
  const test = shuffledIndices
    .slice(splitIndex)
    .map((index) => standardized[index])
    .filter((sample): sample is ClassificationSample => Boolean(sample));

  if (train.length < 6 || test.length < 6) {
    throw new Error("A stable train/test split could not be produced.");
  }

  const predictions = test.map<PredictionRow>((sample) => {
    const predicted = predictLabel(train, sample, neighbors);
    return {
      actual: sample.label,
      predicted,
      correct: sample.label === predicted,
    };
  });

  const labels = Array.from(
    new Set(predictions.flatMap((row) => [row.actual, row.predicted])),
  ).sort((left, right) => left.localeCompare(right));
  const confusion = labels.map(() => labels.map(() => 0));

  for (const prediction of predictions) {
    const yIndex = labels.indexOf(prediction.actual);
    const xIndex = labels.indexOf(prediction.predicted);
    if (yIndex >= 0 && xIndex >= 0) {
      confusion[yIndex][xIndex] += 1;
    }
  }

  const accuracy =
    predictions.filter((row) => row.correct).length / Math.max(predictions.length, 1);

  const precisionValues = labels.map((label, index) => {
    const truePositive = confusion[index]?.[index] ?? 0;
    const predictedPositive = confusion.reduce(
      (sum, row) => sum + (row[index] ?? 0),
      0,
    );
    return predictedPositive === 0 ? 0 : truePositive / predictedPositive;
  });

  const recallValues = labels.map((label, index) => {
    const truePositive = confusion[index]?.[index] ?? 0;
    const actualPositive = confusion[index]?.reduce((sum, value) => sum + value, 0) ?? 0;
    return actualPositive === 0 ? 0 : truePositive / actualPositive;
  });

  return {
    labels,
    predictions,
    confusion,
    accuracy,
    precision:
      precisionValues.reduce((sum, value) => sum + value, 0) /
      Math.max(precisionValues.length, 1),
    recall:
      recallValues.reduce((sum, value) => sum + value, 0) /
      Math.max(recallValues.length, 1),
  };
}

export default function ClassificationView({
  tableName,
  columns,
}: ClassificationViewProps) {
  const dark = useDarkMode();
  const categoricalColumns = useMemo(
    () => columns.filter((column) => column.type !== "number" && column.type !== "date"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const defaultTarget = categoricalColumns[0]?.name ?? "";
  const [targetColumn, setTargetColumn] = useState(defaultTarget);
  const activeTargetColumn = categoricalColumns.some((column) => column.name === targetColumn)
    ? targetColumn
    : defaultTarget;
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(
    () => numericColumns.slice(0, 3).map((column) => column.name),
  );
  const activeFeatures = selectedFeatures.filter((feature) =>
    numericColumns.some((column) => column.name === feature),
  );
  const [neighbors, setNeighbors] = useState(5);
  const [result, setResult] = useState<ClassificationResult | null>(null);
  const [useBackend, setUseBackend] = useState(true);
  const [backendFailed, setBackendFailed] = useState(false);
  const [status, setStatus] = useState(
    "Choose a categorical target and numeric features, then run KNN classification.",
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const chartOption = useMemo(
    () => buildConfusionOption(result?.labels ?? [], result?.confusion ?? [], dark),
    [dark, result],
  );

  function toggleFeature(name: string) {
    setSelectedFeatures((current) =>
      current.includes(name)
        ? current.filter((entry) => entry !== name)
        : [...current, name],
    );
  }

  const fetchSamplesForBackend = useCallback(async () => {
    const query = `
      SELECT
        CAST(${quoteIdentifier(activeTargetColumn)} AS VARCHAR) AS ${quoteIdentifier(activeTargetColumn)},
        ${activeFeatures
          .map(
            (feature) =>
              `TRY_CAST(${quoteIdentifier(feature)} AS DOUBLE) AS ${quoteIdentifier(feature)}`,
          )
          .join(",\n        ")}
      FROM ${quoteIdentifier(tableName)}
      WHERE ${quoteIdentifier(activeTargetColumn)} IS NOT NULL
        ${activeFeatures
          .map(
            (feature) =>
              `AND TRY_CAST(${quoteIdentifier(feature)} AS DOUBLE) IS NOT NULL`,
          )
          .join("\n        ")}
      LIMIT ${SAMPLE_LIMIT}
    `;
    const rows = await runQuery(query);
    return rows.map((row) => {
      const record: Record<string, unknown> = { [activeTargetColumn]: row[activeTargetColumn] };
      for (const feature of activeFeatures) {
        record[feature] = toNumber(row[feature]);
      }
      return record;
    });
  }, [tableName, activeTargetColumn, activeFeatures]);

  async function handleAnalyze() {
    if (!activeTargetColumn || activeFeatures.length === 0) {
      setError("Select one target column and at least one numeric feature.");
      return;
    }

    setLoading(true);
    setError(null);
    setStatus("Sampling rows from DuckDB and scoring a classifier.");

    try {
      if (useBackend && !backendFailed) {
        try {
          const rawSamples = await fetchSamplesForBackend();
          const apiResult: ApiClassificationResult = await apiClassify(
            rawSamples,
            activeTargetColumn,
            activeFeatures,
            "random_forest",
          );

          const labels = apiResult.class_labels;
          const predictions: PredictionRow[] = apiResult.predictions.map((predicted) => ({
            actual: "",
            predicted: String(predicted),
            correct: false,
          }));

          startTransition(() => {
            setResult({
              labels,
              predictions,
              confusion: apiResult.confusion_matrix,
              accuracy: apiResult.metrics.accuracy,
              precision: apiResult.metrics.precision,
              recall: apiResult.metrics.recall,
            });
            setStatus(
              `Classification completed with ${formatPercent(apiResult.metrics.accuracy * 100, 1)} accuracy across ${formatNumber(apiResult.predictions.length)} holdout predictions (server-side).`,
            );
          });
          return;
        } catch {
          setBackendFailed(true);
          setUseBackend(false);
        }
      }

      const nextResult = await loadClassificationResult(
        tableName,
        activeTargetColumn,
        activeFeatures,
        neighbors,
      );
      startTransition(() => {
        setResult(nextResult);
        setStatus(
          `Evaluated ${nextResult.predictions.length} holdout predictions across ${nextResult.labels.length} classes (client-side).`,
        );
      });
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Classification analysis failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result || result.predictions.length === 0) return;

    const lines = [
      "actual,predicted,correct",
      ...result.predictions.map(
        (row) => `${row.actual},${row.predicted},${row.correct ? "true" : "false"}`,
      ),
    ];

    downloadFile(
      lines.join("\n"),
      `${tableName}-classification-predictions.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Target className="h-3.5 w-3.5" />
            Classification view
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Evaluate categorical prediction quality with K-nearest neighbors
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            DuckDB provides the labeled feature sample. DataLens standardizes numeric features,
            splits train and test rows, and summarizes KNN performance with a confusion matrix.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 rounded-2xl border border-white/20 bg-white/80 px-4 py-2.5 text-sm text-slate-600 dark:border-white/10 dark:bg-slate-950/55 dark:text-slate-300">
              <input
                type="checkbox"
                checked={useBackend}
                onChange={(event) => {
                  setUseBackend(event.target.checked);
                  if (event.target.checked) setBackendFailed(false);
                }}
                className="h-4 w-4 rounded accent-cyan-500"
              />
              Use server-side ML
            </label>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
                useBackend && !backendFailed
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
              }`}
            >
              {useBackend && !backendFailed ? (
                <><Server className="h-3 w-3" /> Backend</>
              ) : (
                <><Monitor className="h-3 w-3" /> Client-side</>
              )}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={`${GLASS_CARD_CLASS} p-4`}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Accuracy
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {result ? formatPercent(result.accuracy * 100, 1) : "—"}
              </p>
            </div>
            <div className={`${GLASS_CARD_CLASS} p-4`}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Precision
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {result ? formatPercent(result.precision * 100, 1) : "—"}
              </p>
            </div>
            <div className={`${GLASS_CARD_CLASS} p-4`}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Recall
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {result ? formatPercent(result.recall * 100, 1) : "—"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <CheckSquare className="h-4 w-4 text-cyan-500" />
            Controls
          </div>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Target column
            </span>
            <select
              value={activeTargetColumn}
              onChange={(event) => setTargetColumn(event.target.value)}
              className={FIELD_CLASS}
            >
              {categoricalColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-4 block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Neighbors (k)
            </span>
            <input
              type="range"
              min={3}
              max={15}
              step={2}
              value={neighbors}
              onChange={(event) => setNeighbors(Number(event.target.value))}
              className="w-full accent-cyan-500"
            />
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{neighbors}</p>
          </label>

          <div className="mt-5">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Feature columns
            </span>
            <div className="grid gap-2 sm:grid-cols-2">
              {numericColumns.map((column) => {
                const active = activeFeatures.includes(column.name);
                return (
                  <button
                    key={column.name}
                    type="button"
                    onClick={() => toggleFeature(column.name)}
                    className={`rounded-2xl border px-3 py-2 text-left text-sm transition ${
                      active
                        ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                        : "border-white/20 bg-white/60 text-slate-700 dark:border-white/10 dark:bg-slate-950/45 dark:text-slate-200"
                    }`}
                  >
                    {column.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={handleAnalyze} disabled={loading} className={BUTTON_CLASS}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rows4 className="h-4 w-4" />}
              Run analysis
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
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
          className={`${GLASS_CARD_CLASS} p-5`}
        >
          <div className="mb-4 text-sm font-semibold text-slate-900 dark:text-white">
            Confusion matrix
          </div>
          <ReactEChartsCore
            echarts={echarts}
            option={chartOption}
            notMerge
            lazyUpdate
            style={{ height: 380 }}
          />
        </motion.div>
      </div>
    </section>
  );
}
