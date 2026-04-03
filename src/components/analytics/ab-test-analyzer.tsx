"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Download, FlaskConical, Loader2, Percent } from "lucide-react";
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

interface AbTestAnalyzerProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface GroupMetricSummary {
  label: string;
  count: number;
  mean: number;
  variance: number;
}

interface AbTestResult {
  control: GroupMetricSummary;
  treatment: GroupMetricSummary;
  lift: number;
  pValue: number;
  zScore: number;
  confidenceInterval: readonly [number, number];
}

interface SummaryCardProps {
  label: string;
  value: string;
}

const SAMPLE_LIMIT = 5_000;

function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">{value}</p>
    </div>
  );
}

function formatRate(value: number) {
  return formatPercent(value * 100);
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function normalCdf(value: number) {
  const x = Math.abs(value);
  const t = 1 / (1 + 0.2316419 * x);
  const d = 0.3989423 * Math.exp((-value * value) / 2);
  const probability =
    d *
    t *
    (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));

  return value > 0 ? 1 - probability : probability;
}

function sampleVariance(values: number[]) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const total = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return total / (values.length - 1);
}

function buildQuery(tableName: string, groupColumn: string, metricColumn: string) {
  return `
    SELECT
      CAST(${quoteIdentifier(groupColumn)} AS VARCHAR) AS experiment_group,
      TRY_CAST(${quoteIdentifier(metricColumn)} AS DOUBLE) AS metric_value
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(groupColumn)} IS NOT NULL
      AND TRY_CAST(${quoteIdentifier(metricColumn)} AS DOUBLE) IS NOT NULL
    LIMIT ${SAMPLE_LIMIT}
  `;
}

function summarizeGroup(label: string, values: number[]): GroupMetricSummary {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

  return {
    label,
    count: values.length,
    mean,
    variance: sampleVariance(values),
  };
}

function computeAbTestResult(
  rows: Record<string, unknown>[],
  controlLabel: string,
  treatmentLabel: string,
): AbTestResult | null {
  const controlValues: number[] = [];
  const treatmentValues: number[] = [];

  for (const row of rows) {
    const group = typeof row.experiment_group === "string" ? row.experiment_group : "";
    const metricValue = toNumber(row.metric_value);

    if (!group || metricValue === null) {
      continue;
    }

    if (group === controlLabel) {
      controlValues.push(metricValue);
    }

    if (group === treatmentLabel) {
      treatmentValues.push(metricValue);
    }
  }

  if (controlValues.length < 2 || treatmentValues.length < 2) {
    return null;
  }

  const control = summarizeGroup(controlLabel, controlValues);
  const treatment = summarizeGroup(treatmentLabel, treatmentValues);
  const difference = treatment.mean - control.mean;
  const standardError = Math.sqrt(
    control.variance / control.count + treatment.variance / treatment.count,
  );
  const zScore = standardError > 0 ? difference / standardError : 0;
  const pValue = Math.min(1, Math.max(0, 2 * (1 - normalCdf(Math.abs(zScore)))));
  const margin = 1.96 * standardError;

  return {
    control,
    treatment,
    lift: control.mean === 0 ? 0 : difference / control.mean,
    pValue,
    zScore,
    confidenceInterval: [difference - margin, difference + margin] as const,
  };
}

function buildResultCsv(result: AbTestResult) {
  const header = [
    "control_group",
    "treatment_group",
    "control_mean",
    "treatment_mean",
    "lift",
    "z_score",
    "p_value",
    "ci_low",
    "ci_high",
  ];
  const row = [
    result.control.label,
    result.treatment.label,
    result.control.mean,
    result.treatment.mean,
    result.lift,
    result.zScore,
    result.pValue,
    result.confidenceInterval[0],
    result.confidenceInterval[1],
  ];

  return [header.join(","), row.map(csvEscape).join(",")].join("\n");
}

