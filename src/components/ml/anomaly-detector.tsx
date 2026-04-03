"use client";

import React, { startTransition, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Download,
  Sigma,
  Table2,
  WandSparkles,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { anomalyDetect } from "@/lib/api/ml";
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
import { mean, standardDeviation, zScore } from "@/lib/utils/statistics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  BarChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface AnomalyDetectorProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface MetricRow {
  rowId: number;
  value: number;
  zScore: number;
  isOutlier: boolean;
  row: Record<string, unknown>;
}

interface DistributionBin {
  label: string;
  totalCount: number;
  outlierCount: number;
  midpoint: number;
}

interface AnomalyResult {
  columnName: string;
  rowCount: number;
  meanValue: number;
  standardDeviationValue: number;
  threshold: number;
  outliers: MetricRow[];
  distribution: DistributionBin[];
}

interface BackendSample {
  rowId: number;
  value: number;
  features: number[];
  row: Record<string, unknown>;
}

/* BackendAnomalyResult is imported as AnomalyResult from @/lib/api/types via @/lib/api/ml */

interface SummaryCardProps {
  icon: typeof Table2;
  label: string;
  value: string;
}

const SIGMA_OPTIONS = [1.5, 2, 3] as const;
const SAMPLE_LIMIT = 1200;

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv(rows: Record<string, unknown>[]): string {
  const headers = Array.from(
    rows.reduce((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key));
      return keys;
    }, new Set<string>()),
  );

  return [headers, ...rows.map((row) => headers.map((header) => row[header]))]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
}

function buildQuery(tableName: string, columnName: string): string {
  const safeColumn = quoteIdentifier(columnName);

  return `
    SELECT
      ROW_NUMBER() OVER () AS __row_id,
      TRY_CAST(${safeColumn} AS DOUBLE) AS __metric_value,
      *
    FROM ${quoteIdentifier(tableName)}
    WHERE TRY_CAST(${safeColumn} AS DOUBLE) IS NOT NULL
    LIMIT ${SAMPLE_LIMIT}
  `;
}

function buildDistribution(values: MetricRow[]): DistributionBin[] {
  if (values.length === 0) {
    return [];
  }

  const sortedValues = [...values].sort((left, right) => left.value - right.value);
  const minValue = sortedValues[0]?.value ?? 0;
  const maxValue = sortedValues.at(-1)?.value ?? 0;
  const bucketCount = Math.max(6, Math.min(12, Math.ceil(Math.sqrt(values.length))));
  const range = maxValue - minValue;
  const bucketSize = range === 0 ? 1 : range / bucketCount;

  return Array.from({ length: bucketCount }, (_, index) => {
    const lower = minValue + index * bucketSize;
    const upper = index === bucketCount - 1 ? maxValue : lower + bucketSize;
    const bucketRows = values.filter((row) =>
      index === bucketCount - 1
        ? row.value >= lower && row.value <= upper
        : row.value >= lower && row.value < upper,
    );

    return {
      label: `${lower.toFixed(1)} to ${upper.toFixed(1)}`,
      totalCount: bucketRows.length,
      outlierCount: bucketRows.filter((row) => row.isOutlier).length,
      midpoint: lower + (upper - lower) / 2,
    };
  });
}

function buildChartOption(result: AnomalyResult | null, dark: boolean): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const distribution = result?.distribution ?? [];

  return {
    animationDuration: 420,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    legend: {
      bottom: 0,
      textStyle: { color: textColor },
      data: ["Rows", "Outlier rows"],
    },
    grid: {
      left: 48,
      right: 24,
      top: 24,
      bottom: 56,
    },
    xAxis: {
      type: "category",
      data: distribution.map((bin) => bin.label),
      axisLabel: {
        color: textColor,
        interval: 0,
        rotate: 24,
      },
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
        data: distribution.map((bin) => bin.totalCount),
        itemStyle: {
          color: "#38bdf8",
          borderRadius: [8, 8, 0, 0],
        },
      },
      {
        name: "Outlier rows",
        type: "scatter",
        data: distribution.map((bin, index) => [index, bin.outlierCount]),
        symbolSize: 16,
        itemStyle: {
          color: "#f97316",
          borderColor: dark ? "#fff7ed" : "#9a3412",
          borderWidth: 1,
        },
      },
    ],
  };
}

