"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeftRight,
  Download,
  Eye,
  Loader2,
  ScanSearch,
  Sparkles,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  quoteLiteral,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface EncodingDetectorProps {
  tableName: string;
  columns: ColumnProfile[];
}

type EncodingProfile =
  | "latin1_utf8"
  | "windows1252_cleanup"
  | "normalize_whitespace";

interface EncodingPreviewRow {
  key: string;
  original: string;
  converted: string;
}

type StatusMessage =
  | { kind: "success" | "error"; message: string }
  | null;

const EASE = [0.22, 1, 0.36, 1] as const;
const PROFILE_LABELS: Record<EncodingProfile, string> = {
  latin1_utf8: "Latin-1 to UTF-8",
  windows1252_cleanup: "Windows-1252 cleanup",
  normalize_whitespace: "Normalize whitespace",
};

const LATIN1_REPLACEMENTS = [
  ["Ã§", "ç"],
  ["Ã©", "é"],
  ["Ã¨", "è"],
  ["Ãª", "ê"],
  ["Ã«", "ë"],
  ["Ã¡", "á"],
  ["Ã ", "à"],
  ["Ã¶", "ö"],
  ["Ã¼", "ü"],
  ["Ã±", "ñ"],
  ["Ã‡", "Ç"],
] as const;

const WINDOWS1252_REPLACEMENTS = [
  ["â€™", "’"],
  ["â€œ", "“"],
  ["â€", "”"],
  ["â€“", "–"],
  ["â€”", "—"],
  ["â€¢", "•"],
  ["â€¦", "…"],
  ["Â ", " "],
  ["Â", ""],
] as const;

function toDisplay(value: unknown) {
  if (value === null || value === undefined) {
    return "null";
  }
  return String(value);
}

function applyReplacementSet(value: string, replacements: readonly (readonly [string, string])[]) {
  return replacements.reduce(
    (current, [source, target]) => current.replaceAll(source, target),
    value,
  );
}

function applyProfile(value: string, profile: EncodingProfile) {
  switch (profile) {
    case "latin1_utf8":
      return applyReplacementSet(value, LATIN1_REPLACEMENTS);
    case "windows1252_cleanup":
      return applyReplacementSet(value, WINDOWS1252_REPLACEMENTS);
    case "normalize_whitespace":
    default:
      return value.replace(/\s+/g, " ").trim();
  }
}

function suggestProfile(values: string[]): EncodingProfile {
  const sample = values.join(" ");
  if (sample.includes("â€™") || sample.includes("â€œ") || sample.includes("â€“")) {
    return "windows1252_cleanup";
  }
  if (sample.includes("Ã")) {
    return "latin1_utf8";
  }
  return "normalize_whitespace";
}

function buildCorruptionPredicate(columnName: string) {
  const field = `CAST(${quoteIdentifier(columnName)} AS VARCHAR)`;
  return `${field} LIKE '%Ã%' OR ${field} LIKE '%Â%' OR ${field} LIKE '%â%' OR ${field} LIKE '%�%'`;
}

function buildSqlReplacementExpression(
  columnName: string,
  profile: EncodingProfile,
) {
  const field = `CAST(${quoteIdentifier(columnName)} AS VARCHAR)`;
  const replacements =
    profile === "latin1_utf8"
      ? LATIN1_REPLACEMENTS
      : profile === "windows1252_cleanup"
        ? WINDOWS1252_REPLACEMENTS
        : ([] as const);

  let expression = field;
  for (const [source, target] of replacements) {
    expression = `REPLACE(${expression}, ${quoteLiteral(source)}, ${quoteLiteral(target)})`;
  }

  if (profile === "normalize_whitespace") {
    return `trim(regexp_replace(${field}, '\\s+', ' ', 'g'))`;
  }

  return expression;
}

function buildPreviewCsv(rows: EncodingPreviewRow[]) {
  const lines = ["original,converted"];
  for (const row of rows) {
    lines.push(
      `"${row.original.replaceAll('"', '""')}","${row.converted.replaceAll('"', '""')}"`,
    );
  }
  return lines.join("\n");
}

