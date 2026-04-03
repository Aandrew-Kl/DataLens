"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, Fingerprint, Loader2, ScanSearch } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface ColumnProfilerProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface ProfileStats {
  rowCount: number;
  nonNullCount: number;
  uniqueCount: number;
  minValue: string;
  maxValue: string;
  avgLength: number;
  minLength: number;
  maxLength: number;
  numericAverage: number;
}

interface ProfileResult {
  column: ColumnProfile;
  stats: ProfileStats;
  topValues: Array<{ value: string; frequency: number }>;
  bottomValues: string[];
  patterns: Array<{ pattern: string; frequency: number }>;
}

async function loadProfile(tableName: string, column: ColumnProfile): Promise<ProfileResult> {
  const identifier = quoteIdentifier(column.name);
  const tableIdentifier = quoteIdentifier(tableName);

  const statsQuery = `
    SELECT
      COUNT(*) AS row_count,
      COUNT(${identifier}) AS non_null_count,
      COUNT(DISTINCT ${identifier}) AS unique_count,
      MIN(CAST(${identifier} AS VARCHAR)) AS min_value,
      MAX(CAST(${identifier} AS VARCHAR)) AS max_value,
      AVG(LENGTH(CAST(${identifier} AS VARCHAR))) AS avg_length,
      MIN(LENGTH(CAST(${identifier} AS VARCHAR))) AS min_length,
      MAX(LENGTH(CAST(${identifier} AS VARCHAR))) AS max_length,
      AVG(TRY_CAST(${identifier} AS DOUBLE)) AS numeric_average
    FROM ${tableIdentifier}
  `;

  const topValuesQuery = `
    SELECT
      CAST(${identifier} AS VARCHAR) AS value,
      COUNT(*) AS frequency
    FROM ${tableIdentifier}
    WHERE ${identifier} IS NOT NULL
    GROUP BY 1
    ORDER BY 2 DESC, 1 ASC
    LIMIT 5
  `;

  const bottomValuesQuery = `
    SELECT DISTINCT CAST(${identifier} AS VARCHAR) AS value
    FROM ${tableIdentifier}
    WHERE ${identifier} IS NOT NULL
    ORDER BY 1 ASC
    LIMIT 5
  `;

  const patternQuery = `
    SELECT
      CASE
        WHEN REGEXP_MATCHES(CAST(${identifier} AS VARCHAR), '^[0-9]+$') THEN 'numeric-like'
        WHEN REGEXP_MATCHES(CAST(${identifier} AS VARCHAR), '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\\\.[A-Za-z]{2,}$') THEN 'email-like'
        WHEN REGEXP_MATCHES(CAST(${identifier} AS VARCHAR), '^\\d{4}-\\d{2}-\\d{2}') THEN 'date-like'
        WHEN REGEXP_MATCHES(CAST(${identifier} AS VARCHAR), '^[A-Za-z0-9_-]+$') THEN 'alphanumeric'
        ELSE 'free-text'
      END AS pattern,
      COUNT(*) AS frequency
    FROM ${tableIdentifier}
    WHERE ${identifier} IS NOT NULL
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 5
  `;

  const [statsRows, topValueRows, bottomValueRows, patternRows] = await Promise.all([
    runQuery(statsQuery),
    runQuery(topValuesQuery),
    runQuery(bottomValuesQuery),
    runQuery(patternQuery),
  ]);

  const statsRow = statsRows[0] ?? {};
  const stats: ProfileStats = {
    rowCount: Number(statsRow.row_count ?? 0),
    nonNullCount: Number(statsRow.non_null_count ?? 0),
    uniqueCount: Number(statsRow.unique_count ?? 0),
    minValue: String(statsRow.min_value ?? ""),
    maxValue: String(statsRow.max_value ?? ""),
    avgLength: Number(statsRow.avg_length ?? 0),
    minLength: Number(statsRow.min_length ?? 0),
    maxLength: Number(statsRow.max_length ?? 0),
    numericAverage: Number(statsRow.numeric_average ?? 0),
  };

  return {
    column,
    stats,
    topValues: topValueRows.map((row) => ({
      value: String(row.value ?? ""),
      frequency: Number(row.frequency ?? 0),
    })),
    bottomValues: bottomValueRows.map((row) => String(row.value ?? "")),
    patterns: patternRows.map((row) => ({
      pattern: String(row.pattern ?? "unknown"),
      frequency: Number(row.frequency ?? 0),
    })),
  };
}