async function detectAnomalies(
  tableName: string,
  columnName: string,
  threshold: number,
): Promise<AnomalyResult> {
  const rows = await runQuery(buildQuery(tableName, columnName));
  const metricRows = rows.flatMap<MetricRow>((row) => {
    const value = toNumber(row.__metric_value);

    if (value === null) {
      return [];
    }

    return [
      {
        rowId: Math.max(1, Math.round(toNumber(row.__row_id) ?? 0)),
        value,
        zScore: 0,
        isOutlier: false,
        row,
      },
    ];
  });

  if (metricRows.length < 4) {
    throw new Error("At least four numeric rows are required to detect anomalies.");
  }

  const values = metricRows.map((row) => row.value);
  const meanValue = mean(values);
  const standardDeviationValue = standardDeviation(values);

  const scoredRows = metricRows.map<MetricRow>((row) => {
    const score = Math.abs(zScore(row.value, meanValue, standardDeviationValue));
    const resolvedScore = Number.isFinite(score) ? score : 0;

    return {
      ...row,
      zScore: resolvedScore,
      isOutlier: resolvedScore >= threshold,
    };
  });

  return {
    columnName,
    rowCount: scoredRows.length,
    meanValue,
    standardDeviationValue,
    threshold,
    outliers: scoredRows
      .filter((row) => row.isOutlier)
      .sort((left, right) => right.zScore - left.zScore),
    distribution: buildDistribution(scoredRows),
  };
}

function SummaryCard({ icon: Icon, label, value }: SummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            ML anomaly detector
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {message}
          </p>
        </div>
      </div>
    </section>
  );
}

