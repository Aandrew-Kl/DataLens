"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  BookOpen,
  Check,
  Code2,
  Play,
  Save,
  Sparkles,
  Table2,
} from "lucide-react";
import type { ColumnProfile } from "@/types/dataset";
import { runQuery } from "@/lib/duckdb/client";

interface FormulaEditorProps {
  tableName: string;
  columns: ColumnProfile[];
  onSave: (name: string, expression: string) => void;
}

interface FunctionTemplate {
  name: string;
  snippet: string;
  description: string;
}

interface FunctionGroup {
  title: string;
  items: FunctionTemplate[];
}

type StatusState =
  | {
      type: "error" | "success";
      message: string;
    }
  | null;

const FUNCTION_GROUPS: FunctionGroup[] = [
  {
    title: "Text",
    items: [
      {
        name: "LOWER",
        snippet: "LOWER(|)",
        description: "Normalize free-text values before comparing them.",
      },
      {
        name: "UPPER",
        snippet: "UPPER(|)",
        description: "Convert text to uppercase.",
      },
      {
        name: "CONCAT",
        snippet: "CONCAT(|, ' - ', '')",
        description: "Join multiple string fragments into one label.",
      },
      {
        name: "REGEXP_REPLACE",
        snippet: "REGEXP_REPLACE(|, '[^0-9A-Za-z ]', '')",
        description: "Clean noisy strings with a regular expression.",
      },
    ],
  },
  {
    title: "Numeric",
    items: [
      {
        name: "ROUND",
        snippet: "ROUND(|, 2)",
        description: "Round numeric values to a fixed precision.",
      },
      {
        name: "ABS",
        snippet: "ABS(|)",
        description: "Return the absolute value.",
      },
      {
        name: "COALESCE",
        snippet: "COALESCE(|, 0)",
        description: "Replace nulls with a fallback value.",
      },
      {
        name: "NULLIF",
        snippet: "NULLIF(|, 0)",
        description: "Turn a sentinel value into null.",
      },
    ],
  },
  {
    title: "Date / Time",
    items: [
      {
        name: "DATE_TRUNC",
        snippet: "DATE_TRUNC('month', |)",
        description: "Bucket timestamps into months, weeks, or days.",
      },
      {
        name: "EXTRACT",
        snippet: "EXTRACT(YEAR FROM |)",
        description: "Pull one date part into its own field.",
      },
      {
        name: "STRFTIME",
        snippet: "STRFTIME(|, '%Y-%m')",
        description: "Format dates into display-ready text.",
      },
    ],
  },
  {
    title: "Logic",
    items: [
      {
        name: "CASE",
        snippet: "CASE WHEN | THEN 1 ELSE 0 END",
        description: "Create conditional buckets or boolean flags.",
      },
      {
        name: "CAST",
        snippet: "CAST(| AS DOUBLE)",
        description: "Convert a value to a specific DuckDB type.",
      },
      {
        name: "IFNULL",
        snippet: "IFNULL(|, 'missing')",
        description: "Use a simple two-argument null fallback.",
      },
    ],
  },
];

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "DuckDB rejected the expression.";
}

function stringifyPreviewValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

