"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, Equal, Layers3, Percent, Search } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  quoteLiteral,
  toCount,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataSamplerStratifiedProps {
  tableName: string;
  columns: ColumnProfile[];
}

type AllocationMode = "proportional" | "equal";

interface StratumAllocation {
  label: string;
  rowCount: number;
  sampleSize: number;
}

const PREVIEW_LIMIT = 10;

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return "";
  }

  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const body = rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(","));
  return [headers.join(","), ...body].join("\n");
}

function buildSuggestedAllocations(
  rows: Array<{ label: string; rowCount: number }>,
  totalRequested: number,
  mode: AllocationMode,
): StratumAllocation[] {
  const normalizedTotal = Math.max(1, Math.round(totalRequested));
  const totalRows = rows.reduce((sum, row) => sum + row.rowCount, 0);

  return rows.map((row) => {
    if (mode === "equal") {
      return {
        label: row.label,
        rowCount: row.rowCount,
        sampleSize: Math.min(row.rowCount, Math.max(1, Math.floor(normalizedTotal / Math.max(rows.length, 1)))),
      };
    }

    const proportional = totalRows === 0 ? 0 : Math.round((row.rowCount / totalRows) * normalizedTotal);
    return {
      label: row.label,
      rowCount: row.rowCount,
      sampleSize: Math.min(row.rowCount, Math.max(1, proportional)),
    };
  });
}

function buildLimitsClause(strata: StratumAllocation[]): string {
  return strata
    .filter((stratum) => stratum.sampleSize > 0)
    .map((stratum) => `(${quoteLiteral(stratum.label)}, ${Math.max(0, Math.round(stratum.sampleSize))})`)
    .join(",\n          ");
}

function buildSamplingSql(
  tableName: string,
  stratifyColumn: string,
  seed: string,
  strata: StratumAllocation[],
  previewLimit?: number,
): string {
  const safeTable = quoteIdentifier(tableName);
  const safeColumn = quoteIdentifier(stratifyColumn);
  const limitsClause = buildLimitsClause(strata);

  const limitSql = typeof previewLimit === "number" ? `\n      LIMIT ${previewLimit}` : "";

  return `
    WITH seeded AS (
      SELECT
        *,
        COALESCE(CAST(${safeColumn} AS VARCHAR), '(blank)') AS __stratum,
        ROW_NUMBER() OVER () AS __row_id
      FROM ${safeTable}
    ),
    ranked AS (
      SELECT
        *,
        ROW_NUMBER() OVER (
          PARTITION BY __stratum
          ORDER BY HASH(CAST(__row_id AS VARCHAR) || ${quoteLiteral(seed)})
        ) AS __rank
      FROM seeded
    ),
    sample_limits(stratum_name, limit_value) AS (
      VALUES
          ${limitsClause}
    )
    SELECT * EXCLUDE (__stratum, __row_id, __rank, stratum_name, limit_value)
    FROM ranked
    INNER JOIN sample_limits
      ON ranked.__stratum = sample_limits.stratum_name
    WHERE __rank <= limit_value
    ORDER BY __stratum, __rank${limitSql}
  `;
}

function buildHeaders(rows: Record<string, unknown>[], columns: ColumnProfile[]): string[] {
  return Array.from(new Set([...columns.map((column) => column.name), ...rows.flatMap((row) => Object.keys(row))]));
}

