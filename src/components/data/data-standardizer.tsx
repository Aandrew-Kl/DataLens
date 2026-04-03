"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  Download,
  Eye,
  Loader2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
} from "@/lib/utils/advanced-analytics";
import type { ColumnProfile } from "@/types/dataset";

interface DataStandardizerProps {
  tableName: string;
  columns: ColumnProfile[];
}

type StandardizationOperation = "date" | "phone" | "address" | "case";
type CaseMode = "upper" | "lower" | "title";

interface PreviewRow {
  columnName: string;
  originalValue: string;
  standardizedValue: string;
}

interface SummaryCardProps {
  label: string;
  value: string;
}

const OPERATION_LABELS = {
  date: "Date format unification",
  phone: "Phone number formatting",
  address: "Address standardization",
  case: "Case normalization",
} as const;

function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
        {value}
      </div>
    </div>
  );
}

function defaultSelectedColumns(columns: ColumnProfile[]) {
  return columns
    .filter((column) => column.type === "string" || column.type === "date")
    .slice(0, 3)
    .map((column) => column.name);
}

function toDisplayValue(value: unknown) {
  if (value === null || value === undefined) return "null";
  return String(value);
}

function csvEscape(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function rowsToCsv(rows: PreviewRow[]) {
  return [
    "column_name,original_value,standardized_value",
    ...rows.map((row) =>
      [
        csvEscape(row.columnName),
        csvEscape(row.originalValue),
        csvEscape(row.standardizedValue),
      ].join(","),
    ),
  ].join("\n");
}

function standardizedColumnName(columnName: string) {
  return `${columnName}_standardized`;
}

function buildStandardizationExpression(
  columnName: string,
  operation: StandardizationOperation,
  caseMode: CaseMode,
) {
  const safeColumn = quoteIdentifier(columnName);
  const stringValue = `CAST(${safeColumn} AS VARCHAR)`;
  const trimmed = `TRIM(${stringValue})`;
  const digits = `REGEXP_REPLACE(${stringValue}, '[^0-9]', '', 'g')`;

  if (operation === "date") {
    return `COALESCE(STRFTIME(TRY_CAST(${safeColumn} AS TIMESTAMP), '%Y-%m-%d'), ${trimmed})`;
  }

  if (operation === "phone") {
    return `
      CASE
        WHEN LENGTH(${digits}) = 10 THEN
          '(' || SUBSTR(${digits}, 1, 3) || ') ' || SUBSTR(${digits}, 4, 3) || '-' || SUBSTR(${digits}, 7, 4)
        WHEN LENGTH(${digits}) = 11 THEN
          '+' || SUBSTR(${digits}, 1, 1) || ' (' || SUBSTR(${digits}, 2, 3) || ') ' || SUBSTR(${digits}, 5, 3) || '-' || SUBSTR(${digits}, 8, 4)
        ELSE ${trimmed}
      END
    `;
  }

  if (operation === "address") {
    return `REGEXP_REPLACE(UPPER(${trimmed}), '\\s+', ' ', 'g')`;
  }

  if (caseMode === "lower") {
    return `LOWER(${trimmed})`;
  }
  if (caseMode === "title") {
    return `UPPER(SUBSTR(LOWER(${trimmed}), 1, 1)) || SUBSTR(LOWER(${trimmed}), 2)`;
  }

  return `UPPER(${trimmed})`;
}

function columnMatchesOperation(
  column: ColumnProfile,
  operation: StandardizationOperation,
) {
  if (operation === "date") {
    return column.type === "date" || column.type === "string";
  }
  return column.type === "string" || column.type === "date";
}

export default function DataStandardizer({
  tableName,
  columns,
}: DataStandardizerProps) {
  const selectableColumns = useMemo(
    () => columns.filter((column) => columnMatchesOperation(column, "date") || columnMatchesOperation(column, "phone")),
    [columns],
  );
  const [selectedColumns, setSelectedColumns] = useState<string[]>(
    defaultSelectedColumns(columns),
  );
  const [operation, setOperation] = useState<StandardizationOperation>("date");
  const [caseMode, setCaseMode] = useState<CaseMode>("upper");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [status, setStatus] = useState(
    "Select columns, preview standardized values, then materialize new DuckDB fields.",
  );
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingApply, setLoadingApply] = useState(false);

  const filteredColumns = useMemo(
    () =>
      columns.filter((column) => columnMatchesOperation(column, operation)),
    [columns, operation],
  );

  const appliedColumnNames = useMemo(
    () => selectedColumns.map((columnName) => standardizedColumnName(columnName)),
    [selectedColumns],
  );

  function toggleColumn(columnName: string) {
    setSelectedColumns((current) =>
      current.includes(columnName)
        ? current.filter((value) => value !== columnName)
        : [...current, columnName],
    );
  }

  async function handlePreview() {
    if (selectedColumns.length === 0) {
      setStatus("Choose at least one column to standardize.");
      return;
    }

    setLoadingPreview(true);
    setStatus(`Previewing ${selectedColumns.length} standardized columns...`);

    try {
      const previewSets = await Promise.all(
        selectedColumns.map(async (columnName) => {
          const expression = buildStandardizationExpression(
            columnName,
            operation,
            caseMode,
          );
          const rows = await runQuery(`
            SELECT
              CAST(${quoteIdentifier(columnName)} AS VARCHAR) AS original_value,
              CAST(${expression} AS VARCHAR) AS standardized_value
            FROM ${quoteIdentifier(tableName)}
            WHERE ${quoteIdentifier(columnName)} IS NOT NULL
            LIMIT 6
          `);

          return rows.map<PreviewRow>((row) => ({
            columnName,
            originalValue: toDisplayValue(row.original_value),
            standardizedValue: toDisplayValue(row.standardized_value),
          }));
        }),
      );

      startTransition(() => {
        const nextRows = previewSets.flat();
        setPreviewRows(nextRows);
        setStatus(
          `Preview ready for ${formatNumber(selectedColumns.length)} columns and ${formatNumber(nextRows.length)} sampled values.`,
        );
      });
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to preview standardized values.",
      );
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleApply() {
    if (selectedColumns.length === 0) {
      setStatus("Choose at least one column before applying changes.");
      return;
    }

    setLoadingApply(true);
    setStatus(`Applying ${OPERATION_LABELS[operation].toLowerCase()}...`);

    try {
      for (const columnName of selectedColumns) {
        const destinationColumn = standardizedColumnName(columnName);
        const expression = buildStandardizationExpression(
          columnName,
          operation,
          caseMode,
        );
        await runQuery(
          `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN IF NOT EXISTS ${quoteIdentifier(destinationColumn)} VARCHAR`,
        );
        await runQuery(
          `UPDATE ${quoteIdentifier(tableName)} SET ${quoteIdentifier(destinationColumn)} = ${expression}`,
        );
      }

      setStatus(
        `Created ${formatNumber(selectedColumns.length)} standardized DuckDB columns.`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to apply standardization.",
      );
    } finally {
      setLoadingApply(false);
    }
  }

  function handleExport() {
    if (previewRows.length === 0) return;
    downloadFile(
      rowsToCsv(previewRows),
      `${tableName}-standardizer-preview.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-4 border-b border-white/20 pb-5 dark:border-white/10 xl:flex-row xl:items-center xl:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
            <Sparkles className="h-3.5 w-3.5" />
            Data Standardizer
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
              Standardize mixed formatting before downstream analysis
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Preview transformed samples for dates, phones, addresses, and
              case normalization, then create fresh standardized DuckDB columns.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <select
            aria-label="Standardization operation"
            value={operation}
            onChange={(event) =>
              setOperation(event.currentTarget.value as StandardizationOperation)
            }
            className={FIELD_CLASS}
          >
            {Object.entries(OPERATION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <select
            aria-label="Case normalization mode"
            value={caseMode}
            onChange={(event) => setCaseMode(event.currentTarget.value as CaseMode)}
            className={FIELD_CLASS}
            disabled={operation !== "case"}
          >
            <option value="upper">Upper case</option>
            <option value="lower">Lower case</option>
            <option value="title">Title case</option>
          </select>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-white/60 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
        {status}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Select columns
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {filteredColumns.map((column) => {
                const active = selectedColumns.includes(column.name);
                return (
                  <button
                    key={column.name}
                    type="button"
                    onClick={() => toggleColumn(column.name)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition ${
                      active
                        ? "border-cyan-400 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                        : "border-white/20 bg-white/70 text-slate-700 dark:border-white/10 dark:bg-slate-950/45 dark:text-slate-200"
                    }`}
                  >
                    {active ? <Check className="h-4 w-4" /> : null}
                    {column.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryCard
              label="Selected Columns"
              value={formatNumber(selectedColumns.length)}
            />
            <SummaryCard
              label="Preview Rows"
              value={formatNumber(previewRows.length)}
            />
          </div>

          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Output columns
            </p>
            <div className="mt-4 space-y-2 text-sm text-slate-700 dark:text-slate-200">
              {appliedColumnNames.length > 0 ? (
                appliedColumnNames.map((columnName) => (
                  <div key={columnName}>{columnName}</div>
                ))
              ) : (
                <div>No standardized columns selected.</div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  void handlePreview();
                }}
                disabled={loadingPreview}
                className={`${BUTTON_CLASS} bg-cyan-600 text-white hover:bg-cyan-500 dark:bg-cyan-600 dark:text-white`}
              >
                {loadingPreview ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
                Preview changes
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleApply();
                }}
                disabled={loadingApply}
                className={BUTTON_CLASS}
              >
                {loadingApply ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                Apply via DuckDB
              </button>
              <button
                type="button"
                onClick={handleExport}
                disabled={previewRows.length === 0}
                className={BUTTON_CLASS}
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
            <div className="border-b border-white/15 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                Standardization preview
              </h3>
            </div>
            {previewRows.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                Run a preview to inspect before-and-after formatting samples.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-white/50 dark:bg-slate-950/20">
                    <tr className="text-slate-500 dark:text-slate-400">
                      <th className="px-5 py-3 font-medium">Column</th>
                      <th className="px-5 py-3 font-medium">Original</th>
                      <th className="px-5 py-3 font-medium">Standardized</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, index) => (
                      <tr
                        key={`${row.columnName}-${index}`}
                        className="border-t border-white/10 text-slate-700 dark:text-slate-200"
                      >
                        <td className="px-5 py-3">{row.columnName}</td>
                        <td className="px-5 py-3">{row.originalValue}</td>
                        <td className="px-5 py-3">{row.standardizedValue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
