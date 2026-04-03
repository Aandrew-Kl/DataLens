"use client";

import { startTransition, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { BarChart3, Download, Loader2, Radar, Shuffle } from "lucide-react";
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
import { formatNumber } from "@/lib/utils/formatters";
import { correlation, mean, standardDeviation } from "@/lib/utils/statistics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface FeatureImportanceProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface FeatureSample {
  target: number;
  features: number[];
}

interface FeatureImportanceRow {
  feature: string;
  correlationScore: number;
  permutationScore: number;
}

interface FeatureImportanceResult {
  baselineMae: number;
  rowsAnalyzed: number;
  featureRows: FeatureImportanceRow[];
}

const SAMPLE_LIMIT = 180;
const K_VALUE = 5;

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function createSeededRandom(seed: number) {
  let value = seed;

  return function next() {
    value = (value * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return value / 4_294_967_296;
  };
}

function standardizeSamples(samples: FeatureSample[]) {
  const dimension = samples[0]?.features.length ?? 0;
  const means = Array.from({ length: dimension }, (_, index) =>
    mean(samples.map((sample) => sample.features[index])),
  );
  const deviations = Array.from({ length: dimension }, (_, index) =>
    Math.max(standardDeviation(samples.map((sample) => sample.features[index])), 1e-6),
  );

  return samples.map((sample) => ({
    target: sample.target,
    features: sample.features.map(
      (value, index) => (value - means[index]) / deviations[index],
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

function computeMae(samples: FeatureSample[]) {
  if (samples.length < 8) return Number.NaN;

  let totalAbsoluteError = 0;

  for (let rowIndex = 0; rowIndex < samples.length; rowIndex += 1) {
    const distances = samples
      .map((sample, index) => ({
        index,
        distance:
          index === rowIndex
            ? Number.POSITIVE_INFINITY
            : squaredDistance(samples[rowIndex].features, sample.features),
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, K_VALUE);

    const neighborTargets = distances
      .map(({ index }) => samples[index]?.target)
      .filter((value): value is number => Number.isFinite(value));

    if (neighborTargets.length === 0) continue;

    const predicted =
      neighborTargets.reduce((sum, value) => sum + value, 0) / neighborTargets.length;
    totalAbsoluteError += Math.abs(predicted - samples[rowIndex].target);
  }

  return totalAbsoluteError / samples.length;
}

function permuteFeature(samples: FeatureSample[], featureIndex: number) {
  const random = createSeededRandom(featureIndex + 17);
  const values = samples.map((sample) => sample.features[featureIndex] ?? 0);

  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex] ?? 0, values[index] ?? 0];
  }

  return samples.map((sample, index) => ({
    target: sample.target,
    features: sample.features.map((value, innerIndex) =>
      innerIndex === featureIndex ? (values[index] ?? value) : value,
    ),
  }));
}

function buildImportanceOption(
  rows: FeatureImportanceRow[],
  dark: boolean,
): EChartsOption {
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";

  return {
    animationDuration: 420,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const list = Array.isArray(params)
          ? (params as Array<{ axisValueLabel?: string; seriesName?: string; value?: number }>)
          : [params as { axisValueLabel?: string; seriesName?: string; value?: number }];
        const label = list[0]?.axisValueLabel ?? "Feature";
        const lines = [`<strong>${label}</strong>`];

        for (const item of list) {
          lines.push(
            `${item.seriesName ?? "Score"}: ${formatNumber(Number(item.value ?? 0))}`,
          );
        }

        return lines.join("<br/>");
      },
    },
    legend: {
      bottom: 0,
      textStyle: { color: textColor },
    },
    grid: {
      left: 140,
      right: 24,
      top: 24,
      bottom: 52,
    },
    xAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: rows.map((row) => row.feature),
      axisLabel: { color: textColor },
    },
    series: [
      {
        name: "Permutation importance",
        type: "bar",
        data: rows.map((row) => row.permutationScore),
        itemStyle: { color: "#06b6d4", borderRadius: [0, 8, 8, 0] },
      },
      {
        name: "Abs correlation",
        type: "bar",
        data: rows.map((row) => Math.abs(row.correlationScore)),
        itemStyle: { color: "#8b5cf6", borderRadius: [0, 8, 8, 0], opacity: 0.72 },
      },
    ],
  };
}

async function loadFeatureImportance(
  tableName: string,
  targetColumn: string,
  featureColumns: string[],
): Promise<FeatureImportanceResult> {
  const query = `
    SELECT
      TRY_CAST(${quoteIdentifier(targetColumn)} AS DOUBLE) AS target_value,
      ${featureColumns
        .map(
          (feature) =>
            `TRY_CAST(${quoteIdentifier(feature)} AS DOUBLE) AS ${quoteIdentifier(feature)}`,
        )
        .join(",\n      ")}
    FROM ${quoteIdentifier(tableName)}
    WHERE TRY_CAST(${quoteIdentifier(targetColumn)} AS DOUBLE) IS NOT NULL
      ${featureColumns
        .map(
          (feature) =>
            `AND TRY_CAST(${quoteIdentifier(feature)} AS DOUBLE) IS NOT NULL`,
        )
        .join("\n      ")}
    LIMIT ${SAMPLE_LIMIT}
  `;

  const rows = await runQuery(query);
  const samples = rows.flatMap<FeatureSample>((row) => {
    const target = toNumber(row.target_value);
    const featureValues = featureColumns.map((feature) => toNumber(row[feature]));

    if (
      target === null ||
      featureValues.some((value) => value === null)
    ) {
      return [];
    }

    return [
      {
        target,
        features: featureValues as number[],
      },
    ];
  });

  if (samples.length < 12) {
    throw new Error("At least 12 fully populated numeric rows are required.");
  }

  const standardized = standardizeSamples(samples);
  const baselineMae = computeMae(standardized);

  if (!Number.isFinite(baselineMae)) {
    throw new Error("The selected feature set could not produce a stable baseline.");
  }

  const targetValues = standardized.map((sample) => sample.target);
  const featureRows = featureColumns
    .map<FeatureImportanceRow>((feature, featureIndex) => {
      const permutedMae = computeMae(permuteFeature(standardized, featureIndex));
      const featureValues = standardized.map((sample) => sample.features[featureIndex] ?? 0);

      return {
        feature,
        correlationScore: correlation(featureValues, targetValues),
        permutationScore: Math.max(0, permutedMae - baselineMae),
      };
    })
    .sort(
      (left, right) =>
        right.permutationScore - left.permutationScore ||
        Math.abs(right.correlationScore) - Math.abs(left.correlationScore),
    );

  return {
    baselineMae,
    rowsAnalyzed: standardized.length,
    featureRows,
  };
}

export default function FeatureImportance({
  tableName,
  columns,
}: FeatureImportanceProps) {
  const dark = useDarkMode();
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const defaultTargetColumn = numericColumns[0]?.name ?? "";
  const [targetColumn, setTargetColumn] = useState(defaultTargetColumn);
  const activeTargetColumn = numericColumns.some((column) => column.name === targetColumn)
    ? targetColumn
    : defaultTargetColumn;
  const featureColumns = useMemo(
    () =>
      numericColumns
        .filter((column) => column.name !== activeTargetColumn)
        .map((column) => column.name),
    [activeTargetColumn, numericColumns],
  );
  const [result, setResult] = useState<FeatureImportanceResult | null>(null);
  const [status, setStatus] = useState(
    "Pick a numeric target column, then run a permutation-based ranking.",
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const chartOption = useMemo(
    () => buildImportanceOption(result?.featureRows ?? [], dark),
    [dark, result],
  );

  async function handleAnalyze() {
    if (!activeTargetColumn || featureColumns.length === 0) {
      setError("Choose a target with at least one remaining numeric feature.");
      return;
    }

    setLoading(true);
    setError(null);
    setStatus("Running a KNN-style baseline and permutation scan.");

    try {
      const nextResult = await loadFeatureImportance(
        tableName,
        activeTargetColumn,
        featureColumns,
      );
      startTransition(() => {
        setResult(nextResult);
        setStatus(
          `Scored ${nextResult.featureRows.length} features across ${nextResult.rowsAnalyzed} rows.`,
        );
      });
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Feature importance analysis failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result || result.featureRows.length === 0) return;

    const lines = [
      "feature,permutation_importance,correlation_score",
      ...result.featureRows.map(
        (row) =>
          `${csvEscape(row.feature)},${row.permutationScore},${row.correlationScore}`,
      ),
    ];
    downloadFile(
      lines.join("\n"),
      `${tableName}-feature-importance.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Radar className="h-3.5 w-3.5" />
            Feature importance
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Rank numeric drivers with permutation-based signal loss
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            DataLens samples numeric rows from DuckDB, measures baseline KNN-style error, then
            shuffles each feature to estimate how much predictive signal it contributes.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Rows analyzed
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
              {result ? formatNumber(result.rowsAnalyzed) : "—"}
            </p>
          </div>
          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Baseline MAE
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
              {result ? formatNumber(result.baselineMae) : "—"}
            </p>
          </div>
          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Features ranked
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
              {result ? formatNumber(result.featureRows.length) : formatNumber(featureColumns.length)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <Shuffle className="h-4 w-4 text-cyan-500" />
            Analysis controls
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
              {numericColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>

          <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Remaining numeric columns are used as feature candidates. The permutation score shows
            baseline error increase after a feature is shuffled.
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={handleAnalyze} disabled={loading} className={BUTTON_CLASS}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
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

        <div className="grid gap-5">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
            className={`${GLASS_CARD_CLASS} p-5`}
          >
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <BarChart3 className="h-4 w-4 text-cyan-500" />
              Horizontal importance ranking
            </div>
            <ReactEChartsCore
              echarts={echarts}
              option={chartOption}
              notMerge
              lazyUpdate
              style={{ height: 360 }}
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
            className={`${GLASS_CARD_CLASS} overflow-hidden`}
          >
            <div className="border-b border-white/10 px-5 py-4 text-sm font-semibold text-slate-900 dark:text-white">
              Correlation-based ranking table
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-white/55 dark:bg-slate-900/55">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Feature</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Permutation</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Correlation</th>
                  </tr>
                </thead>
                <tbody>
                  {(result?.featureRows ?? []).map((row) => (
                    <tr key={row.feature} className="border-t border-white/10">
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.feature}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {formatNumber(row.permutationScore)}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {row.correlationScore >= 0 ? "+" : ""}
                        {row.correlationScore.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