export default function DataSamplerStratified({ tableName, columns }: DataSamplerStratifiedProps) {
  const selectableColumns = useMemo(
    () => columns.filter((column) => column.uniqueCount > 1),
    [columns],
  );
  const [stratifyColumn, setStratifyColumn] = useState(selectableColumns[0]?.name ?? "");
  const [allocationMode, setAllocationMode] = useState<AllocationMode>("proportional");
  const [seed, setSeed] = useState("42");
  const [requestedTotal, setRequestedTotal] = useState(24);
  const [strata, setStrata] = useState<StratumAllocation[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [status, setStatus] = useState("Load the strata, rebalance the allocation, and preview a reproducible sample.");
  const [error, setError] = useState<string | null>(null);
  const [loadingStrata, setLoadingStrata] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const previewHeaders = useMemo(
    () => buildHeaders(previewRows, columns),
    [columns, previewRows],
  );

  if (selectableColumns.length === 0) {
    return (
      <section className={`${GLASS_PANEL_CLASS} p-6`}>
        <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Stratified sampler</h2>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          Stratified sampling requires at least one profiled column with more than one distinct value.
        </p>
      </section>
    );
  }

  async function handleLoadStrata(): Promise<void> {
    if (!stratifyColumn) {
      setError("Choose a stratification column first.");
      return;
    }

    setLoadingStrata(true);
    setError(null);

    try {
      const rows = await runQuery(`
        SELECT
          COALESCE(CAST(${quoteIdentifier(stratifyColumn)} AS VARCHAR), '(blank)') AS stratum,
          COUNT(*) AS row_count
        FROM ${quoteIdentifier(tableName)}
        GROUP BY 1
        ORDER BY row_count DESC, stratum ASC
      `);

      const parsedRows = rows.map((row) => ({
        label: String(row.stratum ?? "(blank)"),
        rowCount: toCount(row.row_count),
      }));

      const nextStrata = buildSuggestedAllocations(parsedRows, requestedTotal, allocationMode);
      setStrata(nextStrata);
      setStatus(`Loaded ${formatNumber(nextStrata.length)} strata from ${stratifyColumn}.`);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load strata.");
    } finally {
      setLoadingStrata(false);
    }
  }

  function handleRebalance(): void {
    startTransition(() => {
      setStrata((current) =>
        buildSuggestedAllocations(
          current.map((stratum) => ({
            label: stratum.label,
            rowCount: stratum.rowCount,
          })),
          requestedTotal,
          allocationMode,
        ),
      );
    });
  }

  async function handlePreview(): Promise<void> {
    if (!stratifyColumn || strata.length === 0) {
      setError("Load the strata before previewing a sample.");
      return;
    }

    setPreviewing(true);
    setError(null);

    try {
      const rows = await runQuery(buildSamplingSql(tableName, stratifyColumn, seed, strata, PREVIEW_LIMIT));
      setPreviewRows(rows);
      setStatus(`Previewed ${formatNumber(rows.length)} rows with a deterministic seed of ${seed}.`);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Unable to preview the sample.");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleExport(): Promise<void> {
    if (!stratifyColumn || strata.length === 0) {
      setError("Load the strata before exporting a sample.");
      return;
    }

    setExporting(true);
    setError(null);

    try {
      const rows = await runQuery(buildSamplingSql(tableName, stratifyColumn, seed, strata));
      downloadFile(
        buildCsv(rows),
        `${tableName}-${stratifyColumn}-stratified-sample.csv`,
        "text/csv;charset=utf-8;",
      );
      setStatus(`Exported ${formatNumber(rows.length)} stratified sample rows.`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Unable to export the sample.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <motion.section
      className={`${GLASS_PANEL_CLASS} space-y-6 p-6`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: ANALYTICS_EASE }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
            <Layers3 className="h-3.5 w-3.5" />
            Sampling
          </div>
          <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
            Allocate a reproducible sample across strata
          </h2>
          <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">{status}</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button className={BUTTON_CLASS} disabled={loadingStrata} onClick={() => void handleLoadStrata()} type="button">
            <Search className="h-4 w-4" />
            {loadingStrata ? "Loading strata…" : "Load strata"}
          </button>
          <button className={BUTTON_CLASS} disabled={strata.length === 0 || previewing} onClick={() => void handlePreview()} type="button">
            <Percent className="h-4 w-4" />
            {previewing ? "Previewing…" : "Preview sample"}
          </button>
          <button className={BUTTON_CLASS} disabled={strata.length === 0 || exporting} onClick={() => void handleExport()} type="button">
            <Download className="h-4 w-4" />
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} space-y-4 p-4`}>
            <label className="block space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <span>Stratification column</span>
              <select className={FIELD_CLASS} onChange={(event) => setStratifyColumn(event.target.value)} value={stratifyColumn}>
                {selectableColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <span>Allocation mode</span>
              <select className={FIELD_CLASS} onChange={(event) => setAllocationMode(event.target.value as AllocationMode)} value={allocationMode}>
                <option value="proportional">Proportional</option>
                <option value="equal">Equal</option>
              </select>
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <span>Total requested sample size</span>
              <input
                className={FIELD_CLASS}
                min={1}
                onChange={(event) => setRequestedTotal(Math.max(1, Number(event.target.value) || 1))}
                type="number"
                value={requestedTotal}
              />
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <span>Seed</span>
              <input className={FIELD_CLASS} onChange={(event) => setSeed(event.target.value)} type="text" value={seed} />
            </label>

            <button className={BUTTON_CLASS} disabled={strata.length === 0} onClick={handleRebalance} type="button">
              <Equal className="h-4 w-4" />
              Rebalance allocation
            </button>
          </div>

          {error ? (
            <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          ) : null}
        </aside>

        <div className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
            <div className="border-b border-white/10 px-4 py-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Stratum allocation
              </h3>
            </div>

            {strata.length === 0 ? (
              <p className="px-4 py-8 text-sm text-slate-600 dark:text-slate-300">
                Load the strata to inspect counts and set per-stratum sample sizes.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-950/[0.03] dark:bg-white/[0.03]">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Stratum</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Rows</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Sample size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {strata.map((stratum) => (
                      <tr className="border-t border-white/10" key={stratum.label}>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{stratum.label}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatNumber(stratum.rowCount)}</td>
                        <td className="px-4 py-3">
                          <input
                            aria-label={`Sample size for ${stratum.label}`}
                            className={FIELD_CLASS}
                            max={stratum.rowCount}
                            min={0}
                            onChange={(event) => {
                              const nextValue = Math.max(0, Math.min(stratum.rowCount, Number(event.target.value) || 0));
                              setStrata((current) =>
                                current.map((candidate) =>
                                  candidate.label === stratum.label
                                    ? { ...candidate, sampleSize: nextValue }
                                    : candidate,
                                ),
                              );
                            }}
                            type="number"
                            value={stratum.sampleSize}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
            <div className="border-b border-white/10 px-4 py-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Sample preview
              </h3>
            </div>

            {previewRows.length === 0 ? (
              <p className="px-4 py-8 text-sm text-slate-600 dark:text-slate-300">
                Preview the sample to inspect the stratified rows.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-950/[0.03] dark:bg-white/[0.03]">
                    <tr>
                      {previewHeaders.map((header) => (
                        <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200" key={header}>
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, rowIndex) => (
                      <tr className="border-t border-white/10" key={`${rowIndex}-${previewHeaders.join(":")}`}>
                        {previewHeaders.map((header) => (
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-300" key={header}>
                            {String(row[header] ?? "—")}
                          </td>
                        ))}
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
