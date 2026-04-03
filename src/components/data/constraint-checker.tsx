"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
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
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface ConstraintCheckerProps {
  tableName: string;
  columns: ColumnProfile[];
}

type CheckOperator = "equals" | "greater_than" | "between";

interface ConstraintResult {
  name: string;
  passed: boolean;
  violationCount: number;
  detail: string;
}

interface SummaryCardProps {
  label: string;
  value: string;
}

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

function csvEscape(value: string | number) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function resultsToCsv(results: ConstraintResult[]) {
  return [
    "rule_name,status,violation_count,detail",
    ...results.map((result) =>
      [
        csvEscape(result.name),
        result.passed ? "pass" : "fail",
        result.violationCount,
        csvEscape(result.detail),
      ].join(","),
    ),
  ].join("\n");
}

function buildCheckPredicate(
  columnName: string,
  columnType: ColumnProfile["type"],
  operator: CheckOperator,
  value: string,
  secondValue: string,
) {
  const safeColumn = quoteIdentifier(columnName);

  if (columnType === "number") {
    const firstValue = Number(value);
    const second = Number(secondValue);

    if (!Number.isFinite(firstValue)) {
      return "TRUE";
    }
    if (operator === "greater_than") {
      return `TRY_CAST(${safeColumn} AS DOUBLE) > ${firstValue}`;
    }
    if (operator === "between" && Number.isFinite(second)) {
      return `TRY_CAST(${safeColumn} AS DOUBLE) BETWEEN ${Math.min(firstValue, second)} AND ${Math.max(firstValue, second)}`;
    }
    return `TRY_CAST(${safeColumn} AS DOUBLE) = ${firstValue}`;
  }

  const literal = quoteLiteral(value);
  if (operator === "greater_than") {
    return `CAST(${safeColumn} AS VARCHAR) > ${literal}`;
  }
  if (operator === "between" && secondValue.trim()) {
    return `CAST(${safeColumn} AS VARCHAR) BETWEEN ${literal} AND ${quoteLiteral(secondValue)}`;
  }
  return `CAST(${safeColumn} AS VARCHAR) = ${literal}`;
}

