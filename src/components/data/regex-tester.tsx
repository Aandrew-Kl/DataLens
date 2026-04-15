"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useMemo, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Filter, Loader2, Search, Sparkles, Table2, XCircle } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface RegexTesterProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface RegexMatchRow {
  rowNumber: number;
  value: string;
}

type StatusState = { kind: "success" | "error"; message: string } | null;

const PREVIEW_LIMIT = 100;
const ease = [0.16, 1, 0.3, 1] as const;
const panelClass =
  "overflow-hidden rounded-[28px] border border-white/25 bg-white/70 shadow-[0_24px_90px_-48px_rgba(15,23,42,0.7)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const fieldClass =
  "w-full rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700/70 dark:bg-slate-950/60 dark:text-slate-100";
const buttonClass =
  "inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-55";
const QUICK_PATTERNS = [
  { id: "email", label: "Email", pattern: "^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$" },
  { id: "phone", label: "Phone", pattern: "^(?:\\+?1[-.\\s]?)?(?:\\(?\\d{3}\\)?[-.\\s]?)?\\d{3}[-.\\s]?\\d{4}$" },
  { id: "url", label: "URL", pattern: "^(https?:\\/\\/)?[\\w.-]+\\.[a-z]{2,}(?:\\/\\S*)?$" },
  { id: "date", label: "Date", pattern: "^(?:\\d{4}-\\d{2}-\\d{2}|\\d{2}\\/\\d{2}\\/\\d{4})$" },
  { id: "number", label: "Number", pattern: "^-?\\d+(?:\\.\\d+)?$" },
  { id: "zip", label: "Zip Code", pattern: "^\\d{5}(?:-\\d{4})?$" },
] as const;