export default function EncodingDetector({
  tableName,
  columns,
}: EncodingDetectorProps) {
  const [selectedColumn, setSelectedColumn] = useState("");
  const [profile, setProfile] = useState<EncodingProfile>("latin1_utf8");
  const [outputTableName, setOutputTableName] = useState(`${tableName}_encoded`);
  const [previewRows, setPreviewRows] = useState<EncodingPreviewRow[]>([]);
  const [issueCount, setIssueCount] = useState(0);
  const [scanLoading, setScanLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage>(null);

  const textColumns = useMemo(
    () => columns.filter((column) => column.type === "string" || column.type === "unknown"),
    [columns],
  );
  const activeColumn =
    textColumns.find((column) => column.name === selectedColumn)?.name ??
    textColumns[0]?.name ??
    "";

  async function handleScan() {
    if (!activeColumn) {
      setStatus({ kind: "error", message: "Choose a text column to scan." });
      setPreviewRows([]);
      setIssueCount(0);
      return;
    }

    setScanLoading(true);
    setStatus(null);

    try {
      const predicate = buildCorruptionPredicate(activeColumn);
      const [countRows, sampleRows] = await Promise.all([
        runQuery(
          `SELECT COUNT(*) AS issue_count FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(activeColumn)} IS NOT NULL AND (${predicate})`,
        ),
        runQuery(
          `SELECT CAST(${quoteIdentifier(activeColumn)} AS VARCHAR) AS raw_value FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(activeColumn)} IS NOT NULL AND (${predicate}) LIMIT 10`,
        ),
      ]);

      const values = sampleRows.map((row) => toDisplay(row.raw_value));
      const suggestedProfile = suggestProfile(values);
      const nextPreviewRows = values.map<EncodingPreviewRow>((value, index) => ({
        key: `${index}`,
        original: value,
        converted: applyProfile(value, suggestedProfile),
      }));

      setProfile(suggestedProfile);
      setIssueCount(Number(countRows[0]?.issue_count ?? 0));
      setPreviewRows(nextPreviewRows);
      setStatus({
        kind: "success",
        message: `Detected ${formatNumber(Number(countRows[0]?.issue_count ?? 0))} suspicious value${Number(countRows[0]?.issue_count ?? 0) === 1 ? "" : "s"}. Suggested profile: ${PROFILE_LABELS[suggestedProfile]}.`,
      });
    } catch (error) {
      setPreviewRows([]);
      setIssueCount(0);
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to scan the selected column.",
      });
    } finally {
      setScanLoading(false);
    }
  }

  async function handleApply() {
    if (!activeColumn) {
      setStatus({ kind: "error", message: "Choose a text column to convert." });
      return;
    }
    if (!outputTableName.trim()) {
      setStatus({ kind: "error", message: "Enter an output table name first." });
      return;
    }

    setApplyLoading(true);
    setStatus(null);

    try {
      const selectList = columns
        .map((column) => {
          if (column.name !== activeColumn) {
            return quoteIdentifier(column.name);
          }
          return `${buildSqlReplacementExpression(column.name, profile)} AS ${quoteIdentifier(column.name)}`;
        })
        .join(", ");

      await runQuery(
        `CREATE OR REPLACE TABLE ${quoteIdentifier(outputTableName.trim())} AS SELECT ${selectList} FROM ${quoteIdentifier(tableName)}`,
      );

      setStatus({
        kind: "success",
        message: `Created ${outputTableName.trim()} with ${PROFILE_LABELS[profile]} applied to ${activeColumn}.`,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to convert the selected column.",
      });
    } finally {
      setApplyLoading(false);
    }
  }

  function handleExport() {
    if (previewRows.length === 0) {
      setStatus({ kind: "error", message: "Scan a column before exporting CSV." });
      return;
    }

    downloadFile(
      buildPreviewCsv(previewRows),
      `${tableName}-${activeColumn}-encoding-preview.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
              <ScanSearch className="h-4 w-4" />
              Encoding Detector
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Detect mojibake and normalize suspicious text
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Scan string columns for broken byte patterns, preview repaired values,
              then create a cleaned DuckDB table or export the change sample.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleScan}
              disabled={scanLoading}
              className={BUTTON_CLASS}
            >
              {scanLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
              Scan column
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={applyLoading}
              className={BUTTON_CLASS}
            >
              {applyLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowLeftRight className="h-4 w-4" />
              )}
              Convert encoding
            </button>
            <button type="button" onClick={handleExport} className={BUTTON_CLASS}>
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Text column
            </label>
            <select
              aria-label="Encoding column"
              value={activeColumn}
              onChange={(event) => setSelectedColumn(event.target.value)}
              className={FIELD_CLASS}
            >
              {textColumns.length === 0 ? <option value="">No text columns</option> : null}
              {textColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>

            <div className="mt-4 grid gap-4">
              <label>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Suggested conversion
                </span>
                <select
                  aria-label="Encoding profile"
                  value={profile}
                  onChange={(event) => setProfile(event.target.value as EncodingProfile)}
                  className={FIELD_CLASS}
                >
                  {Object.entries(PROFILE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Output table
                </span>
                <input
                  value={outputTableName}
                  onChange={(event) => setOutputTableName(event.target.value)}
                  className={FIELD_CLASS}
                />
              </label>
            </div>

            <div className="mt-4 rounded-2xl border border-white/20 bg-white/55 p-4 dark:bg-slate-950/35">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Summary
              </div>
              <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
                {formatNumber(issueCount)}
              </div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                problematic value{issueCount === 1 ? "" : "s"} detected
              </div>
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Sparkles className="h-4 w-4 text-cyan-500" />
              Problem preview
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Original values and their converted replacements under the selected profile.
            </p>

            <div className="mt-4 space-y-3">
              {previewRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/20 px-4 py-8 text-sm text-slate-500 dark:text-slate-400">
                  Scan a column to inspect problematic values and suggested fixes.
                </div>
              ) : (
                previewRows.map((row) => (
                  <div
                    key={row.key}
                    className="rounded-2xl border border-white/20 bg-white/55 p-4 dark:bg-slate-950/35"
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                          Original
                        </div>
                        <div className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                          {row.original}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                          Converted
                        </div>
                        <div className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                          {row.converted}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {status ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              status.kind === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
            }`}
          >
            {status.message}
          </div>
        ) : null}
      </div>
    </motion.section>
  );
}
