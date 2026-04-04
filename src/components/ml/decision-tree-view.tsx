"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BrainCircuit,
  CheckCircle2,
  Download,
  GitBranch,
  Loader2,
  Target,
  TreePine,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
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

interface DecisionTreeViewProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface TreeSample {
  label: string;
  features: number[];
}

interface TreePrediction {
  actual: string;
  predicted: string;
}

interface LeafNode {
  kind: "leaf";
  prediction: string;
  samples: number;
  confidence: number;
  counts: Record<string, number>;
}

interface SplitNode {
  kind: "split";
  feature: string;
  threshold: number;
  samples: number;
  prediction: string;
  impurity: number;
  left: TreeNode;
  right: TreeNode;
}

type TreeNode = LeafNode | SplitNode;

interface DecisionTreeResult {
  root: TreeNode;
  accuracy: number;
  sampleCount: number;
  holdoutCount: number;
  depth: number;
  leafCount: number;
  predictions: TreePrediction[];
}

interface TreeMetricProps {
  label: string;
  value: string;
  icon: typeof Target;
}

const SAMPLE_LIMIT = 320;
const MAX_DEPTH = 3;
const MIN_LEAF_SIZE = 4;

function TreeMetric({ label, value, icon: Icon }: TreeMetricProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        {label}
      </div>
      <p className="mt-3 text-2xl font-semibold text-slate-950 dark:text-slate-50">{value}</p>
    </div>
  );
}

function TreeNodeView({
  node,
  depth,
}: {
  node: TreeNode;
  depth: number;
}) {
  if (node.kind === "leaf") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: ANALYTICS_EASE }}
        className={`${GLASS_CARD_CLASS} ml-${Math.min(depth * 2, 6)} p-4`}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          Leaf prediction
        </div>
        <p className="mt-2 text-base font-semibold text-slate-950 dark:text-slate-50">
          {node.prediction}
        </p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {formatNumber(node.samples)} samples • confidence {formatPercent(node.confidence * 100, 1)}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(node.counts).map(([label, count]) => (
            <span
              key={label}
              className="rounded-full border border-white/20 bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-950/55 dark:text-slate-300"
            >
              {label}: {formatNumber(count)}
            </span>
          ))}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: ANALYTICS_EASE }}
      className={`${GLASS_CARD_CLASS} p-4`}
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-cyan-700 dark:text-cyan-300">
        <GitBranch className="h-4 w-4" />
        Split on {node.feature}
      </div>
      <p className="mt-2 text-base font-semibold text-slate-950 dark:text-slate-50">
        {node.feature} ≤ {node.threshold.toFixed(3)}
      </p>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        {formatNumber(node.samples)} samples • impurity {node.impurity.toFixed(3)} • majority{" "}
        {node.prediction}
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Left branch
          </div>
          <TreeNodeView node={node.left} depth={depth + 1} />
        </div>
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Right branch
          </div>
          <TreeNodeView node={node.right} depth={depth + 1} />
        </div>
      </div>
    </motion.div>
  );
}

function createSeededRandom(seed: number) {
  let value = seed;
  return function next() {
    value = (value * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return value / 4_294_967_296;
  };
}

function shuffleSamples(samples: TreeSample[]) {
  const nextRandom = createSeededRandom(17);
  const clone = [...samples];

  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(nextRandom() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex]!, clone[index]!];
  }

  return clone;
}

function countLabels(samples: TreeSample[]) {
  return samples.reduce<Record<string, number>>((accumulator, sample) => {
    accumulator[sample.label] = (accumulator[sample.label] ?? 0) + 1;
    return accumulator;
  }, {});
}

function giniImpurity(samples: TreeSample[]) {
  if (samples.length === 0) return 0;
  const counts = countLabels(samples);
  const total = samples.length;
  let sumSquares = 0;

  for (const count of Object.values(counts)) {
    const probability = count / total;
    sumSquares += probability * probability;
  }

  return 1 - sumSquares;
}

function majorityLabel(samples: TreeSample[]) {
  const counts = countLabels(samples);
  return Object.entries(counts).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0]?.[0] ?? "";
}

function createLeaf(samples: TreeSample[]): LeafNode {
  const counts = countLabels(samples);
  const prediction = majorityLabel(samples);
  const total = samples.length;
  const confidence = total > 0 ? (counts[prediction] ?? 0) / total : 0;

  return {
    kind: "leaf",
    prediction,
    samples: total,
    confidence,
    counts,
  };
}

