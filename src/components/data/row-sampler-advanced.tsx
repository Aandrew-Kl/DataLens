"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Download,
  Filter,
  Layers3,
  Scale,
  Shuffle,
  Table2,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
  quoteIdentifier,
  quoteLiteral,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface RowSamplerAdvancedProps {
  tableName: string;
  columns: ColumnProfile[];
}

type SamplingMethod = "random" | "stratified" | "weighted";
type SamplingUnit = "rows" | "percent";

interface SamplingConfig {
  method: SamplingMethod;
  unit: SamplingUnit;
  amount: number;
  seed: string;
  filterExpression: string;
  stratifyColumn: string;
  weightColumn: string;
}

interface SamplingPreview {
  filteredRows: number;
  sampleSize: number;
  sampleRows: Record<string, unknown>[];
  summary: string;
}

interface SummaryCardProps {
  icon: typeof Table2;
  label: string;
  value: string;
}

const PREVIEW_LIMIT = 8;

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv(rows: Record<string, unknown>[]): string {
  const headers = Array.from(
    rows.reduce((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key));
      return keys;
    }, new Set<string>()),
  );

  return [headers, ...rows.map((row) => headers.map((header) => row[header]))]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
}

function isCategorical(column: ColumnProfile): boolean {
  return (
    (column.type === "string" || column.type === "boolean") &&
    column.uniqueCount >= 2 &&
    column.uniqueCount <= 40
  );
}

function isNumeric(column: ColumnProfile): boolean {
  return column.type === "number";
}

function buildWhereClause(filterExpression: string): string {
  const trimmed = filterExpression.trim();
  return trimmed.length > 0 ? `WHERE (${trimmed})` : "";
}

function buildSampleLimit(totalRows: number, config: SamplingConfig): number {
  if (config.unit === "percent") {
    return Math.max(
      1,
      Math.ceil((totalRows * Math.max(1, config.amount)) / 100),
    );
  }

  return Math.max(1, Math.min(totalRows, Math.round(config.amount)));
}

function buildSampleSql(
  tableName: string,
  config: SamplingConfig,
  filteredRows: number,
): string {
  const safeSeed = quoteLiteral(config.seed);
  const whereClause = buildWhereClause(config.filterExpression);
  const limit = buildSampleLimit(filteredRows, config);
  const fraction = filteredRows === 0 ? 0 : limit / filteredRows;

  const baseCte = `
    WITH filtered AS (
      SELECT *, ROW_NUMBER() OVER () AS __sample_index__
      FROM ${quoteIdentifier(tableName)}
      ${whereClause}
    )
  `;

  if (config.method === "random") {
    return `
      ${baseCte}
      SELECT * EXCLUDE (__sample_index__)
      FROM filtered
      ORDER BY HASH(CAST(__sample_index__ AS VARCHAR) || ${safeSeed})
      LIMIT ${limit}
    `;
  }

  if (config.method === "stratified") {
    const safeStratifyColumn = quoteIdentifier(config.stratifyColumn);

    return `
      ${baseCte},
      stratified AS (
        SELECT
          *,
          COALESCE(CAST(${safeStratifyColumn} AS VARCHAR), '(blank)') AS __stratum,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(CAST(${safeStratifyColumn} AS VARCHAR), '(blank)')
            ORDER BY HASH(CAST(__sample_index__ AS VARCHAR) || ${safeSeed})
          ) AS __stratum_rank,
          COUNT(*) OVER (
            PARTITION BY COALESCE(CAST(${safeStratifyColumn} AS VARCHAR), '(blank)')
          ) AS __stratum_count
        FROM filtered
      )
      SELECT * EXCLUDE (__sample_index__, __stratum, __stratum_rank, __stratum_count)
      FROM stratified
      WHERE __stratum_rank <= GREATEST(
        1,
        CAST(CEIL(__stratum_count * ${fraction}) AS BIGINT)
      )
      ORDER BY __stratum, __stratum_rank
      LIMIT ${limit}
    `;
  }

  const safeWeightColumn = quoteIdentifier(config.weightColumn);

  return `
    ${baseCte},
    weighted AS (
      SELECT
        *,
        GREATEST(TRY_CAST(${safeWeightColumn} AS DOUBLE), 0.000001) AS __weight,
        -LN(
          (MOD(HASH(CAST(__sample_index__ AS VARCHAR) || ${safeSeed}), 1000003) + 1)
          / 1000004.0
        ) / GREATEST(TRY_CAST(${safeWeightColumn} AS DOUBLE), 0.000001) AS __priority
      FROM filtered
      WHERE TRY_CAST(${safeWeightColumn} AS DOUBLE) IS NOT NULL
        AND TRY_CAST(${safeWeightColumn} AS DOUBLE) > 0
    )
    SELECT * EXCLUDE (__sample_index__, __weight, __priority)
    FROM weighted
    ORDER BY __priority
    LIMIT ${limit}
  `;
}

