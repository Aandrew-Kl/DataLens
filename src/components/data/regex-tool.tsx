"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Braces,
  Download,
  Loader2,
  ScanSearch,
  Sparkles,
  Wand2,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface RegexToolProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface SampleRow {
  rowNumber: number;
  value: string;
}

interface PreviewRow {
  rowNumber: number;
  value: string;
  matches: string[];
  groups: string[];
}

interface StatusMessage {
  tone: "success" | "error" | "info";
  text: string;
}

const PREVIEW_LIMIT = 24;
const EASE = [0.22, 1, 0.36, 1] as const;
const GLASS_PANEL_CLASS =
  "border border-white/20 bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45";
const FIELD_CLASS =
  "w-full rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700/70 dark:bg-slate-950/65 dark:text-slate-100";
const BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
function escapeSqlLiteral(value: string) {
  return value.replaceAll("'", "''");
}

function escapeCsvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r")
  ) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function getTextColumns(columns: ColumnProfile[]) {
  return columns.filter(
    (column) => column.type === "string" || column.type === "unknown",
  );
}

function resolveColumn(selectedColumn: string, columns: ColumnProfile[]) {
  return columns.some((column) => column.name === selectedColumn)
    ? selectedColumn
    : (columns[0]?.name ?? "");
}

function createRegex(
  pattern: string,
  caseInsensitive: boolean,
  multiline: boolean,
) {
  if (!pattern.trim()) {
    return { regex: null, error: "Enter a regular expression to test." };
  }

  const flags = `${caseInsensitive ? "i" : ""}${multiline ? "m" : ""}`;

  try {
    return { regex: new RegExp(pattern, flags), error: null };
  } catch (error) {
    return {
      regex: null,
      error: error instanceof Error ? error.message : "Invalid regular expression.",
    };
  }
}

function toPreviewRegex(regex: RegExp) {
  return regex.flags.includes("g")
    ? regex
    : new RegExp(regex.source, `${regex.flags}g`);
}

function getSqlFlags(caseInsensitive: boolean, multiline: boolean) {
  return `${caseInsensitive ? "i" : ""}${multiline ? "m" : ""}`;
}

function getStringValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function getNumberValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : Number(value ?? 0);
}

function buildPreviewRows(
  rows: SampleRow[],
  regex: RegExp,
  groupCount: number,
): PreviewRow[] {
  const previewRegex = toPreviewRegex(regex);

  return rows.flatMap<PreviewRow>((row) => {
    const matches = Array.from(row.value.matchAll(previewRegex));
    if (matches.length === 0) return [];

    const firstMatch = matches[0];
    const groups = Array.from({ length: groupCount }, (_, index) => {
      const nextGroup = firstMatch[index + 1];
      return typeof nextGroup === "string" ? nextGroup : "";
    });

    return [
      {
        rowNumber: row.rowNumber,
        value: row.value,
        matches: matches.map((match) => match[0] ?? "").filter(Boolean),
        groups,
      },
    ];
  });
}

function buildExportCsv(rows: PreviewRow[], groupCount: number) {
  const headers = [
    "row_number",
    "value",
    "matches",
    ...Array.from({ length: groupCount }, (_, index) => `group_${index + 1}`),
  ];
  const lines = rows.map((row) =>
    [
      row.rowNumber,
      row.value,
      row.matches.join(" | "),
      ...row.groups,
    ]
      .map(escapeCsvCell)
      .join(","),
  );

  return [headers.join(","), ...lines].join("\n");
}

function buildSampleQuery(tableName: string, columnName: string) {
  return `
    SELECT ROW_NUMBER() OVER () AS row_number, CAST(${quoteIdentifier(columnName)} AS VARCHAR) AS value
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(columnName)} IS NOT NULL
    LIMIT ${PREVIEW_LIMIT}
  `;
}

