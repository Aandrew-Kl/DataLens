"use client";

import {
  Suspense,
  use,
  useMemo,
  useState,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { ScatterChart } from "echarts/charts";
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
  Filter,
  Percent,
  Sigma,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import {
  mean,
  percentile,
  quartiles,
  standardDeviation,
  zScore,
} from "@/lib/utils/statistics";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface OutlierReportProps {
  tableName: string;
  columns: ColumnProfile[];
}

type DetectionMethod = "zscore" | "iqr" | "percentile";
type Severity = "mild" | "moderate" | "severe";

interface OutlierRowResult {
  rowId: number;
  value: number;
  severity: Severity;
  score: number;
  preview: string;
  exportRow: Record<string, unknown>;
}

interface OutlierReportResult {
  rowCount: number;
  outlierCount: number;
  outlierShare: number;
  lowerBound: number | null;
  upperBound: number | null;
  meanBefore: number;
  meanAfterRemoval: number;
  meanImpactPercent: number;
  normalPoints: Array<[number, number]>;
  outlierPoints: Array<[number, number]>;
  rows: OutlierRowResult[];
  error: string | null;
}

interface DetectionConfig {
  zScoreThreshold: number;
  iqrFactor: number;
  percentileTail: number;
}

function ReportLoadingState() {
  return (
    <div
      className={`${GLASS_PANEL_CLASS} flex min-h-[28rem] items-center justify-center`}
    >
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Building outlier report…
      </div>
    </div>
  );
}

function ReportEmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Outlier Report
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {message}
          </p>
        </div>
      </div>
    </section>
  );
}

function formatMetric(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return Math.abs(value) >= 1000 || Number.isInteger(value)
    ? formatNumber(value)
    : value.toFixed(3);
}

function toPreview(row: Record<string, unknown>, metricColumn: string) {
  const parts = Object.entries(row)
    .filter(([key]) => key !== "__row_id" && key !== "__metric" && key !== metricColumn)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`);

  return parts.join(" • ") || "No additional columns";
}

function classifySeverity(score: number) {
  if (score >= 2) return "severe";
  if (score >= 1.3) return "moderate";
  return "mild";
}

function calculateMeanImpact(before: number, after: number) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return 0;
  if (before === 0) return after === 0 ? 0 : 100;
  return ((after - before) / Math.abs(before)) * 100;
}

function buildScatterOption(
  normalPoints: Array<[number, number]>,
  outlierPoints: Array<[number, number]>,
  columnName: string,
): EChartsOption {
  return {
    animationDuration: 400,
    tooltip: { trigger: "item" },
    legend: {
      data: ["Inlier", "Outlier"],
      top: 0,
    },
    grid: {
      left: 16,
      right: 16,
      top: 42,
      bottom: 16,
      containLabel: true,
    },
    xAxis: {
      type: "value",
      name: "Row",
    },
    yAxis: {
      type: "value",
      name: columnName,
    },
    series: [
      {
        name: "Inlier",
        type: "scatter",
        symbolSize: 10,
        data: normalPoints,
        itemStyle: {
          color: "rgba(14, 165, 233, 0.75)",
        },
      },
      {
        name: "Outlier",
        type: "scatter",
        symbolSize: 14,
        data: outlierPoints,
        itemStyle: {
          color: "rgba(239, 68, 68, 0.85)",
        },
      },
    ],
  };
}

function buildExportCsv(rows: OutlierRowResult[]) {
  const headers = ["row_id", "value", "severity", "score", "preview"];
  const body = rows.map((row) =>
    [
      row.rowId,
      row.value,
      row.severity,
      row.score.toFixed(4),
      `"${row.preview.replace(/"/g, '""')}"`,
    ].join(","),
  );
  return [headers.join(","), ...body].join("\n");
}

function flagZScoreOutliers(
  values: number[],
  threshold: number,
) {
  const average = mean(values);
  const spread = standardDeviation(values);

  return values.map((value) => {
    const score = Math.abs(zScore(value, average, spread));
    const flagged = Number.isFinite(score) && score >= threshold;
    return {
      flagged,
      severityScore: flagged ? Math.max(1, score - threshold + 1) : 0,
      lowerBound: average - threshold * spread,
      upperBound: average + threshold * spread,
    };
  });
}