function readCount(rows: Record<string, unknown>[], key: string): number {
  const rawValue = rows[0]?.[key];
  const count = toNumber(rawValue);
  return count === null ? 0 : Math.max(0, Math.round(count));
}

function buildSummary(
  config: SamplingConfig,
  filteredRows: number,
  sampleSize: number,
): string {
  const filterLabel =
    config.filterExpression.trim().length > 0
      ? ` Filtered with: ${config.filterExpression.trim()}.`
      : "";

  if (config.method === "stratified") {
    return `Seed ${config.seed} produced ${formatNumber(sampleSize)} stratified rows from ${formatNumber(filteredRows)} filtered rows using ${config.stratifyColumn}.${filterLabel}`;
  }

  if (config.method === "weighted") {
    return `Seed ${config.seed} produced ${formatNumber(sampleSize)} weight-ranked rows from ${formatNumber(filteredRows)} filtered rows using ${config.weightColumn}.${filterLabel}`;
  }

  return `Seed ${config.seed} produced ${formatNumber(sampleSize)} random rows from ${formatNumber(filteredRows)} filtered rows.${filterLabel}`;
}

async function loadSamplingPreview(
  tableName: string,
  config: SamplingConfig,
): Promise<SamplingPreview> {
  const filteredRowsResult = await runQuery(`
    SELECT COUNT(*) AS row_count
    FROM ${quoteIdentifier(tableName)}
    ${buildWhereClause(config.filterExpression)}
  `);
  const filteredRows = readCount(filteredRowsResult, "row_count");

  if (filteredRows === 0) {
    return {
      filteredRows: 0,
      sampleSize: 0,
      sampleRows: [],
      summary: "No rows matched the current filter and sampling settings.",
    };
  }

  const sampleSql = buildSampleSql(tableName, config, filteredRows);
  const [sampleCountRows, samplePreviewRows] = await Promise.all([
    runQuery(`SELECT COUNT(*) AS sample_count FROM (${sampleSql}) AS sampled_rows`),
    runQuery(`SELECT * FROM (${sampleSql}) AS sampled_rows LIMIT ${PREVIEW_LIMIT}`),
  ]);
  const sampleSize = readCount(sampleCountRows, "sample_count");

  return {
    filteredRows,
    sampleSize,
    sampleRows: samplePreviewRows,
    summary: buildSummary(config, filteredRows, sampleSize),
  };
}

async function exportSampleRows(
  tableName: string,
  config: SamplingConfig,
): Promise<void> {
  const filteredRowsResult = await runQuery(`
    SELECT COUNT(*) AS row_count
    FROM ${quoteIdentifier(tableName)}
    ${buildWhereClause(config.filterExpression)}
  `);
  const filteredRows = readCount(filteredRowsResult, "row_count");

  if (filteredRows === 0) {
    return;
  }

  const sampleRows = await runQuery(buildSampleSql(tableName, config, filteredRows));
  downloadFile(
    buildCsv(sampleRows),
    `${tableName}-${config.method}-advanced-sample.csv`,
    "text/csv;charset=utf-8;",
  );
}

