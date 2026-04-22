"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { ColumnProfile } from "@/types/dataset";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";

interface MissingDataMapProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

interface MissingColumnMetric {
  name: string;
  type: ColumnProfile["type"];
  nullCount: number;
  nullPercentage: number;
  completeness: number;
}
function getCompletenessColor(completeness: number): string {
  if (completeness > 95) return "bg-emerald-500";
  if (completeness >= 80) return "bg-amber-400";
  return "bg-red-500";
}

function getCompletenessText(completeness: number): string {
  if (completeness > 95) return "text-emerald-700 dark:text-emerald-300";
  if (completeness >= 80) return "text-amber-700 dark:text-amber-300";
  return "text-red-700 dark:text-red-300";
}

function buildSuggestions(
  metrics: MissingColumnMetric[],
  totalRows: number,
): string[] {
  const fullyMissing = metrics.filter((metric) => metric.nullCount === totalRows && totalRows > 0);
  const critical = metrics.filter((metric) => metric.completeness < 80);
  const moderateNumeric = metrics.filter(
    (metric) => metric.type === "number" && metric.completeness >= 80 && metric.completeness <= 95,
  );
  const categoricalGaps = critical.filter((metric) => metric.type !== "number");
  const lowRisk = metrics.filter((metric) => metric.completeness > 95);

  const suggestions: string[] = [];

  if (fullyMissing.length > 0) {
    suggestions.push(
      `Drop or backfill fully empty columns first: ${fullyMissing
        .slice(0, 3)
        .map((metric) => metric.name)
        .join(", ")}${fullyMissing.length > 3 ? ", …" : ""}.`,
    );
  }

  if (critical.length > 0) {
    suggestions.push(
      `Review upstream collection for heavily incomplete fields before modeling or dashboarding: ${critical
        .slice(0, 4)
        .map((metric) => metric.name)
        .join(", ")}${critical.length > 4 ? ", …" : ""}.`,
    );
  }

  if (moderateNumeric.length > 0) {
    suggestions.push(
      `Use median or model-based imputation for moderately incomplete numeric columns such as ${moderateNumeric
        .slice(0, 3)
        .map((metric) => metric.name)
        .join(", ")}${moderateNumeric.length > 3 ? ", …" : ""}.`,
    );
  }

  if (categoricalGaps.length > 0) {
    suggestions.push(
      `For categorical or date fields with large gaps, prefer explicit "Unknown" categories or source-system backfills over silent fills.`,
    );
  }

  if (suggestions.length === 0 && lowRisk.length > 0) {
    suggestions.push(
      "Missingness is low overall, so targeted filtering or lightweight imputation should be sufficient for most analyses.",
    );
  }

  return suggestions.slice(0, 4);
}

