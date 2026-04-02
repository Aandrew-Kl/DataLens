"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle, Copy, Loader2, Search, Trash2 } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber, formatPercent, sanitizeTableName } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DuplicateFinderProps { tableName: string; columns: ColumnProfile[]; }
interface DuplicateSummary { duplicateGroups: number; totalDuplicateRows: number; totalRows: number; percentage: number; }
type StatusState = { kind: "success" | "error"; message: string } | null;

const SAMPLE_LIMIT = 12;
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;

function formatCell(value: unknown, type: ColumnProfile["type"]) {
  if (value === null || value === undefined) return "null";
  if (type === "number" && typeof value === "number") return value.toLocaleString();
  if (type === "boolean" && typeof value === "boolean") return value ? "true" : "false";
  if (type === "date") {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString();
  }
  return String(value);
}

function buildDuplicateQueries(tableName: string, selected: string[]) {
  const tableSql = quote(tableName);
  const columnsSql = selected.map(quote).join(", ");
  const duplicateGroups = `
    WITH duplicate_groups AS (
      SELECT ${columnsSql}, COUNT(*) AS duplicate_count
      FROM ${tableSql}
      GROUP BY ${columnsSql}
      HAVING COUNT(*) > 1
    )
  `;
  return {
    summarySql: `
      ${duplicateGroups}
      SELECT
        (SELECT COUNT(*) FROM duplicate_groups) AS duplicate_groups,
        COALESCE((SELECT SUM(duplicate_count) FROM duplicate_groups), 0) AS total_duplicate_rows,
        (SELECT COUNT(*) FROM ${tableSql}) AS total_rows
    `,
    sampleSql: `
      ${duplicateGroups}
      SELECT *
      FROM duplicate_groups
      ORDER BY duplicate_count DESC, ${columnsSql}
      LIMIT ${SAMPLE_LIMIT}
    `,
  };
}

