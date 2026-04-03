"use client";

import {
  Suspense,
  use,
  useMemo,
  useState,
} from "react";
import { motion } from "framer-motion";
import {
  Download,
  Layers3,
  Percent,
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
  quoteIdentifier,
  quoteLiteral,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataSamplerProps {
  tableName: string;
  columns: ColumnProfile[];
}

type SamplingMethod = "random" | "stratified" | "systematic";
type SamplingUnit = "rows" | "percent";

interface SamplingConfig {
  method: SamplingMethod;
  unit: SamplingUnit;
  amount: number;
  seed: string;
  stratifyColumn: string;
  interval: number;
}

interface SamplingResult {
  totalRows: number;
  sampleRows: Record<string, unknown>[];
  sampleSize: number;
  configSummary: string;
  error: string | null;
}

interface SummaryCardProps {
  icon: typeof Table2;
  label: string;
  value: string;
}

const PREVIEW_LIMIT = 8;

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv(rows: Record<string, unknown>[]) {
  const headers = Array.from(
    rows.reduce((headerSet, row) => {
      Object.keys(row).forEach((key) => headerSet.add(key));
      return headerSet;
    }, new Set<string>()),
  );

  return [headers, ...rows.map((row) => headers.map((header) => row[header]))]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
}

function isCategorical(column: ColumnProfile) {
  return (
    (column.type === "string" || column.type === "boolean") &&
    column.uniqueCount >= 2 &&
    column.uniqueCount <= 32
  );
}

function buildSampleLimit(
  totalRows: number,
  config: SamplingConfig,
) {
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
  totalRows: number,
) {
  const safeTableName = quoteIdentifier(tableName);
  const safeSeed = quoteLiteral(config.seed || "datalens");
  const sampleLimit = buildSampleLimit(totalRows, config);
  const sampleFraction = totalRows === 0 ? 0 : sampleLimit / totalRows;

  const numberedCte = `
    WITH numbered AS (
      SELECT *, ROW_NUMBER() OVER () AS __sample_index__
      FROM ${safeTableName}
    )
  `;

  if (config.method === "random") {
    return `
      ${numberedCte}
      SELECT * EXCLUDE (__sample_index__)
      FROM numbered
      ORDER BY HASH(CAST(__sample_index__ AS VARCHAR) || ${safeSeed})
      LIMIT ${sampleLimit}
    `;
  }

  if (config.method === "stratified") {
    const safeStratify = quoteIdentifier(config.stratifyColumn);
    return `
      ${numberedCte},
      stratified AS (
        SELECT
          *,
          COALESCE(CAST(${safeStratify} AS VARCHAR), '(blank)') AS __stratum,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(CAST(${safeStratify} AS VARCHAR), '(blank)')
            ORDER BY HASH(CAST(__sample_index__ AS VARCHAR) || ${safeSeed})
          ) AS __stratum_rank,
          COUNT(*) OVER (
            PARTITION BY COALESCE(CAST(${safeStratify} AS VARCHAR), '(blank)')
          ) AS __stratum_count
        FROM numbered
      )
      SELECT * EXCLUDE (__sample_index__, __stratum, __stratum_rank, __stratum_count)
      FROM stratified
      WHERE __stratum_rank <= GREATEST(
        1,
        CAST(CEIL(__stratum_count * ${sampleFraction}) AS BIGINT)
      )
      LIMIT ${sampleLimit}
    `;
  }

  const interval = Math.max(1, Math.round(config.interval));

  return `
    ${numberedCte},
    seeded AS (
      SELECT MOD(HASH(${safeSeed}), ${interval}) AS __offset
    )
    SELECT * EXCLUDE (__sample_index__)
    FROM numbered
    CROSS JOIN seeded
    WHERE MOD(__sample_index__ - 1 - __offset + ${interval}, ${interval}) = 0
    ORDER BY __sample_index__
    LIMIT ${sampleLimit}
  `;
}

async function loadSamplingPreview(
  tableName: string,
  config: SamplingConfig,
): Promise<SamplingResult> {
  try {
    const totalRowsResult = await runQuery(`
      SELECT COUNT(*) AS row_count
      FROM ${quoteIdentifier(tableName)}
    `);
    const totalRows = Number(totalRowsResult[0]?.row_count ?? 0);

    if (totalRows === 0) {
      return {
        totalRows: 0,
        sampleRows: [],
        sampleSize: 0,
        configSummary: "The active table is empty.",
        error: "The active table does not contain rows to sample.",
      };
    }

    const sampleSql = buildSampleSql(tableName, config, totalRows);
    const [sampleCountRows, previewRows] = await Promise.all([
      runQuery(`SELECT COUNT(*) AS sample_count FROM (${sampleSql}) AS sampled_rows`),
      runQuery(`SELECT * FROM (${sampleSql}) AS sampled_rows LIMIT ${PREVIEW_LIMIT}`),
    ]);
    const sampleSize = Number(sampleCountRows[0]?.sample_count ?? 0);
    const configSummary =
      config.method === "random"
        ? `Seeded random sample with ${formatNumber(sampleSize)} rows.`
        : config.method === "stratified"
          ? `Seeded stratified sample on ${config.stratifyColumn} with ${formatNumber(sampleSize)} rows.`
          : `Seeded systematic sample every ${formatNumber(config.interval)} rows with ${formatNumber(sampleSize)} rows.`;

    return {
      totalRows,
      sampleRows: previewRows,
      sampleSize,
      configSummary,
      error: null,
    };
  } catch (error) {
    return {
      totalRows: 0,
      sampleRows: [],
      sampleSize: 0,
      configSummary: "",
      error: error instanceof Error ? error.message : "Sampling failed.",
    };
  }
}

async function exportSample(
  tableName: string,
  config: SamplingConfig,
) {
  const totalRowsResult = await runQuery(`
    SELECT COUNT(*) AS row_count
    FROM ${quoteIdentifier(tableName)}
  `);
  const totalRows = Number(totalRowsResult[0]?.row_count ?? 0);
  const sampleSql = buildSampleSql(tableName, config, totalRows);
  const rows = await runQuery(sampleSql);
  downloadFile(
    buildCsv(rows),
    `${tableName}-${config.method}-sample.csv`,
    "text/csv;charset=utf-8;",
  );
}

function SamplingLoadingState() {
  return (
    <div
      className={`${GLASS_PANEL_CLASS} flex min-h-[22rem] items-center justify-center`}
    >
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Loading sample preview…
      </div>
    </div>
  );
}

function SamplingEmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <Shuffle className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Data Sampler
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {message}
          </p>
        </div>
      </div>
    </section>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: SummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
        {value}
      </div>
    </div>
  );
}

