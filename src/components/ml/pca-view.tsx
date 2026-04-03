"use client";

import { startTransition, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Download, Loader2, Orbit, Sigma, Sparkles } from "lucide-react";
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
  BarChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface PCAViewProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface PCAResult {
  rowCount: number;
  selectedColumns: string[];
  varianceRatios: number[];
  scores: Array<{ rowIndex: number; pc1: number; pc2: number }>;
  loadings: Array<{ column: string; pc1: number; pc2: number }>;
}

interface MetricCardProps {
  label: string;
  value: string;
  icon: typeof Orbit;
}

const SAMPLE_LIMIT = 320;
const POWER_ITERATIONS = 40;

function MetricCard({ label, value, icon: Icon }: MetricCardProps) {
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

function dot(left: number[], right: number[]) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return total;
}

function normalize(vector: number[]) {
  const magnitude = Math.sqrt(dot(vector, vector)) || 1;
  return vector.map((value) => value / magnitude);
}

function multiply(matrix: number[][], vector: number[]) {
  return matrix.map((row) => dot(row, vector));
}

function covarianceMatrix(centered: number[][]) {
  const dimension = centered[0]?.length ?? 0;
  const denominator = Math.max(centered.length - 1, 1);

  return Array.from({ length: dimension }, (_, rowIndex) =>
    Array.from({ length: dimension }, (_, columnIndex) => {
      let sum = 0;
      for (const row of centered) {
        sum += (row[rowIndex] ?? 0) * (row[columnIndex] ?? 0);
      }
      return sum / denominator;
    }),
  );
}

function powerIteration(matrix: number[][], seedIndex: number) {
  const dimension = matrix.length;
  let vector = normalize(
    Array.from({ length: dimension }, (_, index) => (index === seedIndex ? 1 : 0.5)),
  );

  for (let iteration = 0; iteration < POWER_ITERATIONS; iteration += 1) {
    vector = normalize(multiply(matrix, vector));
  }

  return vector;
}

function deflate(matrix: number[][], eigenvector: number[], eigenvalue: number) {
  return matrix.map((row, rowIndex) =>
    row.map(
      (value, columnIndex) =>
        value - eigenvalue * (eigenvector[rowIndex] ?? 0) * (eigenvector[columnIndex] ?? 0),
    ),
  );
}

function centerMatrix(matrix: number[][]) {
  const means = matrix[0]?.map((_, index) =>
    matrix.reduce((sum, row) => sum + (row[index] ?? 0), 0) / Math.max(matrix.length, 1),
  ) ?? [];

  return {
    means,
    centered: matrix.map((row) =>
      row.map((value, index) => value - (means[index] ?? 0)),
    ),
  };
}

function buildVarianceOption(result: PCAResult, dark: boolean): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#334155";
  const borderColor = dark ? "#1e293b" : "#e2e8f0";

  return {
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => {
        const entries = Array.isArray(params)
          ? (params as Array<{ name?: string; value?: number }>)
          : [];
        const first = entries[0];
        return `${first?.name ?? "Component"}: ${formatPercent((first?.value ?? 0) * 100, 1)}`;
      },
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      textStyle: { color: textColor },
    },
    grid: { top: 24, right: 20, bottom: 40, left: 48 },
    xAxis: {
      type: "category",
      data: result.varianceRatios.map((_, index) => `PC${index + 1}`),
      axisLabel: { color: textColor },
      axisLine: { lineStyle: { color: borderColor } },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: textColor,
        formatter: (value: number) => `${Math.round(value * 100)}%`,
      },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        type: "bar",
        data: result.varianceRatios,
        itemStyle: {
          color: "#0ea5e9",
          borderRadius: [8, 8, 0, 0],
        },
      },
    ],
  };
}

