"use client";

import { startTransition, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { RadarChart } from "echarts/charts";
import {
  LegendComponent,
  RadarComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Check, Download, Loader2, Sparkles } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([RadarChart, LegendComponent, RadarComponent, TooltipComponent, CanvasRenderer]);

interface DataQualityScoreProps {
  tableName: string;
  columns: ColumnProfile[];
}

type QualityDimensionKey =
  | "completeness"
  | "uniqueness"
  | "consistency"
  | "validity";

interface QualityDimensions {
  completeness: number;
  uniqueness: number;
  consistency: number;
  validity: number;
}

interface ColumnQualityScore extends QualityDimensions {
  columnName: string;
  overall: number;
}

interface QualityAnalysis {
  tableName: string;
  rowCount: number;
  overall: number;
  dimensions: QualityDimensions;
  columnScores: ColumnQualityScore[];
  recommendations: string[];
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "border border-white/20 bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 rounded-[1.75rem] shadow-xl shadow-slate-950/10";

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(1))));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return clampScore(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function sampleMatchesType(value: unknown, type: ColumnProfile["type"]): boolean {
  if (value === null) return true;
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "date") {
    if (typeof value === "string" || typeof value === "number") {
      return !Number.isNaN(Date.parse(String(value)));
    }
    return false;
  }
  return true;
}

function buildStringSignature(value: string): string {
  return value
    .replace(/[A-Z]/g, "A")
    .replace(/[a-z]/g, "a")
    .replace(/[0-9]/g, "9")
    .replace(/[^Aa9]/g, "_");
}

function scoreConsistency(column: ColumnProfile): number {
  const samples = column.sampleValues.filter(
    (value): value is string | number | boolean => value !== null,
  );
  if (samples.length <= 1) return 100;

  if (column.type === "string") {
    const signatures = new Map<string, number>();
    for (const value of samples) {
      const signature = buildStringSignature(String(value));
      signatures.set(signature, (signatures.get(signature) ?? 0) + 1);
    }
    return clampScore((Math.max(...signatures.values()) / samples.length) * 100);
  }

  const validSamples = samples.filter((value) => sampleMatchesType(value, column.type));
  return clampScore((validSamples.length / samples.length) * 100);
}

function scoreValidity(column: ColumnProfile): number {
  const samples = column.sampleValues.filter(
    (value): value is string | number | boolean => value !== null,
  );
  if (samples.length === 0) return 100;
  const validCount = samples.filter((value) => sampleMatchesType(value, column.type)).length;
  return clampScore((validCount / samples.length) * 100);
}

function buildRecommendations(
  tableName: string,
  dimensions: QualityDimensions,
  columnScores: ColumnQualityScore[],
): string[] {
  const recommendations: string[] = [];

  if (dimensions.completeness < 85) {
    recommendations.push(
      `Audit missing values in ${tableName}; completeness is dragging the score down.`,
    );
  }
  if (dimensions.uniqueness < 80) {
    recommendations.push(
      "Review duplicate-heavy columns and consider deduplication or better keys.",
    );
  }
  if (dimensions.consistency < 80) {
    recommendations.push(
      "Normalize inconsistent formats before downstream reporting or modeling.",
    );
  }
  if (dimensions.validity < 90) {
    recommendations.push(
      "Add validation rules for invalid dates, numbers, or booleans before export.",
    );
  }

  const lowestColumns = [...columnScores]
    .sort((left, right) => left.overall - right.overall)
    .slice(0, 2);

  for (const column of lowestColumns) {
    recommendations.push(
      `Prioritize ${column.columnName}; its quality score is only ${column.overall.toFixed(1)}.`,
    );
  }

  return recommendations.slice(0, 5);
}

