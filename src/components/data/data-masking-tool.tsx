"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Download,
  Eye,
  Fingerprint,
  Loader2,
  Shield,
  Sparkles,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataMaskingToolProps {
  tableName: string;
  columns: ColumnProfile[];
}

type MaskStrategy = "hash" | "redact" | "partial" | "anonymize";

interface PreviewCell {
  columnName: string;
  strategy: MaskStrategy;
  original: string;
  masked: string;
}

interface PreviewRow {
  key: string;
  cells: PreviewCell[];
}

type StatusMessage =
  | { kind: "success" | "error"; message: string }
  | null;

const EASE = [0.22, 1, 0.36, 1] as const;
const STRATEGY_OPTIONS: Array<{
  value: MaskStrategy;
  label: string;
  description: string;
}> = [
  { value: "hash", label: "Hash", description: "Stable MD5 for joins." },
  { value: "redact", label: "Redact", description: "Replace with a fixed token." },
  { value: "partial", label: "Partial mask", description: "Keep a few visible characters." },
  { value: "anonymize", label: "Anonymize", description: "Dense-rank pseudonyms." },
];

function toDisplay(value: unknown) {
  if (value === null || value === undefined) {
    return "null";
  }
  return String(value);
}

function buildMaskExpression(
  columnName: string,
  strategy: MaskStrategy,
  visiblePrefix: number,
  visibleSuffix: number,
) {
  const field = quoteIdentifier(columnName);
  const castField = `CAST(${field} AS VARCHAR)`;

  switch (strategy) {
    case "redact":
      return `CASE WHEN ${field} IS NULL THEN NULL ELSE '[REDACTED]' END`;
    case "partial": {
      const prefix = Math.max(0, visiblePrefix);
      const suffix = Math.max(0, visibleSuffix);
      const visibleLength = prefix + suffix;
      return `CASE
        WHEN ${field} IS NULL THEN NULL
        WHEN LENGTH(${castField}) <= ${visibleLength}
          THEN REPEAT('*', LENGTH(${castField}))
        ELSE CONCAT(
          SUBSTRING(${castField}, 1, ${prefix}),
          REPEAT('*', GREATEST(LENGTH(${castField}) - ${visibleLength}, 1)),
          RIGHT(${castField}, ${suffix})
        )
      END`;
    }
    case "anonymize":
      return `CASE
        WHEN ${field} IS NULL THEN NULL
        ELSE CONCAT('anon_', LPAD(CAST(DENSE_RANK() OVER (ORDER BY ${castField}) AS VARCHAR), 4, '0'))
      END`;
    case "hash":
    default:
      return `CASE WHEN ${field} IS NULL THEN NULL ELSE md5(${castField}) END`;
  }
}

function buildPreviewSql(
  tableName: string,
  selectedColumns: string[],
  strategies: Record<string, MaskStrategy>,
  visiblePrefix: number,
  visibleSuffix: number,
) {
  if (selectedColumns.length === 0) {
    return "";
  }

  const selectList = selectedColumns.flatMap((columnName) => {
    const originalAlias = `${columnName}__original`;
    const maskedAlias = `${columnName}__masked`;
    const expression = buildMaskExpression(
      columnName,
      strategies[columnName] ?? "hash",
      visiblePrefix,
      visibleSuffix,
    );

    return [
      `${quoteIdentifier(columnName)} AS ${quoteIdentifier(originalAlias)}`,
      `${expression} AS ${quoteIdentifier(maskedAlias)}`,
    ];
  });

  return `SELECT ${selectList.join(", ")} FROM ${quoteIdentifier(tableName)} LIMIT 8`;
}

function buildMaskedSelect(
  columns: ColumnProfile[],
  selectedColumns: string[],
  strategies: Record<string, MaskStrategy>,
  visiblePrefix: number,
  visibleSuffix: number,
) {
  const selectedSet = new Set(selectedColumns);
  return columns
    .map((column) => {
      if (!selectedSet.has(column.name)) {
        return quoteIdentifier(column.name);
      }

      const expression = buildMaskExpression(
        column.name,
        strategies[column.name] ?? "hash",
        visiblePrefix,
        visibleSuffix,
      );
      return `${expression} AS ${quoteIdentifier(column.name)}`;
    })
    .join(", ");
}