function buildExportCsv(result: ProfileResult) {
  const completeness = result.stats.rowCount
    ? (result.stats.nonNullCount / result.stats.rowCount) * 100
    : 0;
  const uniqueness = result.stats.rowCount
    ? (result.stats.uniqueCount / result.stats.rowCount) * 100
    : 0;

  return [
    "metric,value",
    `column,${result.column.name}`,
    `completeness_pct,${completeness.toFixed(2)}`,
    `uniqueness_pct,${uniqueness.toFixed(2)}`,
    `row_count,${result.stats.rowCount}`,
    `non_null_count,${result.stats.nonNullCount}`,
    `unique_count,${result.stats.uniqueCount}`,
    `min_value,${result.stats.minValue}`,
    `max_value,${result.stats.maxValue}`,
    `avg_length,${result.stats.avgLength.toFixed(2)}`,
    `min_length,${result.stats.minLength}`,
    `max_length,${result.stats.maxLength}`,
    `numeric_average,${result.stats.numericAverage.toFixed(4)}`,
  ].join("\n");
}

export default function ColumnProfiler({
  tableName,
  columns,
}: ColumnProfilerProps) {
  const selectableColumns = useMemo(() => columns, [columns]);
  const [selectedColumnName, setSelectedColumnName] = useState(selectableColumns[0]?.name ?? "");
  const [result, setResult] = useState<ProfileResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedColumn =
    selectableColumns.find((column) => column.name === selectedColumnName) ?? null;

  async function handleProfile() {
    if (!selectedColumn) {
      setError("Select a column to profile.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const nextResult = await loadProfile(tableName, selectedColumn);
      setResult(nextResult);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Column profile failed.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;
    downloadFile(
      buildExportCsv(result),
      `${tableName}-${result.column.name}-profile.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  const completeness = result?.stats.rowCount
    ? (result.stats.nonNullCount / result.stats.rowCount) * 100
    : 0;
  const uniqueness = result?.stats.rowCount
    ? (result.stats.uniqueCount / result.stats.rowCount) * 100
    : 0;

  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <ScanSearch className="h-6 w-6 text-cyan-600 dark:text-cyan-300" />
            <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-50">
              Deep profile a single column
            </h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Inspect completeness, uniqueness, top and bottom values, value length statistics, and
            lightweight pattern analysis for one column at a time.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleProfile()}
            disabled={loading}
            className={BUTTON_CLASS}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
            Profile column
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={!result}
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export report
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.1fr)]">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Column
            </span>
            <select
              value={selectedColumnName}
              onChange={(event) => setSelectedColumnName(event.target.value)}
              className={FIELD_CLASS}
            >
              {selectableColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>

          {error ? (
            <p className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </p>
          ) : null}
        </div>

        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div className={`${GLASS_CARD_CLASS} p-4`}>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Completeness</div>
              <p className="mt-3 text-2xl font-semibold text-slate-950 dark:text-slate-50">{formatPercent(completeness, 1)}</p>
            </div>
            <div className={`${GLASS_CARD_CLASS} p-4`}>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Uniqueness</div>
              <p className="mt-3 text-2xl font-semibold text-slate-950 dark:text-slate-50">{formatPercent(uniqueness, 1)}</p>
            </div>
            <div className={`${GLASS_CARD_CLASS} p-4`}>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Min / Max</div>
              <p className="mt-3 text-sm font-semibold text-slate-950 dark:text-slate-50">{result ? `${result.stats.minValue} → ${result.stats.maxValue}` : "n/a"}</p>
            </div>
            <div className={`${GLASS_CARD_CLASS} p-4`}>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Avg length</div>
              <p className="mt-3 text-2xl font-semibold text-slate-950 dark:text-slate-50">{result ? result.stats.avgLength.toFixed(1) : "0.0"}</p>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: ANALYTICS_EASE }}
            className={`${GLASS_CARD_CLASS} grid gap-4 p-4 lg:grid-cols-3`}
          >
            <div>
              <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">Top values</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                {(result?.topValues ?? []).map((entry) => (
                  <li key={`${entry.value}-${entry.frequency}`}>
                    {entry.value} • {formatNumber(entry.frequency)}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">Bottom values</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                {(result?.bottomValues ?? []).map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">Pattern analysis</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                {(result?.patterns ?? []).map((entry) => (
                  <li key={entry.pattern}>
                    {entry.pattern} • {formatNumber(entry.frequency)}
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
