"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Download,
  Loader2,
  PlusSquare,
  Sigma,
  Sparkles,
  Wand2,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataEnrichToolProps {
  tableName: string;
  columns: ColumnProfile[];
}

type EnrichmentMode = "age" | "domain" | "range" | "normalize";
type NormalizeMode = "minmax" | "zscore";

interface PreviewRow {
  sourceValue: string;
  enrichedValue: string;
}

interface StatusMessage {
  tone: "success" | "error" | "info";
  text: string;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PREVIEW_LIMIT = 12;
const GLASS_PANEL_CLASS =
  "border border-white/20 bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45";
const FIELD_CLASS =
  "w-full rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700/70 dark:bg-slate-950/65 dark:text-slate-100";
const BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
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

function getColumnsForMode(mode: EnrichmentMode, columns: ColumnProfile[]) {
  if (mode === "age") {
    return columns.filter(
      (column) => column.type === "date" || column.type === "string",
    );
  }

  if (mode === "domain") {
    return columns.filter(
      (column) => column.type === "string" || column.type === "unknown",
    );
  }

  return columns.filter((column) => column.type === "number");
}

function resolveColumn(selectedColumn: string, columns: ColumnProfile[]) {
  return columns.some((column) => column.name === selectedColumn)
    ? selectedColumn
    : (columns[0]?.name ?? "");
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "derived_column"
  );
}

function getSuggestedColumnName(
  mode: EnrichmentMode,
  sourceColumn: string,
  normalizeMode: NormalizeMode,
) {
  if (!sourceColumn) return "derived_column";
  if (mode === "age") return `${sourceColumn}_age_years`;
  if (mode === "domain") return `${sourceColumn}_domain`;
  if (mode === "range") return `${sourceColumn}_range_bucket`;
  return `${sourceColumn}_${normalizeMode}`;
}

function buildExpression(
  mode: EnrichmentMode,
  sourceColumn: string,
  bucketSize: number,
  normalizeMode: NormalizeMode,
) {
  const safeColumn = quoteIdentifier(sourceColumn);

  if (mode === "age") {
    return `DATE_DIFF('year', TRY_CAST(${safeColumn} AS DATE), CURRENT_DATE)`;
  }

  if (mode === "domain") {
    return `LOWER(NULLIF(regexp_extract(CAST(${safeColumn} AS VARCHAR), '@([^@]+)$', 1), ''))`;
  }

  if (mode === "range") {
    return `
      CASE
        WHEN TRY_CAST(${safeColumn} AS DOUBLE) IS NULL THEN NULL
        ELSE CONCAT(
          CAST(FLOOR(TRY_CAST(${safeColumn} AS DOUBLE) / ${bucketSize}) * ${bucketSize} AS BIGINT),
          ' - ',
          CAST(FLOOR(TRY_CAST(${safeColumn} AS DOUBLE) / ${bucketSize}) * ${bucketSize} + ${bucketSize} - 1 AS BIGINT)
        )
      END
    `;
  }

  if (normalizeMode === "zscore") {
    return `
      CASE
        WHEN STDDEV_POP(TRY_CAST(${safeColumn} AS DOUBLE)) OVER () = 0 THEN 0
        ELSE (
          TRY_CAST(${safeColumn} AS DOUBLE) - AVG(TRY_CAST(${safeColumn} AS DOUBLE)) OVER ()
        ) / NULLIF(STDDEV_POP(TRY_CAST(${safeColumn} AS DOUBLE)) OVER (), 0)
      END
    `;
  }

  return `
    CASE
      WHEN MAX(TRY_CAST(${safeColumn} AS DOUBLE)) OVER () = MIN(TRY_CAST(${safeColumn} AS DOUBLE)) OVER () THEN 0
      ELSE (
        TRY_CAST(${safeColumn} AS DOUBLE) - MIN(TRY_CAST(${safeColumn} AS DOUBLE)) OVER ()
      ) / NULLIF(MAX(TRY_CAST(${safeColumn} AS DOUBLE)) OVER () - MIN(TRY_CAST(${safeColumn} AS DOUBLE)) OVER (), 0)
    END
  `;
}