export default function DuplicateFinder({ tableName, columns }: DuplicateFinderProps) {
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [summary, setSummary] = useState<DuplicateSummary | null>(null);
  const [sampleRows, setSampleRows] = useState<Record<string, unknown>[]>([]);
  const [hasQueried, setHasQueried] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deduplicating, setDeduplicating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [createdTableName, setCreatedTableName] = useState("");
  const [status, setStatus] = useState<StatusState>(null);

  const selectedColumns = useMemo(
    () => columns.filter((column) => selectedNames.includes(column.name)),
    [columns, selectedNames],
  );
  const columnSignature = useMemo(
    () => columns.map((column) => `${column.name}:${column.type}`).join("|"),
    [columns],
  );
  const columnTypes = useMemo(
    () => Object.fromEntries(columns.map((column) => [column.name, column.type])) as Record<string, ColumnProfile["type"]>,
    [columns],
  );

  useEffect(() => {
    const fallback = columns.slice(0, Math.min(columns.length, 3)).map((column) => column.name);
    setSelectedNames((current) => {
      const retained = current.filter((name) => columns.some((column) => column.name === name));
      return retained.length ? retained : fallback;
    });
    setSummary(null);
    setSampleRows([]);
    setHasQueried(false);
    setCreatedTableName("");
    setStatus(null);
  }, [columnSignature, columns, tableName]);

  function toggleColumn(name: string) {
    setSelectedNames((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  }

  async function handleAnalyze() {
    if (!selectedColumns.length) return;
    setLoading(true);
    setCopied(false);
    setStatus(null);
    setCreatedTableName("");
    try {
      const { summarySql, sampleSql } = buildDuplicateQueries(tableName, selectedColumns.map((column) => column.name));
      const [summaryRows, sampleResult] = await Promise.all([runQuery(summarySql), runQuery(sampleSql)]);
      const row = summaryRows[0] ?? {};
      const totalRows = Number(row.total_rows ?? 0);
      const totalDuplicateRows = Number(row.total_duplicate_rows ?? 0);
      startTransition(() => {
        setSummary({
          duplicateGroups: Number(row.duplicate_groups ?? 0),
          totalDuplicateRows,
          totalRows,
          percentage: totalRows ? (totalDuplicateRows / totalRows) * 100 : 0,
        });
        setSampleRows(sampleResult);
        setHasQueried(true);
      });
    } catch (error) {
      setSummary(null);
      setSampleRows([]);
      setHasQueried(true);
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Duplicate analysis failed." });
    } finally {
      setLoading(false);
    }
  }

  async function handleDeduplicate() {
    if (!selectedColumns.length) return;
    setDeduplicating(true);
    setCopied(false);
    setStatus(null);
    try {
      const dedupTableName = `${sanitizeTableName(tableName)}__dedup_${Date.now().toString(36)}`;
      const distinctSql = selectedColumns.map((column) => quote(column.name)).join(", ");
      await runQuery(`CREATE TABLE ${quote(dedupTableName)} AS SELECT DISTINCT ${distinctSql} FROM ${quote(tableName)}`);
      setCreatedTableName(dedupTableName);
      setStatus({
        kind: "success",
        message: `Created ${dedupTableName} with unique combinations for ${selectedColumns.length} selected column${selectedColumns.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Deduplication failed." });
    } finally {
      setDeduplicating(false);
    }
  }

  async function handleCopyTableName() {
    if (!createdTableName) return;
    try {
      await navigator.clipboard.writeText(createdTableName);
      setCopied(true);
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Copy failed." });
    }
  }

  if (!columns.length) {
    return (
      <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-sm dark:border-slate-800/80 dark:bg-slate-950/50">
        <p className="text-sm text-slate-600 dark:text-slate-300">No columns available for duplicate analysis.</p>
      </section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="overflow-hidden rounded-3xl border border-slate-200/70 bg-gradient-to-br from-white via-slate-50 to-sky-50/70 shadow-xl shadow-slate-950/5 dark:border-slate-800/80 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900"
    >
      <div className="border-b border-slate-200/70 px-6 py-5 dark:border-slate-800/80">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700 dark:border-sky-500/30 dark:text-sky-300">
              <Search className="h-3.5 w-3.5" />
              Duplicate Row Finder
            </div>
            <h2 className="mt-3 text-xl font-semibold text-slate-950 dark:text-slate-50">Find duplicate groups in {tableName}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Pick the columns that define a duplicate key, then run a DuckDB `GROUP BY` query to surface repeated combinations and materialize a distinct key table if you want a deduplicated output.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={loading || deduplicating || !selectedColumns.length}
              className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-400 dark:disabled:bg-slate-700"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Run duplicate query
            </button>
            <button
              type="button"
              onClick={handleDeduplicate}
              disabled={loading || deduplicating || !selectedColumns.length}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-300/80 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800/80"
            >
              {deduplicating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Deduplicate
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 px-6 py-6 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/70 p-4 dark:border-slate-800/80 dark:bg-slate-950/35">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Selected duplicate key</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {selectedColumns.length ? selectedColumns.map((column) => column.name).join(", ") : "Choose at least one column."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-medium">
              <button type="button" onClick={() => setSelectedNames(columns.map((column) => column.name))} className="rounded-full border border-slate-300/80 px-3 py-1.5 text-slate-700 transition hover:border-sky-300 hover:text-sky-700 dark:border-slate-700 dark:text-slate-200 dark:hover:border-sky-500/50 dark:hover:text-sky-300">
                Select all
              </button>
              <button type="button" onClick={() => setSelectedNames([])} className="rounded-full border border-slate-300/80 px-3 py-1.5 text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600">
                Clear
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {columns.map((column) => {
              const active = selectedNames.includes(column.name);
              return (
                <button
                  key={column.name}
                  type="button"
                  onClick={() => toggleColumn(column.name)}
                  className={`rounded-2xl border p-4 text-left transition ${active ? "border-sky-400/50 bg-sky-500/10 text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-100" : "border-slate-200/80 bg-white/70 text-slate-700 hover:border-slate-300 dark:border-slate-800/80 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:border-slate-700"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{column.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{column.type}</p>
                    </div>
                    {active && <CheckCircle className="h-4 w-4 shrink-0 text-sky-500" />}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {formatNumber(column.uniqueCount)} unique values, {formatNumber(column.nullCount)} nulls.
                  </p>
                </button>
              );
            })}
          </div>

          <AnimatePresence mode="wait">
            {status && (
              <motion.div
                key={status.message}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className={`rounded-2xl border px-4 py-3 text-sm ${status.kind === "success" ? "border-emerald-300/60 bg-emerald-500/10 text-emerald-800 dark:border-emerald-500/30 dark:text-emerald-300" : "border-red-300/60 bg-red-500/10 text-red-800 dark:border-red-500/30 dark:text-red-300"}`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-2 font-medium">
                    <CheckCircle className="h-4 w-4" />
                    {status.message}
                  </span>
                  {createdTableName && status.kind === "success" && (
                    <button type="button" onClick={handleCopyTableName} className="inline-flex items-center gap-1 rounded-full border border-current/20 px-3 py-1 text-xs font-semibold">
                      <Copy className="h-3.5 w-3.5" />
                      {copied ? "Copied" : "Copy name"}
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
          {[
            { label: "Duplicate groups", value: summary ? formatNumber(summary.duplicateGroups) : "—" },
            { label: "Total duplicate rows", value: summary ? formatNumber(summary.totalDuplicateRows) : "—" },
            { label: "Share of table", value: summary ? formatPercent(summary.percentage, summary.percentage >= 10 ? 1 : 2) : "—" },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-slate-200/80 bg-white/70 p-4 dark:border-slate-800/80 dark:bg-slate-950/35">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{item.label}</p>
              <p className="mt-3 text-2xl font-semibold text-slate-950 dark:text-slate-50">{item.value}</p>
            </div>
          ))}
          <div className="rounded-2xl border border-slate-200/80 bg-white/70 p-4 text-sm leading-6 text-slate-600 dark:border-slate-800/80 dark:bg-slate-950/35 dark:text-slate-300">
            DuckDB groups `NULL` values together here, so rows with missing values in the selected key will count as duplicates if the same null-pattern repeats.
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200/70 px-6 py-5 dark:border-slate-800/80">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">Sample duplicate groups</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Showing up to {SAMPLE_LIMIT} repeated key combinations, ordered by duplicate count.
            </p>
          </div>
          {createdTableName && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Latest deduped table: <span className="font-mono text-slate-900 dark:text-slate-100">{createdTableName}</span>
            </p>
          )}
        </div>

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center justify-center py-14 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-sky-500" />
              Running duplicate query...
            </motion.div>
          ) : hasQueried && summary && summary.duplicateGroups === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="mt-4 rounded-2xl border border-emerald-300/50 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-800 dark:border-emerald-500/30 dark:text-emerald-300">
              No duplicate groups were found for the currently selected columns.
            </motion.div>
          ) : sampleRows.length ? (
            <motion.div key="table" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="mt-4 overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800/80">
              <div className="max-h-[26rem] overflow-auto">
                <table className="min-w-full divide-y divide-slate-200/80 text-sm dark:divide-slate-800/80">
                  <thead className="sticky top-0 bg-slate-100/95 backdrop-blur dark:bg-slate-900/95">
                    <tr>
                      {selectedColumns.map((column) => (
                        <th key={column.name} className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-200">
                          {column.name}
                        </th>
                      ))}
                      <th className="px-4 py-3 text-right font-semibold text-slate-700 dark:text-slate-200">count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70 bg-white/80 dark:divide-slate-800/80 dark:bg-slate-950/35">
                    {sampleRows.map((row, index) => (
                      <tr key={`${index}-${selectedColumns.map((column) => String(row[column.name])).join("|")}`} className="hover:bg-sky-50/70 dark:hover:bg-slate-900/80">
                        {selectedColumns.map((column) => (
                          <td key={column.name} className="px-4 py-3 text-slate-700 dark:text-slate-200">
                            {formatCell(row[column.name], columnTypes[column.name])}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-slate-50">
                          {formatNumber(Number(row.duplicate_count ?? 0))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          ) : (
            <motion.div key="idle" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="mt-4 rounded-2xl border border-dashed border-slate-300/80 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Choose one or more columns, then run the duplicate query to inspect repeated groups.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
