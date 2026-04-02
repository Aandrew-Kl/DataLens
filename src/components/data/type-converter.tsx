"use client";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  DatabaseZap,
  Eye,
  Hash,
  HelpCircle,
  Loader2,
  RefreshCw,
  ToggleLeft,
  Type,
} from "lucide-react";
import type { ColumnProfile, ColumnType } from "@/types/dataset";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
interface TypeConverterProps {
  tableName: string;
  columns: ColumnProfile[];
  onConvert: () => void;
}
type TargetType = "string" | "number" | "date" | "boolean";
type PreviewRow = { original: string; converted: string; invalid: boolean };
type StatusState = { kind: "success" | "error"; message: string } | null;
const TYPE_OPTIONS: Array<{ value: TargetType; label: string; sql: string }> = [
  { value: "string", label: "String", sql: "VARCHAR" },
  { value: "number", label: "Number", sql: "DOUBLE" },
  { value: "date", label: "Date", sql: "TIMESTAMP" },
  { value: "boolean", label: "Boolean", sql: "BOOLEAN" },
];
const TYPE_ICONS: Record<ColumnType, typeof Type> = {
  string: Type,
  number: Hash,
  date: Calendar,
  boolean: ToggleLeft,
  unknown: HelpCircle,
};
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
const baseTarget = (type: ColumnType): TargetType => (type === "unknown" ? "string" : type);
const sqlType = (type: TargetType) => TYPE_OPTIONS.find((option) => option.value === type)?.sql ?? "VARCHAR";
const show = (value: unknown) => (value === null || value === undefined ? "null" : String(value));
const errorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "DuckDB could not complete the conversion.";
function buildSelectList(columns: ColumnProfile[], targets: Record<string, TargetType>) {
  return columns
    .map((column) => {
      const target = targets[column.name] ?? baseTarget(column.type);
      const field = quote(column.name);
      return target === baseTarget(column.type) ? field : `TRY_CAST(${field} AS ${sqlType(target)}) AS ${field}`;
    })
    .join(", ");
}
export default function TypeConverter({ tableName, columns, onConvert }: TypeConverterProps) {
  const [targets, setTargets] = useState<Record<string, TargetType>>({});
  const [selectedColumn, setSelectedColumn] = useState(columns[0]?.name ?? "");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [invalidCount, setInvalidCount] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<StatusState>(null);
  useEffect(() => {
    setTargets((current) =>
      Object.fromEntries(columns.map((column) => [column.name, current[column.name] ?? baseTarget(column.type)]))
    );
    if (!columns.some((column) => column.name === selectedColumn)) setSelectedColumn(columns[0]?.name ?? "");
  }, [columns, selectedColumn]);
  const selected = useMemo(
    () => columns.find((column) => column.name === selectedColumn) ?? null,
    [columns, selectedColumn]
  );
  const selectedTarget = selected ? targets[selected.name] ?? baseTarget(selected.type) : "string";
  const pending = useMemo(
    () => columns.filter((column) => (targets[column.name] ?? baseTarget(column.type)) !== baseTarget(column.type)),
    [columns, targets]
  );
  const selectList = useMemo(() => buildSelectList(columns, targets), [columns, targets]);
  useEffect(() => {
    if (!selected) {
      setPreviewRows([]);
      setInvalidCount(0);
      return;
    }
    let cancelled = false;
    const tableSql = quote(tableName);
    const columnSql = quote(selected.name);
    const castSql = sqlType(selectedTarget);
    async function loadPreview() {
      setPreviewLoading(true);
      try {
        const [summaryRows, sampleRows] = await Promise.all([
          runQuery(
            `SELECT COUNT(*) FILTER (WHERE ${columnSql} IS NOT NULL) AS non_null_count, COUNT(*) FILTER (WHERE ${columnSql} IS NOT NULL AND TRY_CAST(${columnSql} AS ${castSql}) IS NULL) AS invalid_count FROM ${tableSql}`
          ),
          runQuery(
            `WITH preview AS (SELECT CAST(${columnSql} AS VARCHAR) AS original_value, CAST(TRY_CAST(${columnSql} AS ${castSql}) AS VARCHAR) AS converted_value, ${columnSql} IS NOT NULL AND TRY_CAST(${columnSql} AS ${castSql}) IS NULL AS invalid_cast FROM ${tableSql}) SELECT * FROM preview ORDER BY invalid_cast DESC, original_value NULLS LAST LIMIT 8`
          ),
        ]);
        if (cancelled) return;
        setInvalidCount(Number(summaryRows[0]?.invalid_count ?? 0));
        setPreviewRows(
          sampleRows.map((row) => ({
            original: show(row.original_value),
            converted: show(row.converted_value),
            invalid: Boolean(row.invalid_cast),
          }))
        );
      } catch (error) {
        if (cancelled) return;
        setPreviewRows([]);
        setInvalidCount(0);
        setStatus({ kind: "error", message: errorMessage(error) });
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }
    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [selected, selectedTarget, tableName]);
  async function handleApply() {
    if (!pending.length) return;
    setSubmitting(true);
    setStatus(null);
    const stamp = Date.now();
    const originalSql = quote(tableName);
    const tempSql = quote(`${tableName}__typecast_${stamp}`);
    const backupSql = quote(`${tableName}__backup_${stamp}`);
    try {
      await runQuery(`DROP TABLE IF EXISTS ${tempSql}`);
      await runQuery(`DROP TABLE IF EXISTS ${backupSql}`);
      await runQuery(`CREATE TABLE ${tempSql} AS SELECT ${selectList} FROM ${originalSql}`);
      await runQuery(`ALTER TABLE ${originalSql} RENAME TO ${backupSql}`);
      try {
        await runQuery(`ALTER TABLE ${tempSql} RENAME TO ${originalSql}`);
        await runQuery(`DROP TABLE ${backupSql}`);
      } catch (swapError) {
        await runQuery(`ALTER TABLE ${backupSql} RENAME TO ${originalSql}`).catch(() => undefined);
        await runQuery(`DROP TABLE IF EXISTS ${tempSql}`).catch(() => undefined);
        throw swapError;
      }
      setStatus({
        kind: "success",
        message: `Converted ${pending.length} column${pending.length === 1 ? "" : "s"} in ${tableName}.`,
      });
      onConvert();
    } catch (error) {
      await runQuery(`DROP TABLE IF EXISTS ${tempSql}`).catch(() => undefined);
      setStatus({ kind: "error", message: errorMessage(error) });
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="overflow-hidden rounded-2xl border border-gray-200/70 bg-white/80 shadow-sm backdrop-blur-sm dark:border-gray-800/80 dark:bg-gray-950/40"
    >
      <div className="flex flex-col gap-4 border-b border-gray-200/70 px-5 py-5 dark:border-gray-800/80 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
            <DatabaseZap className="h-3.5 w-3.5" />
            Column Type Converter
          </div>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            Change column targets, inspect DuckDB preview rows, then rewrite{" "}
            <span className="font-mono text-gray-900 dark:text-gray-100">{tableName}</span> with `CREATE TABLE AS SELECT ... TRY_CAST(...)`.
          </p>
        </div>
        <button
          onClick={handleApply}
          disabled={!pending.length || submitting}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-gray-400 dark:disabled:bg-gray-700"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Apply {pending.length ? `(${pending.length})` : ""}
        </button>
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-3">
          {columns.map((column, index) => {
            const Icon = TYPE_ICONS[column.type];
            const target = targets[column.name] ?? baseTarget(column.type);
            const changed = target !== baseTarget(column.type);
            return (
              <motion.button
                key={column.name}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.02, duration: 0.18 }}
                onClick={() => setSelectedColumn(column.name)}
                className={`w-full rounded-2xl border p-4 text-left transition ${selectedColumn === column.name ? "border-cyan-400/60 bg-cyan-500/10 dark:border-cyan-500/40 dark:bg-cyan-500/10" : "border-gray-200/70 bg-gray-50/60 hover:border-cyan-300 dark:border-gray-800/80 dark:bg-gray-950/20 dark:hover:border-cyan-700/70"}`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                      <Icon className="h-4 w-4 text-cyan-500" />
                      <span className="truncate">{column.name}</span>
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <span>{column.type}</span>
                      <ArrowRight className="h-3 w-3" />
                      <span className={changed ? "text-amber-600 dark:text-amber-300" : ""}>{target}</span>
                    </p>
                  </div>
                  <select
                    value={target}
                    onChange={(event) => {
                      setTargets((current) => ({ ...current, [column.name]: event.target.value as TargetType }));
                      setSelectedColumn(column.name);
                    }}
                    onClick={(event) => event.stopPropagation()}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition focus:border-cyan-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  >
                    {TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </motion.button>
            );
          })}
        </div>

        <div className="rounded-2xl border border-gray-200/70 bg-gray-50/60 p-4 dark:border-gray-800/80 dark:bg-gray-950/20">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                <Eye className="h-4 w-4 text-cyan-500" />
                Preview {selected ? `for ${selected.name}` : ""}
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                DuckDB preview rows use `TRY_CAST`, so failed conversions become null.
              </p>
            </div>
            {invalidCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" />
                {formatNumber(invalidCount)} invalid
              </span>
            )}
          </div>
          <div className="mt-4 space-y-2">
            {previewLoading ? (
              <div className="flex items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Fetching preview rows from DuckDB
              </div>
            ) : previewRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                No preview rows available for this column.
              </div>
            ) : (
              previewRows.map((row, index) => (
                <div
                  key={`${row.original}-${index}`}
                  className={`rounded-xl border px-3 py-2 text-sm ${row.invalid ? "border-amber-500/30 bg-amber-500/10" : "border-gray-200/70 bg-white/80 dark:border-gray-800/80 dark:bg-gray-900/60"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-mono text-gray-600 dark:text-gray-300">{row.original}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    <span className={`truncate font-mono ${row.invalid ? "text-amber-700 dark:text-amber-300" : "text-cyan-700 dark:text-cyan-300"}`}>
                      {row.converted}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {status && (
        <div
          className={`border-t px-5 py-4 text-sm ${status.kind === "success" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : "border-red-500/20 bg-red-500/10 text-red-800 dark:text-red-300"}`}
        >
          {status.message}
        </div>
      )}
    </motion.section>
  );
}
