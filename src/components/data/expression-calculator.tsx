"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Code2, Download, Loader2, Play, Sparkles } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

interface ExpressionCalculatorProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface ExpressionTemplate {
  label: string;
  snippet: string;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "border border-white/20 bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 rounded-[1.75rem] shadow-xl shadow-slate-950/10";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:bg-slate-950/50 dark:text-slate-100";

const EXPRESSION_TEMPLATES: ExpressionTemplate[] = [
  {
    label: "Insert CASE",
    snippet: "CASE WHEN amount > 1000 THEN 'high' ELSE 'standard' END",
  },
  {
    label: "Insert math",
    snippet: "ROUND(revenue - cost, 2)",
  },
  {
    label: "Insert string",
    snippet: "CONCAT(customer_name, ' / ', region)",
  },
] as const;
function sanitizeName(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized.length > 0 ? sanitized : "expression_result";
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function buildCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Array.from(
    rows.reduce((keys, row) => {
      for (const key of Object.keys(row)) {
        keys.add(key);
      }
      return keys;
    }, new Set<string>()),
  );

  const body = rows.map((row) =>
    headers.map((header) => formatCell(row[header])).join(","),
  );
  return [headers.join(","), ...body].join("\n");
}

export default function ExpressionCalculator({
  tableName,
  columns,
}: ExpressionCalculatorProps) {
  const [expression, setExpression] = useState("");
  const [virtualColumnName, setVirtualColumnName] = useState("calculated_metric");
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [status, setStatus] = useState("Write a DuckDB expression, preview it, then register it as a virtual column view.");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const quotedAlias = useMemo(
    () => quoteIdentifier(sanitizeName(virtualColumnName)),
    [virtualColumnName],
  );

  const previewHeaders = useMemo(
    () =>
      Array.from(
        previewRows.reduce((keys, row) => {
          for (const key of Object.keys(row)) {
            keys.add(key);
          }
          return keys;
        }, new Set<string>()),
      ),
    [previewRows],
  );

  function handleInsertSnippet(snippet: string) {
    setExpression((current) => (current.trim().length > 0 ? `${current}\n${snippet}` : snippet));
  }

  async function handlePreview() {
    if (expression.trim().length === 0) {
      setStatus("Enter a DuckDB expression before previewing it.");
      return;
    }
    setLoading(true);
    setStatus("Executing preview expression...");

    try {
      const rows = await runQuery(`
        SELECT
          *,
          ${expression.trim()} AS ${quotedAlias}
        FROM ${quoteIdentifier(tableName)}
        LIMIT 8
      `);
      startTransition(() => {
        setPreviewRows(rows);
        setStatus(`Preview returned ${rows.length} row${rows.length === 1 ? "" : "s"}.`);
      });
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to preview the expression.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateVirtualColumn() {
    if (expression.trim().length === 0) {
      setStatus("Enter a DuckDB expression before saving it as a virtual column.");
      return;
    }
    setSaving(true);
    setStatus("Creating or replacing a virtual calculation view...");
    const viewName = `${tableName}__${sanitizeName(virtualColumnName)}`;
    try {
      await runQuery(`
        CREATE OR REPLACE VIEW ${quoteIdentifier(viewName)} AS
        SELECT
          *,
          ${expression.trim()} AS ${quotedAlias}
        FROM ${quoteIdentifier(tableName)}
      `);
      setStatus(`Created virtual column view ${viewName}.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to create the virtual column view.",
      );
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    if (previewRows.length === 0) return;
    downloadFile(
      buildCsv(previewRows),
      `${tableName}-${sanitizeName(virtualColumnName)}-preview.csv`,
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
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-700 dark:text-violet-300">
            <Code2 className="h-3.5 w-3.5" />
            Expression Calculator
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
              Calculate SQL expressions without leaving the dataset
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Supports CASE logic, arithmetic, and string functions via DuckDB.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              void handlePreview();
            }}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-400 dark:disabled:bg-slate-700"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Preview results
          </button>
          <button
            type="button"
            onClick={() => {
              void handleCreateVirtualColumn();
            }}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-900/50 dark:text-slate-200"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Add as virtual column
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={previewRows.length === 0}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-900/50 dark:text-slate-200"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-white/60 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
        {status}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className={`${PANEL_CLASS} p-5`}>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Quick templates
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {EXPRESSION_TEMPLATES.map((template) => (
              <button
                key={template.label}
                type="button"
                onClick={() => handleInsertSnippet(template.snippet)}
                className="rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-500/20 dark:text-violet-300"
              >
                {template.label}
              </button>
            ))}
          </div>

          <div className="mt-5 space-y-3">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                Virtual column name
              </span>
              <input
                value={virtualColumnName}
                onChange={(event) => setVirtualColumnName(event.currentTarget.value)}
                className={`${FIELD_CLASS} w-full`}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                SQL expression
              </span>
              <textarea
                aria-label="SQL expression"
                value={expression}
                onChange={(event) => setExpression(event.currentTarget.value)}
                rows={10}
                placeholder={`CASE\n  WHEN ${columns[0]?.name ?? "metric"} > 0 THEN 'positive'\n  ELSE 'neutral'\nEND`}
                className={`${FIELD_CLASS} min-h-[14rem] w-full resize-y font-mono`}
              />
            </label>
          </div>
        </div>

        <div className={`${PANEL_CLASS} p-5`}>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Preview rows
          </p>
          {previewRows.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-slate-500 dark:text-slate-400">
                  <tr>
                    {previewHeaders.map((header) => (
                      <th key={header} className="px-3 py-2 font-medium">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, rowIndex) => (
                    <tr
                      key={`${rowIndex}-${virtualColumnName}`}
                      className="border-t border-white/20 dark:border-white/10"
                    >
                      {previewHeaders.map((header) => (
                        <td
                          key={`${rowIndex}-${header}`}
                          className="px-3 py-3 text-slate-700 dark:text-slate-200"
                        >
                          {formatCell(row[header])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
              Preview rows will appear here after the expression runs.
            </p>
          )}
        </div>
      </div>
    </motion.section>
  );
}
