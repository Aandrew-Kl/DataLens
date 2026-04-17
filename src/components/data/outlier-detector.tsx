"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { memo, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import type { ColumnProfile } from "@/types/dataset";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";

interface OutlierDetectorProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface OutlierValue {
  value: number;
  frequency: number;
  deviation: number;
}

interface OutlierSummary {
  columnName: string;
  q1: number | null;
  q3: number | null;
  iqr: number | null;
  lowerBound: number | null;
  upperBound: number | null;
  nonNullCount: number;
  outlierCount: number;
  topValues: OutlierValue[];
}

type OutlierRow = Record<string, unknown>;
function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toSqlNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : "NULL";
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(3);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function getSeverityMeta(rate: number, count: number) {
  if (count === 0) {
    return {
      label: "Stable",
      accent:
        "border-emerald-200/70 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300",
      Icon: CheckCircle2,
    };
  }

  if (rate <= 0.01) {
    return {
      label: "Monitor",
      accent:
        "border-amber-200/70 bg-amber-500/10 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300",
      Icon: AlertTriangle,
    };
  }

  return {
    label: "High spread",
    accent:
      "border-red-200/70 bg-red-500/10 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300",
    Icon: AlertTriangle,
  };
}

async function fetchColumnSummary(
  tableName: string,
  columnName: string,
): Promise<OutlierSummary> {
  const safeTable = quoteIdentifier(tableName);
  const safeColumn = quoteIdentifier(columnName);

  const summarySql = `
    WITH stats AS (
      SELECT
        quantile_cont(${safeColumn}, 0.25) AS q1,
        quantile_cont(${safeColumn}, 0.75) AS q3,
        COUNT(${safeColumn}) AS non_null_count
      FROM ${safeTable}
      WHERE ${safeColumn} IS NOT NULL
    ),
    bounds AS (
      SELECT
        q1,
        q3,
        q3 - q1 AS iqr,
        q1 - 1.5 * (q3 - q1) AS lower_bound,
        q3 + 1.5 * (q3 - q1) AS upper_bound,
        non_null_count
      FROM stats
    )
    SELECT
      q1,
      q3,
      iqr,
      lower_bound,
      upper_bound,
      non_null_count,
      COUNT(*) FILTER (
        WHERE ${safeColumn} IS NOT NULL
          AND (${safeColumn} < lower_bound OR ${safeColumn} > upper_bound)
      ) AS outlier_count
    FROM ${safeTable}, bounds
  `;

  const summaryRow = (await runQuery(summarySql))[0] ?? {};

  const summary: OutlierSummary = {
    columnName,
    q1: toNullableNumber(summaryRow.q1),
    q3: toNullableNumber(summaryRow.q3),
    iqr: toNullableNumber(summaryRow.iqr),
    lowerBound: toNullableNumber(summaryRow.lower_bound),
    upperBound: toNullableNumber(summaryRow.upper_bound),
    nonNullCount: Number(summaryRow.non_null_count ?? 0),
    outlierCount: Number(summaryRow.outlier_count ?? 0),
    topValues: [],
  };

  if (
    summary.outlierCount === 0 ||
    summary.q1 === null ||
    summary.q3 === null ||
    summary.lowerBound === null ||
    summary.upperBound === null
  ) {
    return summary;
  }

  const midpoint = (summary.q1 + summary.q3) / 2;
  const topValuesSql = `
    SELECT
      CAST(${safeColumn} AS DOUBLE) AS value,
      COUNT(*) AS frequency,
      MAX(ABS(CAST(${safeColumn} AS DOUBLE) - ${toSqlNumber(midpoint)})) AS deviation
    FROM ${safeTable}
    WHERE ${safeColumn} IS NOT NULL
      AND (
        ${safeColumn} < ${toSqlNumber(summary.lowerBound)}
        OR ${safeColumn} > ${toSqlNumber(summary.upperBound)}
      )
    GROUP BY value
    ORDER BY deviation DESC, frequency DESC
    LIMIT 5
  `;

  const topValues = await runQuery(topValuesSql);

  return {
    ...summary,
    topValues: topValues
      .map((row) => ({
        value: Number(row.value ?? 0),
        frequency: Number(row.frequency ?? 0),
        deviation: Number(row.deviation ?? 0),
      }))
      .filter((row) => Number.isFinite(row.value)),
  };
}