function buildMatchCountQuery(
  tableName: string,
  columnName: string,
  pattern: string,
  flags: string,
) {
  const regexExpression = flags
    ? `regexp_matches(CAST(${quoteIdentifier(columnName)} AS VARCHAR), '${escapeSqlLiteral(pattern)}', '${flags}')`
    : `regexp_matches(CAST(${quoteIdentifier(columnName)} AS VARCHAR), '${escapeSqlLiteral(pattern)}')`;

  return `
    SELECT COUNT(*) AS cnt
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(columnName)} IS NOT NULL
      AND ${regexExpression}
  `;
}

function buildExtractExpression(
  columnName: string,
  pattern: string,
  groupIndex: number,
  flags: string,
) {
  const safeColumn = quoteIdentifier(columnName);
  const safePattern = escapeSqlLiteral(pattern);
  return flags
    ? `regexp_extract(CAST(${safeColumn} AS VARCHAR), '${safePattern}', ${groupIndex}, '${flags}')`
    : `regexp_extract(CAST(${safeColumn} AS VARCHAR), '${safePattern}', ${groupIndex})`;
}

function getSuggestedPrefix(columnName: string) {
  return `${columnName.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "regex"}_group`;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={`rounded-3xl p-4 shadow-sm ${GLASS_PANEL_CLASS}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function StatusBanner({ message }: { message: StatusMessage | null }) {
  if (!message) return null;

  const toneClass =
    message.tone === "error"
      ? "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300"
      : message.tone === "success"
        ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        : "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${toneClass}`}>
      {message.text}
    </div>
  );
}