function flagIqrOutliers(
  values: number[],
  factor: number,
) {
  const { q1, q3 } = quartiles(values);
  const interquartileRange = q3 - q1;
  const lowerBound = q1 - factor * interquartileRange;
  const upperBound = q3 + factor * interquartileRange;

  return values.map((value) => {
    const distance =
      value < lowerBound
        ? (lowerBound - value) / Math.max(interquartileRange, 1e-6)
        : value > upperBound
          ? (value - upperBound) / Math.max(interquartileRange, 1e-6)
          : 0;
    return {
      flagged: value < lowerBound || value > upperBound,
      severityScore: distance <= 0 ? 0 : 1 + distance,
      lowerBound,
      upperBound,
    };
  });
}

function flagPercentileOutliers(
  values: number[],
  tailPercent: number,
) {
  const lowerBound = percentile(values, tailPercent);
  const upperBound = percentile(values, 100 - tailPercent);
  const fullSpan = Math.max(Math.abs(upperBound - lowerBound), 1e-6);

  return values.map((value) => {
    const distance =
      value < lowerBound
        ? (lowerBound - value) / fullSpan
        : value > upperBound
          ? (value - upperBound) / fullSpan
          : 0;
    return {
      flagged: value < lowerBound || value > upperBound,
      severityScore: distance <= 0 ? 0 : 1 + distance * 4,
      lowerBound,
      upperBound,
    };
  });
}

async function loadOutlierReport(
  tableName: string,
  columnName: string,
  method: DetectionMethod,
  config: DetectionConfig,
): Promise<OutlierReportResult> {
  try {
    const rows = await runQuery(`
      SELECT
        ROW_NUMBER() OVER () AS __row_id,
        *,
        TRY_CAST(${quoteIdentifier(columnName)} AS DOUBLE) AS __metric
      FROM ${quoteIdentifier(tableName)}
      WHERE ${quoteIdentifier(columnName)} IS NOT NULL
        AND TRY_CAST(${quoteIdentifier(columnName)} AS DOUBLE) IS NOT NULL
      LIMIT 4000
    `);

    const metricRows = rows
      .map((row) => ({
        source: row,
        rowId: Number(row.__row_id ?? 0),
        value: toNumber(row.__metric),
      }))
      .filter(
        (
          row,
        ): row is {
          source: Record<string, unknown>;
          rowId: number;
          value: number;
        } => row.value !== null && Number.isFinite(row.rowId),
      );

    if (metricRows.length === 0) {
      return {
        rowCount: 0,
        outlierCount: 0,
        outlierShare: 0,
        lowerBound: null,
        upperBound: null,
        meanBefore: 0,
        meanAfterRemoval: 0,
        meanImpactPercent: 0,
        normalPoints: [],
        outlierPoints: [],
        rows: [],
        error: "No numeric rows were available to analyze.",
      };
    }

    const values = metricRows.map((row) => row.value);
    const flaggedResults =
      method === "zscore"
        ? flagZScoreOutliers(values, config.zScoreThreshold)
        : method === "iqr"
          ? flagIqrOutliers(values, config.iqrFactor)
          : flagPercentileOutliers(values, config.percentileTail);

    const rowsWithFlags = metricRows.map((row, index) => ({
      row,
      details: flaggedResults[index],
    }));
    const flaggedRows = rowsWithFlags
      .filter((entry) => entry.details.flagged)
      .map<OutlierRowResult>((entry) => ({
        rowId: entry.row.rowId,
        value: entry.row.value,
        severity: classifySeverity(entry.details.severityScore),
        score: entry.details.severityScore,
        preview: toPreview(entry.row.source, columnName),
        exportRow: {
          row_id: entry.row.rowId,
          value: entry.row.value,
          severity: classifySeverity(entry.details.severityScore),
          score: entry.details.severityScore,
          preview: toPreview(entry.row.source, columnName),
        },
      }))
      .sort((left, right) => right.score - left.score || right.value - left.value);

    const cleanValues = rowsWithFlags
      .filter((entry) => !entry.details.flagged)
      .map((entry) => entry.row.value);
    const meanBefore = mean(values);
    const meanAfterRemoval = cleanValues.length > 0 ? mean(cleanValues) : 0;
    const normalPoints = rowsWithFlags
      .filter((entry) => !entry.details.flagged)
      .map((entry) => [entry.row.rowId, entry.row.value] as [number, number]);
    const outlierPoints = flaggedRows.map(
      (row) => [row.rowId, row.value] as [number, number],
    );

    return {
      rowCount: values.length,
      outlierCount: flaggedRows.length,
      outlierShare: (flaggedRows.length / values.length) * 100,
      lowerBound: flaggedResults[0]?.lowerBound ?? null,
      upperBound: flaggedResults[0]?.upperBound ?? null,
      meanBefore,
      meanAfterRemoval,
      meanImpactPercent: calculateMeanImpact(meanBefore, meanAfterRemoval),
      normalPoints,
      outlierPoints,
      rows: flaggedRows,
      error: null,
    };
  } catch (error) {
    return {
      rowCount: 0,
      outlierCount: 0,
      outlierShare: 0,
      lowerBound: null,
      upperBound: null,
      meanBefore: 0,
      meanAfterRemoval: 0,
      meanImpactPercent: 0,
      normalPoints: [],
      outlierPoints: [],
      rows: [],
      error:
        error instanceof Error
          ? error.message
          : "Failed to compute outlier report.",
    };
  }
}