function OutlierDetector({
  tableName,
  columns,
}: OutlierDetectorProps) {
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );

  const [summaries, setSummaries] = useState<OutlierSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedColumn, setExpandedColumn] = useState<string | null>(null);
  const [rowsByColumn, setRowsByColumn] = useState<Record<string, OutlierRow[]>>({});
  const [rowLoadingColumn, setRowLoadingColumn] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (numericColumns.length === 0) {
      setSummaries([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchSummaries() {
      setLoading(true);
      setError(null);

      try {
        const results = await Promise.all(
          numericColumns.map((column) => fetchColumnSummary(tableName, column.name)),
        );

        if (cancelled) return;

        setSummaries(
          results.sort(
            (left, right) =>
              right.outlierCount - left.outlierCount ||
              left.columnName.localeCompare(right.columnName),
          ),
        );
      } catch (fetchError) {
        if (cancelled) return;
        setSummaries([]);
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to detect outliers.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSummaries();

    return () => {
      cancelled = true;
    };
  }, [numericColumns, tableName]);

  const totalOutliers = useMemo(
    () => summaries.reduce((sum, summary) => sum + summary.outlierCount, 0),
    [summaries],
  );

  const columnsWithOutliers = useMemo(
    () => summaries.filter((summary) => summary.outlierCount > 0).length,
    [summaries],
  );

  async function handleToggleRows(summary: OutlierSummary) {
    if (expandedColumn === summary.columnName) {
      setExpandedColumn(null);
      return;
    }

    setExpandedColumn(summary.columnName);

    if (rowsByColumn[summary.columnName] || summary.outlierCount === 0) {
      return;
    }

    if (
      summary.lowerBound === null ||
      summary.upperBound === null ||
      summary.q1 === null ||
      summary.q3 === null
    ) {
      return;
    }

    try {
      setRowLoadingColumn(summary.columnName);
      setRowErrors((current) => {
        const next = { ...current };
        delete next[summary.columnName];
        return next;
      });

      const safeTable = quoteIdentifier(tableName);
      const safeColumn = quoteIdentifier(summary.columnName);
      const midpoint = (summary.q1 + summary.q3) / 2;
      const rowsSql = `
        SELECT *
        FROM (
          SELECT
            *,
            ABS(CAST(${safeColumn} AS DOUBLE) - ${toSqlNumber(midpoint)}) AS "__deviation"
          FROM ${safeTable}
          WHERE ${safeColumn} IS NOT NULL
            AND (
              ${safeColumn} < ${toSqlNumber(summary.lowerBound)}
              OR ${safeColumn} > ${toSqlNumber(summary.upperBound)}
            )
        )
        ORDER BY "__deviation" DESC
        LIMIT 20
      `;

      const rows = await runQuery(rowsSql);

      setRowsByColumn((current) => ({
        ...current,
        [summary.columnName]: rows,
      }));
    } catch (fetchError) {
      setRowErrors((current) => ({
        ...current,
        [summary.columnName]:
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load outlier rows.",
      }));
    } finally {
      setRowLoadingColumn((current) =>
        current === summary.columnName ? null : current,
      );
    }
  }

  if (numericColumns.length === 0) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        className="
          rounded-2xl border border-gray-200/50 dark:border-gray-700/50
          bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl
          p-6 shadow-xl shadow-slate-900/5
        "
      >
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">
          Outlier Detector
        </p>
        <h3 className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
          No numeric columns available
        </h3>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          IQR-based outlier detection requires at least one numeric field.
        </p>
      </motion.section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      className="
        rounded-2xl border border-gray-200/50 dark:border-gray-700/50
        bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl
        p-6 shadow-xl shadow-slate-900/5
      "
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">
            Outlier Detector
          </p>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Tukey IQR fences across {numericColumns.length} numeric columns
          </h3>
          <p className="max-w-2xl text-sm text-gray-600 dark:text-gray-400">
            Values below Q1 - 1.5×IQR or above Q3 + 1.5×IQR are flagged and ranked by
            distance from the interquartile center.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-200/60 bg-white/70 px-4 py-3 dark:border-gray-700/70 dark:bg-gray-950/35">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              Columns With Outliers
            </p>
            <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {columnsWithOutliers}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200/60 bg-white/70 px-4 py-3 dark:border-gray-700/70 dark:bg-gray-950/35">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              Total Outlier Cells
            </p>
            <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {formatNumber(totalOutliers)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {loading ? (
          <div className="grid min-h-[220px] place-items-center rounded-2xl border border-gray-200/60 bg-white/55 dark:border-gray-800/70 dark:bg-gray-950/35">
            <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200/60 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        ) : (
          summaries.map((summary, index) => {
            const outlierRate =
              summary.nonNullCount > 0 ? summary.outlierCount / summary.nonNullCount : 0;
            const severity = getSeverityMeta(outlierRate, summary.outlierCount);
            const Icon = severity.Icon;
            const rows = rowsByColumn[summary.columnName] ?? [];
            const rowColumns =
              rows.length > 0
                ? Object.keys(rows[0]).filter((key) => !key.startsWith("__"))
                : [];

            return (
              <motion.div
                key={summary.columnName}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03, duration: 0.24 }}
                className="overflow-hidden rounded-2xl border border-gray-200/60 bg-white/70 dark:border-gray-700/70 dark:bg-gray-950/35"
              >
                <div className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                          {summary.columnName}
                        </h4>
                        <span
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${severity.accent}`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {severity.label}
                        </span>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-xl border border-gray-200/60 bg-white/70 px-4 py-3 dark:border-gray-800/70 dark:bg-gray-950/35">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                            Outliers
                          </p>
                          <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">
                            {formatNumber(summary.outlierCount)}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {(outlierRate * 100).toFixed(2)}% of non-null values
                          </p>
                        </div>

                        <div className="rounded-xl border border-gray-200/60 bg-white/70 px-4 py-3 dark:border-gray-800/70 dark:bg-gray-950/35">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                            IQR
                          </p>
                          <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">
                            {summary.iqr === null ? "—" : formatNumber(summary.iqr)}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            Q1 {summary.q1 === null ? "—" : formatNumber(summary.q1)} / Q3{" "}
                            {summary.q3 === null ? "—" : formatNumber(summary.q3)}
                          </p>
                        </div>

                        <div className="rounded-xl border border-gray-200/60 bg-white/70 px-4 py-3 dark:border-gray-800/70 dark:bg-gray-950/35">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                            Lower Fence
                          </p>
                          <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">
                            {summary.lowerBound === null ? "—" : formatNumber(summary.lowerBound)}
                          </p>
                        </div>

                        <div className="rounded-xl border border-gray-200/60 bg-white/70 px-4 py-3 dark:border-gray-800/70 dark:bg-gray-950/35">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                            Upper Fence
                          </p>
                          <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">
                            {summary.upperBound === null ? "—" : formatNumber(summary.upperBound)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleToggleRows(summary)}
                      className="
                        inline-flex items-center justify-center gap-2 rounded-full
                        border border-gray-200/70 bg-white/80 px-4 py-2 text-sm font-medium
                        text-gray-700 transition-colors hover:bg-gray-100
                        dark:border-gray-700/70 dark:bg-gray-950/40 dark:text-gray-200 dark:hover:bg-gray-900
                      "
                    >
                      {expandedColumn === summary.columnName ? (
                        <>
                          <EyeOff className="h-4 w-4" />
                          Hide outlier rows
                        </>
                      ) : (
                        <>
                          <Eye className="h-4 w-4" />
                          View outlier rows
                        </>
                      )}
                    </button>
                  </div>

                  <div className="mt-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                      Top Outlier Values
                    </p>
                    {summary.topValues.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {summary.topValues.map((value, valueIndex) => (
                          <span
                            key={`${summary.columnName}-${value.value}-${valueIndex}`}
                            className="rounded-full border border-red-200/60 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
                          >
                            {formatNumber(value.value)}
                            {value.frequency > 1 ? ` × ${value.frequency}` : ""}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                        No outlier values detected for this column.
                      </p>
                    )}
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {expandedColumn === summary.columnName && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="border-t border-gray-200/60 bg-white/55 p-5 dark:border-gray-800/70 dark:bg-gray-950/25"
                    >
                      {rowLoadingColumn === summary.columnName ? (
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading outlier rows…
                        </div>
                      ) : rowErrors[summary.columnName] ? (
                        <div className="rounded-xl border border-red-200/60 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                          {rowErrors[summary.columnName]}
                        </div>
                      ) : rows.length === 0 ? (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          No outlier rows to display for this column.
                        </p>
                      ) : (
                        <div className="overflow-auto rounded-xl border border-gray-200/60 dark:border-gray-800/70">
                          <table className="min-w-full divide-y divide-gray-200/60 text-left text-xs dark:divide-gray-800/70">
                            <thead className="bg-gray-50/80 dark:bg-gray-900/70">
                              <tr>
                                <th className="px-3 py-2 font-semibold uppercase tracking-[0.15em] text-gray-500 dark:text-gray-400">
                                  Row
                                </th>
                                {rowColumns.map((column) => (
                                  <th
                                    key={`${summary.columnName}-header-${column}`}
                                    className="px-3 py-2 font-semibold uppercase tracking-[0.15em] text-gray-500 dark:text-gray-400"
                                  >
                                    {column}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200/60 bg-white/80 dark:divide-gray-800/70 dark:bg-gray-950/25">
                              {rows.map((row, rowIndex) => (
                                <tr key={`${summary.columnName}-row-${rowIndex}`}>
                                  <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-500 dark:text-gray-400">
                                    {rowIndex + 1}
                                  </td>
                                  {rowColumns.map((column) => (
                                    <td
                                      key={`${summary.columnName}-row-${rowIndex}-${column}`}
                                      className="max-w-[220px] truncate px-3 py-2 text-gray-700 dark:text-gray-300"
                                      title={renderValue(row[column])}
                                    >
                                      {renderValue(row[column])}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })
        )}
      </div>
    </motion.section>
  );
}

export default memo(OutlierDetector);
