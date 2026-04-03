"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Download,
  Eye,
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
  isRecord,
  quoteIdentifier,
  quoteLiteral,
  toCount,
} from "@/lib/utils/advanced-analytics";
import type { ColumnProfile, ColumnType } from "@/types/dataset";

interface MissingValueImputerProps {
  tableName: string;
  columns: ColumnProfile[];
}

type ImputationStrategy =
  | "mean"
  | "median"
  | "mode"
  | "forward_fill"
  | "custom";

interface StrategyConfig {
  strategy: ImputationStrategy;
  customValue: string;
}

interface PreviewRow {
  rowId: number;
  columnName: string;
  originalValue: string;
  imputedValue: string;
}

interface PreviewSummary {
  changedCells: number;
  remainingNulls: number;
}

type StatusState =
  | { kind: "success" | "error"; message: string }
  | null;

const PREVIEW_LIMIT = 12;

function defaultStrategyForType(type: ColumnType): ImputationStrategy {
  if (type === "number") {
    return "mean";
  }
  return "mode";
}

function strategyOptionsForType(type: ColumnType) {
  const options: Array<{ value: ImputationStrategy; label: string }> = [];

  if (type === "number") {
    options.push(
      { value: "mean", label: "Mean" },
      { value: "median", label: "Median" },
    );
  } else {
    options.push({ value: "mode", label: "Mode" });
  }

  options.push(
    { value: "forward_fill", label: "Forward fill" },
    { value: "custom", label: "Custom value" },
  );

  return options;
}

function customPlaceholder(type: ColumnType) {
  if (type === "number") return "Custom number value";
  if (type === "boolean") return "true / false";
  if (type === "date") return "2025-01-01";
  return "Custom text value";
}

function csvEscape(value: string | number) {
  const raw = String(value);
  return raw.includes(",") || raw.includes('"') || raw.includes("\n")
    ? `"${raw.replace(/"/g, '""')}"`
    : raw;
}

function rowsToCsv(rows: PreviewRow[]) {
  return [
    "row_id,column_name,original_value,imputed_value",
    ...rows.map((row) =>
      [
        csvEscape(row.rowId),
        csvEscape(row.columnName),
        csvEscape(row.originalValue),
        csvEscape(row.imputedValue),
      ].join(","),
    ),
  ].join("\n");
}

function buildCustomValueExpression(type: ColumnType, value: string) {
  const literal = quoteLiteral(value.trim());

  if (type === "number") {
    return `TRY_CAST(${literal} AS DOUBLE)`;
  }
  if (type === "boolean") {
    return `TRY_CAST(${literal} AS BOOLEAN)`;
  }
  if (type === "date") {
    return `TRY_CAST(${literal} AS TIMESTAMP)`;
  }

  return literal;
}