function DataSamplerPanel({
  resource,
  tableName,
  config,
}: {
  resource: Promise<SamplingResult>;
  tableName: string;
  config: SamplingConfig;
}) {
  const result = use(resource);

  if (result.error) {
    return (
      <div className={`${GLASS_PANEL_CLASS} p-6`}>
        <p className="text-sm text-rose-600 dark:text-rose-300">
          {result.error}
        </p>
      </div>
    );
  }

  const previewHeaders = result.sampleRows[0]
    ? Object.keys(result.sampleRows[0])
    : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className="space-y-5"
    >
      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Sampling Summary
            </div>
            <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              {result.configSummary}
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Seed `{config.seed || "datalens"}` keeps the sample reproducible
              across preview refreshes and exports.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void exportSample(tableName, config)}
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Download sampled CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          icon={Table2}
          label="Rows in dataset"
          value={formatNumber(result.totalRows)}
        />
        <SummaryCard
          icon={Layers3}
          label="Rows in sample"
          value={formatNumber(result.sampleSize)}
        />
        <SummaryCard
          icon={Percent}
          label="Sample share"
          value={
            result.totalRows > 0
              ? `${((result.sampleSize / result.totalRows) * 100).toFixed(1)}%`
              : "0%"
          }
        />
      </div>

      <div className={`${GLASS_PANEL_CLASS} overflow-hidden`}>
        <div className="border-b border-white/20 px-5 py-4 dark:border-white/10">
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            Sample preview
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Previewing up to {PREVIEW_LIMIT} sampled rows from the active query.
          </p>
        </div>
        {result.sampleRows.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-500 dark:text-slate-300">
            No sampled rows matched the current configuration.
          </div>
        ) : (
          <div className="overflow-x-auto px-5 py-5">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  {previewHeaders.map((header) => (
                    <th
                      key={header}
                      className="bg-white/60 px-4 py-3 text-left font-semibold text-slate-700 dark:bg-slate-950/45 dark:text-slate-200"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.sampleRows.map((row, index) => (
                  <tr key={`row-${index}`}>
                    {previewHeaders.map((header) => (
                      <td
                        key={`${index}-${header}`}
                        className="border-t border-white/10 px-4 py-3 text-slate-700 dark:text-slate-200"
                      >
                        {String(row[header] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function DataSampler({
  tableName,
  columns,
}: DataSamplerProps) {
  const categoricalColumns = useMemo(
    () => columns.filter(isCategorical),
    [columns],
  );

  const [method, setMethod] = useState<SamplingMethod>("random");
  const [unit, setUnit] = useState<SamplingUnit>("rows");
  const [amountInput, setAmountInput] = useState("100");
  const [seedInput, setSeedInput] = useState("datalens");
  const [stratifyColumn, setStratifyColumn] = useState(
    categoricalColumns[0]?.name ?? "",
  );
  const [intervalInput, setIntervalInput] = useState("10");

  const resolvedStratifyColumn = useMemo(() => {
    if (categoricalColumns.some((column) => column.name === stratifyColumn)) {
      return stratifyColumn;
    }
    return categoricalColumns[0]?.name ?? "";
  }, [categoricalColumns, stratifyColumn]);

  const config = useMemo(
    () =>
      ({
        method,
        unit,
        amount:
          unit === "percent"
            ? Math.max(1, Math.min(100, Math.round(toNumber(amountInput) ?? 10)))
            : Math.max(1, Math.round(toNumber(amountInput) ?? 100)),
        seed: seedInput.trim() || "datalens",
        stratifyColumn: resolvedStratifyColumn,
        interval: Math.max(1, Math.round(toNumber(intervalInput) ?? 10)),
      }) satisfies SamplingConfig,
    [
      amountInput,
      intervalInput,
      method,
      resolvedStratifyColumn,
      seedInput,
      unit,
    ],
  );

  const resource = useMemo(
    () => loadSamplingPreview(tableName, config),
    [config, tableName],
  );

  if (columns.length === 0) {
    return (
      <SamplingEmptyState message="Sampling requires at least one profiled column." />
    );
  }

  if (method === "stratified" && categoricalColumns.length === 0) {
    return (
      <SamplingEmptyState message="Stratified sampling needs a low-cardinality categorical column." />
    );
  }

  return (
    <section className="space-y-5">
      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
              <Shuffle className="h-4 w-4" />
              Data Sampler
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Preview seeded random, stratified, or systematic samples
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Configure the sample size as rows or percent, then export the same
              deterministic sample for downstream work.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Method
              </span>
              <select
                value={method}
                onChange={(event) =>
                  setMethod(event.target.value as SamplingMethod)
                }
                className={FIELD_CLASS}
              >
                <option value="random">Random</option>
                <option value="stratified">Stratified</option>
                <option value="systematic">Systematic</option>
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Unit
              </span>
              <select
                value={unit}
                onChange={(event) =>
                  setUnit(event.target.value as SamplingUnit)
                }
                className={FIELD_CLASS}
              >
                <option value="rows">Rows</option>
                <option value="percent">Percent</option>
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {unit === "percent" ? "Sample percent" : "Sample rows"}
              </span>
              <input
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                className={FIELD_CLASS}
                inputMode="numeric"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Seed
              </span>
              <input
                value={seedInput}
                onChange={(event) => setSeedInput(event.target.value)}
                className={FIELD_CLASS}
              />
            </label>

            {method === "stratified" ? (
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
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
            ) : (
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Interval
                </span>
                <input
                  value={intervalInput}
                  onChange={(event) => setIntervalInput(event.target.value)}
                  className={FIELD_CLASS}
                  inputMode="numeric"
                  disabled={method !== "systematic"}
                />
              </label>
            )}
          </div>
        </div>
      </div>

      <Suspense fallback={<SamplingLoadingState />}>
        <DataSamplerPanel
          resource={resource}
          tableName={tableName}
          config={config}
        />
      </Suspense>
    </section>
  );
}
