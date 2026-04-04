"use client";

import { useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Binary, Download, Target } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface LogisticRegressionViewProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface TrainingSample {
  label: string;
  target: number;
  features: number[];
}

interface CoefficientRow {
  label: string;
  value: number;
}

interface PredictionRow {
  actual: string;
  predicted: string;
  probability: number;
  correct: boolean;
}

interface RocPoint {
  threshold: number;
  fpr: number;
  tpr: number;
}

interface LogisticResult {
  coefficients: CoefficientRow[];
  auc: number;
  rocPoints: RocPoint[];
  predictions: PredictionRow[];
  probabilityBins: Array<{ label: string; count: number }>;
  confusion: {
    truePositive: number;
    falsePositive: number;
    trueNegative: number;
    falseNegative: number;
  };
  positiveLabel: string;
  negativeLabel: string;
}

interface NormalizedDataset {
  samples: TrainingSample[];
  featureMeans: number[];
  featureScales: number[];
}

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv(rows: PredictionRow[]): string {
  const header = "actual,predicted,probability,correct";
  const body = rows.map((row) =>
    [row.actual, row.predicted, row.probability.toFixed(6), row.correct].map(escapeCsv).join(","),
  );
  return [header, ...body].join("\n");
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function dotProduct(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

function normalizeSamples(samples: TrainingSample[]): NormalizedDataset {
  const featureCount = samples[0]?.features.length ?? 0;
  const featureMeans = Array.from({ length: featureCount }, (_, index) => {
    const values = samples.map((sample) => sample.features[index] ?? 0);
    return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  });
  const featureScales = Array.from({ length: featureCount }, (_, index) => {
    const values = samples.map((sample) => sample.features[index] ?? 0);
    const meanValue = featureMeans[index] ?? 0;
    const variance =
      values.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) /
      Math.max(values.length, 1);
    return Math.max(Math.sqrt(variance), 1);
  });

  return {
    featureMeans,
    featureScales,
    samples: samples.map((sample) => ({
      ...sample,
      features: sample.features.map(
        (value, index) => (value - (featureMeans[index] ?? 0)) / (featureScales[index] ?? 1),
      ),
    })),
  };
}

function fitWeights(samples: TrainingSample[], iterations = 600, learningRate = 0.2): number[] {
  const featureCount = samples[0]?.features.length ?? 0;
  const weights = Array.from({ length: featureCount + 1 }, () => 0);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradients = Array.from({ length: featureCount + 1 }, () => 0);

    for (const sample of samples) {
      const zValue = weights[0] + dotProduct(sample.features, weights.slice(1));
      const prediction = sigmoid(zValue);
      const error = prediction - sample.target;
      gradients[0] += error;

      for (let index = 0; index < featureCount; index += 1) {
        gradients[index + 1] += error * (sample.features[index] ?? 0);
      }
    }

    for (let index = 0; index < weights.length; index += 1) {
      weights[index] -= (learningRate * gradients[index]) / Math.max(samples.length, 1);
    }
  }

  return weights;
}

function buildRocPoints(predictions: PredictionRow[], positiveLabel: string): RocPoint[] {
  const thresholds = Array.from({ length: 21 }, (_, index) => 1 - index * 0.05);

  return thresholds.map((threshold) => {
    let truePositive = 0;
    let falsePositive = 0;
    let trueNegative = 0;
    let falseNegative = 0;

    for (const row of predictions) {
      const predictedPositive = row.probability >= threshold;
      const actualPositive = row.actual === positiveLabel;

      if (predictedPositive && actualPositive) truePositive += 1;
      if (predictedPositive && !actualPositive) falsePositive += 1;
      if (!predictedPositive && !actualPositive) trueNegative += 1;
      if (!predictedPositive && actualPositive) falseNegative += 1;
    }

    const tpr = truePositive / Math.max(truePositive + falseNegative, 1);
    const fpr = falsePositive / Math.max(falsePositive + trueNegative, 1);

    return { threshold, tpr, fpr };
  }).sort((left, right) => left.fpr - right.fpr);
}

function computeAuc(points: RocPoint[]): number {
  let area = 0;

  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    area += ((left.tpr + right.tpr) / 2) * (right.fpr - left.fpr);
  }

  return Math.max(0, Math.min(1, area));
}

function buildProbabilityBins(predictions: PredictionRow[]): Array<{ label: string; count: number }> {
  const bins = [
    { label: "0.0-0.2", count: 0 },
    { label: "0.2-0.4", count: 0 },
    { label: "0.4-0.6", count: 0 },
    { label: "0.6-0.8", count: 0 },
    { label: "0.8-1.0", count: 0 },
  ];

  for (const row of predictions) {
    if (row.probability < 0.2) bins[0].count += 1;
    else if (row.probability < 0.4) bins[1].count += 1;
    else if (row.probability < 0.6) bins[2].count += 1;
    else if (row.probability < 0.8) bins[3].count += 1;
    else bins[4].count += 1;
  }

  return bins;
}

