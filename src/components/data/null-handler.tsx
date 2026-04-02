"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, DatabaseZap, Eye, Loader2, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile, ColumnType } from "@/types/dataset";

interface NullHandlerProps {
  tableName: string;
  columns: ColumnProfile[];
  onComplete: () => void;
}
type NullAction = "drop" | "mean" | "mode" | "custom" | "forward_fill";
type ActionConfig = { action: NullAction; customValue: string };
type StatusState = { kind: "success" | "error"; message: string } | null;
const PREVIEW_LIMIT = 6;
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
const escapeSql = (value: string) => value.replace(/'/g, "''");
const defaultAction = (type: ColumnType): NullAction => (type === "number" ? "mean" : type === "string" ? "mode" : "forward_fill");
const optionsFor = (type: ColumnType) => [
  { value: "drop" as const, label: "Drop rows with nulls" },
  ...(type === "number" ? [{ value: "mean" as const, label: "Fill with mean" }] : []),
  ...(type === "string" ? [{ value: "mode" as const, label: "Fill with mode" }] : []),
  { value: "custom" as const, label: "Fill with custom value" },
  { value: "forward_fill" as const, label: "Forward fill" },
];
function customSql(type: ColumnType, value: string) {
  const escaped = escapeSql(value.trim());
  if (type === "number") return `TRY_CAST('${escaped}' AS DOUBLE)`;
  if (type === "boolean") return `TRY_CAST('${escaped}' AS BOOLEAN)`;
  if (type === "date") return `TRY_CAST('${escaped}' AS TIMESTAMP)`;
  return `'${escaped}'`;
}
function hintFor(column: ColumnProfile, config: ActionConfig) {
  if (config.action === "drop") return "Rows missing this field are filtered out before fills run.";
  if (config.action === "mean") return `Numeric nulls use the column mean${column.mean !== undefined ? ` (${formatNumber(column.mean)})` : ""}.`;
  if (config.action === "mode") return "String nulls use the most common non-null value.";
  if (config.action === "custom") return "DuckDB casts the custom value during preview and apply.";
  return "Carries the last observed non-null value forward in scan order.";
}
function cellText(value: unknown) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}
function buildTransformSql(tableName: string, columns: ColumnProfile[], configs: Record<string, ActionConfig>) {
  const missing = columns.filter((column) => column.nullCount > 0);
  const forward = missing.filter((column) => configs[column.name]?.action === "forward_fill");
  const dropFilters = missing.filter((column) => configs[column.name]?.action === "drop").map((column) => `${quote(column.name)} IS NOT NULL`);
  const forwardMap = new Map(forward.map((column, index) => [column.name, `__nh_ff_${index}`]));
  const source = forward.length ? "windowed" : "filtered";
  const selectList = columns
    .map((column) => {
      const config = configs[column.name];
      const field = quote(column.name);
      if (!config || config.action === "drop") return field;
      if (config.action === "mean") return `COALESCE(${field}, (SELECT AVG(${field}) FROM filtered WHERE ${field} IS NOT NULL)) AS ${field}`;
      if (config.action === "mode") return `COALESCE(${field}, (SELECT ${field} FROM filtered WHERE ${field} IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC, CAST(${field} AS VARCHAR) ASC LIMIT 1)) AS ${field}`;
      if (config.action === "custom") return `COALESCE(${field}, ${customSql(column.type, config.customValue)}) AS ${field}`;
      return `COALESCE(${field}, MAX(${field}) OVER (PARTITION BY ${quote(forwardMap.get(column.name) ?? "__nh_ff")})) AS ${field}`;
    })
    .join(",\n      ");
  const windowFields = forward
    .map((column, index) => `SUM(CASE WHEN ${quote(column.name)} IS NOT NULL THEN 1 ELSE 0 END) OVER (ORDER BY __nh_row_id) AS ${quote(`__nh_ff_${index}`)}`)
    .join(",\n      ");
  return `
    WITH base AS (
      SELECT *, ROW_NUMBER() OVER () AS __nh_row_id
      FROM ${quote(tableName)}
    ),
    filtered AS (
      SELECT * FROM base
      ${dropFilters.length ? `WHERE ${dropFilters.join(" AND ")}` : ""}
    )
    ${forward.length ? `,
    windowed AS (
      SELECT *,
        ${windowFields}
      FROM filtered
    )` : ""}
    SELECT
      ${selectList}
    FROM ${source}
    ORDER BY __nh_row_id
  `;
}
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-200/80 bg-gray-50/80 p-4 dark:border-gray-800/80 dark:bg-gray-900/40">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  );
}