function buildScatterOption(result: PCAResult, dark: boolean): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#334155";
  const borderColor = dark ? "#1e293b" : "#e2e8f0";

  return {
    tooltip: {
      trigger: "item",
      formatter: (params: unknown) => {
        const point = params as {
          value?: [number, number];
          dataIndex?: number;
        };
        return [
          `Row ${formatNumber((point.dataIndex ?? 0) + 1)}`,
          `PC1: ${(point.value?.[0] ?? 0).toFixed(3)}`,
          `PC2: ${(point.value?.[1] ?? 0).toFixed(3)}`,
        ].join("<br/>");
      },
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      textStyle: { color: textColor },
    },
    grid: { top: 24, right: 20, bottom: 44, left: 48 },
    xAxis: {
      type: "value",
      name: "PC1",
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    yAxis: {
      type: "value",
      name: "PC2",
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        type: "scatter",
        symbolSize: 10,
        itemStyle: {
          color: "#14b8a6",
          opacity: 0.8,
        },
        data: result.scores.map((row) => [row.pc1, row.pc2]),
      },
    ],
  };
}

async function runPCAAnalysis(tableName: string, selectedColumns: string[]): Promise<PCAResult> {
  const query = `
    SELECT
      ${selectedColumns
        .map(
          (column) =>
            `TRY_CAST(${quoteIdentifier(column)} AS DOUBLE) AS ${quoteIdentifier(column)}`,
        )
        .join(",\n      ")}
    FROM ${quoteIdentifier(tableName)}
    WHERE ${selectedColumns
      .map((column) => `TRY_CAST(${quoteIdentifier(column)} AS DOUBLE) IS NOT NULL`)
      .join("\n      AND ")}
    LIMIT ${SAMPLE_LIMIT}
  `;

  const rows = await runQuery(query);
  const matrix = rows.flatMap<number[]>((row) => {
    const values = selectedColumns.map((column) => toNumber(row[column]));
    if (values.some((value) => value === null)) {
      return [];
    }
    return [values as number[]];
  });

  if (matrix.length < 12 || selectedColumns.length < 2) {
    throw new Error("Select at least two numeric columns and 12 complete rows.");
  }

  const { centered } = centerMatrix(matrix);
  const baseCovariance = covarianceMatrix(centered);
  const totalVariance = baseCovariance.reduce(
    (sum, row, index) => sum + (row[index] ?? 0),
    0,
  );

  let currentMatrix = baseCovariance;
  const components = Array.from({ length: Math.min(3, selectedColumns.length) }, (_, index) => {
    const eigenvector = powerIteration(currentMatrix, index);
    const eigenvalue = Math.max(0, dot(eigenvector, multiply(currentMatrix, eigenvector)));
    currentMatrix = deflate(currentMatrix, eigenvector, eigenvalue);
    return { eigenvector, eigenvalue };
  });

  const varianceRatios = components.map((component) =>
    totalVariance > 0 ? component.eigenvalue / totalVariance : 0,
  );

  const scores = centered.map((row, index) => ({
    rowIndex: index + 1,
    pc1: dot(row, components[0]?.eigenvector ?? []),
    pc2: dot(row, components[1]?.eigenvector ?? []),
  }));

  const loadings = selectedColumns.map((column, index) => ({
    column,
    pc1: components[0]?.eigenvector[index] ?? 0,
    pc2: components[1]?.eigenvector[index] ?? 0,
  }));

  return {
    rowCount: matrix.length,
    selectedColumns,
    varianceRatios,
    scores,
    loadings,
  };
}