function weightedImpurity(left: TreeSample[], right: TreeSample[]) {
  const total = left.length + right.length;
  if (total === 0) return 0;
  return (left.length / total) * giniImpurity(left) + (right.length / total) * giniImpurity(right);
}

function bestSplit(samples: TreeSample[], featureNames: string[]) {
  const baseline = giniImpurity(samples);
  let best:
    | {
        featureIndex: number;
        threshold: number;
        left: TreeSample[];
        right: TreeSample[];
        impurity: number;
      }
    | null = null;

  for (let featureIndex = 0; featureIndex < featureNames.length; featureIndex += 1) {
    const ordered = [...samples]
      .map((sample) => ({
        sample,
        value: sample.features[featureIndex] ?? 0,
      }))
      .sort((left, right) => left.value - right.value);

    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (!previous || !current || previous.sample.label === current.sample.label) {
        continue;
      }

      const threshold = (previous.value + current.value) / 2;
      const left = samples.filter((sample) => (sample.features[featureIndex] ?? 0) <= threshold);
      const right = samples.filter((sample) => (sample.features[featureIndex] ?? 0) > threshold);

      if (left.length < MIN_LEAF_SIZE || right.length < MIN_LEAF_SIZE) {
        continue;
      }

      const impurity = weightedImpurity(left, right);
      if (!best || impurity < best.impurity) {
        best = { featureIndex, threshold, left, right, impurity };
      }
    }
  }

  if (!best || baseline - best.impurity < 0.001) {
    return null;
  }

  return best;
}

function buildTree(samples: TreeSample[], featureNames: string[], depth: number): TreeNode {
  const uniqueLabels = new Set(samples.map((sample) => sample.label));
  if (depth >= MAX_DEPTH || samples.length < MIN_LEAF_SIZE * 2 || uniqueLabels.size <= 1) {
    return createLeaf(samples);
  }

  const split = bestSplit(samples, featureNames);
  if (!split) {
    return createLeaf(samples);
  }

  return {
    kind: "split",
    feature: featureNames[split.featureIndex] ?? "feature",
    threshold: split.threshold,
    samples: samples.length,
    prediction: majorityLabel(samples),
    impurity: split.impurity,
    left: buildTree(split.left, featureNames, depth + 1),
    right: buildTree(split.right, featureNames, depth + 1),
  };
}

function predictWithFeatureOrder(node: TreeNode, featureNames: string[], features: number[]): string {
  if (node.kind === "leaf") {
    return node.prediction;
  }

  const featureIndex = featureNames.indexOf(node.feature);
  const value = featureIndex >= 0 ? features[featureIndex] : undefined;
  return value !== undefined && value <= node.threshold
    ? predictWithFeatureOrder(node.left, featureNames, features)
    : predictWithFeatureOrder(node.right, featureNames, features);
}

function countLeaves(node: TreeNode): number {
  if (node.kind === "leaf") return 1;
  return countLeaves(node.left) + countLeaves(node.right);
}

function maxDepth(node: TreeNode): number {
  if (node.kind === "leaf") return 1;
  return 1 + Math.max(maxDepth(node.left), maxDepth(node.right));
}