function buildAnalysis(
  tableName: string,
  columns: ColumnProfile[],
  rowCount: number,
): QualityAnalysis {
  const safeRowCount = Math.max(rowCount, 1);
  const columnScores = columns.map((column) => {
    const nonNullCount = Math.max(safeRowCount - column.nullCount, 0);
    const completeness = clampScore((nonNullCount / safeRowCount) * 100);
    const uniqueness = nonNullCount === 0
      ? 100
      : clampScore((Math.min(column.uniqueCount, nonNullCount) / nonNullCount) * 100);
    const consistency = scoreConsistency(column);
    const validity = scoreValidity(column);
    const overall = average([completeness, uniqueness, consistency, validity]);

    return {
      columnName: column.name,
      completeness,
      uniqueness,
      consistency,
      validity,
      overall,
    } satisfies ColumnQualityScore;
  });

  const dimensions = {
    completeness: average(columnScores.map((score) => score.completeness)),
    uniqueness: average(columnScores.map((score) => score.uniqueness)),
    consistency: average(columnScores.map((score) => score.consistency)),
    validity: average(columnScores.map((score) => score.validity)),
  } satisfies QualityDimensions;

  return {
    tableName,
    rowCount,
    overall: average(Object.values(dimensions)),
    dimensions,
    columnScores,
    recommendations: buildRecommendations(tableName, dimensions, columnScores),
  };
}

function buildReportCsv(analysis: QualityAnalysis): string {
  const header =
    "column_name,overall,completeness,uniqueness,consistency,validity";
  const lines = analysis.columnScores.map((score) =>
    [
      score.columnName,
      score.overall.toFixed(1),
      score.completeness.toFixed(1),
      score.uniqueness.toFixed(1),
      score.consistency.toFixed(1),
      score.validity.toFixed(1),
    ].join(","),
  );
  return [header, ...lines].join("\n");
}

function formatRadarTooltip(params: unknown): string {
  const items = Array.isArray(params) ? params : [params];
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return "Quality score";
      const record = item as Record<string, unknown>;
      const values = Array.isArray(record.value)
        ? record.value.map((value) => Number(value).toFixed(1)).join(" / ")
        : "";
      return `${String(record.seriesName ?? "Quality")}: ${values}`;
    })
    .join("<br/>");
}

