"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, Play, Rows3, Sigma } from "lucide-react";
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
import type { ColumnProfile } from "@/types/dataset";

interface WindowFunctionBuilderProps {
  tableName: string;
  columns: ColumnProfile[];
}

type WindowFunctionName = "ROW_NUMBER" | "RANK" | "LAG" | "LEAD" | "SUM";

interface WindowQueryResult {
  rows: Record<string, unknown>[];
}

const WINDOW_OPTIONS = ["ROW_NUMBER", "RANK", "LAG", "LEAD", "SUM"] as const;

function formatCell(value: unknown) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? formatNumber(value) : String(value);
  return String(value);
}

function buildWindowExpression(
  fn: WindowFunctionName,
  targetColumn: string,
  partitionColumn: string,
  orderColumn: string,
  offset: number,
) {
  const partitionClause = partitionColumn
    ? `PARTITION BY ${quoteIdentifier(partitionColumn)} `
    : "";
  const orderClause = `ORDER BY ${quoteIdentifier(orderColumn)}`;
  const base = `${partitionClause}${orderClause}`;

  if (fn === "ROW_NUMBER" || fn === "RANK") {
    return `${fn}() OVER (${base}) AS ${quoteIdentifier("window_value")}`;
  }

  if (fn === "SUM") {
    return `SUM(${quoteIdentifier(targetColumn)}) OVER (${base}) AS ${quoteIdentifier("window_value")}`;
  }

  return `${fn}(${quoteIdentifier(targetColumn)}, ${offset}) OVER (${base}) AS ${quoteIdentifier("window_value")}`;
}

function buildSql(
  tableName: string,
  partitionColumn: string,
  orderColumn: string,
  fn: WindowFunctionName,
  targetColumn: string,
  offset: number,
) {
  return [
    "SELECT",
    "  *,",
    `  ${buildWindowExpression(fn, targetColumn, partitionColumn, orderColumn, offset)}`,
    `FROM ${quoteIdentifier(tableName)}`,
    `ORDER BY ${quoteIdentifier(orderColumn)}`,
    "LIMIT 50",
  ].join("\n");
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
        Execute the query to preview window-function output.
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

export default function WindowFunctionBuilder({
  tableName,
  columns,
}: WindowFunctionBuilderProps) {
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [partitionColumn, setPartitionColumn] = useState("");
  const [orderColumn, setOrderColumn] = useState(columns[0]?.name ?? "");
  const [fn, setFn] = useState<WindowFunctionName>("ROW_NUMBER");
  const [targetColumn, setTargetColumn] = useState(numericColumns[0]?.name ?? columns[0]?.name ?? "");
  const [offset, setOffset] = useState(1);
  const [result, setResult] = useState<WindowQueryResult>({ rows: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeOrderColumn =
    columns.find((column) => column.name === orderColumn)?.name ??
    columns[0]?.name ??
    "";
  const activeTargetColumn =
    (fn === "SUM"
      ? numericColumns.find((column) => column.name === targetColumn)?.name ?? numericColumns[0]?.name
      : columns.find((column) => column.name === targetColumn)?.name ?? columns[0]?.name) ??
    "";

  const sql = useMemo(
    () => buildSql(tableName, partitionColumn, activeOrderColumn, fn, activeTargetColumn, Math.max(1, offset)),
    [activeOrderColumn, activeTargetColumn, fn, offset, partitionColumn, tableName],
  );

  async function handleExecute() {
    if (!activeOrderColumn) {
      setError("Choose an order column before executing the window query.");
      setResult({ rows: [] });
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(sql);
      setResult({ rows });
    } catch (cause) {
      setResult({ rows: [] });
      setError(cause instanceof Error ? cause.message : "Window function execution failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result.rows.length) return;
    downloadFile(
      buildCsv(result.rows),
      `${tableName}-window-results.csv`,
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
            <Rows3 className="h-4 w-4" />
            Window Function Builder
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            Compose ranking, lag, lead, and running aggregates
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleExport} disabled={!result.rows.length} className={BUTTON_CLASS}>
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          <button type="button" onClick={handleExecute} disabled={loading} className={BUTTON_CLASS}>
            <Play className="h-4 w-4" />
            {loading ? "Executing…" : "Execute window query"}
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm text-slate-600 dark:text-slate-300">
          <span className="mb-2 block">Partition column</span>
          <select
            aria-label="Partition column"
            value={partitionColumn}
            onChange={(event) => setPartitionColumn(event.target.value)}
            className={FIELD_CLASS}
          >
            <option value="">None</option>
            {columns.map((column) => (
              <option key={column.name} value={column.name}>{column.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-600 dark:text-slate-300">
          <span className="mb-2 block">Order column</span>
          <select
            aria-label="Order column"
            value={activeOrderColumn}
            onChange={(event) => setOrderColumn(event.target.value)}
            className={FIELD_CLASS}
          >
            {columns.map((column) => (
              <option key={column.name} value={column.name}>{column.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-600 dark:text-slate-300">
          <span className="mb-2 block">Window function</span>
          <select
            aria-label="Window function"
            value={fn}
            onChange={(event) => setFn(event.target.value as WindowFunctionName)}
            className={FIELD_CLASS}
          >
            {WINDOW_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-600 dark:text-slate-300">
          <span className="mb-2 block">Target column</span>
          <select
            aria-label="Target column"
            value={activeTargetColumn}
            onChange={(event) => setTargetColumn(event.target.value)}
            className={FIELD_CLASS}
            disabled={fn === "ROW_NUMBER" || fn === "RANK"}
          >
            {(fn === "SUM" ? (numericColumns.length ? numericColumns : columns) : columns).map((column) => (
              <option key={column.name} value={column.name}>{column.name}</option>
            ))}
          </select>
        </label>
      </div>

      {(fn === "LAG" || fn === "LEAD") ? (
        <div className="mt-4 max-w-[220px]">
          <label className="text-sm text-slate-600 dark:text-slate-300">
            <span className="mb-2 block">Offset</span>
            <input
              aria-label="Window offset"
              type="number"
              min={1}
              max={12}
              value={offset}
              onChange={(event) => setOffset(Math.max(1, Number(event.target.value) || 1))}
              className={FIELD_CLASS}
            />
          </label>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
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
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <Sigma className="h-4 w-4" />
            Preview results
          </h3>
          <ResultsTable rows={result.rows} />
        </div>
      </div>
    </motion.section>
  );
}
