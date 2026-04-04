"use client";

import { memo, useCallback, useMemo, useState, useSyncExternalStore } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  Calculator,
  Download,
  FunctionSquare,
  LineChart as LineChartIcon,
  Loader2,
  Monitor,
  Play,
  Server,
  Sigma,
} from "lucide-react";
import { exportToCSV } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import { runQuery } from "@/lib/duckdb/client";
import { regression as apiRegression } from "@/lib/api/ml";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([LineChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface RegressionViewProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface RegressionSample {
  x: number;
  y: number;
}

interface AnovaSummary {
  sst: number;
  ssr: number;
  sse: number;
  dfModel: number;
  dfResidual: number;
  msr: number;
  mse: number;
  fStatistic: number;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const CARD_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";

function subscribeDarkMode(listener: () => void) {
  if (typeof document === "undefined") return () => undefined;
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function getDarkModeSnapshot() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let pivot = 0; pivot < size; pivot += 1) {
    let maxRow = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot] ?? 0) > Math.abs(augmented[maxRow][pivot] ?? 0)) {
        maxRow = row;
      }
    }

    [augmented[pivot], augmented[maxRow]] = [augmented[maxRow], augmented[pivot]];
    const pivotValue = augmented[pivot][pivot] ?? 0;
    if (Math.abs(pivotValue) < 1e-10) continue;

    for (let column = pivot; column <= size; column += 1) {
      augmented[pivot][column] = (augmented[pivot][column] ?? 0) / pivotValue;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot] ?? 0;
      for (let column = pivot; column <= size; column += 1) {
        augmented[row][column] = (augmented[row][column] ?? 0) - factor * (augmented[pivot][column] ?? 0);
      }
    }
  }

  return augmented.map((row) => row[size] ?? 0);
}

function evaluatePolynomial(coefficients: number[], xValue: number): number {
  return coefficients.reduce((sum, coefficient, degree) => sum + coefficient * xValue ** degree, 0);
}

function buildRegressionOption(
  dark: boolean,
  xColumn: string,
  yColumn: string,
  samples: RegressionSample[],
  curvePoints: Array<[number, number]>,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";

  return {
    animationDuration: 420,
    legend: { bottom: 0, textStyle: { color: textColor } },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    grid: { left: 56, right: 24, top: 24, bottom: 56 },
    xAxis: {
      type: "value",
      name: xColumn,
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    yAxis: {
      type: "value",
      name: yColumn,
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        name: "Observed",
        type: "scatter",
        data: samples.map((sample) => [sample.x, sample.y]),
        itemStyle: { color: "#06b6d4", opacity: 0.78 },
        symbolSize: 9,
      },
      {
        name: "Fitted curve",
        type: "line",
        data: curvePoints,
        showSymbol: false,
        smooth: true,
        lineStyle: { color: "#22c55e", width: 3 },
      },
    ],
  };
}

function buildResidualOption(
  dark: boolean,
  xColumn: string,
  residuals: Array<[number, number]>,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";

  return {
    animationDuration: 420,
    tooltip: { trigger: "item" },
    grid: { left: 56, right: 24, top: 24, bottom: 56 },
    xAxis: {
      type: "value",
      name: xColumn,
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
      {
        type: "scatter",
        data: residuals,
        itemStyle: { color: "#f97316", opacity: 0.8 },
        symbolSize: 8,
      },
      {
        type: "line",
        data: residuals.length > 0 ? [[Math.min(...residuals.map((entry) => entry[0])), 0], [Math.max(...residuals.map((entry) => entry[0])), 0]] : [],
        showSymbol: false,
        lineStyle: { color: "#94a3b8", type: "dashed" },
      },
    ],
  };
}