function SummaryCard({
  label,
  icon: Icon,
  value,
  detail,
}: {
  label: string;
  icon: typeof Sigma;
  value: string;
  detail: string;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        {label}
      </div>
      <div className="mt-4 text-2xl font-semibold text-slate-950 dark:text-white">
        {value}
      </div>
      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{detail}</div>
    </div>
  );
}

function OutlierReportPanel({
  resource,
  tableName,
  columnName,
}: {
  resource: Promise<OutlierReportResult>;
  tableName: string;
  columnName: string;
}) {
  const result = use(resource);

  if (result.error) {
    return (
      <div className={`${GLASS_PANEL_CLASS} p-6`}>
        <p className="text-sm text-rose-600 dark:text-rose-300">{result.error}</p>
      </div>
    );
  }

  const chartOption = buildScatterOption(
    result.normalPoints,
    result.outlierPoints,
    columnName,
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className="space-y-5"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          label="Flagged rows"
          icon={AlertTriangle}
          value={formatNumber(result.outlierCount)}
          detail={`${formatPercent(result.outlierShare, 1)} of sampled rows`}
        />
        <SummaryCard
          label="Impact on mean if removed"
          icon={Percent}
          value={`${result.meanImpactPercent > 0 ? "+" : ""}${formatPercent(result.meanImpactPercent, 1)}`}
          detail={`${formatMetric(result.meanBefore)} to ${formatMetric(result.meanAfterRemoval)}`}
        />
        <SummaryCard
          label="Threshold band"
          icon={Filter}
          value={`${formatMetric(result.lowerBound)} to ${formatMetric(result.upperBound)}`}
          detail="Lower and upper cutoffs used for the active method"
        />
      </div>

      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
              Scatter view of outliers
            </h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Red points mark flagged rows, plotted against row order.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              downloadFile(
                buildExportCsv(result.rows),
                `${tableName}-${columnName}-outlier-report.csv`,
                "text/csv;charset=utf-8;",
              )
            }
            disabled={result.rows.length === 0}
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export outlier CSV
          </button>
        </div>

        <ReactEChartsCore
          echarts={echarts}
          option={chartOption}
          notMerge
          lazyUpdate
          style={{ height: 340 }}
        />
      </div>

      <div className={`${GLASS_PANEL_CLASS} overflow-hidden p-5`}>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            Flagged outliers
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Ranked by severity so the most disruptive records surface first.
          </p>
        </div>

        {result.rows.length === 0 ? (
          <div className="rounded-2xl border border-emerald-200/60 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/20 dark:text-emerald-300">
            No outliers were flagged for the current settings.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Value</th>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Preview</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.slice(0, 18).map((row) => (
                  <tr
                    key={`${row.rowId}-${row.value}`}
                    className="border-t border-white/10 text-slate-700 dark:text-slate-200"
                  >
                    <td className="px-3 py-3 font-medium">{`Row ${row.rowId}`}</td>
                    <td className="px-3 py-3">{formatMetric(row.value)}</td>
                    <td className="px-3 py-3 capitalize">{row.severity}</td>
                    <td className="px-3 py-3">{row.score.toFixed(2)}</td>
                    <td className="px-3 py-3 text-slate-500 dark:text-slate-400">
                      {row.preview}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function OutlierReport({
  tableName,
  columns,
}: OutlierReportProps) {
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [selectedColumn, setSelectedColumn] = useState(
    numericColumns[0]?.name ?? "",
  );
  const [method, setMethod] = useState<DetectionMethod>("zscore");
  const [zScoreInput, setZScoreInput] = useState("3");
  const [iqrFactor, setIqrFactor] = useState("1.5");
  const [percentileTailInput, setPercentileTailInput] = useState("5");

  const resolvedColumn = useMemo(() => {
    if (numericColumns.some((column) => column.name === selectedColumn)) {
      return selectedColumn;
    }
    return numericColumns[0]?.name ?? "";
  }, [numericColumns, selectedColumn]);

  const config = useMemo<DetectionConfig>(
    () => ({
      zScoreThreshold: Math.max(1, toNumber(zScoreInput) ?? 3),
      iqrFactor: Math.max(1.5, toNumber(iqrFactor) ?? 1.5),
      percentileTail: Math.min(20, Math.max(1, toNumber(percentileTailInput) ?? 5)),
    }),
    [iqrFactor, percentileTailInput, zScoreInput],
  );

  const resource = useMemo(() => {
    if (!resolvedColumn) {
      return Promise.resolve<OutlierReportResult>({
        rowCount: 0,
        outlierCount: 0,
        outlierShare: 0,
        lowerBound: null,
        upperBound: null,
        meanBefore: 0,
        meanAfterRemoval: 0,
        meanImpactPercent: 0,
        normalPoints: [],
        outlierPoints: [],
        rows: [],
        error: "Choose a numeric column to inspect.",
      });
    }

    return loadOutlierReport(tableName, resolvedColumn, method, config);
  }, [config, method, resolvedColumn, tableName]);

  if (numericColumns.length === 0) {
    return (
      <ReportEmptyState message="No numeric columns available for outlier analysis." />
    );
  }

  return (
    <section className="space-y-5">
      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Detection Workspace
                </p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                  Outlier Report
                </h2>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Compare Z-score, IQR, and percentile-based detection strategies,
              quantify how much outliers distort the mean, and inspect the rows
              that drive the biggest deviations.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Numeric column
              </span>
              <select
                value={resolvedColumn}
                onChange={(event) => setSelectedColumn(event.target.value)}
                className={FIELD_CLASS}
              >
                {numericColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Detection method
              </span>
              <select
                value={method}
                onChange={(event) =>
                  setMethod(event.target.value as DetectionMethod)
                }
                className={FIELD_CLASS}
              >
                <option value="zscore">Z-score</option>
                <option value="iqr">IQR</option>
                <option value="percentile">Percentile</option>
              </select>
            </label>

            {method === "zscore" ? (
              <label className="text-sm text-slate-600 dark:text-slate-300">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Z-score threshold
                </span>
                <input
                  value={zScoreInput}
                  onChange={(event) => setZScoreInput(event.target.value)}
                  inputMode="decimal"
                  className={FIELD_CLASS}
                />
              </label>
            ) : null}

            {method === "iqr" ? (
              <label className="text-sm text-slate-600 dark:text-slate-300">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  IQR fence
                </span>
                <select
                  value={iqrFactor}
                  onChange={(event) => setIqrFactor(event.target.value)}
                  className={FIELD_CLASS}
                >
                  <option value="1.5">1.5x IQR</option>
                  <option value="3">3x IQR</option>
                </select>
              </label>
            ) : null}

            {method === "percentile" ? (
              <label className="text-sm text-slate-600 dark:text-slate-300">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Tail percentile
                </span>
                <input
                  value={percentileTailInput}
                  onChange={(event) => setPercentileTailInput(event.target.value)}
                  inputMode="decimal"
                  className={FIELD_CLASS}
                />
              </label>
            ) : null}
          </div>
        </div>
      </div>

      <Suspense fallback={<ReportLoadingState />}>
        <OutlierReportPanel
          resource={resource}
          tableName={tableName}
          columnName={resolvedColumn}
        />
      </Suspense>
    </section>
  );
}