export default function DataQualityScore({
  tableName,
  columns,
}: DataQualityScoreProps) {
  const [analysis, setAnalysis] = useState<QualityAnalysis | null>(null);
  const [status, setStatus] = useState("Run the scorecard to calculate quality metrics.");
  const [loading, setLoading] = useState(false);

  async function handleCalculate() {
    setLoading(true);
    setStatus("Calculating completeness, uniqueness, consistency, and validity...");
    try {
      const rows = await runQuery(
        `SELECT COUNT(*) AS row_count FROM "${tableName.replaceAll('"', '""')}"`
      );
      const nextAnalysis = buildAnalysis(tableName, columns, toNumber(rows[0]?.row_count));
      startTransition(() => {
        setAnalysis(nextAnalysis);
        setStatus(`Scored ${columns.length} columns across ${formatNumber(nextAnalysis.rowCount)} rows.`);
      });
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to calculate the quality score.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!analysis) return;
    downloadFile(
      [
        JSON.stringify(analysis, null, 2),
        "\n\n",
        buildReportCsv(analysis),
      ],
      `${tableName}-quality-report.txt`,
      "text/plain;charset=utf-8",
    );
  }

  const chartOption = useMemo<EChartsOption>(() => {
    if (!analysis) return {};

    return {
      tooltip: {
        trigger: "item",
        formatter: formatRadarTooltip,
      },
      legend: {
        bottom: 0,
        textStyle: {
          color: "#64748b",
        },
      },
      radar: {
        indicator: [
          { name: "Completeness", max: 100 },
          { name: "Uniqueness", max: 100 },
          { name: "Consistency", max: 100 },
          { name: "Validity", max: 100 },
        ],
        splitNumber: 5,
        axisName: {
          color: "#0f172a",
        },
        splitArea: {
          areaStyle: {
            color: ["rgba(14,165,233,0.05)", "rgba(14,165,233,0.08)"],
          },
        },
      },
      series: [
        {
          name: "Quality dimensions",
          type: "radar",
          areaStyle: {
            color: "rgba(14, 165, 233, 0.22)",
          },
          lineStyle: {
            color: "#06b6d4",
            width: 2,
          },
          itemStyle: {
            color: "#0891b2",
          },
          data: [
            {
              value: [
                analysis.dimensions.completeness,
                analysis.dimensions.uniqueness,
                analysis.dimensions.consistency,
                analysis.dimensions.validity,
              ],
              name: "Overall dimensions",
            },
          ],
        },
      ],
    };
  }, [analysis]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE }}
      className={`${PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-4 border-b border-white/20 pb-5 dark:border-white/10 xl:flex-row xl:items-center xl:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">
            <Sparkles className="h-3.5 w-3.5" />
            Data Quality Score
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
              Score data quality across four dimensions
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Measure completeness, uniqueness, consistency, and validity, then
              export the scorecard as a report.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              void handleCalculate();
            }}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-400 dark:disabled:bg-slate-700"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Calculate quality score
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={!analysis}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-900/50 dark:text-slate-200"
          >
            <Download className="h-4 w-4" />
            Export report
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-white/60 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
        {status}
      </div>

      {analysis ? (
        <div className="mt-6 space-y-6">
          <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <div className={`${PANEL_CLASS} p-5`}>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Overall quality score
              </p>
              <p className="mt-3 text-5xl font-semibold text-slate-900 dark:text-slate-50">
                {analysis.overall.toFixed(1)}
              </p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Based on {formatNumber(analysis.rowCount)} rows and{" "}
                {formatNumber(analysis.columnScores.length)} profiled columns.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/50">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Completeness
                  </p>
                  <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">
                    {analysis.dimensions.completeness.toFixed(1)}
                  </p>
                </div>
                <div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/50">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Uniqueness
                  </p>
                  <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">
                    {analysis.dimensions.uniqueness.toFixed(1)}
                  </p>
                </div>
                <div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/50">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Consistency
                  </p>
                  <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">
                    {analysis.dimensions.consistency.toFixed(1)}
                  </p>
                </div>
                <div className="rounded-2xl bg-white/70 p-4 dark:bg-slate-900/50">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Validity
                  </p>
                  <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">
                    {analysis.dimensions.validity.toFixed(1)}
                  </p>
                </div>
              </div>
            </div>

            <div className={`${PANEL_CLASS} p-5`}>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Radar chart
              </p>
              <div className="mt-3 h-[20rem]">
                <ReactEChartsCore
                  echarts={echarts}
                  option={chartOption}
                  notMerge
                  lazyUpdate
                  style={{ height: "100%", width: "100%" }}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className={`${PANEL_CLASS} p-5`}>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Column scores
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Column</th>
                      <th className="px-3 py-2 font-medium">Overall</th>
                      <th className="px-3 py-2 font-medium">Completeness</th>
                      <th className="px-3 py-2 font-medium">Uniqueness</th>
                      <th className="px-3 py-2 font-medium">Consistency</th>
                      <th className="px-3 py-2 font-medium">Validity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.columnScores.map((score) => (
                      <tr
                        key={score.columnName}
                        className="border-t border-white/20 dark:border-white/10"
                      >
                        <td className="px-3 py-3 font-medium text-slate-900 dark:text-slate-50">
                          {score.columnName}
                        </td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                          {score.overall.toFixed(1)}
                        </td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                          {score.completeness.toFixed(1)}
                        </td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                          {score.uniqueness.toFixed(1)}
                        </td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                          {score.consistency.toFixed(1)}
                        </td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                          {score.validity.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={`${PANEL_CLASS} p-5`}>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Recommendations
              </p>
              <ul className="mt-4 space-y-3">
                {analysis.recommendations.map((recommendation) => (
                  <li
                    key={recommendation}
                    className="rounded-2xl bg-white/70 px-4 py-3 text-sm text-slate-700 dark:bg-slate-900/50 dark:text-slate-200"
                  >
                    {recommendation}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </motion.section>
  );
}
