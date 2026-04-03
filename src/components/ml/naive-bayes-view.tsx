"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BrainCircuit,
  Download,
  Loader2,
  Sigma,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  normalPdf,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface NaiveBayesViewProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface SampleRow {
  label: string;
  features: number[];
}

interface PriorRow {
  label: string;
  count: number;
  prior: number;
}

interface PosteriorRow {
  actual: string;
  predicted: string;
  confidence: number;
}

interface ModelResult {
  priors: PriorRow[];
  posteriorRows: PosteriorRow[];
  labels: string[];
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

function sampleToCsv(rows: PosteriorRow[]) {
  return [
    "actual,predicted,confidence",
    ...rows.map((row) =>
      [row.actual, row.predicted, row.confidence.toFixed(6)].join(","),
    ),
  ].join("\n");
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function stddev(values: number[]) {
  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) /
    Math.max(values.length, 1);
  return Math.max(Math.sqrt(variance), 1e-6);
}

async function runNaiveBayes(
  tableName: string,
  targetColumn: string,
  featureColumns: string[],
): Promise<ModelResult> {
  const queryRows = await runQuery(`
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

  const samples = queryRows.flatMap<SampleRow>((row) => {
    const label =
      typeof row.target_label === "string" && row.target_label.trim().length > 0
        ? row.target_label
        : null;
    const features = featureColumns.map((columnName) => toNumber(row[columnName]));
    if (!label || features.some((value) => value == null)) return [];
    return [{ label, features: features as number[] }];
  });

  if (samples.length < 18) {
    throw new Error("At least 18 complete rows are required for Naive Bayes analysis.");
  }

  const indices = samples.map((_, index) => index);
  const random = createSeededRandom(17);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [indices[index], indices[swapIndex]] = [indices[swapIndex] ?? 0, indices[index] ?? 0];
  }

  const splitIndex = Math.max(8, Math.floor(samples.length * 0.7));
  const train = indices.slice(0, splitIndex).map((index) => samples[index]).filter(Boolean) as SampleRow[];
  const holdout = indices.slice(splitIndex).map((index) => samples[index]).filter(Boolean) as SampleRow[];

  const byLabel = new Map<string, SampleRow[]>();
  for (const sample of train) {
    const bucket = byLabel.get(sample.label) ?? [];
    bucket.push(sample);
    byLabel.set(sample.label, bucket);
  }

  const priors = [...byLabel.entries()]
    .map<PriorRow>(([label, bucket]) => ({
      label,
      count: bucket.length,
      prior: bucket.length / train.length,
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  const labels = priors.map((row) => row.label);
  const featureStats = new Map<string, Array<{ mean: number; stddev: number }>>();

  for (const prior of priors) {
    const bucket = byLabel.get(prior.label) ?? [];
    featureStats.set(
      prior.label,
      featureColumns.map((_, featureIndex) => {
        const values = bucket.map((sample) => sample.features[featureIndex] ?? 0);
        return {
          mean: mean(values),
          stddev: stddev(values),
        };
      }),
    );
  }

  const posteriorRows = holdout.map<PosteriorRow>((sample) => {
    const scores = priors.map((prior) => {
      const stats = featureStats.get(prior.label) ?? [];
      let logScore = Math.log(Math.max(prior.prior, 1e-6));
      sample.features.forEach((featureValue, featureIndex) => {
        const stat = stats[featureIndex];
        logScore += Math.log(Math.max(normalPdf(featureValue, stat?.mean ?? 0, stat?.stddev ?? 1), 1e-9));
      });
      return { label: prior.label, logScore };
    });

    const maxScore = Math.max(...scores.map((score) => score.logScore));
    const scaled = scores.map((score) => ({
      label: score.label,
      value: Math.exp(score.logScore - maxScore),
    }));
    const total = scaled.reduce((sum, score) => sum + score.value, 0);
    const ranked = scaled
      .map((score) => ({
        label: score.label,
        probability: total === 0 ? 0 : score.value / total,
      }))
      .sort((left, right) => right.probability - left.probability);
    return {
      actual: sample.label,
      predicted: ranked[0]?.label ?? "",
      confidence: ranked[0]?.probability ?? 0,
    };
  });

  const confusionMatrix = labels.map(() => labels.map(() => 0));
  let correct = 0;
  for (const row of posteriorRows) {
    const actualIndex = labels.indexOf(row.actual);
    const predictedIndex = labels.indexOf(row.predicted);
    if (actualIndex >= 0 && predictedIndex >= 0) {
      confusionMatrix[actualIndex][predictedIndex] += 1;
    }
    if (row.actual === row.predicted) {
      correct += 1;
    }
  }

  return {
    priors,
    posteriorRows,
    labels,
    confusionMatrix,
    accuracy: posteriorRows.length === 0 ? 0 : (correct / posteriorRows.length) * 100,
  };
}

export default function NaiveBayesView({
  tableName,
  columns,
}: NaiveBayesViewProps) {
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
  const [result, setResult] = useState<ModelResult | null>(null);
  const [status, setStatus] = useState(
    "Choose a categorical target and numeric features to estimate class probabilities.",
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
    setStatus("Running Gaussian Naive Bayes...");

    try {
      const nextResult = await runNaiveBayes(tableName, targetColumn, featureColumns);
      startTransition(() => {
        setResult(nextResult);
        setStatus(
          `Scored ${formatNumber(nextResult.posteriorRows.length)} holdout predictions with ${formatPercent(nextResult.accuracy)} accuracy.`,
        );
      });
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to run Naive Bayes analysis.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;
    downloadFile(
      sampleToCsv(result.posteriorRows),
      `${tableName}-naive-bayes-results.csv`,
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
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-700 dark:text-violet-300">
            <BrainCircuit className="h-3.5 w-3.5" />
            Naive Bayes
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
              Estimate posterior class probabilities from numeric features
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Compute priors, score holdout rows, and inspect the resulting
              classification matrix without leaving the dataset workspace.
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
            className={`${BUTTON_CLASS} bg-violet-600 text-white hover:bg-violet-500 dark:bg-violet-600 dark:text-white`}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sigma className="h-4 w-4" />
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
            <div className="grid gap-3">
              <select
                aria-label="Target column"
                value={targetColumn}
                onChange={(event) => setTargetColumn(event.currentTarget.value)}
                className="w-full rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-500/10 dark:border-white/10 dark:bg-slate-950/55 dark:text-slate-100"
              >
                {targetOptions.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                {featureOptions.map((column) => {
                  const active = featureColumns.includes(column.name);
                  return (
                    <button
                      key={column.name}
                      type="button"
                      onClick={() => toggleFeature(column.name)}
                      className={`rounded-full border px-3 py-2 text-sm transition ${
                        active
                          ? "border-violet-400 bg-violet-500/15 text-violet-700 dark:text-violet-300"
                          : "border-white/20 bg-white/70 text-slate-700 dark:border-white/10 dark:bg-slate-950/45 dark:text-slate-200"
                      }`}
                    >
                      {column.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryCard
              label="Accuracy"
              value={result ? formatPercent(result.accuracy) : "—"}
            />
            <SummaryCard
              label="Holdout Rows"
              value={result ? formatNumber(result.posteriorRows.length) : "0"}
            />
          </div>

          <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
            <div className="border-b border-white/15 px-5 py-4 font-semibold text-slate-950 dark:text-white">
              Prior probabilities
            </div>
            {result ? (
              <table className="min-w-full text-left text-sm">
                <thead className="bg-white/50 dark:bg-slate-950/20">
                  <tr className="text-slate-500 dark:text-slate-400">
                    <th className="px-5 py-3 font-medium">Label</th>
                    <th className="px-5 py-3 font-medium">Count</th>
                    <th className="px-5 py-3 font-medium">Prior</th>
                  </tr>
                </thead>
                <tbody>
                  {result.priors.map((row) => (
                    <tr key={row.label} className="border-t border-white/10 text-slate-700 dark:text-slate-200">
                      <td className="px-5 py-3">{row.label}</td>
                      <td className="px-5 py-3">{formatNumber(row.count)}</td>
                      <td className="px-5 py-3">{formatPercent(row.prior * 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-5 py-10 text-sm text-slate-500 dark:text-slate-400">
                Run the model to inspect class priors.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
            <div className="border-b border-white/15 px-5 py-4 font-semibold text-slate-950 dark:text-white">
              Posterior probability table
            </div>
            {result ? (
              <table className="min-w-full text-left text-sm">
                <thead className="bg-white/50 dark:bg-slate-950/20">
                  <tr className="text-slate-500 dark:text-slate-400">
                    <th className="px-5 py-3 font-medium">Actual</th>
                    <th className="px-5 py-3 font-medium">Predicted</th>
                    <th className="px-5 py-3 font-medium">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {result.posteriorRows.map((row, index) => (
                    <tr key={`${row.actual}-${index}`} className="border-t border-white/10 text-slate-700 dark:text-slate-200">
                      <td className="px-5 py-3">{row.actual}</td>
                      <td className="px-5 py-3">{row.predicted}</td>
                      <td className="px-5 py-3">{formatPercent(row.confidence * 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-5 py-10 text-sm text-slate-500 dark:text-slate-400">
                Posterior confidence scores will appear here after analysis.
              </div>
            )}
          </div>

          <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
            <div className="border-b border-white/15 px-5 py-4 font-semibold text-slate-950 dark:text-white">
              Classification matrix
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
                The confusion matrix will update after scoring holdout predictions.
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
