"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, Eye, Loader2, Scissors, Split } from "lucide-react";
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

interface ColumnSplitterProps {
  tableName: string;
  columns: ColumnProfile[];
}

type SplitMode = "delimiter" | "regex" | "fixed";

interface SplitPreviewRow {
  key: string;
  original: string;
  parts: string[];
}

type StatusMessage =
  | { kind: "success" | "error"; message: string }
  | null;

const EASE = [0.22, 1, 0.36, 1] as const;

function toDisplay(value: unknown) {
  if (value === null || value === undefined) {
    return "null";
  }
  return String(value);
}

function parseWidths(widthsText: string) {
  return widthsText
    .split(",")
    .map((chunk) => Number.parseInt(chunk.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function derivePartCount(mode: SplitMode, widths: number[], requestedCount: string) {
  if (mode === "fixed" && widths.length > 0) {
    return widths.length;
  }
  const parsed = Number.parseInt(requestedCount, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 8) : 2;
}

function deriveColumnNames(
  sourceColumn: string,
  providedNames: string,
  partCount: number,
) {
  const parsed = providedNames
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from({ length: partCount }, (_, index) => (
    parsed[index] ?? `${sourceColumn}_part_${index + 1}`
  ));
}

function buildSplitExpression(
  columnName: string,
  mode: SplitMode,
  partIndex: number,
  delimiter: string,
  regexPattern: string,
  widths: number[],
) {
  const field = `CAST(${quoteIdentifier(columnName)} AS VARCHAR)`;

  if (mode === "regex") {
    return `NULLIF(regexp_extract(${field}, ${quoteLiteral(regexPattern)}, ${partIndex + 1}), '')`;
  }

  if (mode === "fixed") {
    const start = widths.slice(0, partIndex).reduce((sum, width) => sum + width, 1);
    const width = widths[partIndex] ?? 1;
    return `NULLIF(SUBSTRING(${field}, ${start}, ${width}), '')`;
  }

  return `NULLIF(split_part(${field}, ${quoteLiteral(delimiter)}, ${partIndex + 1}), '')`;
}

function buildPreviewRows(
  rows: Record<string, unknown>[],
  sourceColumn: string,
  columnNames: string[],
) {
  return rows.map<SplitPreviewRow>((row, index) => ({
    key: `${index}`,
    original: toDisplay(row.original_value),
    parts: columnNames.map((columnName) => toDisplay(row[columnName])),
  }));
}

function buildPreviewCsv(rows: SplitPreviewRow[], columnNames: string[]) {
  const lines = [["original", ...columnNames].join(",")];

  for (const row of rows) {
    const values = [row.original, ...row.parts].map(
      (value) => `"${value.replaceAll('"', '""')}"`,
    );
    lines.push(values.join(","));
  }

  return lines.join("\n");
}

export default function ColumnSplitter({
  tableName,
  columns,
}: ColumnSplitterProps) {
  const [selectedColumn, setSelectedColumn] = useState("");
  const [mode, setMode] = useState<SplitMode>("delimiter");
  const [delimiter, setDelimiter] = useState(",");
  const [regexPattern, setRegexPattern] = useState("([^,]+),([^,]+)");
  const [widthsText, setWidthsText] = useState("3,3");
  const [partCount, setPartCount] = useState("2");
  const [newColumnNames, setNewColumnNames] = useState("");
  const [outputTableName, setOutputTableName] = useState(`${tableName}_split`);
  const [previewRows, setPreviewRows] = useState<SplitPreviewRow[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
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
  const widths = parseWidths(widthsText);
  const activePartCount = derivePartCount(mode, widths, partCount);
  const derivedColumnNames = deriveColumnNames(activeColumn || "column", newColumnNames, activePartCount);

  async function handlePreview() {
    if (!activeColumn) {
      setStatus({ kind: "error", message: "Choose a text column to split." });
      setPreviewRows([]);
      return;
    }
    if (mode === "delimiter" && delimiter === "") {
      setStatus({ kind: "error", message: "Enter a delimiter before previewing the split." });
      return;
    }
    if (mode === "regex" && regexPattern.trim() === "") {
      setStatus({ kind: "error", message: "Enter a regular expression with capture groups." });
      return;
    }
    if (mode === "fixed" && widths.length === 0) {
      setStatus({ kind: "error", message: "Provide fixed widths such as 3,4,2." });
      return;
    }

    setPreviewLoading(true);
    setStatus(null);

    try {
      const projectedParts = derivedColumnNames.map((columnName, index) => (
        `${buildSplitExpression(activeColumn, mode, index, delimiter, regexPattern, widths)} AS ${quoteIdentifier(columnName)}`
      ));

      const rows = await runQuery(
        `SELECT CAST(${quoteIdentifier(activeColumn)} AS VARCHAR) AS original_value, ${projectedParts.join(", ")} FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(activeColumn)} IS NOT NULL LIMIT 10`,
      );
      setPreviewRows(buildPreviewRows(rows, activeColumn, derivedColumnNames));
      setStatus({
        kind: "success",
        message: `Loaded ${formatNumber(rows.length)} preview row${rows.length === 1 ? "" : "s"} for ${activeColumn}.`,
      });
    } catch (error) {
      setPreviewRows([]);
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to preview the split output.",
      });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleApply() {
    if (!activeColumn) {
      setStatus({ kind: "error", message: "Choose a text column to split." });
      return;
    }
    if (!outputTableName.trim()) {
      setStatus({ kind: "error", message: "Enter an output table name first." });
      return;
    }

    setApplyLoading(true);
    setStatus(null);

    try {
      const projectedParts = derivedColumnNames.map((columnName, index) => (
        `${buildSplitExpression(activeColumn, mode, index, delimiter, regexPattern, widths)} AS ${quoteIdentifier(columnName)}`
      ));
      await runQuery(
        `CREATE OR REPLACE TABLE ${quoteIdentifier(outputTableName.trim())} AS SELECT *, ${projectedParts.join(", ")} FROM ${quoteIdentifier(tableName)}`,
      );
      setStatus({
        kind: "success",
        message: `Created ${outputTableName.trim()} with ${derivedColumnNames.length} new split column${derivedColumnNames.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to create the split table.",
      });
    } finally {
      setApplyLoading(false);
    }
  }

  function handleExport() {
    if (previewRows.length === 0) {
      setStatus({ kind: "error", message: "Load preview rows before exporting CSV." });
      return;
    }

    downloadFile(
      buildPreviewCsv(previewRows, derivedColumnNames),
      `${tableName}-${activeColumn}-split-preview.csv`,
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
              <Split className="h-4 w-4" />
              Column Splitter
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Split a text field into multiple columns
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Split by delimiter, regular expression, or fixed width, then preview
              the derived columns before writing a new DuckDB table.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handlePreview}
              disabled={previewLoading}
              className={BUTTON_CLASS}
            >
              {previewLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
              Preview split
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
                <Scissors className="h-4 w-4" />
              )}
              Apply split
            </button>
            <button type="button" onClick={handleExport} className={BUTTON_CLASS}>
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Source column
            </label>
            <select
              aria-label="Source column"
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
                  Split mode
                </span>
                <select
                  aria-label="Split mode"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as SplitMode)}
                  className={FIELD_CLASS}
                >
                  <option value="delimiter">Delimiter</option>
                  <option value="regex">Regex</option>
                  <option value="fixed">Fixed width</option>
                </select>
              </label>

              {mode === "delimiter" ? (
                <label>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Delimiter
                  </span>
                  <input
                    value={delimiter}
                    onChange={(event) => setDelimiter(event.target.value)}
                    className={FIELD_CLASS}
                  />
                </label>
              ) : null}

              {mode === "regex" ? (
                <label>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Regex pattern
                  </span>
                  <input
                    value={regexPattern}
                    onChange={(event) => setRegexPattern(event.target.value)}
                    className={FIELD_CLASS}
                    placeholder="([^-]+)-([^-]+)"
                  />
                </label>
              ) : null}

              {mode === "fixed" ? (
                <label>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Fixed widths
                  </span>
                  <input
                    value={widthsText}
                    onChange={(event) => setWidthsText(event.target.value)}
                    className={FIELD_CLASS}
                    placeholder="3,4,2"
                  />
                </label>
              ) : (
                <label>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Number of parts
                  </span>
                  <input
                    value={partCount}
                    onChange={(event) => setPartCount(event.target.value)}
                    className={FIELD_CLASS}
                    inputMode="numeric"
                  />
                </label>
              )}

              <label>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  New column names
                </span>
                <input
                  value={newColumnNames}
                  onChange={(event) => setNewColumnNames(event.target.value)}
                  className={FIELD_CLASS}
                  placeholder={`${activeColumn}_part_1, ${activeColumn}_part_2`}
                />
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
          </div>

          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Preview split results
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Derived columns: {derivedColumnNames.join(", ")}
                </p>
              </div>
              <div className="rounded-full border border-white/20 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                {formatNumber(derivedColumnNames.length)} parts
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {previewRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/20 px-4 py-8 text-sm text-slate-500 dark:text-slate-400">
                  Preview rows will appear here after you run the split preview.
                </div>
              ) : (
                previewRows.map((row) => (
                  <div
                    key={row.key}
                    className="rounded-2xl border border-white/20 bg-white/55 p-4 dark:bg-slate-950/35"
                  >
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      Original
                    </div>
                    <div className="mt-1 text-sm text-slate-800 dark:text-slate-100">
                      {row.original}
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {row.parts.map((part, index) => (
                        <div
                          key={`${row.key}-${derivedColumnNames[index] ?? index}`}
                          className="rounded-2xl border border-white/20 p-3"
                        >
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                            {derivedColumnNames[index] ?? `part_${index + 1}`}
                          </div>
                          <div className="mt-1 text-sm text-slate-800 dark:text-slate-100">
                            {part}
                          </div>
                        </div>
                      ))}
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