function buildPreviewQuery(
  tableName: string,
  sourceColumn: string,
  expression: string,
  newColumnName: string,
) {
  return `
    SELECT
      CAST(${quoteIdentifier(sourceColumn)} AS VARCHAR) AS source_value,
      CAST(${expression} AS VARCHAR) AS ${quoteIdentifier(newColumnName)}
    FROM ${quoteIdentifier(tableName)}
    LIMIT ${PREVIEW_LIMIT}
  `;
}

function buildExportCsv(rows: PreviewRow[], newColumnName: string) {
  const header = `source_value,${escapeCsvCell(newColumnName)}`;
  const body = rows.map((row) =>
    [row.sourceValue, row.enrichedValue].map(escapeCsvCell).join(","),
  );
  return [header, ...body].join("\n");
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

export default function DataEnrichTool({
  tableName,
  columns,
}: DataEnrichToolProps) {
  const [mode, setMode] = useState<EnrichmentMode>("age");
  const [selectedColumn, setSelectedColumn] = useState("");
  const [customColumnName, setCustomColumnName] = useState("");
  const [bucketSize, setBucketSize] = useState(25);
  const [normalizeMode, setNormalizeMode] = useState<NormalizeMode>("minmax");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  const eligibleColumns = useMemo(
    () => getColumnsForMode(mode, columns),
    [columns, mode],
  );
  const activeColumn = resolveColumn(selectedColumn, eligibleColumns);
  const suggestedColumnName = getSuggestedColumnName(
    mode,
    activeColumn,
    normalizeMode,
  );
  const activeColumnName = slugify(customColumnName.trim() || suggestedColumnName);
  const expression = buildExpression(mode, activeColumn, bucketSize, normalizeMode);

  async function handlePreview() {
    if (!activeColumn) {
      setStatus({
        tone: "error",
        text: "Choose a compatible source column for the selected enrichment mode.",
      });
      return;
    }

    setPreviewing(true);
    setStatus(null);

    try {
      const rows = await runQuery(
        buildPreviewQuery(tableName, activeColumn, expression, activeColumnName),
      );
      const nextRows = rows.map((row) => ({
        sourceValue:
          typeof row.source_value === "string"
            ? row.source_value
            : row.source_value == null
              ? ""
              : String(row.source_value),
        enrichedValue:
          typeof row[activeColumnName] === "string"
            ? row[activeColumnName]
            : row[activeColumnName] == null
              ? ""
              : String(row[activeColumnName]),
      }));

      startTransition(() => {
        setPreviewRows(nextRows);
        setStatus({
          tone: "success",
          text: `Previewed ${formatNumber(nextRows.length)} enriched rows for ${activeColumn}.`,
        });
      });
    } catch (error) {
      startTransition(() => {
        setPreviewRows([]);
        setStatus({
          tone: "error",
          text: error instanceof Error ? error.message : "Preview query failed.",
        });
      });
    } finally {
      setPreviewing(false);
    }
  }

  async function handleApply() {
    if (!activeColumn) {
      setStatus({
        tone: "error",
        text: "Choose a compatible source column before applying enrichment.",
      });
      return;
    }

    setApplying(true);
    setStatus(null);

    const tempTableName = `${tableName}__enrich_${Date.now()}`;
    const backupTableName = `${tableName}__enrich_backup_${Date.now()}`;

    try {
      await runQuery(`DROP TABLE IF EXISTS ${quoteIdentifier(tempTableName)}`);
      await runQuery(`DROP TABLE IF EXISTS ${quoteIdentifier(backupTableName)}`);
      await runQuery(`
        CREATE TABLE ${quoteIdentifier(tempTableName)} AS
        SELECT *,
               ${expression} AS ${quoteIdentifier(activeColumnName)}
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
        text: `Applied ${activeColumnName} to ${tableName}.`,
      });
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : "Enrichment apply failed.",
      });
    } finally {
      setApplying(false);
    }
  }

  function handleExport() {
    if (previewRows.length === 0) {
      setStatus({
        tone: "info",
        text: "Generate a preview before exporting enriched rows.",
      });
      return;
    }

    downloadFile(
      buildExportCsv(previewRows, activeColumnName),
      `${tableName}-${activeColumnName}-preview.csv`,
      "text/csv;charset=utf-8;",
    );
    setStatus({
      tone: "success",
      text: "Exported the enrichment preview to CSV.",
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
            <PlusSquare className="h-3.5 w-3.5" />
            Data enrich tool
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Add computed columns for dates, email domains, ranges, and normalized metrics
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Build a derived field on top of {tableName}, preview the transformed values, export
            them for review, and apply the new column back into DuckDB once the output looks right.
          </p>
        </div>

        <div className="grid w-full gap-3 sm:grid-cols-3 lg:max-w-md">
          <MetricCard label="Eligible Columns" value={formatNumber(eligibleColumns.length)} />
          <MetricCard label="Preview Rows" value={formatNumber(previewRows.length)} />
          <MetricCard label="Columns In Table" value={formatNumber(columns.length)} />
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.96fr_1.04fr]">
        <div className={`rounded-[1.75rem] p-5 ${GLASS_PANEL_CLASS}`}>
          <div className="grid gap-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Enrichment mode
              </span>
              <select
                aria-label="Enrichment mode"
                className={FIELD_CLASS}
                value={mode}
                onChange={(event) => setMode(event.target.value as EnrichmentMode)}
              >
                <option value="age">Calculate age from date</option>
                <option value="domain">Extract domain from email</option>
                <option value="range">Categorize numeric ranges</option>
                <option value="normalize">Normalize numeric values</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Source column
              </span>
              <select
                aria-label="Source column"
                className={FIELD_CLASS}
                value={activeColumn}
                onChange={(event) => setSelectedColumn(event.target.value)}
              >
                {eligibleColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            {mode === "range" ? (
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Range size
                </span>
                <input
                  aria-label="Range size"
                  className={FIELD_CLASS}
                  min={1}
                  type="number"
                  value={bucketSize}
                  onChange={(event) => setBucketSize(Math.max(1, Number(event.target.value)))}
                />
              </label>
            ) : null}

            {mode === "normalize" ? (
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Normalize mode
                </span>
                <select
                  aria-label="Normalize mode"
                  className={FIELD_CLASS}
                  value={normalizeMode}
                  onChange={(event) => setNormalizeMode(event.target.value as NormalizeMode)}
                >
                  <option value="minmax">Min-max (0 to 1)</option>
                  <option value="zscore">Z-score</option>
                </select>
              </label>
            ) : null}

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                New column name
              </span>
              <input
                aria-label="New column name"
                className={FIELD_CLASS}
                placeholder={suggestedColumnName}
                value={customColumnName}
                onChange={(event) => setCustomColumnName(event.target.value)}
              />
            </label>

            <StatusBanner message={status} />

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handlePreview}
                disabled={previewing || eligibleColumns.length === 0}
                className={`${BUTTON_CLASS} bg-cyan-600 text-white hover:bg-cyan-500`}
              >
                {previewing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Preview enrichment
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={applying || previewRows.length === 0}
                className={`${BUTTON_CLASS} border border-white/20 bg-white/70 text-slate-800 hover:bg-white dark:bg-slate-950/45 dark:text-slate-100 dark:hover:bg-slate-950/60`}
              >
                {applying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                Apply enrichment
              </button>
              <button
                type="button"
                onClick={handleExport}
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
                Preview rows
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Generated values for {activeColumnName} using the first {PREVIEW_LIMIT} rows.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 dark:bg-white/5 dark:text-slate-300">
              <Sigma className="h-3.5 w-3.5" />
              {activeColumnName}
            </div>
          </div>

          {previewRows.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-white/25 bg-white/35 p-8 text-sm text-slate-600 dark:bg-slate-950/25 dark:text-slate-300">
              Preview an enrichment to inspect the transformed value before applying it to the
              dataset.
            </div>
          ) : (
            <div className="mt-5 overflow-hidden rounded-3xl border border-white/20">
              <div className="grid grid-cols-2 gap-4 bg-slate-900/5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:bg-white/5 dark:text-slate-400">
                <span>{activeColumn}</span>
                <span>{activeColumnName}</span>
              </div>
              <div className="divide-y divide-white/15">
                {previewRows.map((row, index) => (
                  <div
                    key={`${row.sourceValue}-${index}`}
                    className="grid grid-cols-2 gap-4 px-4 py-4 text-sm text-slate-700 dark:text-slate-200"
                  >
                    <span className="break-all">{row.sourceValue || "—"}</span>
                    <span className="break-all">{row.enrichedValue || "—"}</span>
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