async function loadDecisionTree(
  tableName: string,
  targetColumn: string,
  featureColumns: string[],
): Promise<DecisionTreeResult> {
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
          (feature) => `AND TRY_CAST(${quoteIdentifier(feature)} AS DOUBLE) IS NOT NULL`,
        )
        .join("\n      ")}
    LIMIT ${SAMPLE_LIMIT}
  `;

  const rows = await runQuery(query);
  const samples = rows.flatMap<TreeSample>((row) => {
    const label = typeof row.target_label === "string" ? row.target_label.trim() : "";
    const features = featureColumns.map((feature) => toNumber(row[feature]));

    if (!label || features.some((value) => value === null)) {
      return [];
    }

    return [
      {
        label,
        features: features as number[],
      },
    ];
  });

  if (samples.length < 18) {
    throw new Error("At least 18 complete rows are required to build a decision tree.");
  }

  const shuffled = shuffleSamples(samples);
  const splitIndex = Math.max(8, Math.floor(shuffled.length * 0.72));
  const training = shuffled.slice(0, splitIndex);
  const holdout = shuffled.slice(splitIndex);

  const root = buildTree(training, featureColumns, 0);
  const predictions = holdout.map((sample) => ({
    actual: sample.label,
    predicted: predictWithFeatureOrder(root, featureColumns, sample.features),
  }));
  const correct = predictions.filter(
    (prediction) => prediction.actual === prediction.predicted,
  ).length;

  return {
    root,
    accuracy: predictions.length > 0 ? correct / predictions.length : 0,
    sampleCount: samples.length,
    holdoutCount: predictions.length,
    depth: maxDepth(root),
    leafCount: countLeaves(root),
    predictions,
  };
}

export default function DecisionTreeView({
  tableName,
  columns,
}: DecisionTreeViewProps) {
  const targetColumns = useMemo(
    () =>
      columns.filter(
        (column) =>
          column.type === "string" ||
          column.type === "boolean" ||
          (column.type === "number" && column.uniqueCount <= 12),
      ),
    [columns],
  );
  const featureColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );

  const [targetColumn, setTargetColumn] = useState(targetColumns[0]?.name ?? "");
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(
    featureColumns.slice(0, Math.min(3, featureColumns.length)).map((column) => column.name),
  );
  const [result, setResult] = useState<DecisionTreeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const incompatible = targetColumns.length === 0 || featureColumns.length === 0;

  function toggleFeature(name: string) {
    setSelectedFeatures((current) =>
      current.includes(name)
        ? current.filter((feature) => feature !== name)
        : [...current, name],
    );
  }

  async function handleRun() {
    if (!targetColumn || selectedFeatures.length === 0) {
      setError("Select one target column and at least one numeric feature.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const nextResult = await loadDecisionTree(tableName, targetColumn, selectedFeatures);
      startTransition(() => {
        setResult(nextResult);
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Decision tree analysis failed.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;

    downloadFile(
      JSON.stringify(
        {
          targetColumn,
          featureColumns: selectedFeatures,
          accuracy: result.accuracy,
          tree: result.root,
        },
        null,
        2,
      ),
      `${tableName}-decision-tree.json`,
      "application/json;charset=utf-8;",
    );
  }

  if (incompatible) {
    return (
      <section className={`${GLASS_PANEL_CLASS} p-6`}>
        <div className="flex items-center gap-3">
          <BrainCircuit className="h-6 w-6 text-cyan-600 dark:text-cyan-300" />
          <div>
            <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-50">
              Build a CART-style decision tree from your dataset
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              You need at least one categorical target column and one numeric feature column.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <BrainCircuit className="h-6 w-6 text-cyan-600 dark:text-cyan-300" />
            <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-50">
              Build a CART-style decision tree from your dataset
            </h2>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Choose a target and numeric predictors, then train a compact split tree with leaf
            predictions, holdout accuracy, and an exportable tree structure.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={loading}
            className={BUTTON_CLASS}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <TreePine className="h-4 w-4" />}
            Train tree
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={!result}
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export tree
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Target column
            </span>
            <select
              value={targetColumn}
              onChange={(event) => setTargetColumn(event.target.value)}
              className={FIELD_CLASS}
            >
              {targetColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Feature columns
            </span>
            <div className="flex flex-wrap gap-2">
              {featureColumns.map((column) => {
                const active = selectedFeatures.includes(column.name);
                return (
                  <button
                    key={column.name}
                    type="button"
                    onClick={() => toggleFeature(column.name)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      active
                        ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                        : "border-white/20 bg-white/70 text-slate-600 dark:bg-slate-950/55 dark:text-slate-300"
                    }`}
                  >
                    {column.name}
                  </button>
                );
              })}
            </div>
          </div>

          {error ? (
            <p className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </p>
          ) : null}
        </div>

        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-4">
            <TreeMetric icon={Target} label="Accuracy" value={result ? formatPercent(result.accuracy * 100, 1) : "0.0%"} />
            <TreeMetric icon={BrainCircuit} label="Samples" value={result ? formatNumber(result.sampleCount) : "0"} />
            <TreeMetric icon={GitBranch} label="Tree depth" value={result ? formatNumber(result.depth) : "0"} />
            <TreeMetric icon={CheckCircle2} label="Leaf nodes" value={result ? formatNumber(result.leafCount) : "0"} />
          </div>

          <div className={`${GLASS_CARD_CLASS} p-4`}>
            {result ? (
              <>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Holdout accuracy is {formatPercent(result.accuracy * 100, 1)} across{" "}
                  {formatNumber(result.holdoutCount)} validation rows.
                </p>
                <div className="mt-4">
                  <TreeNodeView node={result.root} depth={0} />
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Train the tree to inspect split thresholds, leaf predictions, and exported structure.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
