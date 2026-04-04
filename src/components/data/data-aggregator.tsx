"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, Layers3, Play, Sigma, Table2 } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataAggregatorProps {
  tableName: string;
  columns: ColumnProfile[];
}

type AggregateFunction = "SUM" | "AVG" | "MIN" | "MAX" | "COUNT";

interface MetricSelection {
  columnName: string;
  functions: AggregateFunction[];
}

const AGGREGATE_FUNCTIONS = ["SUM", "AVG", "MIN", "MAX", "COUNT"] as const;

function formatCell(value: unknown) {
  if (value === null || value === undefined) {
    return "All";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? formatNumber(value) : String(value);
  }
  return String(value);
}

function buildMetricSelections(columns: ColumnProfile[]) {
  return columns
    .filter((column) => column.type === "number")
    .map<MetricSelection>((column, index) => ({
      columnName: column.name,
      functions: index === 0 ? ["SUM", "AVG"] : ["SUM"],
    }));
}

function buildAggregationSql(
  tableName: string,
  groupColumns: string[],
  metrics: MetricSelection[],
  useRollup: boolean,
) {
  if (groupColumns.length === 0 && metrics.length === 0) {
    return `SELECT * FROM ${quoteIdentifier(tableName)} LIMIT 0`;
  }

  const measureExpressions = metrics.flatMap((metric) =>
    metric.functions.map((fn) => {
      const alias = `${fn.toLowerCase()}_${metric.columnName}`;
      if (fn === "COUNT") {
        return `COUNT(${quoteIdentifier(metric.columnName)}) AS ${quoteIdentifier(alias)}`;
      }
      return `${fn}(TRY_CAST(${quoteIdentifier(metric.columnName)} AS DOUBLE)) AS ${quoteIdentifier(alias)}`;
    }),
  );

  const selectList = [...groupColumns.map((column) => quoteIdentifier(column)), ...measureExpressions];
  const groupByClause =
    groupColumns.length === 0
      ? ""
      : useRollup
        ? `GROUP BY ROLLUP (${groupColumns.map((column) => quoteIdentifier(column)).join(", ")})`
        : `GROUP BY ${groupColumns.map((column) => quoteIdentifier(column)).join(", ")}`;

  return [
    "SELECT",
    `  ${selectList.join(",\n  ")}`,
    `FROM ${quoteIdentifier(tableName)}`,
    groupByClause,
    groupColumns.length
      ? `ORDER BY ${groupColumns.map((column) => `${quoteIdentifier(column)} NULLS LAST`).join(", ")}`
      : "",
    "LIMIT 80",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] ?? {});

  return [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => {
          const value = row[header];
          const stringValue = value === null || value === undefined ? "" : String(value);
          return /[,"\n\r]/.test(stringValue)
            ? `"${stringValue.replace(/"/g, '""')}"`
            : stringValue;
        })
        .join(","),
    ),
  ].join("\n");
}

function AggregationTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-white/25 px-4 py-8 text-sm text-slate-600 dark:text-slate-300">
        Preview the aggregation to inspect grouped output.
      </div>
    );
  }

  const headers = Object.keys(rows[0] ?? {});

  return (
    <div className="overflow-hidden rounded-3xl border border-white/20">
      <table className="min-w-full text-left text-sm text-slate-700 dark:text-slate-200">
        <thead className="bg-slate-950/5 text-xs uppercase tracking-[0.16em] text-slate-500 dark:bg-white/5 dark:text-slate-400">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-4 py-3">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`} className="border-t border-white/15">
              {headers.map((header) => (
                <td key={`${rowIndex}-${header}`} className="px-4 py-3">
                  {formatCell(row[header])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DataAggregator({
  tableName,
  columns,
}: DataAggregatorProps) {
  const dimensionColumns = useMemo(
    () => columns.filter((column) => column.type !== "number"),
    [columns],
  );
  const [groupColumns, setGroupColumns] = useState<string[]>(
    dimensionColumns.slice(0, 2).map((column) => column.name),
  );
  const [metrics, setMetrics] = useState<MetricSelection[]>(() => buildMetricSelections(columns));
  const [useRollup, setUseRollup] = useState(true);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sql = useMemo(
    () => buildAggregationSql(tableName, groupColumns, metrics, useRollup),
    [groupColumns, metrics, tableName, useRollup],
  );

  function toggleGroupColumn(columnName: string) {
    setGroupColumns((current) =>
      current.includes(columnName)
        ? current.filter((value) => value !== columnName)
        : [...current, columnName],
    );
  }

  function toggleMetricFunction(columnName: string, fn: AggregateFunction) {
    setMetrics((current) =>
      current.map((metric) => {
        if (metric.columnName !== columnName) {
          return metric;
        }

        const functions = metric.functions.includes(fn)
          ? metric.functions.filter((value) => value !== fn)
          : [...metric.functions, fn];

        return {
          ...metric,
          functions: functions.length > 0 ? functions : ["SUM"],
        };
      }),
    );
  }

  async function handlePreview() {
    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(sql);
      setPreviewRows(rows);
    } catch (cause) {
      setPreviewRows([]);
      setError(cause instanceof Error ? cause.message : "Aggregation preview failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (previewRows.length === 0) return;
    downloadFile(
      buildCsv(previewRows),
      `${tableName}-aggregated.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} p-6`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
            <Layers3 className="h-4 w-4" />
            Data Aggregator
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            Build multi-level roll-ups across dimensions
          </h2>
        </div>
        <div className="flex gap-2">
          <button type="button" className={BUTTON_CLASS} disabled={!previewRows.length} onClick={handleExport}>
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          <button type="button" className={BUTTON_CLASS} disabled={loading} onClick={handlePreview}>
            <Play className="h-4 w-4" />
            Preview aggregated rows
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Group columns
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {dimensionColumns.map((column) => (
                <button
                  key={column.name}
                  type="button"
                  onClick={() => toggleGroupColumn(column.name)}
                  className={`rounded-2xl px-4 py-2 text-sm transition ${
                    groupColumns.includes(column.name)
                      ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                      : "bg-slate-950/5 text-slate-700 dark:bg-white/5 dark:text-slate-200"
                  }`}
                >
                  {column.name}
                </button>
              ))}
            </div>
            <label className="mt-4 flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={useRollup}
                onChange={(event) => setUseRollup(event.target.checked)}
              />
              Enable hierarchical roll-up
            </label>
          </div>

          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              <Sigma className="h-4 w-4" />
              Aggregation functions per value column
            </div>
            <div className="mt-4 space-y-4">
              {metrics.map((metric) => (
                <div key={metric.columnName} className="rounded-3xl bg-slate-950/5 p-4 dark:bg-white/5">
                  <div className="text-sm font-semibold text-slate-950 dark:text-white">
                    {metric.columnName}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {AGGREGATE_FUNCTIONS.map((fn) => (
                      <button
                        key={`${metric.columnName}-${fn}`}
                        type="button"
                        onClick={() => toggleMetricFunction(metric.columnName, fn)}
                        className={`rounded-2xl px-3 py-2 text-sm transition ${
                          metric.functions.includes(fn)
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                            : "bg-white/60 text-slate-700 dark:bg-slate-950/45 dark:text-slate-200"
                        }`}
                      >
                        {fn}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              <Table2 className="h-4 w-4" />
              Generated SQL
            </div>
            <pre className="mt-4 overflow-x-auto rounded-3xl bg-slate-950 px-4 py-4 text-xs text-slate-100">
              <code>{sql}</code>
            </pre>
            {error ? (
              <p className="mt-3 text-sm text-rose-700 dark:text-rose-300">{error}</p>
            ) : null}
          </div>

          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  Preview
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {loading
                    ? "Running DuckDB aggregation…"
                    : `${formatNumber(previewRows.length)} preview rows loaded`}
                </div>
              </div>
            </div>
            <AggregationTable rows={previewRows} />
          </div>
        </div>
      </div>
    </motion.section>
  );
}