export default function FormulaEditor({
  tableName,
  columns,
  onSave,
}: FormulaEditorProps) {
  const [name, setName] = useState("");
  const [expression, setExpression] = useState("");
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [status, setStatus] = useState<StatusState>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const previewAlias = name.trim() || "preview";
  const previewSql =
    expression.trim().length > 0
      ? `SELECT\n  ${expression.trim()} AS ${quoteIdentifier(previewAlias)}\nFROM ${quoteIdentifier(tableName)}\nLIMIT 5;`
      : `SELECT\n  <expression> AS ${quoteIdentifier(previewAlias)}\nFROM ${quoteIdentifier(tableName)}\nLIMIT 5;`;

  function insertSnippet(rawSnippet: string) {
    const textarea = textareaRef.current;
    const placeholderIndex = rawSnippet.indexOf("|");
    const snippet = rawSnippet.replace("|", "");

    setPreviewRows([]);
    setStatus(null);

    if (!textarea) {
      setExpression((current) => `${current}${snippet}`);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextExpression =
      expression.slice(0, start) + snippet + expression.slice(end);

    setExpression(nextExpression);

    const cursorOffset =
      placeholderIndex >= 0 ? placeholderIndex : snippet.length;

    requestAnimationFrame(() => {
      textarea.focus();
      const nextPosition = start + cursorOffset;
      textarea.setSelectionRange(nextPosition, nextPosition);
    });
  }

  async function handlePreview() {
    const trimmedExpression = expression.trim();

    if (!trimmedExpression) {
      setStatus({
        type: "error",
        message: "Enter a SQL expression before previewing it.",
      });
      setPreviewRows([]);
      return;
    }

    setIsPreviewing(true);
    setStatus(null);

    try {
      const rows = await runQuery(
        `SELECT ${trimmedExpression} AS ${quoteIdentifier(previewAlias)} FROM ${quoteIdentifier(tableName)} LIMIT 5`
      );
      setPreviewRows(rows);
      setStatus({
        type: "success",
        message: `Preview returned ${rows.length} sample row${rows.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setPreviewRows([]);
      setStatus({
        type: "error",
        message: getErrorMessage(error),
      });
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleSave() {
    const trimmedName = name.trim();
    const trimmedExpression = expression.trim();

    if (!trimmedName) {
      setStatus({
        type: "error",
        message: "Computed columns need a name before they can be saved.",
      });
      return;
    }

    if (!trimmedExpression) {
      setStatus({
        type: "error",
        message: "Computed columns need a SQL expression before saving.",
      });
      return;
    }

    if (
      columns.some(
        (column) => column.name.toLowerCase() === trimmedName.toLowerCase()
      )
    ) {
      setStatus({
        type: "error",
        message: `A column named "${trimmedName}" already exists in ${tableName}.`,
      });
      return;
    }

    setIsSaving(true);
    setStatus(null);

    try {
      await runQuery(
        `SELECT ${trimmedExpression} AS ${quoteIdentifier(trimmedName)} FROM ${quoteIdentifier(tableName)} LIMIT 1`
      );
      onSave(trimmedName, trimmedExpression);
      setStatus({
        type: "success",
        message: `Saved computed column "${trimmedName}".`,
      });
    } catch (error) {
      setStatus({
        type: "error",
        message: getErrorMessage(error),
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="
        rounded-2xl border border-white/30 dark:border-white/10
        bg-white/55 dark:bg-gray-900/55 backdrop-blur-xl
        shadow-[0_20px_80px_-30px_rgba(15,23,42,0.35)]
        overflow-hidden
      "
    >
      <div className="border-b border-gray-200/50 dark:border-gray-700/50 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-300">
              <Sparkles className="h-3.5 w-3.5" />
              Formula editor
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
              Build computed column expressions
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Write a DuckDB expression, preview it against <span className="font-mono">{tableName}</span>, then save the
              validated formula.
            </p>
          </div>

          <div className="inline-flex items-center gap-2 rounded-xl border border-gray-200/60 dark:border-gray-700/60 bg-white/50 dark:bg-gray-950/40 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
            <Table2 className="h-4 w-4 text-blue-500 dark:text-blue-300" />
            <span className="font-medium">{columns.length}</span>
            <span>available columns</span>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                Column name
              </span>
              <input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setPreviewRows([]);
                  setStatus(null);
                }}
                placeholder="profit_margin"
                className="
                  h-11 w-full rounded-xl border border-gray-200/70 dark:border-gray-700/70
                  bg-white/70 dark:bg-gray-950/50
                  px-3 text-sm text-gray-900 dark:text-gray-100
                  outline-none transition
                  placeholder:text-gray-400 dark:placeholder:text-gray-500
                  focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20
                "
              />
            </label>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                  Available columns
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Click a chip to insert a quoted identifier.
                </span>
              </div>

              <div className="flex flex-wrap gap-2 rounded-2xl border border-gray-200/60 dark:border-gray-700/60 bg-white/40 dark:bg-gray-950/30 p-3">
                {columns.map((column, index) => (
                  <motion.button
                    key={column.name}
                    type="button"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.02, duration: 0.2 }}
                    onClick={() => insertSnippet(quoteIdentifier(column.name))}
                    className="
                      inline-flex items-center gap-2 rounded-full border border-gray-200/70 dark:border-gray-700/70
                      bg-white/75 dark:bg-gray-900/70 px-3 py-1.5 text-xs font-medium
                      text-gray-700 dark:text-gray-200 transition
                      hover:border-blue-400/60 hover:text-blue-600 dark:hover:text-blue-300
                    "
                  >
                    <span>{column.name}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      {column.type}
                    </span>
                  </motion.button>
                ))}

                {columns.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No columns are available for this relation yet.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                SQL expression
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <Code2 className="h-3.5 w-3.5" />
                DuckDB syntax
              </span>
            </div>

            <textarea
              ref={textareaRef}
              value={expression}
              onChange={(event) => {
                setExpression(event.target.value);
                setPreviewRows([]);
                setStatus(null);
              }}
              placeholder='COALESCE("revenue", 0) - COALESCE("cost", 0)'
              className="
                min-h-[180px] w-full rounded-2xl border border-gray-200/70 dark:border-gray-700/70
                bg-slate-950/95 px-4 py-3 font-mono text-sm leading-6 text-slate-100
                outline-none transition placeholder:text-slate-500
                focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20
              "
            />
          </div>

          <div className="rounded-2xl border border-gray-200/60 dark:border-gray-700/60 bg-white/45 dark:bg-gray-950/35 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                Preview query
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">Generated from the current editor state</span>
            </div>

            <pre className="overflow-x-auto rounded-xl bg-slate-950/95 px-4 py-3 text-xs leading-6 text-slate-200">
              {previewSql}
            </pre>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handlePreview}
              disabled={isPreviewing}
              className="
                inline-flex items-center gap-2 rounded-xl border border-blue-500/30
                bg-blue-500/15 px-4 py-2.5 text-sm font-semibold text-blue-700
                transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60
                dark:text-blue-200
              "
            >
              <Play className="h-4 w-4" />
              {isPreviewing ? "Running preview..." : "Preview"}
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="
                inline-flex items-center gap-2 rounded-xl border border-emerald-500/30
                bg-emerald-500/15 px-4 py-2.5 text-sm font-semibold text-emerald-700
                transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60
                dark:text-emerald-200
              "
            >
              <Save className="h-4 w-4" />
              {isSaving ? "Validating..." : "Save formula"}
            </button>
          </div>

          <AnimatePresence mode="wait">
            {status && (
              <motion.div
                key={status.message}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className={`
                  flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm
                  ${
                    status.type === "error"
                      ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-200"
                      : "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
                  }
                `}
              >
                {status.type === "error" ? (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <Check className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <p>{status.message}</p>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="rounded-2xl border border-gray-200/60 dark:border-gray-700/60 bg-white/45 dark:bg-gray-950/35 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                  Preview results
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  The first five values returned by the current expression.
                </p>
              </div>
            </div>

            {previewRows.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-gray-200/60 dark:border-gray-700/60">
                <table className="min-w-full divide-y divide-gray-200/60 dark:divide-gray-700/60 text-sm">
                  <thead className="bg-gray-50/80 dark:bg-gray-900/70">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                        #
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                        {previewAlias}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200/60 dark:divide-gray-700/60">
                    {previewRows.map((row, index) => (
                      <tr key={`${previewAlias}-${index}`} className="bg-white/60 dark:bg-gray-950/30">
                        <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">
                          {index + 1}
                        </td>
                        <td className="px-3 py-2 font-mono text-sm text-gray-800 dark:text-gray-200">
                          {stringifyPreviewValue(row[previewAlias])}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200/70 dark:border-gray-700/70 bg-white/30 dark:bg-gray-950/20 px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                Run a preview to inspect sample output values here.
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-gray-200/60 dark:border-gray-700/60 bg-white/45 dark:bg-gray-950/35 p-4">
            <div className="mb-4 flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-blue-500 dark:text-blue-300" />
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                  DuckDB functions
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Click any snippet to insert it into the expression editor.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {FUNCTION_GROUPS.map((group) => (
                <div key={group.title} className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                    {group.title}
                  </p>

                  <div className="space-y-2">
                    {group.items.map((item) => (
                      <button
                        key={`${group.title}-${item.name}`}
                        type="button"
                        onClick={() => insertSnippet(item.snippet)}
                        className="
                          block w-full rounded-xl border border-gray-200/60 dark:border-gray-700/60
                          bg-white/70 dark:bg-gray-950/40 px-3 py-3 text-left transition
                          hover:border-blue-400/50 hover:bg-blue-500/5
                        "
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-300">
                            {item.name}
                          </span>
                          <span className="text-[10px] uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
                            Insert
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                          {item.description}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </motion.section>
  );
}
