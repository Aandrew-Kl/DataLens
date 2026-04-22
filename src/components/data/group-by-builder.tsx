"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, Play, Sigma, Table2 } from "lucide-react";
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
import { formatNumber } from "@/lib/utils/formatters";
import { buildMetricExpression } from "@/lib/utils/sql";
import type { ColumnProfile } from "@/types/dataset";

interface GroupByBuilderProps {
  tableName: string;
  columns: ColumnProfile[];
}

type AggregateFunction = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";

interface AggregateMetric {
  id: string;
  fn: AggregateFunction;
  columnName: string;
}

const AGGREGATE_OPTIONS = ["COUNT", "SUM", "AVG", "MIN", "MAX"] as const;

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? formatNumber(value) : String(value);
  return String(value);
}

function buildAggregateExpression(metric: AggregateMetric) {
  if (metric.fn === "COUNT") {
    return `COUNT(*) AS ${quoteIdentifier("count_rows")}`;
  }

  const alias = `${metric.fn.toLowerCase()}_${metric.columnName}`;
  return `${buildMetricExpression(metric.fn, metric.columnName, quoteIdentifier, { cast: false })} AS ${quoteIdentifier(alias)}`;
}

function buildSql(
  tableName: string,
  groupColumns: string[],
  metrics: AggregateMetric[],
) {
  const selectParts = [
    ...groupColumns.map((column) => quoteIdentifier(column)),
    ...metrics.map((metric) => buildAggregateExpression(metric)),
  ];

  const orderField =
    groupColumns[0] != null
      ? quoteIdentifier(groupColumns[0])
      : metrics[0] != null
        ? quoteIdentifier(metrics[0].fn === "COUNT" ? "count_rows" : `${metrics[0].fn.toLowerCase()}_${metrics[0].columnName}`)
        : "1";

  return [
    "SELECT",
    `  ${selectParts.join(",\n  ")}`,
    `FROM ${quoteIdentifier(tableName)}`,
    groupColumns.length ? `GROUP BY ${groupColumns.map((column) => quoteIdentifier(column)).join(", ")}` : "",
    `ORDER BY ${orderField}${groupColumns.length ? "" : " DESC"}`,
    "LIMIT 50",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0] ?? {});
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => formatCell(row[header])).join(",")),
  ].join("\n");
}

function ResultsTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) {
    return (
      <div className="rounded-3xl border border-dashed border-white/25 px-4 py-8 text-sm text-slate-600 dark:text-slate-300">
        Execute the query to preview grouped results.
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
          {rows.map((row, index) => (
            <tr key={`row-${index}`} className="border-t border-white/15">
              {headers.map((header) => (
                <td key={`${index}-${header}`} className="px-4 py-3">
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

export default function GroupByBuilder({
  tableName,
  columns,
}: GroupByBuilderProps) {
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [groupColumns, setGroupColumns] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<AggregateMetric[]>([
    { id: createId("metric"), fn: "COUNT", columnName: numericColumns[0]?.name ?? columns[0]?.name ?? "" },
  ]);
  const [results, setResults] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sql = useMemo(
    () => buildSql(tableName, groupColumns, metrics),
    [groupColumns, metrics, tableName],
  );

  function toggleGroupColumn(columnName: string) {
    setGroupColumns((current) =>
      current.includes(columnName)
        ? current.filter((value) => value !== columnName)
        : [...current, columnName],
    );
  }

  function updateMetric(id: string, next: Partial<AggregateMetric>) {
    setMetrics((current) =>
      current.map((metric) => (metric.id === id ? { ...metric, ...next } : metric)),
    );
  }

  function addMetric() {
    setMetrics((current) => [
      ...current,
      {
        id: createId("metric"),
        fn: "SUM",
        columnName: numericColumns[0]?.name ?? columns[0]?.name ?? "",
      },
    ]);
  }

  async function handleExecute() {
    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(sql);
      setResults(rows);
    } catch (cause) {
      setResults([]);
      setError(cause instanceof Error ? cause.message : "GROUP BY execution failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!results.length) return;
    downloadFile(
      buildCsv(results),
      `${tableName}-group-by-results.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} p-6`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
            <Table2 className="h-4 w-4" />
            Group By Builder
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            Compose grouped aggregations visually
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleExport} disabled={!results.length} className={BUTTON_CLASS}>
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          <button type="button" onClick={handleExecute} disabled={loading} className={BUTTON_CLASS}>
            <Play className="h-4 w-4" />
            {loading ? "Executing…" : "Execute GROUP BY"}
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Group columns
          </h3>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {columns.map((column) => (
              <label
                key={column.name}
                className="flex items-center gap-3 rounded-2xl border border-white/15 px-4 py-3 text-sm text-slate-700 dark:text-slate-200"
              >
                <input
                  type="checkbox"
                  checked={groupColumns.includes(column.name)}
                  onChange={() => toggleGroupColumn(column.name)}
                />
                {column.name}
              </label>
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Aggregates
            </h3>
            <button type="button" onClick={addMetric} className={BUTTON_CLASS}>
              <Sigma className="h-4 w-4" />
              Add metric
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {metrics.map((metric) => (
              <div key={metric.id} className="grid gap-3 md:grid-cols-2">
                <select
                  aria-label={`Aggregate function ${metric.id}`}
                  value={metric.fn}
                  onChange={(event) => updateMetric(metric.id, { fn: event.target.value as AggregateFunction })}
                  className={FIELD_CLASS}
                >
                  {AGGREGATE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                <select
                  aria-label={`Aggregate column ${metric.id}`}
                  value={metric.columnName}
                  onChange={(event) => updateMetric(metric.id, { columnName: event.target.value })}
                  className={FIELD_CLASS}
                  disabled={metric.fn === "COUNT"}
                >
                  {(metric.fn === "COUNT" ? columns : numericColumns.length ? numericColumns : columns).map((column) => (
                    <option key={column.name} value={column.name}>{column.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Generated SQL
          </h3>
          <pre className="mt-4 overflow-x-auto rounded-3xl bg-slate-950 px-4 py-4 text-sm text-cyan-200">
            <code>{sql}</code>
          </pre>
          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <div className={`${GLASS_CARD_CLASS} mt-6 p-4`}>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          Preview results
        </h3>
        <ResultsTable rows={results} />
      </div>
    </motion.section>
  );
}