export default function AnomalyDetector({
  tableName,
  columns,
}: AnomalyDetectorProps): React.ReactNode {
  const dark = useDarkMode();
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const defaultColumn = numericColumns[0]?.name ?? "";
  const [columnName, setColumnName] = useState(defaultColumn);
  const [sigmaThreshold, setSigmaThreshold] = useState("3");
  const [result, setResult] = useState<AnomalyResult | null>(null);
  const [useBackend, setUseBackend] = useState(true);
  const [backendFailed, setBackendFailed] = useState(false);
  const [status, setStatus] = useState(
    "Run anomaly detection to compare values against the selected z-score threshold.",
  );
  const [error, setError] = useState<string | null>(null);

  const activeColumn = numericColumns.some((column) => column.name === columnName)
    ? columnName
    : defaultColumn;
  const threshold = Number(sigmaThreshold);
  const chartOption = useMemo(
    () => buildChartOption(result, dark),
    [dark, result],
  );
  const outlierPercent = useMemo(() => {
    if (!result || result.rowCount === 0) {
      return 0;
    }
    return (result.outliers.length / result.rowCount) * 100;
  }, [result]);

  async function handleDetect(): Promise<void> {
    if (!activeColumn) {
      setError("Choose a numeric column before running anomaly detection.");
      return;
    }

    setError(null);
    setStatus(`Calculating z-scores for ${activeColumn}.`);

    if (useBackend && !backendFailed) {
      try {
        const rows = await runQuery(buildQuery(tableName, activeColumn));
        const samples = rows.flatMap<BackendSample>((row) => {
          const value = toNumber(row.__metric_value);

          if (value === null) {
            return [];
          }

          return [
            {
              rowId: Math.max(1, Math.round(toNumber(row.__row_id) ?? 0)),
              value,
              features: [value],
              row,
            },
          ];
        });

        if (samples.length < 4) {
          throw new Error(
            "At least four numeric rows are required to detect anomalies.",
          );
        }

        const recordData = samples.map((s) => ({ [activeColumn]: s.value }));
        const backendResult = await anomalyDetect(recordData, [activeColumn]);
        const scoredRows = samples.map<MetricRow>((sample, index) => {
          const score = Number(backendResult.scores[index]);
          const resolvedScore = Number.isFinite(score) ? Math.abs(score) : 0;

          return {
            rowId: sample.rowId,
            value: sample.value,
            zScore: resolvedScore,
            isOutlier: backendResult.labels[index] === -1,
            row: sample.row,
          };
        });

        const sampleValues = samples.map((s) => s.value);
        const nextResult: AnomalyResult = {
          columnName: activeColumn,
          rowCount: scoredRows.length,
          meanValue: mean(sampleValues),
          standardDeviationValue: standardDeviation(sampleValues),
          threshold,
          outliers: scoredRows
            .filter((row) => row.isOutlier)
            .sort((left, right) => right.zScore - left.zScore),
          distribution: buildDistribution(scoredRows),
        };

        startTransition(() => {
          setResult(nextResult);
          setStatus(
            `Backend flagged ${formatNumber(nextResult.outliers.length)} outliers at ${nextResult.threshold}σ in ${formatNumber(nextResult.rowCount)} sampled rows.`,
          );
        });

        return;
      } catch {
        startTransition(() => {
          setBackendFailed(true);
        });
      }
    }

    try {
      const nextResult = await detectAnomalies(tableName, activeColumn, threshold);
      startTransition(() => {
        setResult(nextResult);
        setStatus(
          `Flagged ${formatNumber(nextResult.outliers.length)} outliers at ${nextResult.threshold}σ in ${formatNumber(nextResult.rowCount)} sampled rows.`,
        );
      });
    } catch (detectionError) {
      setError(
        detectionError instanceof Error
          ? detectionError.message
          : "Unable to detect anomalies.",
      );
    }
  }

  function handleExport(): void {
    if (!result || result.outliers.length === 0) {
      return;
    }

    const rows = result.outliers.map((row) => ({
      __row_id: row.rowId,
      __value: row.value,
      __z_score: row.zScore.toFixed(3),
      ...row.row,
    }));

    downloadFile(
      buildCsv(rows),
      `${tableName}-${result.columnName}-outliers.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  if (numericColumns.length === 0) {
    return (
      <EmptyState message="This detector requires at least one numeric column." />
    );
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <WandSparkles className="h-3.5 w-3.5" />
            ML detector
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Detect outliers with z-scores
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Choose a numeric column, apply a 1.5σ, 2σ, or 3σ threshold, then review the
            resulting distribution and export the flagged rows.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <SummaryCard
            icon={Table2}
            label="Rows analyzed"
            value={result ? formatNumber(result.rowCount) : "—"}
          />
          <SummaryCard
            icon={Sigma}
            label="Mean"
            value={result ? formatNumber(result.meanValue) : "—"}
          />
          <SummaryCard
            icon={AlertTriangle}
            label="Outliers"
            value={result ? formatNumber(result.outliers.length) : "—"}
          />
          <SummaryCard
            icon={WandSparkles}
            label="Outlier rate"
            value={result ? formatPercent(outlierPercent, 1) : "—"}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <Sigma className="h-4 w-4 text-cyan-500" />
            Detector controls
          </div>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Numeric column
            </span>
            <select
              value={activeColumn}
              onChange={(event) => setColumnName(event.target.value)}
              className={FIELD_CLASS}
            >
              {numericColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-4 block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Sigma threshold
            </span>
            <select
              value={sigmaThreshold}
              onChange={(event) => setSigmaThreshold(event.target.value)}
              className={FIELD_CLASS}
            >
              {SIGMA_OPTIONS.map((option) => (
                <option key={option} value={String(option)}>
                  {option} sigma
                </option>
              ))}
            </select>
          </label>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setUseBackend((previousMode) => {
                  const nextMode = !previousMode;
                  if (nextMode) {
                    setBackendFailed(false);
                  }
                  return nextMode;
                });
              }}
              className={`${BUTTON_CLASS} ${useBackend ? "bg-cyan-500 text-white" : "bg-white/20 text-slate-700 dark:bg-slate-900/50 dark:text-white"}`}
            >
              {useBackend ? "Backend" : "Client"}
            </button>
            <button
              type="button"
              onClick={() => {
                void handleDetect();
              }}
              className={BUTTON_CLASS}
            >
              <AlertTriangle className="h-4 w-4" />
              Detect anomalies
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!result || result.outliers.length === 0}
              className={BUTTON_CLASS}
            >
              <Download className="h-4 w-4" />
              Export outlier rows CSV
            </button>
          </div>

          <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {status}
          </p>
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
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Distribution chart
              </h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Histogram buckets show all sampled rows while orange markers highlight buckets that
                contain outliers.
              </p>
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
            <div className="border-b border-white/10 px-5 py-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Outlier rows
              </h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {result
                  ? `${formatNumber(result.outliers.length)} rows exceed ${result.threshold}σ.`
                  : "Run the detector to inspect flagged rows."}
              </p>
            </div>

            {result && result.outliers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-white/55 dark:bg-slate-900/55">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">
                        Row
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">
                        Value
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">
                        |z-score|
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.outliers.map((row) => (
                      <tr key={`outlier-${row.rowId}`} className="border-t border-white/10">
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                          Row {row.rowId}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                          {formatNumber(row.value)}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                          {row.zScore.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-5 py-8 text-sm text-slate-600 dark:text-slate-300">
                No detected outliers yet.
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
