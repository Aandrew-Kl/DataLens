"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Download,
  Loader2,
  Orbit,
  Target,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface KnnViewProps {
  tableName: string;
  columns: ColumnProfile[];
}

type DistanceMetric = "euclidean" | "manhattan";

interface KnnSample {
  label: string;
  features: number[];
}

interface PredictionRow {
  actual: string;
  predicted: string;
  correct: boolean;
}

interface KnnResult {
  labels: string[];
  predictions: PredictionRow[];
  confusionMatrix: number[][];
  accuracy: number;
}

interface SummaryCardProps {
  label: string;
  value: string;
}

const SAMPLE_LIMIT = 240;

function SummaryCard({ label, value }: SummaryCardProps) {
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

function createSeededRandom(seed: number) {
  let value = seed;
  return function next() {
    value = (value * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return value / 4_294_967_296;
  };
}

function standardize(samples: KnnSample[]) {
  const dimensions = samples[0]?.features.length ?? 0;
  const means = Array.from({ length: dimensions }, (_, index) => {
    const values = samples.map((sample) => sample.features[index] ?? 0);
    return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  });
  const deviations = Array.from({ length: dimensions }, (_, index) => {
    const values = samples.map((sample) => sample.features[index] ?? 0);
    const avg = means[index] ?? 0;
    const variance =
      values.reduce((sum, value) => sum + (value - avg) ** 2, 0) /
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

function distance(left: number[], right: number[], metric: DistanceMetric) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    const delta = Math.abs((left[index] ?? 0) - (right[index] ?? 0));
    total += metric === "euclidean" ? delta ** 2 : delta;
  }
  return metric === "euclidean" ? Math.sqrt(total) : total;
}

function predictionsToCsv(predictions: PredictionRow[]) {
  return [
    "actual,predicted,correct",
    ...predictions.map((row) => [row.actual, row.predicted, row.correct].join(",")),
  ].join("\n");
}

async function runKnnModel(
  tableName: string,
  targetColumn: string,
  featureColumns: string[],
  neighbors: number,
  metric: DistanceMetric,
): Promise<KnnResult> {
  const rows = await runQuery(`
    SELECT
      CAST(${quoteIdentifier(targetColumn)} AS VARCHAR) AS target_label,
      ${featureColumns
        .map(
          (columnName) =>
            `TRY_CAST(${quoteIdentifier(columnName)} AS DOUBLE) AS ${quoteIdentifier(columnName)}`,
        )
        .join(",\n      ")}
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(targetColumn)} IS NOT NULL
      ${featureColumns
        .map(
          (columnName) =>
            `AND TRY_CAST(${quoteIdentifier(columnName)} AS DOUBLE) IS NOT NULL`,
        )
        .join("\n      ")}
    LIMIT ${SAMPLE_LIMIT}
  `);

  const samples = rows.flatMap<KnnSample>((row) => {
    const label =
      typeof row.target_label === "string" && row.target_label.trim().length > 0
        ? row.target_label
        : null;
    const features = featureColumns.map((columnName) => toNumber(row[columnName]));
    if (!label || features.some((value) => value == null)) return [];
    return [{ label, features: features as number[] }];
  });

  if (samples.length < 18) {
    throw new Error("At least 18 complete rows are required for KNN analysis.");
  }

  const standardized = standardize(samples);
  const indices = standardized.map((_, index) => index);
  const random = createSeededRandom(19);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [indices[index], indices[swapIndex]] = [indices[swapIndex] ?? 0, indices[index] ?? 0];
  }

  const splitIndex = Math.max(8, Math.floor(standardized.length * 0.7));
  const training = indices.slice(0, splitIndex).map((index) => standardized[index]).filter(Boolean) as KnnSample[];
  const holdout = indices.slice(splitIndex).map((index) => standardized[index]).filter(Boolean) as KnnSample[];

  const labels = Array.from(new Set(standardized.map((sample) => sample.label))).sort();
  const confusionMatrix = labels.map(() => labels.map(() => 0));

  const predictions = holdout.map<PredictionRow>((sample) => {
    const nearest = training
      .map((candidate) => ({
        label: candidate.label,
        distance: distance(candidate.features, sample.features, metric),
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, Math.min(neighbors, training.length));

    const counts = new Map<string, number>();
    for (const item of nearest) {
      counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
    }
    const predicted =
      [...counts.entries()].sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
      )[0]?.[0] ?? "";
    return {
      actual: sample.label,
      predicted,
      correct: sample.label === predicted,
    };
  });

  let correctCount = 0;
  for (const row of predictions) {
    const actualIndex = labels.indexOf(row.actual);
    const predictedIndex = labels.indexOf(row.predicted);
    if (actualIndex >= 0 && predictedIndex >= 0) {
      confusionMatrix[actualIndex][predictedIndex] += 1;
    }
    if (row.correct) {
      correctCount += 1;
    }
  }

  return {
    labels,
    predictions,
    confusionMatrix,
    accuracy: predictions.length === 0 ? 0 : (correctCount / predictions.length) * 100,
  };
}

export default function KnnView({ tableName, columns }: KnnViewProps) {
  const targetOptions = useMemo(
    () => columns.filter((column) => column.type !== "number"),
    [columns],
  );
  const featureOptions = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [targetColumn, setTargetColumn] = useState(
    targetOptions[0]?.name ?? columns[0]?.name ?? "",
  );
  const [featureColumns, setFeatureColumns] = useState(
    featureOptions.slice(0, 2).map((column) => column.name),
  );
  const [neighbors, setNeighbors] = useState(5);
  const [metric, setMetric] = useState<DistanceMetric>("euclidean");
  const [result, setResult] = useState<KnnResult | null>(null);
  const [status, setStatus] = useState(
    "Select a categorical target, numeric features, a K value, and a distance metric.",
  );
  const [loading, setLoading] = useState(false);

  function toggleFeature(columnName: string) {
    setFeatureColumns((current) =>
      current.includes(columnName)
        ? current.filter((value) => value !== columnName)
        : [...current, columnName],
    );
  }

  async function handleRunAnalysis() {
    if (!targetColumn || featureColumns.length === 0) {
      setStatus("Select one target column and at least one numeric feature.");
      return;
    }

    setLoading(true);
    setStatus("Running K-nearest neighbors...");

    try {
      const nextResult = await runKnnModel(
        tableName,
        targetColumn,
        featureColumns,
        neighbors,
        metric,
      );
      startTransition(() => {
        setResult(nextResult);
        setStatus(
          `Evaluated ${formatNumber(nextResult.predictions.length)} holdout predictions at ${formatPercent(nextResult.accuracy)} accuracy.`,
        );
      });
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to run KNN analysis.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;
    downloadFile(
      predictionsToCsv(result.predictions),
      `${tableName}-knn-results.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-4 border-b border-white/20 pb-5 dark:border-white/10 xl:flex-row xl:items-center xl:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-fuchsia-700 dark:text-fuchsia-300">
            <Orbit className="h-3.5 w-3.5" />
            KNN View
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
              Classify holdout rows with local nearest-neighbor voting
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Compare euclidean and manhattan distance strategies while tuning
              the K value and reviewing the resulting confusion matrix.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              void handleRunAnalysis();
            }}
            disabled={loading}
            className={`${BUTTON_CLASS} bg-fuchsia-600 text-white hover:bg-fuchsia-500 dark:bg-fuchsia-600 dark:text-white`}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Target className="h-4 w-4" />
            )}
            Run analysis
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

      <div className="mt-4 rounded-2xl bg-white/60 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
        {status}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
        <div className="space-y-6">
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="grid gap-3 md:grid-cols-3">
              <select
                aria-label="Target column"
                value={targetColumn}
                onChange={(event) => setTargetColumn(event.currentTarget.value)}
                className={FIELD_CLASS}
              >
                {targetOptions.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 dark:border-white/10 dark:bg-slate-950/55 dark:text-slate-100">
                <span>K</span>
                <input
                  aria-label="K value"
                  type="number"
                  min={1}
                  max={15}
                  value={neighbors}
                  onChange={(event) => setNeighbors(Math.max(1, Number(event.currentTarget.value) || 1))}
                  className="w-20 bg-transparent outline-none"
                />
              </label>
              <select
                aria-label="Distance metric"
                value={metric}
                onChange={(event) => setMetric(event.currentTarget.value as DistanceMetric)}
                className={FIELD_CLASS}
              >
                <option value="euclidean">Euclidean</option>
                <option value="manhattan">Manhattan</option>
              </select>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {featureOptions.map((column) => {
                const active = featureColumns.includes(column.name);
                return (
                  <button
                    key={column.name}
                    type="button"
                    onClick={() => toggleFeature(column.name)}
                    className={`rounded-full border px-3 py-2 text-sm transition ${
                      active
                        ? "border-fuchsia-400 bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300"
                        : "border-white/20 bg-white/70 text-slate-700 dark:border-white/10 dark:bg-slate-950/45 dark:text-slate-200"
                    }`}
                  >
                    {column.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryCard
              label="Accuracy"
              value={result ? formatPercent(result.accuracy) : "—"}
            />
            <SummaryCard
              label="Predictions"
              value={result ? formatNumber(result.predictions.length) : "0"}
            />
          </div>
        </div>

        <div className="space-y-6">
          <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
            <div className="border-b border-white/15 px-5 py-4 font-semibold text-slate-950 dark:text-white">
              Classification results
            </div>
            {result ? (
              <table className="min-w-full text-left text-sm">
                <thead className="bg-white/50 dark:bg-slate-950/20">
                  <tr className="text-slate-500 dark:text-slate-400">
                    <th className="px-5 py-3 font-medium">Actual</th>
                    <th className="px-5 py-3 font-medium">Predicted</th>
                    <th className="px-5 py-3 font-medium">Correct</th>
                  </tr>
                </thead>
                <tbody>
                  {result.predictions.map((row, index) => (
                    <tr key={`${row.actual}-${index}`} className="border-t border-white/10 text-slate-700 dark:text-slate-200">
                      <td className="px-5 py-3">{row.actual}</td>
                      <td className="px-5 py-3">{row.predicted}</td>
                      <td className="px-5 py-3">{row.correct ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-5 py-10 text-sm text-slate-500 dark:text-slate-400">
                Run analysis to inspect per-row KNN predictions.
              </div>
            )}
          </div>

          <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
            <div className="border-b border-white/15 px-5 py-4 font-semibold text-slate-950 dark:text-white">
              Confusion matrix
            </div>
            {result ? (
              <table className="min-w-full text-left text-sm">
                <thead className="bg-white/50 dark:bg-slate-950/20">
                  <tr className="text-slate-500 dark:text-slate-400">
                    <th className="px-5 py-3 font-medium">Actual \ Predicted</th>
                    {result.labels.map((label) => (
                      <th key={label} className="px-5 py-3 font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.labels.map((label, rowIndex) => (
                    <tr key={label} className="border-t border-white/10 text-slate-700 dark:text-slate-200">
                      <td className="px-5 py-3 font-medium">{label}</td>
                      {result.confusionMatrix[rowIndex]?.map((value, columnIndex) => (
                        <td key={`${label}-${result.labels[columnIndex]}`} className="px-5 py-3">
                          {formatNumber(value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-5 py-10 text-sm text-slate-500 dark:text-slate-400">
                The confusion matrix will appear after scoring holdout samples.
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