export default function AbTestAnalyzer({ tableName, columns }: AbTestAnalyzerProps) {
  const groupColumns = useMemo(
    () => columns.filter((column) => column.type === "string" || column.type === "boolean"),
    [columns],
  );
  const metricColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const initialGroupColumn = groupColumns[0];
  const initialValues = initialGroupColumn?.sampleValues
    .map((value) => String(value ?? ""))
    .filter((value) => value.length > 0);

  const [groupColumn, setGroupColumn] = useState(initialGroupColumn?.name ?? "");
  const [metricColumn, setMetricColumn] = useState(metricColumns[0]?.name ?? "");
  const [controlValue, setControlValue] = useState(initialValues?.[0] ?? "");
  const [treatmentValue, setTreatmentValue] = useState(initialValues?.[1] ?? initialValues?.[0] ?? "");
  const [result, setResult] = useState<AbTestResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState(
    "Choose a test split and a metric to estimate lift and significance.",
  );

  const availableGroupValues = useMemo(() => {
    const currentColumn = columns.find((column) => column.name === groupColumn);
    return (currentColumn?.sampleValues ?? [])
      .map((value) => String(value ?? ""))
      .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);
  }, [columns, groupColumn]);

  async function handleAnalyze() {
    if (!groupColumn || !metricColumn || !controlValue || !treatmentValue) {
      setStatus("Select a group column, metric, control group, and treatment group first.");
      return;
    }

    if (controlValue === treatmentValue) {
      setStatus("Control and treatment groups must be different.");
      return;
    }

    setIsLoading(true);

    try {
      const rows = await runQuery(buildQuery(tableName, groupColumn, metricColumn));
      const nextResult = computeAbTestResult(rows, controlValue, treatmentValue);

      if (!nextResult) {
        setStatus("Need at least two observations in both control and treatment groups.");
      } else {
        startTransition(() => {
          setResult(nextResult);
          setStatus(
            `Treatment improves ${metricColumn} by ${formatRate(nextResult.lift)} with p=${nextResult.pValue.toFixed(3)}.`,
          );
        });
      }
    } catch {
      setStatus("A/B test analysis failed. Check the selected metric and groups.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;
    downloadFile(
      buildResultCsv(result),
      `${tableName}-ab-test-analysis.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  const hasColumns = groupColumns.length > 0 && metricColumns.length > 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <FlaskConical className="h-3.5 w-3.5" />
            A/B analysis
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Compare control and treatment performance
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Estimate lift, confidence intervals, and statistical significance for an experiment
            metric across two groups.
          </p>
        </div>

        <div className={`${GLASS_CARD_CLASS} max-w-md p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Latest analysis
          </p>
          <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
            {result ? `${result.treatment.label} vs ${result.control.label}` : "Awaiting analysis"}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{status}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Group column
              </span>
              <select
                value={groupColumn}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  const nextColumn = columns.find((column) => column.name === nextValue);
                  const nextGroupValues = (nextColumn?.sampleValues ?? [])
                    .map((value) => String(value ?? ""))
                    .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);

                  setGroupColumn(nextValue);
                  setControlValue(nextGroupValues[0] ?? "");
                  setTreatmentValue(nextGroupValues[1] ?? nextGroupValues[0] ?? "");
                }}
                className={FIELD_CLASS}
                aria-label="Group column"
              >
                {groupColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Metric column
              </span>
              <select
                value={metricColumn}
                onChange={(event) => setMetricColumn(event.target.value)}
                className={FIELD_CLASS}
                aria-label="Metric column"
              >
                {metricColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Control group
              </span>
              <select
                value={controlValue}
                onChange={(event) => setControlValue(event.target.value)}
                className={FIELD_CLASS}
                aria-label="Control group"
              >
                {availableGroupValues.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Treatment group
              </span>
              <select
                value={treatmentValue}
                onChange={(event) => setTreatmentValue(event.target.value)}
                className={FIELD_CLASS}
                aria-label="Treatment group"
              >
                {availableGroupValues.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleAnalyze()}
              className={BUTTON_CLASS}
              disabled={!hasColumns || isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Activity className="h-4 w-4" />
              )}
              Analyze test
            </button>
            <button
              type="button"
              onClick={handleExport}
              className={BUTTON_CLASS}
              disabled={!result}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>

        <div className="grid gap-4">
          <SummaryCard label="Lift" value={result ? formatRate(result.lift) : "—"} />
          <SummaryCard label="p-value" value={result ? result.pValue.toFixed(3) : "—"} />
          <SummaryCard
            label="Confidence interval"
            value={
              result
                ? `${formatNumber(result.confidenceInterval[0])} to ${formatNumber(result.confidenceInterval[1])}`
                : "—"
            }
          />
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        <div className={`${GLASS_CARD_CLASS} overflow-hidden p-5`}>
          <div className="flex items-center gap-3">
            <Percent className="h-5 w-5 text-cyan-700 dark:text-cyan-300" />
            <h3 className="text-base font-semibold text-slate-950 dark:text-white">
              Group metrics
            </h3>
          </div>

          {!hasColumns ? (
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
              Add a categorical group column and at least one numeric metric to analyze an A/B
              test.
            </p>
          ) : !result ? (
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
              Select control and treatment groups, then run the comparison.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-white/20 text-sm">
                <thead>
                  <tr className="text-left text-slate-500 dark:text-slate-400">
                    <th className="px-3 py-2 font-medium">Group</th>
                    <th className="px-3 py-2 font-medium">Count</th>
                    <th className="px-3 py-2 font-medium">Mean</th>
                    <th className="px-3 py-2 font-medium">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {[result.control, result.treatment].map((summary) => (
                    <tr key={summary.label} className="border-t border-white/10">
                      <td className="px-3 py-2 font-medium text-slate-950 dark:text-white">
                        {summary.label}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {summary.count}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {formatNumber(summary.mean)}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {formatNumber(summary.variance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">
            Statistical readout
          </h3>
          {!result ? (
            <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
              The analyzer reports relative lift, a two-sided z-test p-value, and a 95% confidence
              interval for the mean difference.
            </p>
          ) : (
            <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              <p>
                Treatment mean: <span className="font-medium text-slate-950 dark:text-white">{formatNumber(result.treatment.mean)}</span>
              </p>
              <p>
                Control mean: <span className="font-medium text-slate-950 dark:text-white">{formatNumber(result.control.mean)}</span>
              </p>
              <p>
                z-score: <span className="font-medium text-slate-950 dark:text-white">{result.zScore.toFixed(3)}</span>
              </p>
              <p>
                Significance:{" "}
                <span className="font-medium text-slate-950 dark:text-white">
                  {result.pValue < 0.05 ? "Statistically significant" : "Not statistically significant"}
                </span>
              </p>
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}