function buildPreviewRows(
  rows: Record<string, unknown>[],
  selectedColumns: string[],
  strategies: Record<string, MaskStrategy>,
) {
  return rows.map<PreviewRow>((row, index) => ({
    key: `${index}`,
    cells: selectedColumns.map((columnName) => ({
      columnName,
      strategy: strategies[columnName] ?? "hash",
      original: toDisplay(row[`${columnName}__original`]),
      masked: toDisplay(row[`${columnName}__masked`]),
    })),
  }));
}

function buildPreviewCsv(rows: PreviewRow[]) {
  const lines = ["row,column,strategy,original,masked"];
  for (const row of rows) {
    for (const cell of row.cells) {
      const safeOriginal = `"${cell.original.replaceAll('"', '""')}"`;
      const safeMasked = `"${cell.masked.replaceAll('"', '""')}"`;
      lines.push(
        `${row.key},${cell.columnName},${cell.strategy},${safeOriginal},${safeMasked}`,
      );
    }
  }
  return lines.join("\n");
}

export default function DataMaskingTool({
  tableName,
  columns,
}: DataMaskingToolProps) {
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [strategies, setStrategies] = useState<Record<string, MaskStrategy>>({});
  const [visiblePrefix, setVisiblePrefix] = useState("2");
  const [visibleSuffix, setVisibleSuffix] = useState("2");
  const [outputTableName, setOutputTableName] = useState(`${tableName}_masked`);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage>(null);

  const availableColumns = useMemo(() => columns.map((column) => column.name), [columns]);
  const activeSelectedColumns = useMemo(
    () => selectedColumns.filter((columnName) => availableColumns.includes(columnName)),
    [availableColumns, selectedColumns],
  );
  const parsedPrefix = Number.parseInt(visiblePrefix, 10);
  const parsedSuffix = Number.parseInt(visibleSuffix, 10);
  const safePrefix = Number.isFinite(parsedPrefix) ? Math.max(0, parsedPrefix) : 2;
  const safeSuffix = Number.isFinite(parsedSuffix) ? Math.max(0, parsedSuffix) : 2;

  function toggleColumn(columnName: string) {
    startTransition(() => {
      setSelectedColumns((current) =>
        current.includes(columnName)
          ? current.filter((entry) => entry !== columnName)
          : [...current, columnName],
      );
      setStrategies((current) => ({
        ...current,
        [columnName]: current[columnName] ?? "hash",
      }));
    });
  }

  async function handlePreview() {
    if (activeSelectedColumns.length === 0) {
      setStatus({ kind: "error", message: "Select at least one column to preview masking." });
      setPreviewRows([]);
      return;
    }

    setPreviewLoading(true);
    setStatus(null);
    try {
      const sql = buildPreviewSql(
        tableName,
        activeSelectedColumns,
        strategies,
        safePrefix,
        safeSuffix,
      );
      const rows = await runQuery(sql);
      setPreviewRows(buildPreviewRows(rows, activeSelectedColumns, strategies));
      setStatus({
        kind: "success",
        message: `Loaded ${formatNumber(rows.length)} preview row${rows.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setPreviewRows([]);
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Unable to preview masked values.",
      });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleApply() {
    if (activeSelectedColumns.length === 0) {
      setStatus({ kind: "error", message: "Select at least one column to create a masked table." });
      return;
    }
    if (!outputTableName.trim()) {
      setStatus({ kind: "error", message: "Enter an output table name first." });
      return;
    }

    setApplyLoading(true);
    setStatus(null);

    try {
      const selectList = buildMaskedSelect(
        columns,
        activeSelectedColumns,
        strategies,
        safePrefix,
        safeSuffix,
      );
      await runQuery(
        `CREATE OR REPLACE TABLE ${quoteIdentifier(outputTableName.trim())} AS SELECT ${selectList} FROM ${quoteIdentifier(tableName)}`,
      );
      setStatus({
        kind: "success",
        message: `Created masked table ${outputTableName.trim()} with ${activeSelectedColumns.length} protected column${activeSelectedColumns.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Unable to create the masked table.",
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

    const csv = buildPreviewCsv(previewRows);
    downloadFile(csv, `${tableName}-masked-preview.csv`, "text/csv;charset=utf-8;");
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
              <Shield className="h-4 w-4" />
              Privacy Masking
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Mask sensitive columns before sharing {tableName}
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Pick the columns that need protection, choose a masking strategy for each,
              preview the result, then create a masked DuckDB table or export the preview.
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
              Preview masked rows
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
                <Sparkles className="h-4 w-4" />
              )}
              Apply to DuckDB
            </button>
            <button type="button" onClick={handleExport} className={BUTTON_CLASS}>
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Fingerprint className="h-4 w-4 text-cyan-500" />
              Choose columns
            </div>
            <div className="flex flex-wrap gap-2">
              {columns.map((column) => {
                const selected = activeSelectedColumns.includes(column.name);
                return (
                  <button
                    key={column.name}
                    type="button"
                    onClick={() => toggleColumn(column.name)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      selected
                        ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                        : "border-white/20 bg-white/50 text-slate-700 dark:bg-slate-950/40 dark:text-slate-200"
                    }`}
                  >
                    {column.name}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 grid gap-4">
              {activeSelectedColumns.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/20 px-4 py-8 text-sm text-slate-500 dark:text-slate-400">
                  Select one or more columns to configure masking.
                </div>
              ) : (
                activeSelectedColumns.map((columnName) => (
                  <div
                    key={columnName}
                    className="rounded-2xl border border-white/20 bg-white/55 p-4 dark:bg-slate-950/35"
                  >
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      {columnName}
                    </label>
                    <select
                      aria-label={`${columnName} masking strategy`}
                      value={strategies[columnName] ?? "hash"}
                      onChange={(event) =>
                        setStrategies((current) => ({
                          ...current,
                          [columnName]: event.target.value as MaskStrategy,
                        }))
                      }
                      className={FIELD_CLASS}
                    >
                      {STRATEGY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      {
                        STRATEGY_OPTIONS.find(
                          (option) => option.value === (strategies[columnName] ?? "hash"),
                        )?.description
                      }
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className={`${GLASS_CARD_CLASS} p-5`}>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Output table
              </label>
              <input
                value={outputTableName}
                onChange={(event) => setOutputTableName(event.target.value)}
                className={FIELD_CLASS}
                placeholder={`${tableName}_masked`}
              />
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Partial prefix
                  </span>
                  <input
                    value={visiblePrefix}
                    onChange={(event) => setVisiblePrefix(event.target.value)}
                    className={FIELD_CLASS}
                    inputMode="numeric"
                  />
                </label>
                <label>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Partial suffix
                  </span>
                  <input
                    value={visibleSuffix}
                    onChange={(event) => setVisibleSuffix(event.target.value)}
                    className={FIELD_CLASS}
                    inputMode="numeric"
                  />
                </label>
              </div>
            </div>

            <div className={`${GLASS_CARD_CLASS} p-5`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Preview rows
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Original and masked values for the currently selected columns.
                  </p>
                </div>
                <div className="rounded-full border border-white/20 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                  {formatNumber(activeSelectedColumns.length)} selected
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {previewRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/20 px-4 py-8 text-sm text-slate-500 dark:text-slate-400">
                    Preview data will appear here after you run masking preview.
                  </div>
                ) : (
                  previewRows.map((row) => (
                    <div
                      key={row.key}
                      className="rounded-2xl border border-white/20 bg-white/55 p-4 dark:bg-slate-950/35"
                    >
                      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Row {row.key}
                      </div>
                      <div className="grid gap-3">
                        {row.cells.map((cell) => (
                          <div
                            key={`${row.key}-${cell.columnName}`}
                            className="grid gap-2 rounded-2xl border border-white/20 p-3 md:grid-cols-[1fr_1fr]"
                          >
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                {cell.columnName} original
                              </div>
                              <div className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                                {cell.original}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                {cell.columnName} masked
                              </div>
                              <div className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                                {cell.masked}
                              </div>
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