function subscribeDarkMode(callback: () => void) {
  if (typeof document === "undefined") return () => undefined;
  const root = document.documentElement;
  const observer = new MutationObserver(callback);
  observer.observe(root, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function getDarkModeSnapshot() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

function useDarkMode() {
  return useSyncExternalStore(subscribeDarkMode, getDarkModeSnapshot, () => false);
}
function escapeSqlLiteral(value: string) {
  return value.replace(/'/g, "''");
}

function buildDuckDbFlags(caseInsensitive: boolean, multiline: boolean) {
  return `${caseInsensitive ? "i" : ""}${multiline ? "m" : ""}`;
}

function createRegex(pattern: string, caseInsensitive: boolean, multiline: boolean) {
  if (!pattern.trim()) {
    return { regex: null, error: "Enter a regular expression to test." };
  }
  try {
    return {
      regex: new RegExp(pattern, `${caseInsensitive ? "i" : ""}${multiline ? "m" : ""}`),
      error: null,
    };
  } catch (error) {
    return {
      regex: null,
      error: error instanceof Error ? error.message : "Invalid regular expression.",
    };
  }
}

function renderHighlightedValue(value: string, regex: RegExp | null) {
  if (!regex) return value;
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const matcher = new RegExp(regex.source, flags);
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(matcher)) {
    const text = match[0] ?? "";
    const index = match.index ?? 0;
    if (!text) break;
    if (index > lastIndex) {
      parts.push(<span key={`text-${index}`}>{value.slice(lastIndex, index)}</span>);
    }
    parts.push(
      <mark
        key={`match-${index}`}
        className="rounded bg-cyan-500/20 px-1 py-0.5 font-medium text-cyan-800 dark:bg-cyan-400/20 dark:text-cyan-200"
      >
        {text}
      </mark>,
    );
    lastIndex = index + text.length;
  }

  if (parts.length === 0) return value;
  if (lastIndex < value.length) parts.push(<span key="tail">{value.slice(lastIndex)}</span>);
  return parts;
}

async function runRegexPreview(
  tableName: string,
  columnName: string,
  pattern: string,
  flags: string,
) {
  const safeTable = quoteIdentifier(tableName);
  const safeColumn = quoteIdentifier(columnName);
  const escapedPattern = escapeSqlLiteral(pattern);
  const regexCall = flags
    ? `regexp_matches(cell_value, '${escapedPattern}', '${flags}')`
    : `regexp_matches(cell_value, '${escapedPattern}')`;
  const baseSql = `
    WITH source AS (
      SELECT ROW_NUMBER() OVER () AS row_number, CAST(${safeColumn} AS VARCHAR) AS cell_value
      FROM ${safeTable}
    )
    SELECT row_number, cell_value
    FROM source
    WHERE cell_value IS NOT NULL AND ${regexCall}
  `;

  const [rows, countRows] = await Promise.all([
    runQuery(`${baseSql} ORDER BY row_number LIMIT ${PREVIEW_LIMIT}`),
    runQuery(`SELECT COUNT(*) AS cnt FROM (${baseSql}) AS regex_matches`),
  ]);

  return {
    rows: rows.map((row) => ({
      rowNumber: Number(row.row_number ?? 0),
      value: String(row.cell_value ?? ""),
    })),
    count: Number(countRows[0]?.cnt ?? 0),
  };
}

async function applyRegexFilter(
  tableName: string,
  columnName: string,
  pattern: string,
  flags: string,
) {
  const safeTable = quoteIdentifier(tableName);
  const safeColumn = quoteIdentifier(columnName);
  const escapedPattern = escapeSqlLiteral(pattern);
  const stamp = Date.now();
  const tempTable = quoteIdentifier(`${tableName}__regex_${stamp}`);
  const backupTable = quoteIdentifier(`${tableName}__regex_backup_${stamp}`);
  const regexCall = flags
    ? `regexp_matches(CAST(${safeColumn} AS VARCHAR), '${escapedPattern}', '${flags}')`
    : `regexp_matches(CAST(${safeColumn} AS VARCHAR), '${escapedPattern}')`;

  try {
    await runQuery(`DROP TABLE IF EXISTS ${tempTable}`);
    await runQuery(`DROP TABLE IF EXISTS ${backupTable}`);
    await runQuery(`
      CREATE TABLE ${tempTable} AS
      SELECT *
      FROM ${safeTable}
      WHERE ${safeColumn} IS NOT NULL AND ${regexCall}
    `);
    await runQuery(`ALTER TABLE ${safeTable} RENAME TO ${backupTable}`);
    try {
      await runQuery(`ALTER TABLE ${tempTable} RENAME TO ${safeTable}`);
      await runQuery(`DROP TABLE ${backupTable}`);
    } catch (error) {
      await runQuery(`ALTER TABLE ${backupTable} RENAME TO ${safeTable}`).catch(() => undefined);
      await runQuery(`DROP TABLE IF EXISTS ${tempTable}`).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    await runQuery(`DROP TABLE IF EXISTS ${tempTable}`).catch(() => undefined);
    throw error;
  }
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/65 p-4 shadow-sm backdrop-blur-sm dark:border-slate-700/70 dark:bg-slate-950/35">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

export default function RegexTester({ tableName, columns }: RegexTesterProps) {
  const dark = useDarkMode();
  const textColumns = useMemo(
    () => columns.filter((column) => column.type === "string" || column.type === "unknown"),
    [columns],
  );
  const [selectedColumn, setSelectedColumn] = useState(textColumns[0]?.name ?? "");
  const [pattern, setPattern] = useState("");
  const [caseInsensitive, setCaseInsensitive] = useState(true);
  const [multiline, setMultiline] = useState(false);
  const [matches, setMatches] = useState<RegexMatchRow[]>([]);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState<StatusState>(null);
  const activeColumn = textColumns.some((column) => column.name === selectedColumn)
    ? selectedColumn
    : (textColumns[0]?.name ?? "");
  const regexState = useMemo(
    () => createRegex(pattern, caseInsensitive, multiline),
    [pattern, caseInsensitive, multiline],
  );
  const duckFlags = buildDuckDbFlags(caseInsensitive, multiline);
  const validationTone = regexState.regex
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";

  async function handleTest() {
    if (!activeColumn || !regexState.regex) {
      setStatus({ kind: "error", message: regexState.error ?? "Choose a text column first." });
      return;
    }
    setTesting(true);
    setStatus(null);
    try {
      const result = await runRegexPreview(tableName, activeColumn, pattern, duckFlags);
      setMatches(result.rows);
      setMatchCount(result.count);
      setStatus({
        kind: "success",
        message: `Previewed ${Math.min(result.count, PREVIEW_LIMIT)} rows for ${activeColumn}.`,
      });
    } catch (error) {
      setMatches([]);
      setMatchCount(null);
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Regex test query failed.",
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleApplyFilter() {
    if (!activeColumn || !regexState.regex) {
      setStatus({ kind: "error", message: regexState.error ?? "Choose a valid regex first." });
      return;
    }
    setApplying(true);
    setStatus(null);
    try {
      await applyRegexFilter(tableName, activeColumn, pattern, duckFlags);
      const refreshed = await runRegexPreview(tableName, activeColumn, pattern, duckFlags);
      setMatches(refreshed.rows);
      setMatchCount(refreshed.count);
      setStatus({
        kind: "success",
        message: `Filtered ${tableName} permanently with ${activeColumn}.`,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to apply regex filter.",
      });
    } finally {
      setApplying(false);
    }
  }

  if (!textColumns.length) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease }}
        className={panelClass}
      >
        <div className="p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-600 dark:text-cyan-300">
            Regex Tester
          </p>
          <h2 className="mt-3 text-xl font-semibold text-slate-900 dark:text-slate-100">
            No text columns available
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            This tool needs a string-like column in {tableName} before it can test or filter values.
          </p>
        </div>
      </motion.section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease }}
      className={`${panelClass} bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.78),rgba(248,250,252,0.72))] dark:bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_26%),linear-gradient(180deg,rgba(2,6,23,0.88),rgba(15,23,42,0.82))]`}
    >
      <div className="border-b border-white/30 px-6 py-5 dark:border-white/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
              <Sparkles className="h-3.5 w-3.5" />
              Regex Tester
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">
              Validate and filter {tableName}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Test regular expressions against a text column, inspect matches in DuckDB, then rewrite
              the table with a permanent regex filter if the rule is correct.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Text Columns" value={formatNumber(textColumns.length)} />
            <StatCard
              label="Preview Limit"
              value={formatNumber(PREVIEW_LIMIT)}
            />
            <StatCard
              label="Match Count"
              value={matchCount === null ? "Not run" : formatNumber(matchCount)}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-6 px-6 py-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Text column
            </span>
            <select
              value={activeColumn}
              onChange={(event) => setSelectedColumn(event.target.value)}
              className={fieldClass}
            >
              {textColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Regular expression
            </span>
            <input
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              placeholder="^(ERROR|WARN)"
              className={fieldClass}
            />
          </label>

          <div className={`rounded-2xl border px-4 py-3 text-sm ${validationTone}`}>
            <div className="flex items-center gap-2">
              {regexState.regex ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              <span className="font-semibold">{regexState.regex ? "Valid regex" : "Regex error"}</span>
            </div>
            <p className="mt-2 text-xs leading-5">
              {regexState.regex
                ? `DuckDB will execute this pattern with flags "${duckFlags || "none"}".`
                : (regexState.error ?? "Enter a regular expression to begin.")}
            </p>
          </div>

          <div className="rounded-2xl border border-white/25 bg-white/55 p-4 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-slate-950/30">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <Search className="h-4 w-4 text-cyan-500" />
              Quick patterns
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_PATTERNS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setPattern(preset.pattern)}
                  className="rounded-full border border-slate-200/70 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-cyan-400/50 hover:text-cyan-700 dark:border-slate-700/70 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:text-cyan-300"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/25 bg-white/55 p-4 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-slate-950/30">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Regex flags</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <label className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 dark:border-slate-700/70 dark:bg-slate-950/60 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={caseInsensitive}
                  onChange={(event) => setCaseInsensitive(event.target.checked)}
                  className="accent-cyan-500"
                />
                Case-insensitive
              </label>
              <label className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 dark:border-slate-700/70 dark:bg-slate-950/60 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={multiline}
                  onChange={(event) => setMultiline(event.target.checked)}
                  className="accent-cyan-500"
                />
                Multiline
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={testing || applying || !regexState.regex}
              className={`${buttonClass} bg-cyan-600 text-white hover:bg-cyan-500`}
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Test regex
            </button>
            <button
              type="button"
              onClick={() => void handleApplyFilter()}
              disabled={testing || applying || !regexState.regex}
              className={`${buttonClass} border border-slate-300/80 bg-white/75 text-slate-700 hover:bg-slate-100 dark:border-slate-700/70 dark:bg-slate-950/55 dark:text-slate-200 dark:hover:bg-slate-900`}
            >
              {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Filter className="h-4 w-4" />}
              Filter Data
            </button>
          </div>

          <AnimatePresence mode="wait">
            {status ? (
              <motion.div
                key={status.message}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2, ease }}
                className={`rounded-2xl border px-4 py-3 text-sm ${
                  status.kind === "success"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                }`}
              >
                {status.message}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <div className="rounded-[26px] border border-white/25 bg-white/55 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-slate-950/30">
          <div className="flex items-center justify-between border-b border-white/25 px-5 py-4 dark:border-white/10">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <Table2 className={`h-4 w-4 ${dark ? "text-cyan-300" : "text-cyan-600"}`} />
              Matching rows
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Showing up to {PREVIEW_LIMIT}
            </span>
          </div>

          <div className="max-h-[480px] overflow-auto">
            {matches.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Run a test to inspect matching values and highlight matched text.
              </div>
            ) : (
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 bg-white/90 backdrop-blur dark:bg-slate-950/90">
                  <tr className="border-b border-slate-200/70 dark:border-slate-700/70">
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      Row
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      {activeColumn}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((row) => (
                    <tr
                      key={`${row.rowNumber}-${row.value}`}
                      className="border-b border-slate-200/60 text-slate-700 dark:border-slate-800/70 dark:text-slate-200"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                        {formatNumber(row.rowNumber)}
                      </td>
                      <td className="px-4 py-3">{renderHighlightedValue(row.value, regexState.regex)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