function buildImputationQueries(
  tableName: string,
  columns: ColumnProfile[],
  configs: Record<string, StrategyConfig>,
) {
  const nullableColumns = columns.filter((column) => column.nullCount > 0);
  const forwardFillColumns = nullableColumns.filter(
    (column) => configs[column.name]?.strategy === "forward_fill",
  );
  const forwardAliases = new Map(
    forwardFillColumns.map((column, index) => [column.name, `__dli_ff_${index}`]),
  );
  const safeTableName = quoteIdentifier(tableName);
  const windowExpressions = forwardFillColumns.map((column) => {
    const field = quoteIdentifier(column.name);
    const alias = quoteIdentifier(forwardAliases.get(column.name) ?? "");
    return `SUM(CASE WHEN ${field} IS NOT NULL THEN 1 ELSE 0 END) OVER (ORDER BY "__dli_row_id") AS ${alias}`;
  });
  const sourceName = forwardFillColumns.length > 0 ? "windowed" : "base";

  const selectExpressions = columns.flatMap((column) => {
    const safeField = quoteIdentifier(column.name);
    const originalAlias = quoteIdentifier(`__orig_${column.name}`);
    const config = configs[column.name];

    const valueExpression = (() => {
      if (!config) {
        return `${safeField}`;
      }
      if (config.strategy === "mean") {
        return `COALESCE(${safeField}, (SELECT AVG(${safeField}) FROM base WHERE ${safeField} IS NOT NULL))`;
      }
      if (config.strategy === "median") {
        return `COALESCE(${safeField}, (SELECT MEDIAN(${safeField}) FROM base WHERE ${safeField} IS NOT NULL))`;
      }
      if (config.strategy === "mode") {
        return `COALESCE(${safeField}, (SELECT ${safeField} FROM base WHERE ${safeField} IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC, CAST(${safeField} AS VARCHAR) ASC LIMIT 1))`;
      }
      if (config.strategy === "custom") {
        return `COALESCE(${safeField}, ${buildCustomValueExpression(column.type, config.customValue)})`;
      }
      const groupAlias = quoteIdentifier(forwardAliases.get(column.name) ?? "");
      return `COALESCE(${safeField}, MAX(${safeField}) OVER (PARTITION BY ${groupAlias}))`;
    })();

    return [
      `${safeField} AS ${originalAlias}`,
      `${valueExpression} AS ${safeField}`,
    ];
  });

  const filledCte = `
    WITH base AS (
      SELECT *, ROW_NUMBER() OVER () AS "__dli_row_id"
      FROM ${safeTableName}
    )
    ${windowExpressions.length > 0 ? `,
    windowed AS (
      SELECT *,
        ${windowExpressions.join(",\n        ")}
      FROM base
    )` : ""}
    ,
    filled AS (
      SELECT
        "__dli_row_id",
        ${selectExpressions.join(",\n        ")}
      FROM ${sourceName}
    )
  `;

  const previewUnions = nullableColumns.map((column) => {
    const safeField = quoteIdentifier(column.name);
    const originalAlias = quoteIdentifier(`__orig_${column.name}`);
    const escapedName = column.name.replace(/'/g, "''");

    return `
      SELECT
        "__dli_row_id" AS row_id,
        '${escapedName}' AS column_name,
        COALESCE(CAST(${originalAlias} AS VARCHAR), 'null') AS original_value,
        COALESCE(CAST(${safeField} AS VARCHAR), 'null') AS imputed_value
      FROM filled
      WHERE ${originalAlias} IS DISTINCT FROM ${safeField}
    `;
  });

  const summaryExpressions = [
    ...nullableColumns.map((column, index) => {
      const safeField = quoteIdentifier(column.name);
      return `COUNT(*) FILTER (WHERE ${safeField} IS NULL) AS "remaining_${index}"`;
    }),
    ...nullableColumns.map((column, index) => {
      const safeField = quoteIdentifier(column.name);
      const originalAlias = quoteIdentifier(`__orig_${column.name}`);
      return `COUNT(*) FILTER (WHERE ${originalAlias} IS DISTINCT FROM ${safeField}) AS "changed_${index}"`;
    }),
  ];

  return {
    previewSql: `
      ${filledCte}
      ${previewUnions.join("\nUNION ALL\n")}
      ORDER BY row_id, column_name
      LIMIT ${PREVIEW_LIMIT}
    `,
    summarySql: `
      ${filledCte}
      SELECT
        ${summaryExpressions.join(",\n        ")}
      FROM filled
    `,
    applySql: `
      ${filledCte}
      SELECT
        ${columns.map((column) => quoteIdentifier(column.name)).join(",\n        ")}
      FROM filled
      ORDER BY "__dli_row_id"
    `,
  };
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function StrategyCard({
  column,
  config,
  invalidCustom,
  onStrategyChange,
  onCustomValueChange,
}: {
  column: ColumnProfile;
  config: StrategyConfig;
  invalidCustom: boolean;
  onStrategyChange: (columnName: string, strategy: ImputationStrategy) => void;
  onCustomValueChange: (columnName: string, value: string) => void;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">
            {column.name}
          </p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {formatNumber(column.nullCount)} null values · {column.type}
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,220px)_minmax(0,220px)]">
          <select
            value={config.strategy}
            onChange={(event) =>
              onStrategyChange(
                column.name,
                event.target.value as ImputationStrategy,
              )
            }
            className={FIELD_CLASS}
          >
            {strategyOptionsForType(column.type).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {config.strategy === "custom" ? (
            <input
              value={config.customValue}
              onChange={(event) =>
                onCustomValueChange(column.name, event.target.value)
              }
              placeholder={customPlaceholder(column.type)}
              className={`${FIELD_CLASS} ${
                invalidCustom ? "border-rose-400 focus:border-rose-400" : ""
              }`}
            />
          ) : (
            <div className="flex items-center rounded-2xl border border-white/20 bg-white/55 px-4 py-3 text-sm text-slate-500 dark:bg-slate-900/35 dark:text-slate-400">
              {config.strategy === "forward_fill"
                ? "Uses prior observed value"
                : "Column-level statistic"}
            </div>
          )}
        </div>
      </div>
      {invalidCustom ? (
        <p className="mt-3 text-sm font-medium text-rose-700 dark:text-rose-300">
          Enter a value before previewing or applying.
        </p>
      ) : null}
    </div>
  );
}

function PreviewTable({
  rows,
}: {
  rows: PreviewRow[];
}) {
  return (
    <div className="overflow-auto rounded-3xl border border-white/20 bg-white/55 dark:bg-slate-900/35">
      <table className="min-w-full border-collapse">
        <thead className="bg-white/65 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:bg-slate-900/45 dark:text-slate-400">
          <tr>
            <th className="px-4 py-3">Row</th>
            <th className="px-4 py-3">Column</th>
            <th className="px-4 py-3">Original</th>
            <th className="px-4 py-3">Imputed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.rowId}-${row.columnName}`}
              className="border-t border-white/20 text-sm text-slate-700 dark:text-slate-200"
            >
              <td className="px-4 py-3">{row.rowId}</td>
              <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                {row.columnName}
              </td>
              <td className="px-4 py-3">{row.originalValue}</td>
              <td className="px-4 py-3">{row.imputedValue}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MissingValueImputer({
  tableName,
  columns,
}: MissingValueImputerProps) {
  const missingColumns = useMemo(
    () => columns.filter((column) => column.nullCount > 0),
    [columns],
  );
  const [overrides, setOverrides] = useState<Record<string, Partial<StrategyConfig>>>(
    {},
  );
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewSummary, setPreviewSummary] = useState<PreviewSummary | null>(null);
  const [lastPreviewSignature, setLastPreviewSignature] = useState<string | null>(
    null,
  );
  const [status, setStatus] = useState<StatusState>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);

  const configByColumn = useMemo<Record<string, StrategyConfig>>(
    () =>
      Object.fromEntries(
        missingColumns.map((column) => {
          const override = overrides[column.name] ?? {};
          return [
            column.name,
            {
              strategy:
                override.strategy ?? defaultStrategyForType(column.type),
              customValue: override.customValue ?? "",
            },
          ];
        }),
      ),
    [missingColumns, overrides],
  );
  const planSignature = useMemo(
    () =>
      JSON.stringify(
        missingColumns.map((column) => ({
          name: column.name,
          strategy: configByColumn[column.name]?.strategy,
          customValue: configByColumn[column.name]?.customValue ?? "",
        })),
      ),
    [configByColumn, missingColumns],
  );
  const invalidCustomColumns = useMemo(
    () =>
      missingColumns.filter((column) => {
        const config = configByColumn[column.name];
        return (
          config?.strategy === "custom" &&
          config.customValue.trim().length === 0
        );
      }),
    [configByColumn, missingColumns],
  );
  const totalNulls = missingColumns.reduce(
    (sum, column) => sum + column.nullCount,
    0,
  );
  const previewIsCurrent = lastPreviewSignature === planSignature;

  function handleStrategyChange(
    columnName: string,
    strategy: ImputationStrategy,
  ) {
    setOverrides((current) => ({
      ...current,
      [columnName]: {
        ...current[columnName],
        strategy,
      },
    }));
  }

  function handleCustomValueChange(columnName: string, value: string) {
    setOverrides((current) => ({
      ...current,
      [columnName]: {
        ...current[columnName],
        customValue: value,
      },
    }));
  }

  async function handlePreview() {
    if (invalidCustomColumns.length > 0) {
      setStatus({
        kind: "error",
        message: "Enter a value before previewing or applying.",
      });
      return;
    }

    setPreviewing(true);
    setStatus(null);

    try {
      const queries = buildImputationQueries(tableName, columns, configByColumn);
      const [summaryRows, rows] = await Promise.all([
        runQuery(queries.summarySql),
        runQuery(queries.previewSql),
      ]);
      const summaryRow = summaryRows[0];
      const changedCells = missingColumns.reduce((sum, _column, index) => {
        return sum + (isRecord(summaryRow) ? toCount(summaryRow[`changed_${index}`]) : 0);
      }, 0);
      const remainingNulls = missingColumns.reduce((sum, _column, index) => {
        return sum + (isRecord(summaryRow) ? toCount(summaryRow[`remaining_${index}`]) : 0);
      }, 0);
      const mappedRows = rows
        .filter(isRecord)
        .map<PreviewRow>((row) => ({
          rowId: toCount(row.row_id),
          columnName: String(row.column_name ?? ""),
          originalValue: String(row.original_value ?? "null"),
          imputedValue: String(row.imputed_value ?? "null"),
        }));

      setPreviewRows(mappedRows);
      setPreviewSummary({
        changedCells,
        remainingNulls,
      });
      setLastPreviewSignature(planSignature);
      setStatus({
        kind: "success",
        message:
          changedCells > 0
            ? `Preview ready with ${formatNumber(changedCells)} imputed cells.`
            : "Preview generated with no cell-level changes.",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to preview the imputation plan.",
      });
    } finally {
      setPreviewing(false);
    }
  }

  async function handleApply() {
    if (!previewIsCurrent) {
      setStatus({
        kind: "error",
        message: "Run a fresh preview before applying this plan.",
      });
      return;
    }

    setApplying(true);
    setStatus(null);

    const stamp = Date.now();
    const sourceTable = quoteIdentifier(tableName);
    const tempTable = quoteIdentifier(`${tableName}__imputed_${stamp}`);
    const backupTable = quoteIdentifier(`${tableName}__backup_${stamp}`);
    const queries = buildImputationQueries(tableName, columns, configByColumn);

    try {
      await runQuery(`DROP TABLE IF EXISTS ${tempTable}`);
      await runQuery(`DROP TABLE IF EXISTS ${backupTable}`);
      await runQuery(`CREATE TABLE ${tempTable} AS ${queries.applySql}`);
      await runQuery(`ALTER TABLE ${sourceTable} RENAME TO ${backupTable}`);

      try {
        await runQuery(`ALTER TABLE ${tempTable} RENAME TO ${sourceTable}`);
        await runQuery(`DROP TABLE ${backupTable}`);
      } catch (swapError) {
        await runQuery(`ALTER TABLE ${backupTable} RENAME TO ${sourceTable}`).catch(
          () => undefined,
        );
        await runQuery(`DROP TABLE IF EXISTS ${tempTable}`).catch(
          () => undefined,
        );
        throw swapError;
      }

      setStatus({
        kind: "success",
        message: `Applied the imputation plan to ${tableName}.`,
      });
    } catch (error) {
      await runQuery(`DROP TABLE IF EXISTS ${tempTable}`).catch(() => undefined);
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to apply the imputation plan.",
      });
    } finally {
      setApplying(false);
    }
  }

  function handleExport() {
    if (!previewIsCurrent || previewRows.length === 0) {
      setStatus({
        kind: "error",
        message: "Generate a preview before exporting the comparison CSV.",
      });
      return;
    }

    downloadFile(
      rowsToCsv(previewRows),
      `${tableName}-imputation-preview.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  if (missingColumns.length === 0) {
    return (
      <section className={`${GLASS_PANEL_CLASS} p-6`}>
        <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
          Missing Value Imputer
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
          No missing values were detected, so there is nothing to impute.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
              Missing Value Repair
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
              Missing Value Imputer
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Configure a per-column strategy, preview how nulls would be
              rewritten, then apply the plan directly inside DuckDB.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handlePreview}
              disabled={previewing || applying}
              className={BUTTON_CLASS}
            >
              <Eye className="h-4 w-4" />
              Preview
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!previewIsCurrent || previewRows.length === 0}
              className={BUTTON_CLASS}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!previewIsCurrent || applying}
              className={`${BUTTON_CLASS} bg-cyan-600 text-white hover:bg-cyan-500 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400`}
            >
              <Wand2 className="h-4 w-4" />
              Apply
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Columns with Nulls"
          value={formatNumber(missingColumns.length)}
        />
        <SummaryCard
          label="Null Cells"
          value={formatNumber(totalNulls)}
        />
        <SummaryCard
          label="Changed Cells"
          value={formatNumber(
            previewIsCurrent ? previewSummary?.changedCells ?? 0 : 0,
          )}
        />
        <SummaryCard
          label="Remaining Nulls"
          value={formatNumber(
            previewIsCurrent ? previewSummary?.remainingNulls ?? totalNulls : totalNulls,
          )}
        />
      </div>

      <div className="grid gap-4">
        {missingColumns.map((column) => (
          <StrategyCard
            key={column.name}
            column={column}
            config={configByColumn[column.name] ?? {
              strategy: defaultStrategyForType(column.type),
              customValue: "",
            }}
            invalidCustom={invalidCustomColumns.some(
              (entry) => entry.name === column.name,
            )}
            onStrategyChange={handleStrategyChange}
            onCustomValueChange={handleCustomValueChange}
          />
        ))}
      </div>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
        className={`${GLASS_PANEL_CLASS} p-5`}
      >
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 text-cyan-600 dark:text-cyan-300" />
          <div>
            <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
              Preview: original vs imputed
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              The preview shows the first {PREVIEW_LIMIT} changed cells for the
              current configuration.
            </p>
          </div>
        </div>

        {status ? (
          <p
            className={`mt-4 text-sm font-medium ${
              status.kind === "error"
                ? "text-rose-700 dark:text-rose-300"
                : "text-emerald-700 dark:text-emerald-300"
            }`}
          >
            {status.message}
          </p>
        ) : null}

        {previewIsCurrent && previewRows.length > 0 ? (
          <div className="mt-4">
            <PreviewTable rows={previewRows} />
          </div>
        ) : (
          <div className="mt-4 rounded-3xl border border-dashed border-white/20 bg-white/40 px-4 py-8 text-sm text-slate-500 dark:bg-slate-900/25 dark:text-slate-400">
            Run a preview to compare original and imputed values.
          </div>
        )}
      </motion.section>
    </section>
  );
}