function buildResult(
  rows: Record<string, unknown>[],
  featureColumns: string[],
): LogisticResult {
  const labels = Array.from(
    new Set(rows.map((row) => String(row.target_value ?? "")).filter((value) => value.length > 0)),
  ).sort();

  if (labels.length !== 2) {
    throw new Error("Logistic regression requires a binary target with exactly two labels.");
  }

  const negativeLabel = labels[0] ?? "";
  const positiveLabel = labels[1] ?? "";

  const samples = rows.flatMap<TrainingSample>((row) => {
    const label = String(row.target_value ?? "").trim();
    const features = featureColumns.map((column) => toNumber(row[column]));

    if (label.length === 0 || features.some((value) => value === null)) {
      return [];
    }

    return [
      {
        label,
        target: label === positiveLabel ? 1 : 0,
        features: features as number[],
      },
    ];
  });

  if (samples.length < 8) {
    throw new Error("At least 8 complete rows are required to fit the logistic model.");
  }

  const normalized = normalizeSamples(samples);
  const weights = fitWeights(normalized.samples);

  const predictions = normalized.samples.map((sample) => {
    const probability = sigmoid(weights[0] + dotProduct(sample.features, weights.slice(1)));
    const predicted = probability >= 0.5 ? positiveLabel : negativeLabel;

    return {
      actual: sample.label,
      predicted,
      probability,
      correct: predicted === sample.label,
    };
  });

  const rocPoints = buildRocPoints(predictions, positiveLabel);
  const auc = computeAuc(rocPoints);

  const confusion = predictions.reduce(
    (current, row) => {
      if (row.actual === positiveLabel && row.predicted === positiveLabel) current.truePositive += 1;
      if (row.actual !== positiveLabel && row.predicted === positiveLabel) current.falsePositive += 1;
      if (row.actual !== positiveLabel && row.predicted !== positiveLabel) current.trueNegative += 1;
      if (row.actual === positiveLabel && row.predicted !== positiveLabel) current.falseNegative += 1;
      return current;
    },
    {
      truePositive: 0,
      falsePositive: 0,
      trueNegative: 0,
      falseNegative: 0,
    },
  );

  return {
    coefficients: [
      { label: "Intercept", value: weights[0] ?? 0 },
      ...featureColumns.map((column, index) => ({
        label: column,
        value: weights[index + 1] ?? 0,
      })),
    ],
    auc,
    rocPoints,
    predictions,
    probabilityBins: buildProbabilityBins(predictions),
    confusion,
    positiveLabel,
    negativeLabel,
  };
}

function buildRocOption(result: LogisticResult | null, dark: boolean): EChartsOption {
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
          ? params as Array<{ value?: [number, number] }>
          : [];
        const point = points[0]?.value;
        const fpr = point?.[0] ?? 0;
        const tpr = point?.[1] ?? 0;
        return `FPR: ${formatPercent(fpr * 100, 1)}<br/>TPR: ${formatPercent(tpr * 100, 1)}`;
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
      type: "value",
      min: 0,
      max: 1,
      name: "False positive rate",
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 1,
      name: "True positive rate",
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        name: "ROC",
        type: "line",
        smooth: true,
        showSymbol: false,
        data: result?.rocPoints.map((point) => [point.fpr, point.tpr]) ?? [],
        lineStyle: { color: "#06b6d4", width: 3 },
      },
      {
        name: "Chance",
        type: "line",
        showSymbol: false,
        data: [
          [0, 0],
          [1, 1],
        ],
        lineStyle: { color: "#94a3b8", type: "dashed" },
      },
    ],
  };
}

function buildProbabilityOption(result: LogisticResult | null, dark: boolean): EChartsOption {
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
    grid: {
      left: 56,
      right: 24,
      top: 24,
      bottom: 56,
    },
    xAxis: {
      type: "category",
      data: result?.probabilityBins.map((bucket) => bucket.label) ?? [],
      axisLabel: { color: textColor },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        name: "Rows",
        type: "bar",
        barMaxWidth: 36,
        data: result?.probabilityBins.map((bucket) => bucket.count) ?? [],
        itemStyle: { color: "#22c55e", borderRadius: [12, 12, 0, 0] },
      },
    ],
  };
}