export default function ConstraintChecker({
  tableName,
  columns,
}: ConstraintCheckerProps) {
  const categoricalColumns = useMemo(
    () => columns.filter((column) => column.type !== "number" || column.uniqueCount <= 30),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [primaryKeyColumn, setPrimaryKeyColumn] = useState(
    columns[0]?.name ?? "",
  );
  const [foreignKeyColumn, setForeignKeyColumn] = useState(
    categoricalColumns[0]?.name ?? columns[0]?.name ?? "",
  );
  const [referenceTable, setReferenceTable] = useState("customers");
  const [referenceColumn, setReferenceColumn] = useState("id");
  const [checkColumn, setCheckColumn] = useState(
    numericColumns[0]?.name ?? columns[0]?.name ?? "",
  );
  const [checkOperator, setCheckOperator] = useState<CheckOperator>("greater_than");
  const [checkValue, setCheckValue] = useState("0");
  const [secondCheckValue, setSecondCheckValue] = useState("100");
  const [notNullColumns, setNotNullColumns] = useState<string[]>(
    columns.slice(0, 2).map((column) => column.name),
  );
  const [results, setResults] = useState<ConstraintResult[]>([]);
  const [status, setStatus] = useState(
    "Validate core constraints before publishing downstream models or reports.",
  );
  const [loading, setLoading] = useState(false);

  const checkColumnType =
    columns.find((column) => column.name === checkColumn)?.type ?? "string";

  function toggleNotNullColumn(columnName: string) {
    setNotNullColumns((current) =>
      current.includes(columnName)
        ? current.filter((value) => value !== columnName)
        : [...current, columnName],
    );
  }

  async function handleRunValidation() {
    if (!primaryKeyColumn || !checkColumn) {
      setStatus("Choose columns for the primary key and check constraints.");
      return;
    }

    setLoading(true);
    setStatus("Running constraint validation...");

    try {
      const primaryKeyRows = await runQuery(`
        SELECT COUNT(*) AS violation_count
        FROM (
          SELECT ${quoteIdentifier(primaryKeyColumn)}
          FROM ${quoteIdentifier(tableName)}
          GROUP BY 1
          HAVING ${quoteIdentifier(primaryKeyColumn)} IS NULL OR COUNT(*) > 1
        )
      `);
      const primaryKeyViolations = toCount(primaryKeyRows[0]?.violation_count);

      const foreignKeyRows = referenceTable.trim() && referenceColumn.trim()
        ? await runQuery(`
            SELECT COUNT(*) AS violation_count
            FROM ${quoteIdentifier(tableName)} base
            WHERE ${quoteIdentifier(foreignKeyColumn)} IS NOT NULL
              AND CAST(${quoteIdentifier(foreignKeyColumn)} AS VARCHAR) NOT IN (
                SELECT CAST(${quoteIdentifier(referenceColumn)} AS VARCHAR)
                FROM ${quoteIdentifier(referenceTable)}
              )
          `)
        : [{ violation_count: 0 }];
      const foreignKeyViolations = toCount(foreignKeyRows[0]?.violation_count);

      const checkRows = await runQuery(`
        SELECT COUNT(*) AS violation_count
        FROM ${quoteIdentifier(tableName)}
        WHERE ${quoteIdentifier(checkColumn)} IS NOT NULL
          AND NOT (${buildCheckPredicate(
            checkColumn,
            checkColumnType,
            checkOperator,
            checkValue,
            secondCheckValue,
          )})
      `);
      const checkViolations = toCount(checkRows[0]?.violation_count);

      const notNullRows = notNullColumns.length > 0
        ? await runQuery(`
            SELECT COUNT(*) AS violation_count
            FROM ${quoteIdentifier(tableName)}
            WHERE ${notNullColumns
              .map((columnName) => `${quoteIdentifier(columnName)} IS NULL`)
              .join(" OR ")}
          `)
        : [{ violation_count: 0 }];
      const notNullViolations = toCount(notNullRows[0]?.violation_count);

      startTransition(() => {
        setResults([
          {
            name: `Primary key uniqueness (${primaryKeyColumn})`,
            passed: primaryKeyViolations === 0,
            violationCount: primaryKeyViolations,
            detail:
              primaryKeyViolations === 0
                ? "No duplicate or null primary key values found."
                : "Duplicate or null primary key candidates detected.",
          },
          {
            name: `Foreign key references (${foreignKeyColumn})`,
            passed: foreignKeyViolations === 0,
            violationCount: foreignKeyViolations,
            detail:
              foreignKeyViolations === 0
                ? `All values resolved against ${referenceTable}.${referenceColumn}.`
                : "Reference misses were found in the selected foreign key column.",
          },
          {
            name: `Check constraint (${checkColumn})`,
            passed: checkViolations === 0,
            violationCount: checkViolations,
            detail:
              checkViolations === 0
                ? "All inspected values satisfy the configured rule."
                : "Values outside the accepted range or match were found.",
          },
          {
            name: "Not null constraint",
            passed: notNullViolations === 0,
            violationCount: notNullViolations,
            detail:
              notNullViolations === 0
                ? "All monitored columns are fully populated."
                : "Nulls remain in one or more required columns.",
          },
        ]);
        setStatus("Constraint validation completed.");
      });
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to validate data constraints.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (results.length === 0) return;
    downloadFile(
      resultsToCsv(results),
      `${tableName}-constraint-report.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  const passingRules = results.filter((result) => result.passed).length;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-4 border-b border-white/20 pb-5 dark:border-white/10 xl:flex-row xl:items-center xl:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            Constraint Checker
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
              Validate structural data rules before delivery
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Combine primary key, foreign key, check, and not-null validation
              in one repeatable DuckDB pass.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              void handleRunValidation();
            }}
            disabled={loading}
            className={`${BUTTON_CLASS} bg-emerald-600 text-white hover:bg-emerald-500 dark:bg-emerald-600 dark:text-white`}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            Run validation
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={results.length === 0}
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export report
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-white/60 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
        {status}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-6">
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Rule definitions
            </p>
            <div className="mt-4 grid gap-4">
              <select
                aria-label="Primary key column"
                value={primaryKeyColumn}
                onChange={(event) => setPrimaryKeyColumn(event.currentTarget.value)}
                className={FIELD_CLASS}
              >
                {columns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>

              <div className="grid gap-3 md:grid-cols-3">
                <select
                  aria-label="Foreign key column"
                  value={foreignKeyColumn}
                  onChange={(event) => setForeignKeyColumn(event.currentTarget.value)}
                  className={FIELD_CLASS}
                >
                  {columns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Reference table"
                  value={referenceTable}
                  onChange={(event) => setReferenceTable(event.currentTarget.value)}
                  className={FIELD_CLASS}
                  placeholder="Reference table"
                />
                <input
                  aria-label="Reference column"
                  value={referenceColumn}
                  onChange={(event) => setReferenceColumn(event.currentTarget.value)}
                  className={FIELD_CLASS}
                  placeholder="Reference column"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <select
                  aria-label="Check constraint column"
                  value={checkColumn}
                  onChange={(event) => setCheckColumn(event.currentTarget.value)}
                  className={FIELD_CLASS}
                >
                  {columns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Check operator"
                  value={checkOperator}
                  onChange={(event) =>
                    setCheckOperator(event.currentTarget.value as CheckOperator)
                  }
                  className={FIELD_CLASS}
                >
                  <option value="equals">Equals</option>
                  <option value="greater_than">Greater than</option>
                  <option value="between">Between</option>
                </select>
                <input
                  aria-label="Check value"
                  value={checkValue}
                  onChange={(event) => setCheckValue(event.currentTarget.value)}
                  className={FIELD_CLASS}
                />
                <input
                  aria-label="Second check value"
                  value={secondCheckValue}
                  onChange={(event) => setSecondCheckValue(event.currentTarget.value)}
                  className={FIELD_CLASS}
                  disabled={checkOperator !== "between"}
                />
              </div>
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Not-null columns
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {columns.map((column) => {
                const active = notNullColumns.includes(column.name);
                return (
                  <button
                    key={column.name}
                    type="button"
                    onClick={() => toggleNotNullColumn(column.name)}
                    className={`rounded-full border px-3 py-2 text-sm transition ${
                      active
                        ? "border-emerald-400 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "border-white/20 bg-white/70 text-slate-700 dark:border-white/10 dark:bg-slate-950/45 dark:text-slate-200"
                    }`}
                  >
                    {column.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryCard label="Rules Passing" value={`${passingRules}/4`} />
            <SummaryCard
              label="Violations Found"
              value={formatNumber(
                results.reduce((sum, result) => sum + result.violationCount, 0),
              )}
            />
          </div>

          <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
            <div className="border-b border-white/15 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                Validation results
              </h3>
            </div>
            {results.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                Run validation to see pass or fail results across all configured constraints.
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {results.map((result) => (
                  <div key={result.name} className="flex gap-4 px-5 py-4">
                    <div className="pt-0.5">
                      {result.passed ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-amber-500" />
                      )}
                    </div>
                    <div className="space-y-1">
                      <div className="font-medium text-slate-950 dark:text-white">
                        {result.name}
                      </div>
                      <div className="text-sm text-slate-600 dark:text-slate-300">
                        {result.detail}
                      </div>
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Violations: {formatNumber(result.violationCount)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
