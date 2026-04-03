"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Download,
  Filter,
  Sparkles,
  Sigma,
  Wand2,
  type LucideIcon,
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
  toCount,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface OutlierRemovalProps {
  tableName: string;
  columns: ColumnProfile[];
}

type RemovalMethod = "iqr" | "zscore" | "percentile";

interface RemovalConfig {
  method: RemovalMethod;
  zScoreThreshold: number;
  percentileTail: number;
}

interface RemovalSummary {
  totalRows: number;
  analyzedRows: number;
  removedRows: number;
  cleanRows: number;
  meanBefore: number | null;
  meanAfter: number | null;
  stddevBefore: number | null;
  stddevAfter: number | null;
  minBefore: number | null;
  minAfter: number | null;
  maxBefore: number | null;
  maxAfter: number | null;
}

interface PreviewResult {
  columnName: string;
  config: RemovalConfig;
  summary: RemovalSummary;
  rows: Record<string, unknown>[];
}

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: PreviewResult }
  | { status: "error"; message: string };

type ApplyState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; tableName: string }
  | { status: "error"; message: string };

interface SummaryCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
}

interface ComparisonRow {
  label: string;
  beforeValue: number | null;
  afterValue: number | null;
}

const PREVIEW_LIMIT = 12;

const METHOD_OPTIONS = [
  { value: "iqr", label: "IQR" },
  { value: "zscore", label: "Z-score" },
  { value: "percentile", label: "Percentile" },
] as const satisfies ReadonlyArray<{ value: RemovalMethod; label: string }>;

function formatMetric(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return Math.abs(value) >= 1000 || Number.isInteger(value)
    ? formatNumber(value)
    : value.toFixed(3);
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return "";

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

function methodLabel(method: RemovalMethod) {
  const match = METHOD_OPTIONS.find((option) => option.value === method);
  return match?.label ?? "IQR";
}

function normalizePreviewRows(rows: Record<string, unknown>[]) {
  return rows.map((row) => {
    const normalized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(row)) {
      if (key === "__is_outlier") continue;
      if (key === "__row_id") {
        normalized.row_id = value;
        continue;
      }
      if (key === "__metric") {
        normalized.metric_value = value;
        continue;
      }

      normalized[key] = value;
    }

    return normalized;
  });
}

function buildComparisonRows(summary: RemovalSummary): ComparisonRow[] {
  return [
    {
      label: "Mean",
      beforeValue: summary.meanBefore,
      afterValue: summary.meanAfter,
    },
    {
      label: "Std dev",
      beforeValue: summary.stddevBefore,
      afterValue: summary.stddevAfter,
    },
    {
      label: "Minimum",
      beforeValue: summary.minBefore,
      afterValue: summary.minAfter,
    },
    {
      label: "Maximum",
      beforeValue: summary.maxBefore,
      afterValue: summary.maxAfter,
    },
  ];
}

function buildAnalysisCtes(
  tableName: string,
  columnName: string,
  config: RemovalConfig,
) {
  const safeTableName = quoteIdentifier(tableName);
  const safeColumnName = quoteIdentifier(columnName);
  const percentileLow = (config.percentileTail / 100).toFixed(4);
  const percentileHigh = (1 - config.percentileTail / 100).toFixed(4);

  const condition =
    config.method === "zscore"
      ? `
          CASE
            WHEN total_numeric_rows = 0 OR stddev_before IS NULL OR stddev_before = 0 THEN FALSE
            ELSE ABS((__metric - mean_before) / stddev_before) >= ${config.zScoreThreshold}
          END
        `
      : config.method === "percentile"
        ? `
            CASE
              WHEN total_numeric_rows = 0 OR lower_percentile IS NULL OR upper_percentile IS NULL THEN FALSE
              ELSE __metric < lower_percentile OR __metric > upper_percentile
            END
          `
        : `
            CASE
              WHEN total_numeric_rows = 0 OR q1 IS NULL OR q3 IS NULL THEN FALSE
              ELSE __metric < q1 - 1.5 * (q3 - q1) OR __metric > q3 + 1.5 * (q3 - q1)
            END
          `;

  return `
    WITH numbered AS (
      SELECT ROW_NUMBER() OVER () AS __row_id, *
      FROM ${safeTableName}
    ),
    metrics AS (
      SELECT __row_id, TRY_CAST(${safeColumnName} AS DOUBLE) AS __metric
      FROM numbered
    ),
    usable AS (
      SELECT __row_id, __metric
      FROM metrics
      WHERE __metric IS NOT NULL
    ),
    stats AS (
      SELECT
        COUNT(*) AS total_numeric_rows,
        AVG(__metric) AS mean_before,
        COALESCE(STDDEV_SAMP(__metric), 0) AS stddev_before,
        MIN(__metric) AS min_before,
        MAX(__metric) AS max_before,
        QUANTILE_CONT(__metric, 0.25) AS q1,
        MEDIAN(__metric) AS median_before,
        QUANTILE_CONT(__metric, 0.75) AS q3,
        QUANTILE_CONT(__metric, ${percentileLow}) AS lower_percentile,
        QUANTILE_CONT(__metric, ${percentileHigh}) AS upper_percentile
      FROM usable
    ),
    scored AS (
      SELECT
        numbered.*,
        metrics.__metric,
        ${condition} AS __is_outlier
      FROM numbered
      LEFT JOIN metrics USING (__row_id)
      CROSS JOIN stats
    )
  `;
}