export default function LogisticRegressionView({ tableName, columns }: LogisticRegressionViewProps) {
  const dark = useDarkMode();
  const targetCandidates = useMemo(
    () => columns.filter((column) => column.uniqueCount === 2 || column.type === "boolean"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [targetColumn, setTargetColumn] = useState(targetCandidates[0]?.name ?? "");
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(
    numericColumns
      .filter((column) => column.name !== targetCandidates[0]?.name)
      .slice(0, 2)
      .map((column) => column.name),
  );
  const [result, setResult] = useState<LogisticResult | null>(null);
  const [status, setStatus] = useState("Choose a binary target, pick numeric features, and fit the logistic model.");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (targetCandidates.length === 0 || numericColumns.length === 0) {
    return (
      <section className={`${GLASS_PANEL_CLASS} p-6`}>
        <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Logistic regression view</h2>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          Logistic regression needs one binary target column and at least one numeric feature column.
        </p>
      </section>
    );
  }

  const featureOptions = numericColumns.filter((column) => column.name !== targetColumn);

  async function handleFitModel(): Promise<void> {
    if (!targetColumn || selectedFeatures.length === 0) {
      setError("Choose a target column and at least one numeric feature.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(`
        SELECT
          CAST(${quoteIdentifier(targetColumn)} AS VARCHAR) AS target_value,
          ${selectedFeatures
            .map(
              (feature) =>
                `TRY_CAST(${quoteIdentifier(feature)} AS DOUBLE) AS ${quoteIdentifier(feature)}`,
            )
            .join(",\n          ")}
        FROM ${quoteIdentifier(tableName)}
        WHERE ${quoteIdentifier(targetColumn)} IS NOT NULL
          ${selectedFeatures
            .map(
              (feature) =>
                `AND TRY_CAST(${quoteIdentifier(feature)} AS DOUBLE) IS NOT NULL`,
            )
            .join("\n          ")}
      `);

      const nextResult = buildResult(rows, selectedFeatures);
      setResult(nextResult);
      setStatus(`Fit a ${selectedFeatures.length}-feature model with AUC ${nextResult.auc.toFixed(3)}.`);
    } catch (fitError) {
      setError(fitError instanceof Error ? fitError.message : "Unable to fit the logistic model.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport(): void {
    if (!result) {
      setError("Fit the model before exporting predictions.");
      return;
    }

    downloadFile(
      buildCsv(result.predictions),
      `${tableName}-${targetColumn}-logistic-regression.csv`,
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
          <div className="inline-flex items-center gap-2 rounded-full bg-sky-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">
            <Binary className="h-3.5 w-3.5" />
            Binary modeling
          </div>
          <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
            Estimate class probabilities and inspect the ROC trade-off
          </h2>
          <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">{status}</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button className={BUTTON_CLASS} disabled={loading} onClick={() => void handleFitModel()} type="button">
            <Target className="h-4 w-4" />
            {loading ? "Fitting…" : "Fit model"}
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
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Binary target</p>
              <div className="mt-3 space-y-2">
                {targetCandidates.map((column) => (
                  <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200" key={column.name}>
                    <input
                      checked={targetColumn === column.name}
                      name="logistic-target-column"
                      onChange={() => {
                        setTargetColumn(column.name);
                        setSelectedFeatures((current) => current.filter((feature) => feature !== column.name));
                      }}
                      type="radio"
                    />
                    <span>{column.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Numeric features</p>
              <div className="mt-3 space-y-2">
                {featureOptions.map((column) => (
                  <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200" key={column.name}>
                    <input
                      checked={selectedFeatures.includes(column.name)}
                      onChange={() =>
                        setSelectedFeatures((current) =>
                          current.includes(column.name)
                            ? current.filter((feature) => feature !== column.name)
                            : [...current, column.name],
                        )
                      }
                      type="checkbox"
                    />
                    <span>{column.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {result ? (
            <div className={`${GLASS_CARD_CLASS} grid gap-3 p-4`}>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">AUC</p>
                <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{result.auc.toFixed(3)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Positive label</p>
                <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{result.positiveLabel}</p>
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
              <ReactEChartsCore option={buildRocOption(result, dark)} style={{ height: 300 }} />
            </div>
            <div className={`${GLASS_CARD_CLASS} p-4`}>
              <ReactEChartsCore option={buildProbabilityOption(result, dark)} style={{ height: 300 }} />
            </div>
          </div>

          {result ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
                <div className="border-b border-white/10 px-4 py-3">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Coefficients
                  </h3>
                </div>

                <table className="min-w-full text-left text-sm">
                  <tbody>
                    {result.coefficients.map((row) => (
                      <tr className="border-t border-white/10 first:border-t-0" key={row.label}>
                        <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">{row.label}</th>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.value.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
                <div className="border-b border-white/10 px-4 py-3">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Confusion matrix
                  </h3>
                </div>

                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-950/[0.03] dark:bg-white/[0.03]">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Actual / Predicted</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">{result.positiveLabel}</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">{result.negativeLabel}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-white/10">
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">{result.positiveLabel}</th>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{result.confusion.truePositive}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{result.confusion.falseNegative}</td>
                    </tr>
                    <tr className="border-t border-white/10">
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">{result.negativeLabel}</th>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{result.confusion.falsePositive}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{result.confusion.trueNegative}</td>
                    </tr>
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