export default function MissingDataMap({
  tableName,
  columns,
  rowCount,
}: MissingDataMapProps) {
  const [metrics, setMetrics] = useState<MissingColumnMetric[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // TODO(wave6): migrate to useQuery — single-SELECT + post-processing pattern.
  useEffect(() => {
    if (columns.length === 0) {
      setMetrics([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchMissingness() {
      setLoading(true);
      setError(null);

      try {
        const safeTable = quoteIdentifier(tableName);
        const selectClauses = columns.map(
          (column, index) =>
            `COUNT(*) FILTER (WHERE ${quoteIdentifier(column.name)} IS NULL) AS "c${index}_nulls"`,
        );

        const sql = `
          SELECT
            COUNT(*) AS row_count,
            ${selectClauses.join(",\n            ")}
          FROM ${safeTable}
        `;

        const resultRow = (await runQuery(sql))[0] ?? {};
        const queriedRowCount = Number(resultRow.row_count ?? 0);
        const resolvedRowCount = queriedRowCount > 0 ? queriedRowCount : rowCount;

        const nextMetrics = columns
          .map((column, index) => {
            const nullCount = Number(resultRow[`c${index}_nulls`] ?? column.nullCount ?? 0);
            const nullPercentage =
              resolvedRowCount > 0 ? (nullCount / resolvedRowCount) * 100 : 0;
            const completeness = Math.max(0, 100 - nullPercentage);

            return {
              name: column.name,
              type: column.type,
              nullCount,
              nullPercentage,
              completeness,
            };
          })
          .sort((left, right) => right.completeness - left.completeness);

        if (cancelled) return;
        setMetrics(nextMetrics);
      } catch (fetchError) {
        if (cancelled) return;
        setMetrics([]);
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to compute missing-data coverage.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchMissingness();

    return () => {
      cancelled = true;
    };
  }, [columns, rowCount, tableName]);

  const completenessScore = useMemo(() => {
    if (metrics.length === 0 || rowCount === 0) return 0;
    const totalCells = rowCount * metrics.length;
    const totalMissing = metrics.reduce((sum, metric) => sum + metric.nullCount, 0);
    return ((totalCells - totalMissing) / totalCells) * 100;
  }, [metrics, rowCount]);

  const completenessBreakdown = useMemo(() => {
    const green = metrics.filter((metric) => metric.completeness > 95).length;
    const yellow = metrics.filter(
      (metric) => metric.completeness >= 80 && metric.completeness <= 95,
    ).length;
    const red = metrics.filter((metric) => metric.completeness < 80).length;

    return { green, yellow, red };
  }, [metrics]);

  const suggestions = useMemo(
    () => buildSuggestions(metrics, rowCount),
    [metrics, rowCount],
  );

  if (columns.length === 0) {
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
          Missing Data Map
        </p>
        <h3 className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
          No columns available
        </h3>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Load a dataset to visualize null coverage and completeness.
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
            Missing Data Map
          </p>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Column completeness ranked from strongest to weakest
          </h3>
          <p className="max-w-2xl text-sm text-gray-600 dark:text-gray-400">
            Bars show each column&apos;s null percentage while the color indicates its overall
            completeness threshold.
          </p>
        </div>

        <div className="min-w-[260px] rounded-2xl border border-gray-200/60 bg-white/70 p-4 dark:border-gray-700/70 dark:bg-gray-950/35">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
            Overall Completeness
          </p>
          <div className="mt-2 flex items-end gap-3">
            <p className="text-3xl font-semibold text-gray-900 dark:text-gray-100">
              {completenessScore.toFixed(1)}%
            </p>
            <span className="pb-1 text-sm text-gray-500 dark:text-gray-400">
              across {formatNumber(rowCount)} rows
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200/80 dark:bg-gray-800/80">
            <motion.div
              className={getCompletenessColor(completenessScore)}
              initial={{ width: 0 }}
              animate={{ width: `${completenessScore}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              style={{ height: "100%" }}
            />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl bg-emerald-500/10 px-2 py-2 text-emerald-700 dark:text-emerald-300">
              <p className="font-semibold">{completenessBreakdown.green}</p>
              <p>&gt;95%</p>
            </div>
            <div className="rounded-xl bg-amber-500/10 px-2 py-2 text-amber-700 dark:text-amber-300">
              <p className="font-semibold">{completenessBreakdown.yellow}</p>
              <p>80-95%</p>
            </div>
            <div className="rounded-xl bg-red-500/10 px-2 py-2 text-red-700 dark:text-red-300">
              <p className="font-semibold">{completenessBreakdown.red}</p>
              <p>&lt;80%</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">
        <div className="rounded-2xl border border-gray-200/60 bg-white/55 p-4 dark:border-gray-800/70 dark:bg-gray-950/35">
          {loading ? (
            <div className="grid min-h-[260px] place-items-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
                className="h-10 w-10 rounded-full border-2 border-emerald-500/25 border-t-emerald-500"
              />
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200/60 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </div>
          ) : (
            <div className="space-y-3">
              {metrics.map((metric, index) => (
                <motion.div
                  key={metric.name}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.03, duration: 0.24 }}
                  className="rounded-2xl border border-gray-200/60 bg-white/80 p-4 dark:border-gray-800/70 dark:bg-gray-950/30"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p
                        className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100"
                        title={metric.name}
                      >
                        {metric.name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {metric.nullCount.toLocaleString()} nulls
                      </p>
                    </div>

                    <div className={`text-right ${getCompletenessText(metric.completeness)}`}>
                      <p className="text-sm font-semibold">{metric.completeness.toFixed(1)}% complete</p>
                      <p className="text-xs">{metric.nullPercentage.toFixed(1)}% null</p>
                    </div>
                  </div>

                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200/80 dark:bg-gray-800/70">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${metric.nullPercentage}%` }}
                      transition={{ delay: index * 0.03 + 0.08, duration: 0.45, ease: "easeOut" }}
                      className={getCompletenessColor(metric.completeness)}
                      style={{ height: "100%" }}
                    />
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200/60 bg-white/55 p-4 dark:border-gray-800/70 dark:bg-gray-950/35">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
            Suggested Actions
          </p>
          <div className="mt-4 space-y-3">
            {suggestions.map((suggestion, index) => (
              <motion.div
                key={`${suggestion}-${index}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05, duration: 0.24 }}
                className="rounded-2xl border border-gray-200/60 bg-white/80 px-4 py-3 text-sm text-gray-700 dark:border-gray-800/70 dark:bg-gray-950/30 dark:text-gray-300"
              >
                {suggestion}
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