export default function RegexTool({ tableName, columns }: RegexToolProps) {
  const textColumns = useMemo(() => getTextColumns(columns), [columns]);
  const [selectedColumn, setSelectedColumn] = useState(textColumns[0]?.name ?? "");
  const [pattern, setPattern] = useState("");
  const [caseInsensitive, setCaseInsensitive] = useState(true);
  const [multiline, setMultiline] = useState(false);
  const [groupCount, setGroupCount] = useState(2);
  const [groupPrefix, setGroupPrefix] = useState("");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  const activeColumn = resolveColumn(selectedColumn, textColumns);
  const regexState = useMemo(
    () => createRegex(pattern, caseInsensitive, multiline),
    [pattern, caseInsensitive, multiline],
  );
  const activePrefix = groupPrefix.trim() || getSuggestedPrefix(activeColumn || "regex");
  const sqlFlags = getSqlFlags(caseInsensitive, multiline);

  async function handleTestRegex() {
    if (!activeColumn || !regexState.regex) {
      setStatus({
        tone: "error",
        text: regexState.error ?? "Select a string column before testing.",
      });
      return;
    }

    setTesting(true);
    setStatus(null);

    try {
      const [sampleRows, countRows] = await Promise.all([
        runQuery(buildSampleQuery(tableName, activeColumn)),
        runQuery(buildMatchCountQuery(tableName, activeColumn, pattern, sqlFlags)),
      ]);

      const rows = sampleRows.map((row) => ({
        rowNumber: getNumberValue(row, "row_number"),
        value: getStringValue(row, "value"),
      }));
      const nextPreviewRows = buildPreviewRows(rows, regexState.regex, groupCount);
      const nextMatchCount = getNumberValue(countRows[0] ?? {}, "cnt");

      startTransition(() => {
        setPreviewRows(nextPreviewRows);
        setMatchCount(nextMatchCount);
        setStatus({
          tone: "success",
          text:
            nextPreviewRows.length > 0
              ? `Found ${formatNumber(nextMatchCount)} matching rows in ${activeColumn}.`
              : `No preview matches were found in ${activeColumn}.`,
        });
      });
    } catch (error) {
      startTransition(() => {
        setPreviewRows([]);
        setMatchCount(null);
        setStatus({
          tone: "error",
          text: error instanceof Error ? error.message : "Regex preview failed.",
        });
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleApplyExtraction() {
    if (!activeColumn || !regexState.regex) {
      setStatus({
        tone: "error",
        text: regexState.error ?? "Choose a valid regex before applying extraction.",
      });
      return;
    }

    setApplying(true);
    setStatus(null);

    const tempTableName = `${tableName}__regex_extract_${Date.now()}`;
    const backupTableName = `${tableName}__regex_extract_backup_${Date.now()}`;
    const extractColumns = Array.from({ length: groupCount }, (_, index) => {
      const alias = `${activePrefix}_${index + 1}`;
      return `${buildExtractExpression(activeColumn, pattern, index + 1, sqlFlags)} AS ${quoteIdentifier(alias)}`;
    }).join(",\n        ");

    try {
      await runQuery(`DROP TABLE IF EXISTS ${quoteIdentifier(tempTableName)}`);
      await runQuery(`DROP TABLE IF EXISTS ${quoteIdentifier(backupTableName)}`);
      await runQuery(`
        CREATE TABLE ${quoteIdentifier(tempTableName)} AS
        SELECT *,
               ${extractColumns}
        FROM ${quoteIdentifier(tableName)}
      `);
      await runQuery(
        `ALTER TABLE ${quoteIdentifier(tableName)} RENAME TO ${quoteIdentifier(backupTableName)}`,
      );

      try {
        await runQuery(
          `ALTER TABLE ${quoteIdentifier(tempTableName)} RENAME TO ${quoteIdentifier(tableName)}`,
        );
        await runQuery(`DROP TABLE ${quoteIdentifier(backupTableName)}`);
      } catch (error) {
        await runQuery(
          `ALTER TABLE ${quoteIdentifier(backupTableName)} RENAME TO ${quoteIdentifier(tableName)}`,
        ).catch(() => undefined);
        await runQuery(`DROP TABLE IF EXISTS ${quoteIdentifier(tempTableName)}`).catch(
          () => undefined,
        );
        throw error;
      }

      setStatus({
        tone: "success",
        text: `Applied ${groupCount} extracted columns to ${tableName}.`,
      });
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : "Regex extraction failed.",
      });
    } finally {
      setApplying(false);
    }
  }

  function handleExportCsv() {
    if (previewRows.length === 0) {
      setStatus({
        tone: "info",
        text: "Run a preview first so there is match data to export.",
      });
      return;
    }

    downloadFile(
      buildExportCsv(previewRows, groupCount),
      `${tableName}-regex-matches.csv`,
      "text/csv;charset=utf-8;",
    );
    setStatus({
      tone: "success",
      text: "Exported the current regex preview to CSV.",
    });
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      className={`rounded-[2rem] p-6 shadow-[0_28px_90px_-52px_rgba(15,23,42,0.85)] ${GLASS_PANEL_CLASS}`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
            <Braces className="h-3.5 w-3.5" />
            Regex tool
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Test patterns, inspect groups, and write extracted columns back to DuckDB
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Choose a string column in {tableName}, preview regex matches, extract capture
            groups into new fields, and export the preview as CSV before applying the
            transformation.
          </p>
        </div>

        <div className="grid w-full gap-3 sm:grid-cols-3 lg:max-w-md">
          <MetricCard
            label="Text Columns"
            value={formatNumber(textColumns.length)}
          />
          <MetricCard
            label="Preview Matches"
            value={formatNumber(previewRows.length)}
          />
          <MetricCard
            label="Total Matches"
            value={formatNumber(matchCount ?? 0)}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <div className={`rounded-[1.75rem] p-5 ${GLASS_PANEL_CLASS}`}>
          <div className="grid gap-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                String column
              </span>
              <select
                aria-label="String column"
                className={FIELD_CLASS}
                value={activeColumn}
                onChange={(event) => setSelectedColumn(event.target.value)}
              >
                {textColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Regular expression
              </span>
              <textarea
                aria-label="Regex pattern"
                className={`${FIELD_CLASS} min-h-32`}
                placeholder="e.g. ([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+)"
                value={pattern}
                onChange={(event) => setPattern(event.target.value)}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Capture groups
                </span>
                <select
                  aria-label="Capture groups"
                  className={FIELD_CLASS}
                  value={groupCount}
                  onChange={(event) => setGroupCount(Number(event.target.value))}
                >
                  <option value={1}>1 group</option>
                  <option value={2}>2 groups</option>
                  <option value={3}>3 groups</option>
                  <option value={4}>4 groups</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Column prefix
                </span>
                <input
                  aria-label="Column prefix"
                  className={FIELD_CLASS}
                  value={groupPrefix}
                  onChange={(event) => setGroupPrefix(event.target.value)}
                  placeholder={getSuggestedPrefix(activeColumn)}
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/60 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/30 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={caseInsensitive}
                  onChange={(event) => setCaseInsensitive(event.target.checked)}
                />
                Case insensitive
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/60 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/30 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={multiline}
                  onChange={(event) => setMultiline(event.target.checked)}
                />
                Multiline
              </label>
            </div>

            <StatusBanner message={status} />

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleTestRegex}
                disabled={testing || textColumns.length === 0}
                className={`${BUTTON_CLASS} bg-cyan-600 text-white hover:bg-cyan-500`}
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ScanSearch className="h-4 w-4" />
                )}
                Test regex
              </button>
              <button
                type="button"
                onClick={handleApplyExtraction}
                disabled={applying || previewRows.length === 0}
                className={`${BUTTON_CLASS} border border-white/20 bg-white/70 text-slate-800 hover:bg-white dark:bg-slate-950/45 dark:text-slate-100 dark:hover:bg-slate-950/60`}
              >
                {applying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                Apply extraction
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={previewRows.length === 0}
                className={`${BUTTON_CLASS} border border-white/20 bg-white/70 text-slate-800 hover:bg-white dark:bg-slate-950/45 dark:text-slate-100 dark:hover:bg-slate-950/60`}
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            </div>
          </div>
        </div>

        <div className={`rounded-[1.75rem] p-5 ${GLASS_PANEL_CLASS}`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                Match preview
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Matches and extracted groups from the first {PREVIEW_LIMIT} non-null rows.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 dark:bg-white/5 dark:text-slate-300">
              <Sparkles className="h-3.5 w-3.5" />
              {activePrefix}_1 ... {activePrefix}_{groupCount}
            </div>
          </div>

          {regexState.error ? (
            <div className="mt-5 rounded-3xl border border-rose-500/20 bg-rose-500/10 p-5 text-sm text-rose-700 dark:text-rose-300">
              {regexState.error}
            </div>
          ) : previewRows.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-white/25 bg-white/35 p-8 text-sm text-slate-600 dark:bg-slate-950/25 dark:text-slate-300">
              Run a preview to see row-level matches, extracted groups, and CSV-ready output.
            </div>
          ) : (
            <div className="mt-5 overflow-hidden rounded-3xl border border-white/20">
              <div className="grid grid-cols-[88px_minmax(220px,1.4fr)_minmax(180px,1fr)_minmax(200px,1fr)] gap-4 bg-slate-900/5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:bg-white/5 dark:text-slate-400">
                <span>Row</span>
                <span>Value</span>
                <span>Matches</span>
                <span>Groups</span>
              </div>
              <div className="max-h-[30rem] divide-y divide-white/15 overflow-y-auto">
                {previewRows.map((row) => (
                  <div
                    key={`${row.rowNumber}-${row.value}`}
                    className="grid grid-cols-[88px_minmax(220px,1.4fr)_minmax(180px,1fr)_minmax(200px,1fr)] gap-4 px-4 py-4 text-sm text-slate-700 dark:text-slate-200"
                  >
                    <span className="font-medium text-slate-500 dark:text-slate-400">
                      {row.rowNumber}
                    </span>
                    <span className="break-all">{row.value}</span>
                    <div className="flex flex-wrap gap-2">
                      {row.matches.map((match, index) => (
                        <span
                          key={`${row.rowNumber}-match-${index}`}
                          className="rounded-full bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-700 dark:text-cyan-300"
                        >
                          {match}
                        </span>
                      ))}
                    </div>
                    <div className="space-y-2">
                      {row.groups.map((group, index) => (
                        <div
                          key={`${row.rowNumber}-group-${index}`}
                          className="rounded-2xl bg-slate-900/5 px-3 py-2 text-xs dark:bg-white/5"
                        >
                          <span className="font-semibold text-slate-500 dark:text-slate-400">
                            {activePrefix}_{index + 1}
                          </span>
                          <span className="ml-2 break-all text-slate-800 dark:text-slate-100">
                            {group || "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}