function buildSummarySql(
  tableName: string,
  columnName: string,
  config: RemovalConfig,
) {
  return `
    ${buildAnalysisCtes(tableName, columnName, config)},
    after_stats AS (
      SELECT
        COUNT(*) FILTER (WHERE __metric IS NOT NULL) AS clean_numeric_rows,
        AVG(__metric) FILTER (WHERE __metric IS NOT NULL) AS mean_after,
        COALESCE(STDDEV_SAMP(__metric) FILTER (WHERE __metric IS NOT NULL), 0) AS stddev_after,
        MIN(__metric) FILTER (WHERE __metric IS NOT NULL) AS min_after,
        MAX(__metric) FILTER (WHERE __metric IS NOT NULL) AS max_after
      FROM scored
      WHERE NOT __is_outlier
    )
    SELECT
      (SELECT COUNT(*) FROM numbered) AS total_rows,
      total_numeric_rows,
      (SELECT COUNT(*) FROM scored WHERE __is_outlier) AS removed_rows,
      (SELECT COUNT(*) FROM numbered) - (SELECT COUNT(*) FROM scored WHERE __is_outlier) AS clean_rows,
      mean_before,
      stddev_before,
      min_before,
      max_before,
      clean_numeric_rows,
      mean_after,
      stddev_after,
      min_after,
      max_after
    FROM stats
    CROSS JOIN after_stats
  `;
}

function buildPreviewSql(
  tableName: string,
  columnName: string,
  config: RemovalConfig,
) {
  return `
    ${buildAnalysisCtes(tableName, columnName, config)}
    SELECT *
    FROM scored
    WHERE __is_outlier
    ORDER BY ABS(__metric - COALESCE((SELECT median_before FROM stats), (SELECT mean_before FROM stats), 0)) DESC, __row_id
    LIMIT ${PREVIEW_LIMIT}
  `;
}

function buildApplySql(
  tableName: string,
  columnName: string,
  outputTableName: string,
  config: RemovalConfig,
) {
  return `
    CREATE TABLE ${quoteIdentifier(outputTableName)} AS
    ${buildAnalysisCtes(tableName, columnName, config)}
    SELECT * EXCLUDE (__row_id, __metric, __is_outlier)
    FROM scored
    WHERE NOT __is_outlier
    ORDER BY __row_id
  `;
}

async function loadRemovalPreview(
  tableName: string,
  columnName: string,
  config: RemovalConfig,
): Promise<PreviewResult> {
  const [summaryRows, previewRows] = await Promise.all([
    runQuery(buildSummarySql(tableName, columnName, config)),
    runQuery(buildPreviewSql(tableName, columnName, config)),
  ]);

  const summaryRecord = isRecord(summaryRows[0]) ? summaryRows[0] : {};
  const summary: RemovalSummary = {
    totalRows: toCount(summaryRecord.total_rows),
    analyzedRows: toCount(summaryRecord.total_numeric_rows),
    removedRows: toCount(summaryRecord.removed_rows),
    cleanRows: toCount(summaryRecord.clean_rows),
    meanBefore: toNumber(summaryRecord.mean_before),
    meanAfter: toNumber(summaryRecord.mean_after),
    stddevBefore: toNumber(summaryRecord.stddev_before),
    stddevAfter: toNumber(summaryRecord.stddev_after),
    minBefore: toNumber(summaryRecord.min_before),
    minAfter: toNumber(summaryRecord.min_after),
    maxBefore: toNumber(summaryRecord.max_before),
    maxAfter: toNumber(summaryRecord.max_after),
  };

  const normalizedRows = normalizePreviewRows(
    previewRows.filter(isRecord),
  );

  return {
    columnName,
    config,
    summary,
    rows: normalizedRows,
  };
}