export default function NullHandler({ tableName, columns, onComplete }: NullHandlerProps) {
  const missingColumns = useMemo(() => columns.filter((column) => column.nullCount > 0).sort((a, b) => b.nullCount - a.nullCount), [columns]);
  const [configs, setConfigs] = useState<Record<string, ActionConfig>>({});
  const [rowCount, setRowCount] = useState(0);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [remainingNulls, setRemainingNulls] = useState<number | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [previewDirty, setPreviewDirty] = useState(true);
  const [status, setStatus] = useState<StatusState>(null);
  useEffect(() => {
    setConfigs((current) => Object.fromEntries(missingColumns.map((column) => [column.name, current[column.name] ?? { action: defaultAction(column.type), customValue: "" }])));
    setPreviewRows([]);
    setPreviewCount(null);
    setRemainingNulls(null);
    setPreviewDirty(true);
  }, [missingColumns]);
  useEffect(() => {
    let cancelled = false;
    async function loadRowCount() {
      setLoadingRows(true);
      try {
        const count = Number((await runQuery(`SELECT COUNT(*) AS cnt FROM ${quote(tableName)}`))[0]?.cnt ?? 0);
        if (!cancelled) startTransition(() => setRowCount(count));
      } catch (error) {
        if (!cancelled) setStatus({ kind: "error", message: error instanceof Error ? error.message : "Failed to read row count." });
      } finally {
        if (!cancelled) setLoadingRows(false);
      }
    }
    if (tableName) void loadRowCount();
    return () => {
      cancelled = true;
    };
  }, [tableName]);
  useEffect(() => {
    setPreviewDirty(true);
  }, [configs]);
  const invalidCustom = useMemo(() => missingColumns.filter((column) => configs[column.name]?.action === "custom" && !configs[column.name]?.customValue.trim()), [configs, missingColumns]);
  const missingTotal = useMemo(() => missingColumns.reduce((sum, column) => sum + column.nullCount, 0), [missingColumns]);
  const transformSql = useMemo(() => (missingColumns.length ? buildTransformSql(tableName, columns, configs) : ""), [columns, configs, missingColumns.length, tableName]);
  async function handlePreview() {
    if (!missingColumns.length || invalidCustom.length) {
      setStatus({ kind: "error", message: "Add a custom value for every column using the custom action." });
      return;
    }
    setPreviewLoading(true);
    setStatus(null);
    try {
      const nullClauses = missingColumns.map((column, index) => `COUNT(*) FILTER (WHERE ${quote(column.name)} IS NULL) AS "n${index}"`).join(",\n          ");
      const summarySql = `SELECT COUNT(*) AS row_count${nullClauses ? `,\n          ${nullClauses}` : ""} FROM (${transformSql}) AS transformed`;
      const [summaryRows, rows] = await Promise.all([runQuery(summarySql), runQuery(`SELECT * FROM (${transformSql}) AS transformed LIMIT ${PREVIEW_LIMIT}`)]);
      const summary = summaryRows[0] ?? {};
      const unresolved = missingColumns.reduce((sum, _column, index) => sum + Number(summary[`n${index}`] ?? 0), 0);
      startTransition(() => {
        setPreviewRows(rows);
        setPreviewCount(Number(summary.row_count ?? 0));
        setRemainingNulls(unresolved);
        setPreviewDirty(false);
      });
    } catch (error) {
      setPreviewRows([]);
      setPreviewCount(null);
      setRemainingNulls(null);
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Preview query failed." });
    } finally {
      setPreviewLoading(false);
    }
  }
  async function handleApply() {
    if (previewDirty) {
      setStatus({ kind: "error", message: "Preview the null-handling plan before applying it." });
      return;
    }
    setApplying(true);
    setStatus(null);
    const stamp = Date.now();
    const sourceTable = quote(tableName);
    const tempTable = quote(`${tableName}__nulls_${stamp}`);
    const backupTable = quote(`${tableName}__backup_${stamp}`);
    try {
      await runQuery(`DROP TABLE IF EXISTS ${tempTable}`);
      await runQuery(`DROP TABLE IF EXISTS ${backupTable}`);
      await runQuery(`CREATE TABLE ${tempTable} AS ${transformSql}`);
      await runQuery(`ALTER TABLE ${sourceTable} RENAME TO ${backupTable}`);
      try {
        await runQuery(`ALTER TABLE ${tempTable} RENAME TO ${sourceTable}`);
        await runQuery(`DROP TABLE ${backupTable}`);
      } catch (swapError) {
        await runQuery(`ALTER TABLE ${backupTable} RENAME TO ${sourceTable}`).catch(() => undefined);
        await runQuery(`DROP TABLE IF EXISTS ${tempTable}`).catch(() => undefined);
        throw swapError;
      }
      setStatus({ kind: "success", message: `Applied null handling to ${tableName}.` });
      onComplete();
    } catch (error) {
      await runQuery(`DROP TABLE IF EXISTS ${tempTable}`).catch(() => undefined);
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Failed to apply null handling." });
    } finally {
      setApplying(false);
    }
  }
  if (!missingColumns.length) {
    return (
      <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-emerald-500/20 bg-white/85 p-6 shadow-sm backdrop-blur-sm dark:border-emerald-400/20 dark:bg-gray-950/50">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">No null values detected</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{tableName} is already complete, so there is nothing to rewrite here.</p>
            <button type="button" onClick={onComplete} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500">
              <CheckCircle2 className="h-4 w-4" />
              Continue
            </button>
          </div>
        </div>
      </motion.section>
    );
  }
  return (
    <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: "easeOut" }} className="overflow-hidden rounded-2xl border border-gray-200/70 bg-white/85 shadow-sm backdrop-blur-sm dark:border-gray-800/80 dark:bg-gray-950/45">
      <div className="border-b border-gray-200/70 px-6 py-5 dark:border-gray-800/80">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
              <DatabaseZap className="h-3.5 w-3.5" />
              Null Value Handler
            </div>
            <h2 className="mt-3 text-xl font-semibold text-gray-900 dark:text-gray-100">Repair missing values in {tableName}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300">Choose a per-column strategy, preview the rewritten rows, then replace the table with a DuckDB <span className="font-mono text-[13px]">CREATE TABLE AS SELECT</span> pass.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handlePreview} disabled={previewLoading || applying || !!invalidCustom.length} className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-700 transition hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-cyan-300">
              {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Preview result
            </button>
            <button type="button" onClick={handleApply} disabled={applying || previewLoading || previewDirty} className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-gray-400 dark:disabled:bg-gray-700">
              {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Apply changes
            </button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <StatCard label="Columns" value={formatNumber(missingColumns.length)} />
          <StatCard label="Null cells" value={formatNumber(missingTotal)} />
          <StatCard label="Rows" value={loadingRows ? "…" : formatNumber(rowCount)} />
          <StatCard label="Preview output" value={previewCount === null ? "Not run" : formatNumber(previewCount)} />
        </div>
      </div>

      <div className="grid gap-5 p-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-3">
          {missingColumns.map((column, index) => {
            const config = configs[column.name] ?? { action: defaultAction(column.type), customValue: "" };
            const percentage = rowCount > 0 ? (column.nullCount / rowCount) * 100 : 0;
            return (
              <motion.div key={column.name} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03, duration: 0.18 }} className="rounded-2xl border border-gray-200/80 bg-gray-50/80 p-4 dark:border-gray-800/80 dark:bg-gray-900/35">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{column.name}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <span className="rounded-full border border-gray-300/80 px-2.5 py-1 dark:border-gray-700">{column.type}</span>
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-700 dark:text-amber-300">{formatNumber(column.nullCount)} nulls</span>
                      <span>{formatPercent(percentage)}</span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">{hintFor(column, config)}</p>
                  </div>
                  <div className="w-full max-w-sm space-y-3">
                    <select
                      value={config.action}
                      onChange={(event) => setConfigs((current) => ({ ...current, [column.name]: { ...current[column.name], action: event.target.value as NullAction } }))}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-cyan-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                    >
                      {optionsFor(column.type).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    {config.action === "custom" && (
                      <div>
                        <input
                          value={config.customValue}
                          onChange={(event) => setConfigs((current) => ({ ...current, [column.name]: { ...current[column.name], customValue: event.target.value } }))}
                          placeholder={`Custom ${column.type} value`}
                          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-cyan-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                        />
                        {!config.customValue.trim() && <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">Enter a value before previewing or applying.</p>}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
        <div className="rounded-2xl border border-gray-200/80 bg-gray-50/80 p-4 dark:border-gray-800/80 dark:bg-gray-900/35">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100"><Sparkles className="h-4 w-4 text-cyan-500" />Preview result</p>
              <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">Preview runs the same transformation SQL that apply uses.</p>
            </div>
            <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${previewDirty ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>
              {previewDirty ? <RefreshCw className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {previewDirty ? "Needs refresh" : "Ready"}
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <StatCard label="Rows after plan" value={previewCount === null ? "—" : formatNumber(previewCount)} />
            <StatCard label="Remaining nulls" value={remainingNulls === null ? "—" : formatNumber(remainingNulls)} />
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-800/80">
            {previewLoading ? (
              <div className="flex items-center gap-2 px-4 py-10 text-sm text-gray-500 dark:text-gray-400"><Loader2 className="h-4 w-4 animate-spin" />Running DuckDB preview query</div>
            ) : previewRows.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-10 text-sm text-gray-500 dark:text-gray-400"><Eye className="h-4 w-4" />Preview rows will appear here after you run the plan.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
                  <thead className="bg-gray-100/80 dark:bg-gray-900/80">
                    <tr>{columns.map((column) => <th key={column.name} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">{column.name}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {previewRows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="bg-white/80 dark:bg-gray-950/40">
                        {columns.map((column) => <td key={column.name} className="max-w-[180px] truncate px-3 py-2 text-sm text-gray-700 dark:text-gray-200">{cellText(row[column.name])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {status && (
            <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${status.kind === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"}`}>
              {status.message}
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}