export default function PCAView({ tableName, columns }: PCAViewProps) {
  const dark = useDarkMode();
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );

  const [selectedColumns, setSelectedColumns] = useState<string[]>(
    numericColumns.slice(0, Math.min(3, numericColumns.length)).map((column) => column.name),
  );
  const [result, setResult] = useState<PCAResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleColumn(name: string) {
    setSelectedColumns((current) =>
      current.includes(name)
        ? current.filter((column) => column !== name)
        : [...current, name],
    );
  }

  async function handleRun() {
    if (selectedColumns.length < 2) {
      setError("Select at least two numeric columns for PCA.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const nextResult = await runPCAAnalysis(tableName, selectedColumns);
      startTransition(() => {
        setResult(nextResult);
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "PCA failed.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;
    const csv = [
      "row_index,pc1,pc2",
      ...result.scores.map(
        (row) => `${row.rowIndex},${row.pc1.toFixed(6)},${row.pc2.toFixed(6)}`,
      ),
    ].join("\n");

    downloadFile(csv, `${tableName}-pca-scores.csv`, "text/csv;charset=utf-8;");
  }

  if (numericColumns.length < 2) {
    return (
      <section className={`${GLASS_PANEL_CLASS} p-6`}>
        <div className="flex items-center gap-3">
          <Orbit className="h-6 w-6 text-cyan-600 dark:text-cyan-300" />
          <div>
            <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-50">
              Run PCA on numeric feature space
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              PCA requires at least two numeric columns.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const capturedVariance = result
    ? result.varianceRatios.slice(0, 2).reduce((sum, value) => sum + value, 0)
    : 0;

  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Orbit className="h-6 w-6 text-cyan-600 dark:text-cyan-300" />
            <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-50">
              Run PCA on numeric feature space
            </h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Select numeric columns, inspect explained variance, view the first two component
            scores, and export PCA coordinates for downstream use.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={loading}
            className={BUTTON_CLASS}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Compute PCA
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={!result}
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export scores
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Numeric columns
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {numericColumns.map((column) => {
              const active = selectedColumns.includes(column.name);
              return (
                <button
                  key={column.name}
                  type="button"
                  onClick={() => toggleColumn(column.name)}
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

          {error ? (
            <p className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </p>
          ) : null}
        </div>

        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard icon={Sigma} label="Rows used" value={result ? formatNumber(result.rowCount) : "0"} />
            <MetricCard icon={Orbit} label="Features" value={formatNumber(selectedColumns.length)} />
            <MetricCard
              icon={Sparkles}
              label="PC1 + PC2 variance"
              value={result ? formatPercent(capturedVariance * 100, 1) : "0.0%"}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: ANALYTICS_EASE }}
              className={`${GLASS_CARD_CLASS} p-4`}
            >
              <h3 className="text-base font-semibold text-slate-950 dark:text-slate-50">
                Explained variance ratio
              </h3>
              <div className="mt-4">
                <ReactEChartsCore
                  echarts={echarts}
                  option={result ? buildVarianceOption(result, dark) : { series: [] }}
                  style={{ height: 260 }}
                />
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
              className={`${GLASS_CARD_CLASS} p-4`}
            >
              <h3 className="text-base font-semibold text-slate-950 dark:text-slate-50">
                First two component scores
              </h3>
              <div className="mt-4">
                <ReactEChartsCore
                  echarts={echarts}
                  option={result ? buildScatterOption(result, dark) : { series: [] }}
                  style={{ height: 260 }}
                />
              </div>
            </motion.div>
          </div>

          <div className={`${GLASS_CARD_CLASS} overflow-hidden p-4`}>
            <h3 className="text-base font-semibold text-slate-950 dark:text-slate-50">
              Loading matrix
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Explained variance captured by first 2 components:{" "}
              {formatPercent(capturedVariance * 100, 1)}.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-white/20 text-left text-slate-500 dark:text-slate-400">
                    <th className="px-3 py-2">Column</th>
                    <th className="px-3 py-2">PC1 loading</th>
                    <th className="px-3 py-2">PC2 loading</th>
                  </tr>
                </thead>
                <tbody>
                  {(result?.loadings ?? []).map((loading) => (
                    <tr key={loading.column} className="border-b border-white/10 last:border-b-0">
                      <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                        {loading.column}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {loading.pc1.toFixed(4)}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {loading.pc2.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