async function applyRemoval(
  tableName: string,
  columnName: string,
  config: RemovalConfig,
) {
  const cleanTableName = `${tableName}__clean_${Date.now()}`;
  await runQuery(`DROP TABLE IF EXISTS ${quoteIdentifier(cleanTableName)}`);
  await runQuery(buildApplySql(tableName, columnName, cleanTableName, config));
  return cleanTableName;
}

function OutlierRemovalEmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Outlier Removal
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {message}
          </p>
        </div>
      </div>
    </section>
  );
}

function SummaryCard({ icon: Icon, label, value, detail }: SummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
        {value}
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{detail}</p>
    </div>
  );
}

function StatsComparisonTable({ summary }: { summary: RemovalSummary }) {
  const rows = buildComparisonRows(summary);

  return (
    <div className={`${GLASS_PANEL_CLASS} overflow-hidden`}>
      <div className="border-b border-white/20 px-5 py-4 dark:border-white/10">
        <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
          Before / after stats
        </h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Comparing the selected numeric column before and after outlier removal.
        </p>
      </div>
      <div className="overflow-x-auto px-5 py-5">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              <th className="px-3 py-2">Metric</th>
              <th className="px-3 py-2">Before</th>
              <th className="px-3 py-2">After</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-white/10">
                <td className="px-3 py-3 font-medium text-slate-700 dark:text-slate-200">
                  {row.label}
                </td>
                <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                  {formatMetric(row.beforeValue)}
                </td>
                <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                  {formatMetric(row.afterValue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PreviewTable({ rows }: { rows: Record<string, unknown>[] }) {
  const headers = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <div className={`${GLASS_PANEL_CLASS} overflow-hidden`}>
      <div className="border-b border-white/20 px-5 py-4 dark:border-white/10">
        <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
          Rows marked for removal
        </h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Previewing up to {PREVIEW_LIMIT} flagged rows before any table is created.
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-6 text-sm text-emerald-700 dark:text-emerald-300">
          No rows are currently flagged by the active thresholds.
        </div>
      ) : (
        <div className="overflow-x-auto px-5 py-5">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                {headers.map((header) => (
                  <th key={header} className="px-3 py-2">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`preview-row-${rowIndex}`} className="border-t border-white/10">
                  {headers.map((header) => (
                    <td
                      key={`${rowIndex}-${header}`}
                      className="px-3 py-3 text-slate-700 dark:text-slate-200"
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
  );
}

export default function OutlierRemoval({
  tableName,
  columns,
}: OutlierRemovalProps) {
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [selectedColumn, setSelectedColumn] = useState(
    numericColumns[0]?.name ?? "",
  );
  const [method, setMethod] = useState<RemovalMethod>("iqr");
  const [zScoreInput, setZScoreInput] = useState("3");
  const [percentileInput, setPercentileInput] = useState("5");
  const [previewState, setPreviewState] = useState<PreviewState>({
    status: "idle",
  });
  const [applyState, setApplyState] = useState<ApplyState>({
    status: "idle",
  });

  const resolvedColumn = useMemo(() => {
    if (numericColumns.some((column) => column.name === selectedColumn)) {
      return selectedColumn;
    }
    return numericColumns[0]?.name ?? "";
  }, [numericColumns, selectedColumn]);

  const config = useMemo<RemovalConfig>(
    () => ({
      method,
      zScoreThreshold: Math.max(1, toNumber(zScoreInput) ?? 3),
      percentileTail: Math.min(20, Math.max(1, toNumber(percentileInput) ?? 5)),
    }),
    [method, percentileInput, zScoreInput],
  );

  function resetExecutionState() {
    setPreviewState({ status: "idle" });
    setApplyState({ status: "idle" });
  }

  async function handlePreview() {
    if (!resolvedColumn) {
      setPreviewState({
        status: "error",
        message: "Select a numeric column to preview outlier removal.",
      });
      return;
    }

    setApplyState({ status: "idle" });
    setPreviewState({ status: "loading" });

    try {
      const result = await loadRemovalPreview(tableName, resolvedColumn, config);
      startTransition(() => {
        setPreviewState({ status: "ready", result });
      });
    } catch (error) {
      startTransition(() => {
        setPreviewState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to preview outlier removal.",
        });
      });
    }
  }

  async function handleApply() {
    if (previewState.status !== "ready") return;

    setApplyState({ status: "loading" });

    try {
      const cleanTableName = await applyRemoval(
        tableName,
        previewState.result.columnName,
        previewState.result.config,
      );
      startTransition(() => {
        setApplyState({ status: "success", tableName: cleanTableName });
      });
    } catch (error) {
      startTransition(() => {
        setApplyState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create the clean table.",
        });
      });
    }
  }

  function handleExport() {
    if (previewState.status !== "ready") return;

    downloadFile(
      buildCsv(previewState.result.rows),
      `${tableName}-${previewState.result.columnName}-outliers.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  if (numericColumns.length === 0) {
    return (
      <OutlierRemovalEmptyState message="No numeric columns are available for outlier removal." />
    );
  }

  const previewReady = previewState.status === "ready" ? previewState.result : null;
  const removedShare =
    previewReady && previewReady.summary.analyzedRows > 0
      ? (previewReady.summary.removedRows / previewReady.summary.analyzedRows) * 100
      : 0;

  return (
    <section className="space-y-5">
      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
              <Wand2 className="h-4 w-4" />
              Outlier Removal
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Preview a clean table before you remove extreme rows
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Choose a numeric column, compare IQR, Z-score, or percentile
              thresholds, then create a clean table without mutating the source.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Numeric column
              </span>
              <select
                aria-label="Numeric column"
                value={resolvedColumn}
                onChange={(event) => {
                  setSelectedColumn(event.target.value);
                  resetExecutionState();
                }}
                className={FIELD_CLASS}
              >
                {numericColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Method
              </span>
              <select
                aria-label="Method"
                value={method}
                onChange={(event) => {
                  setMethod(event.target.value as RemovalMethod);
                  resetExecutionState();
                }}
                className={FIELD_CLASS}
              >
                {METHOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Z-score threshold
              </span>
              <input
                aria-label="Z-score threshold"
                value={zScoreInput}
                onChange={(event) => {
                  setZScoreInput(event.target.value);
                  resetExecutionState();
                }}
                className={FIELD_CLASS}
                inputMode="decimal"
                disabled={method !== "zscore"}
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Tail percentile
              </span>
              <input
                aria-label="Tail percentile"
                value={percentileInput}
                onChange={(event) => {
                  setPercentileInput(event.target.value);
                  resetExecutionState();
                }}
                className={FIELD_CLASS}
                inputMode="decimal"
                disabled={method !== "percentile"}
              />
            </label>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handlePreview()}
            className={BUTTON_CLASS}
            disabled={previewState.status === "loading"}
          >
            <Sparkles className="h-4 w-4" />
            Preview removal
          </button>
          <button
            type="button"
            onClick={handleExport}
            className={BUTTON_CLASS}
            disabled={previewState.status !== "ready"}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void handleApply()}
            className={BUTTON_CLASS}
            disabled={previewState.status !== "ready" || applyState.status === "loading"}
          >
            <Wand2 className="h-4 w-4" />
            Apply clean table
          </button>
        </div>
      </div>

      {previewState.status === "idle" ? (
        <OutlierRemovalEmptyState message="Run a preview to inspect which rows would be removed and how the distribution changes." />
      ) : null}

      {previewState.status === "loading" ? (
        <div className={`${GLASS_PANEL_CLASS} p-6 text-sm text-slate-600 dark:text-slate-300`}>
          Building removal preview…
        </div>
      ) : null}

      {previewState.status === "error" ? (
        <div className={`${GLASS_PANEL_CLASS} p-6 text-sm text-rose-600 dark:text-rose-300`}>
          {previewState.message}
        </div>
      ) : null}

      {previewReady ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
          className="space-y-5"
        >
          <div className="grid gap-4 md:grid-cols-3">
            <SummaryCard
              icon={Filter}
              label="Method"
              value={methodLabel(previewReady.config.method)}
              detail={`Preview ready for ${formatNumber(previewReady.summary.removedRows)} rows.`}
            />
            <SummaryCard
              icon={AlertTriangle}
              label="Rows removed"
              value={formatNumber(previewReady.summary.removedRows)}
              detail={`${formatPercent(removedShare, 1)} of analyzed numeric rows`}
            />
            <SummaryCard
              icon={Sigma}
              label="Clean table size"
              value={formatNumber(previewReady.summary.cleanRows)}
              detail={`${formatNumber(previewReady.summary.totalRows)} source rows across the full table`}
            />
          </div>

          <StatsComparisonTable summary={previewReady.summary} />
          <PreviewTable rows={previewReady.rows} />

          {applyState.status === "success" ? (
            <div className={`${GLASS_PANEL_CLASS} p-6 text-sm text-emerald-700 dark:text-emerald-300`}>
              {`Created clean table ${applyState.tableName}.`}
            </div>
          ) : null}

          {applyState.status === "loading" ? (
            <div className={`${GLASS_PANEL_CLASS} p-6 text-sm text-slate-600 dark:text-slate-300`}>
              Creating clean table…
            </div>
          ) : null}

          {applyState.status === "error" ? (
            <div className={`${GLASS_PANEL_CLASS} p-6 text-sm text-rose-600 dark:text-rose-300`}>
              {applyState.message}
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </section>
  );
}