function SummaryCard({ icon: Icon, label, value }: SummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <Shuffle className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Advanced row sampler
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {message}
          </p>
        </div>
      </div>
    </section>
  );
}

export default function RowSamplerAdvanced({
  tableName,
  columns,
}: RowSamplerAdvancedProps) {
  const categoricalColumns = useMemo(
    () => columns.filter(isCategorical),
    [columns],
  );
  const numericColumns = useMemo(() => columns.filter(isNumeric), [columns]);

  const [method, setMethod] = useState<SamplingMethod>("random");
  const [unit, setUnit] = useState<SamplingUnit>("rows");
  const [amountInput, setAmountInput] = useState("120");
  const [seedInput, setSeedInput] = useState("datalens");
  const [filterExpression, setFilterExpression] = useState("");
  const [stratifyColumn, setStratifyColumn] = useState(
    categoricalColumns[0]?.name ?? "",
  );
  const [weightColumn, setWeightColumn] = useState(numericColumns[0]?.name ?? "");
  const [preview, setPreview] = useState<SamplingPreview | null>(null);
  const [status, setStatus] = useState(
    "Compose a deterministic sample with optional SQL filter conditions.",
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const resolvedStratifyColumn = useMemo(() => {
    if (categoricalColumns.some((column) => column.name === stratifyColumn)) {
      return stratifyColumn;
    }
    return categoricalColumns[0]?.name ?? "";
  }, [categoricalColumns, stratifyColumn]);

  const resolvedWeightColumn = useMemo(() => {
    if (numericColumns.some((column) => column.name === weightColumn)) {
      return weightColumn;
    }
    return numericColumns[0]?.name ?? "";
  }, [numericColumns, weightColumn]);

  const config = useMemo(
    () =>
      ({
        method,
        unit,
        amount:
          unit === "percent"
            ? Math.max(1, Math.min(100, Math.round(toNumber(amountInput) ?? 10)))
            : Math.max(1, Math.round(toNumber(amountInput) ?? 120)),
        seed: seedInput.trim() || "datalens",
        filterExpression,
        stratifyColumn: resolvedStratifyColumn,
        weightColumn: resolvedWeightColumn,
      }) satisfies SamplingConfig,
    [
      amountInput,
      filterExpression,
      method,
      resolvedStratifyColumn,
      resolvedWeightColumn,
      seedInput,
      unit,
    ],
  );

  async function handlePreview(): Promise<void> {
    if (method === "stratified" && resolvedStratifyColumn.length === 0) {
      setError("Choose a categorical column before running a stratified sample.");
      return;
    }

    if (method === "weighted" && resolvedWeightColumn.length === 0) {
      setError("Choose a numeric weight column before running a weighted sample.");
      return;
    }

    setLoading(true);
    setError(null);
    setStatus("Running sampling preview in DuckDB.");

    try {
      const nextPreview = await loadSamplingPreview(tableName, config);
      startTransition(() => {
        setPreview(nextPreview);
        setStatus(nextPreview.summary);
      });
    } catch (samplingError) {
      setError(
        samplingError instanceof Error
          ? samplingError.message
          : "Unable to preview sampled rows.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleExport(): Promise<void> {
    try {
      await exportSampleRows(tableName, config);
    } catch (exportError) {
      setError(
        exportError instanceof Error ? exportError.message : "Unable to export sample rows.",
      );
    }
  }

  if (columns.length === 0) {
    return <EmptyState message="Sampling requires at least one profiled column." />;
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Layers3 className="h-3.5 w-3.5" />
            Advanced sampling
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Mix SQL filters, strata, and sampling weights
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Preview a reproducible sample before export. Switch between seeded random,
            stratified, and weighted sampling without changing the underlying table.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryCard
            icon={Table2}
            label="Profiled columns"
            value={formatNumber(columns.length)}
          />
          <SummaryCard
            icon={Filter}
            label="Categorical strata"
            value={formatNumber(categoricalColumns.length)}
          />
          <SummaryCard
            icon={Scale}
            label="Numeric weights"
            value={formatNumber(numericColumns.length)}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <Shuffle className="h-4 w-4 text-cyan-500" />
            Sampling controls
          </div>

          <div className="grid gap-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Sampling method
              </span>
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value as SamplingMethod)}
                className={FIELD_CLASS}
              >
                <option value="random">Random sample</option>
                <option value="stratified">Stratified sample</option>
                <option value="weighted">Weight-based sample</option>
              </select>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Size unit
                </span>
                <select
                  value={unit}
                  onChange={(event) => setUnit(event.target.value as SamplingUnit)}
                  className={FIELD_CLASS}
                >
                  <option value="rows">Rows</option>
                  <option value="percent">Percent</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  {unit === "percent" ? "Sample percent" : "Sample rows"}
                </span>
                <input
                  value={amountInput}
                  onChange={(event) => setAmountInput(event.target.value)}
                  className={FIELD_CLASS}
                  inputMode="numeric"
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Seed
              </span>
              <input
                value={seedInput}
                onChange={(event) => setSeedInput(event.target.value)}
                className={FIELD_CLASS}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Filter expression
              </span>
              <textarea
                value={filterExpression}
                onChange={(event) => setFilterExpression(event.target.value)}
                className={`${FIELD_CLASS} min-h-28 resize-y`}
                placeholder={`region = 'EMEA' AND amount > 500`}
              />
            </label>

            {method === "stratified" ? (
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Stratify by
                </span>
                <select
                  value={resolvedStratifyColumn}
                  onChange={(event) => setStratifyColumn(event.target.value)}
                  className={FIELD_CLASS}
                >
                  {categoricalColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {method === "weighted" ? (
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Weight column
                </span>
                <select
                  value={resolvedWeightColumn}
                  onChange={(event) => setWeightColumn(event.target.value)}
                  className={FIELD_CLASS}
                >
                  {numericColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  void handlePreview();
                }}
                disabled={loading}
                className={BUTTON_CLASS}
              >
                <Shuffle className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Preview sample
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleExport();
                }}
                disabled={!preview || preview.sampleSize === 0}
                className={BUTTON_CLASS}
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            </div>

            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
              {status}
            </p>
            {error ? (
              <p className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
          className="grid gap-5"
        >
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="grid gap-4 sm:grid-cols-3">
              <SummaryCard
                icon={Table2}
                label="Filtered rows"
                value={preview ? formatNumber(preview.filteredRows) : "—"}
              />
              <SummaryCard
                icon={Shuffle}
                label="Sample size"
                value={preview ? formatNumber(preview.sampleSize) : "—"}
              />
              <SummaryCard
                icon={Layers3}
                label="Seed"
                value={config.seed}
              />
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
            <div className="border-b border-white/10 px-5 py-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Sample preview
              </h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {preview
                  ? preview.summary
                  : "Run a preview to inspect the first sampled rows before export."}
              </p>
            </div>

            {preview && preview.sampleRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-white/55 dark:bg-slate-900/55">
                    <tr>
                      {Object.keys(preview.sampleRows[0] ?? {}).map((key) => (
                        <th
                          key={key}
                          className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200"
                        >
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleRows.map((row, index) => (
                      <tr
                        key={`row-${index}`}
                        className="border-t border-white/10 text-slate-600 dark:text-slate-300"
                      >
                        {Object.entries(row).map(([key, value]) => (
                          <td key={`${index}-${key}`} className="px-4 py-3">
                            {isRecord(value) ? JSON.stringify(value) : String(value ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-5 py-8 text-sm text-slate-600 dark:text-slate-300">
                {preview
                  ? "The current filter or weighting removed every row from the sample."
                  : "No preview yet."}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