function AnovaTable({ summary }: { summary: AnovaSummary | null }) {
  if (!summary) {
    return (
      <div className="rounded-[1rem] border border-dashed border-white/20 px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
        Run a regression model to inspect the ANOVA breakdown.
      </div>
    );
  }

  const rows = [
    { label: "Regression SSR", value: summary.ssr },
    { label: "Residual SSE", value: summary.sse },
    { label: "Total SST", value: summary.sst },
    { label: "Model df", value: summary.dfModel },
    { label: "Residual df", value: summary.dfResidual },
    { label: "MSR", value: summary.msr },
    { label: "MSE", value: summary.mse },
    { label: "F statistic", value: summary.fStatistic },
  ] as const;

  return (
    <div className="overflow-hidden rounded-[1rem] border border-white/15 bg-white/55 dark:bg-slate-950/25">
      <table className="min-w-full text-left text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-white/10 first:border-t-0">
              <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">{row.label}</th>
              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatNumber(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RegressionView({ tableName, columns }: RegressionViewProps) {
  const dark = useSyncExternalStore(subscribeDarkMode, getDarkModeSnapshot, () => false);
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [xColumn, setXColumn] = useState(numericColumns[0]?.name ?? "");
  const [yColumn, setYColumn] = useState(numericColumns[1]?.name ?? numericColumns[0]?.name ?? "");
  const [regressionType, setRegressionType] = useState<"linear" | "poly2" | "poly3" | "poly4" | "poly5">("linear");
  const [coefficients, setCoefficients] = useState<number[]>([]);
  const [samples, setSamples] = useState<RegressionSample[]>([]);
  const [rSquared, setRSquared] = useState(0);
  const [anova, setAnova] = useState<AnovaSummary | null>(null);
  const [predictionInput, setPredictionInput] = useState("");
  const [useBackend, setUseBackend] = useState(true);
  const [backendFailed, setBackendFailed] = useState(false);
  const [status, setStatus] = useState("Choose X and Y numeric columns, then fit a model.");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const degree = regressionType === "linear" ? 1 : Number(regressionType.replace("poly", ""));
  const predictedValue = useMemo(() => {
    const xValue = Number(predictionInput);
    if (!Number.isFinite(xValue) || coefficients.length === 0) return null;
    return evaluatePolynomial(coefficients, xValue);
  }, [coefficients, predictionInput]);

  const curvePoints = useMemo(() => {
    if (samples.length === 0 || coefficients.length === 0) return [] as Array<[number, number]>;
    const minX = Math.min(...samples.map((sample) => sample.x));
    const maxX = Math.max(...samples.map((sample) => sample.x));
    const span = maxX - minX || 1;
    return Array.from({ length: 80 }, (_, index) => {
      const xValue = minX + (span * index) / 79;
      return [xValue, evaluatePolynomial(coefficients, xValue)] as [number, number];
    });
  }, [coefficients, samples]);

  const residualData = useMemo(
    () =>
      samples.map((sample) => [sample.x, sample.y - evaluatePolynomial(coefficients, sample.x)] as [number, number]),
    [coefficients, samples],
  );

  const regressionOption = useMemo(
    () => buildRegressionOption(dark, xColumn, yColumn, samples, curvePoints),
    [curvePoints, dark, samples, xColumn, yColumn],
  );

  const residualOption = useMemo(
    () => buildResidualOption(dark, xColumn, residualData),
    [dark, residualData, xColumn],
  );

  async function runRegressionClientSide() {
    const powerTerms = Array.from({ length: degree * 2 + 1 }, (_, index) => index);
    const aggregateSql = `
      SELECT
        COUNT(*) AS row_count,
        ${powerTerms.map((power) => `SUM(POWER(CAST(${quoteIdentifier(xColumn)} AS DOUBLE), ${power})) AS sx${power}`).join(",\n        ")},
        ${Array.from({ length: degree + 1 }, (_, index) => `SUM(POWER(CAST(${quoteIdentifier(xColumn)} AS DOUBLE), ${index}) * CAST(${quoteIdentifier(yColumn)} AS DOUBLE)) AS sxy${index}`).join(",\n        ")}
      FROM ${quoteIdentifier(tableName)}
      WHERE ${quoteIdentifier(xColumn)} IS NOT NULL AND ${quoteIdentifier(yColumn)} IS NOT NULL
    `;

    const [aggregateRow] = await runQuery(aggregateSql);
    const rowCount = Number(aggregateRow?.row_count ?? 0);

    const normalMatrix = Array.from({ length: degree + 1 }, (_, row) =>
      Array.from({ length: degree + 1 }, (_, column) => toNumber(aggregateRow?.[`sx${row + column}`])),
    );
    const rhsVector = Array.from({ length: degree + 1 }, (_, index) => toNumber(aggregateRow?.[`sxy${index}`]));
    const nextCoefficients = solveLinearSystem(normalMatrix, rhsVector);

    const sampleRows = await runQuery(
      `SELECT
         CAST(${quoteIdentifier(xColumn)} AS DOUBLE) AS x_value,
         CAST(${quoteIdentifier(yColumn)} AS DOUBLE) AS y_value
       FROM ${quoteIdentifier(tableName)}
       WHERE ${quoteIdentifier(xColumn)} IS NOT NULL AND ${quoteIdentifier(yColumn)} IS NOT NULL
       ORDER BY x_value
       LIMIT 3000`,
    );
    const nextSamples = sampleRows.map((row) => ({
      x: toNumber(row.x_value),
      y: toNumber(row.y_value),
    }));

    const yMean = nextSamples.reduce((sum, sample) => sum + sample.y, 0) / Math.max(nextSamples.length, 1);
    const sse = nextSamples.reduce((sum, sample) => {
      const residual = sample.y - evaluatePolynomial(nextCoefficients, sample.x);
      return sum + residual * residual;
    }, 0);
    const sst = nextSamples.reduce((sum, sample) => {
      const delta = sample.y - yMean;
      return sum + delta * delta;
    }, 0);
    const ssr = Math.max(sst - sse, 0);
    const nextRSquared = sst === 0 ? 1 : 1 - sse / sst;
    const dfModel = degree;
    const dfResidual = Math.max(rowCount - degree - 1, 1);
    const msr = ssr / Math.max(dfModel, 1);
    const mse = sse / dfResidual;
    const nextAnova: AnovaSummary = {
      sst,
      ssr,
      sse,
      dfModel,
      dfResidual,
      msr,
      mse,
      fStatistic: mse === 0 ? 0 : msr / mse,
    };

    setCoefficients(nextCoefficients);
    setSamples(nextSamples);
    setRSquared(nextRSquared);
    setAnova(nextAnova);
    setStatus(`${regressionType === "linear" ? "Linear" : `Polynomial degree ${degree}`} regression fitted on ${rowCount} rows (client-side).`);
  }

  const fetchSamplesForBackend = useCallback(async () => {
    const sampleRows = await runQuery(
      `SELECT
         CAST(${quoteIdentifier(xColumn)} AS DOUBLE) AS x_value,
         CAST(${quoteIdentifier(yColumn)} AS DOUBLE) AS y_value
       FROM ${quoteIdentifier(tableName)}
       WHERE ${quoteIdentifier(xColumn)} IS NOT NULL AND ${quoteIdentifier(yColumn)} IS NOT NULL
       ORDER BY x_value
       LIMIT 3000`,
    );
    return sampleRows.map((row) => ({
      [xColumn]: toNumber(row.x_value),
      [yColumn]: toNumber(row.y_value),
    }));
  }, [tableName, xColumn, yColumn]);

  async function runRegression() {
    if (!xColumn || !yColumn || xColumn === yColumn) {
      setError("Pick two distinct numeric columns.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (useBackend && !backendFailed) {
        try {
          const rawSamples = await fetchSamplesForBackend();
          const methodMap: Record<string, string> = {
            linear: "linear",
            poly2: "polynomial_2",
            poly3: "polynomial_3",
            poly4: "polynomial_4",
            poly5: "polynomial_5",
          };
          const apiResult = await apiRegression(
            rawSamples,
            yColumn,
            [xColumn],
            methodMap[regressionType] ?? "linear",
          );

          const nextSamples = rawSamples.map((row) => ({
            x: row[xColumn] as number,
            y: row[yColumn] as number,
          }));

          const nextCoefficients: number[] = [];
          nextCoefficients[0] = apiResult.intercept;
          for (let d = 1; d <= degree; d += 1) {
            const key = d === 1 ? xColumn : `${xColumn}^${d}`;
            nextCoefficients[d] = apiResult.coefficients[key] ?? apiResult.coefficients[xColumn] ?? 0;
          }

          const yMean = nextSamples.reduce((s, p) => s + p.y, 0) / Math.max(nextSamples.length, 1);
          const sse = nextSamples.reduce((s, p) => {
            const r = p.y - evaluatePolynomial(nextCoefficients, p.x);
            return s + r * r;
          }, 0);
          const sst = nextSamples.reduce((s, p) => {
            const d = p.y - yMean;
            return s + d * d;
          }, 0);
          const ssr = Math.max(sst - sse, 0);
          const dfModel = degree;
          const dfResidual = Math.max(nextSamples.length - degree - 1, 1);
          const msr = ssr / Math.max(dfModel, 1);
          const mse = sse / dfResidual;

          setCoefficients(nextCoefficients);
          setSamples(nextSamples);
          setRSquared(apiResult.r2);
          setAnova({
            sst,
            ssr,
            sse,
            dfModel,
            dfResidual,
            msr,
            mse,
            fStatistic: mse === 0 ? 0 : msr / mse,
          });
          setStatus(
            `${regressionType === "linear" ? "Linear" : `Polynomial degree ${degree}`} regression fitted on ${nextSamples.length} rows (server-side).`,
          );
          return;
        } catch {
          setBackendFailed(true);
          setUseBackend(false);
        }
      }

      await runRegressionClientSide();
    } catch (regressionError) {
      setError(regressionError instanceof Error ? regressionError.message : "Regression failed.");
    } finally {
      setLoading(false);
    }
  }

  function exportCoefficients() {
    if (coefficients.length === 0) return;
    exportToCSV(
      coefficients.map((coefficient, degreeIndex) => ({
        term: degreeIndex === 0 ? "intercept" : `x^${degreeIndex}`,
        coefficient,
      })),
      `${tableName}-${xColumn}-${yColumn}-coefficients.csv`,
    );
  }

  return (
    <section className={`${CARD_CLASS} overflow-hidden p-5`}>
      <div className="flex flex-col gap-5 border-b border-white/15 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-[1.25rem] bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
            <LineChartIcon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
              Regression
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">
              Linear and polynomial least-squares fitting
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900/30 dark:text-slate-300">
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
      </div>

      <div className="rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 mt-4 text-sm text-slate-600 dark:bg-slate-900/30 dark:text-slate-300">
        {status}
      </div>

      {error ? (
        <div className="mt-4 rounded-[1.2rem] border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <select
                value={xColumn}
                onChange={(event) => setXColumn(event.target.value)}
                className="rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              >
                {numericColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    X · {column.name}
                  </option>
                ))}
              </select>
              <select
                value={yColumn}
                onChange={(event) => setYColumn(event.target.value)}
                className="rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              >
                {numericColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    Y · {column.name}
                  </option>
                ))}
              </select>
              <select
                value={regressionType}
                onChange={(event) =>
                  setRegressionType(event.target.value as "linear" | "poly2" | "poly3" | "poly4" | "poly5")
                }
                className="rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              >
                <option value="linear">Linear</option>
                <option value="poly2">Polynomial degree 2</option>
                <option value="poly3">Polynomial degree 3</option>
                <option value="poly4">Polynomial degree 4</option>
                <option value="poly5">Polynomial degree 5</option>
              </select>
              <input
                value={predictionInput}
                onChange={(event) => setPredictionInput(event.target.value)}
                placeholder="X value for prediction"
                className="rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runRegression()}
                className="inline-flex items-center gap-2 rounded-[1rem] bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Fit model
              </button>
              <button
                type="button"
                onClick={exportCoefficients}
                className="inline-flex items-center gap-2 rounded-[1rem] border border-white/15 bg-white/55 px-4 py-3 text-sm text-slate-700 transition hover:bg-white/70 dark:bg-slate-950/35 dark:text-slate-200"
              >
                <Download className="h-4 w-4" />
                Export coefficients
              </button>
            </div>
          </motion.div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[1.25rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
              <div className="flex items-center gap-2">
                <Sigma className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">R²</p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">
                {formatNumber(rSquared)}
              </p>
            </div>
            <div className="rounded-[1.25rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
              <div className="flex items-center gap-2">
                <FunctionSquare className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Model order</p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">{degree}</p>
            </div>
            <div className="rounded-[1.25rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
              <div className="flex items-center gap-2">
                <Calculator className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Prediction</p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">
                {predictedValue === null ? "—" : formatNumber(predictedValue)}
              </p>
            </div>
          </div>

          <div className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Model coefficients</p>
            <div className="mt-4 space-y-2">
              {coefficients.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Fit a model to inspect the least-squares coefficients.
                </p>
              ) : (
                coefficients.map((coefficient, index) => (
                  <div
                    key={`coef-${index}`}
                    className="flex items-center justify-between rounded-[1rem] border border-white/15 bg-white/55 px-4 py-3 dark:bg-slate-950/25"
                  >
                    <span className="text-sm text-slate-700 dark:text-slate-200">
                      {index === 0 ? "Intercept" : `x^${index}`}
                    </span>
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {formatNumber(coefficient)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <AnovaTable summary={anova} />
        </div>

        <div className="space-y-4">
          <div className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Observed points and fitted curve</p>
            <div className="mt-4 overflow-hidden rounded-[1.2rem] border border-white/15 bg-white/55 dark:bg-slate-950/25">
              <ReactEChartsCore echarts={echarts} option={regressionOption} notMerge lazyUpdate style={{ height: 360 }} />
            </div>
          </div>

          <div className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Residuals plot</p>
            <div className="mt-4 overflow-hidden rounded-[1.2rem] border border-white/15 bg-white/55 dark:bg-slate-950/25">
              <ReactEChartsCore echarts={echarts} option={residualOption} notMerge lazyUpdate style={{ height: 280 }} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default memo(RegressionView);
