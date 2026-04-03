"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Download,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface TypeCastToolProps {
  tableName: string;
  columns: ColumnProfile[];
}

type TargetType = "string" | "number" | "date" | "boolean";

interface PreviewRow {
  originalValue: string;
  castValue: string;
  failedCast: boolean;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "border border-white/20 bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 rounded-[1.75rem] shadow-xl shadow-slate-950/10";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:bg-slate-950/50 dark:text-slate-100";

const TARGET_OPTIONS = [
  { value: "string", label: "String", sql: "VARCHAR" },
  { value: "number", label: "Number", sql: "DOUBLE" },
  { value: "date", label: "Date", sql: "TIMESTAMP" },
  { value: "boolean", label: "Boolean", sql: "BOOLEAN" },
] satisfies Array<{ value: TargetType; label: string; sql: string }>;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "null";
  return String(value);
}

function targetSql(targetType: TargetType): string {
  return TARGET_OPTIONS.find((option) => option.value === targetType)?.sql ?? "VARCHAR";
}

function buildPreviewCsv(rows: PreviewRow[]): string {
  const header = "original_value,cast_value,failed_cast";
  const body = rows.map((row) =>
    [row.originalValue, row.castValue, row.failedCast ? "true" : "false"].join(","),
  );
  return [header, ...body].join("\n");
}

export default function TypeCastTool({
  tableName,
  columns,
}: TypeCastToolProps) {
  const [selectedColumn, setSelectedColumn] = useState(columns[0]?.name ?? "");
  const [targetType, setTargetType] = useState<TargetType>("string");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [failedCount, setFailedCount] = useState(0);
  const [status, setStatus] = useState("Preview a cast to inspect failed conversions before applying it.");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);

  const newColumnName = useMemo(
    () => `${selectedColumn}_${targetType}`,
    [selectedColumn, targetType],
  );

  async function handlePreview() {
    if (!selectedColumn) return;
    setPreviewLoading(true);
    setStatus(`Previewing ${selectedColumn} as ${targetType}...`);

    const sourceColumn = quoteIdentifier(selectedColumn);
    const sourceTable = quoteIdentifier(tableName);
    const castType = targetSql(targetType);

    try {
      const [summaryRows, sampleRows] = await Promise.all([
        runQuery(`
          SELECT COUNT(*) FILTER (
            WHERE ${sourceColumn} IS NOT NULL
              AND TRY_CAST(${sourceColumn} AS ${castType}) IS NULL
          ) AS failed_count
          FROM ${sourceTable}
        `),
        runQuery(`
          SELECT
            CAST(${sourceColumn} AS VARCHAR) AS original_value,
            CAST(TRY_CAST(${sourceColumn} AS ${castType}) AS VARCHAR) AS cast_value,
            ${sourceColumn} IS NOT NULL AND TRY_CAST(${sourceColumn} AS ${castType}) IS NULL AS failed_cast
          FROM ${sourceTable}
          LIMIT 8
        `),
      ]);

      startTransition(() => {
        setFailedCount(Number(summaryRows[0]?.failed_count ?? 0));
        setPreviewRows(
          sampleRows.map((row) => ({
            originalValue: formatCell(row.original_value),
            castValue: formatCell(row.cast_value),
            failedCast: Boolean(row.failed_cast),
          })),
        );
        setStatus(
          `Preview loaded for ${selectedColumn}. ${formatNumber(Number(summaryRows[0]?.failed_count ?? 0))} failed casts detected.`,
        );
      });
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to preview the cast.",
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleApply() {
    if (!selectedColumn) return;
    setApplyLoading(true);
    setStatus(`Applying ${targetType} cast into ${newColumnName}...`);
    const sourceColumn = quoteIdentifier(selectedColumn);
    const sourceTable = quoteIdentifier(tableName);
    const castColumn = quoteIdentifier(newColumnName);
    const castType = targetSql(targetType);

    try {
      await runQuery(
        `ALTER TABLE ${sourceTable} ADD COLUMN IF NOT EXISTS ${castColumn} ${castType}`
      );
      await runQuery(
        `UPDATE ${sourceTable} SET ${castColumn} = TRY_CAST(${sourceColumn} AS ${castType})`
      );
      setStatus(`Created ${newColumnName} from ${selectedColumn}.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to apply the cast.",
      );
    } finally {
      setApplyLoading(false);
    }
  }

  function handleExport() {
    if (previewRows.length === 0) return;
    downloadFile(
      buildPreviewCsv(previewRows),
      `${tableName}-${selectedColumn}-${targetType}-preview.csv`,
      "text/csv;charset=utf-8",
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE }}
      className={`${PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-4 border-b border-white/20 pb-5 dark:border-white/10 xl:flex-row xl:items-center xl:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
            <Sparkles className="h-3.5 w-3.5" />
            Type Cast Tool
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
              Cast one column into a new typed field
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Preview `TRY_CAST` results first, then materialize the cast into a
              new DuckDB column without overwriting the source.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:min-w-[28rem]">
          <select
            aria-label="Select column"
            value={selectedColumn}
            onChange={(event) => setSelectedColumn(event.currentTarget.value)}
            className={FIELD_CLASS}
          >
            {columns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Target type"
            value={targetType}
            onChange={(event) => setTargetType(event.currentTarget.value as TargetType)}
            className={FIELD_CLASS}
          >
            {TARGET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-white/60 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
        {status}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className={`${PANEL_CLASS} p-5`}>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Casting plan
          </p>
          <div className="mt-4 space-y-3 text-sm text-slate-700 dark:text-slate-200">
            <p>
              Source column: <strong>{selectedColumn || "None selected"}</strong>
            </p>
            <p>
              Target type: <strong>{targetType}</strong>
            </p>
            <p>
              New column: <strong>{newColumnName}</strong>
            </p>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                void handlePreview();
              }}
              disabled={!selectedColumn || previewLoading}
              className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-400 dark:disabled:bg-slate-700"
            >
              {previewLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Preview cast results
            </button>
            <button
              type="button"
              onClick={() => {
                void handleApply();
              }}
              disabled={!selectedColumn || applyLoading}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-900/50 dark:text-slate-200"
            >
              {applyLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Apply new column
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={previewRows.length === 0}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-900/50 dark:text-slate-200"
            >
              <Download className="h-4 w-4" />
              Export preview CSV
            </button>
          </div>

          <div className="mt-5 rounded-2xl bg-white/70 p-4 text-sm text-slate-700 dark:bg-slate-900/50 dark:text-slate-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span>
                Failed casts: <strong>{formatNumber(failedCount)}</strong>
              </span>
            </div>
          </div>
        </div>

        <div className={`${PANEL_CLASS} p-5`}>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Cast preview
          </p>
          <div className="mt-4 overflow-x-auto">
            {previewRows.length > 0 ? (
              <table className="min-w-full text-left text-sm">
                <thead className="text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Original</th>
                    <th className="px-3 py-2 font-medium">Cast value</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, index) => (
                    <tr
                      key={`${row.originalValue}-${index}`}
                      className="border-t border-white/20 dark:border-white/10"
                    >
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {row.originalValue}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {row.castValue}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {row.failedCast ? "Failed" : "Converted"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Preview rows appear here after you run a cast preview.
              </p>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
