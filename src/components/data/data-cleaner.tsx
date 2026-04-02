"use client";

import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BadgeInfo,
  CheckCircle2,
  DatabaseZap,
  Eraser,
  Eye,
  History,
  Loader2,
  RotateCcw,
  Sparkles,
  Wand2,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile, ColumnType } from "@/types/dataset";

interface DataCleanerProps {
  tableName: string;
  columns: ColumnProfile[];
  onCleanComplete?: () => void;
}

type Severity = "critical" | "warning" | "info";
type IssueType = "nulls" | "duplicates" | "outliers" | "type_mismatches" | "whitespace";
type NullStrategy = "mean" | "median" | "mode" | "custom";
type InferredType = Exclude<ColumnType, "string" | "unknown">;
type Notice = { tone: "success" | "error" | "info"; message: string } | null;

interface TypeCandidate {
  target: InferredType;
  validCount: number;
  invalidCount: number;
  nonNullCount: number;
}

interface DataIssue {
  id: string;
  type: IssueType;
  severity: Severity;
  columnName: string;
  description: string;
  affectedRows: number;
  suggestedFix: string;
  duplicateGroups?: number;
  outlierBounds?: { lower: number; upper: number };
  typeCandidate?: TypeCandidate;
}

interface PreviewSample {
  id: string;
  before: string;
  after: string;
  detail: string;
}

interface PreviewState {
  issueId: string;
  title: string;
  sql: string;
  rows: PreviewSample[];
}

interface HistoryEntry {
  id: string;
  issueId: string;
  label: string;
  affectedRows: number;
  backupTable: string;
  createdAt: number;
}

const EASE = [0.16, 1, 0.3, 1] as const;
const PREVIEW_LIMIT = 6;
const SEVERITY_STYLES: Record<Severity, string> = {
  critical:
    "border-red-400/30 bg-red-500/10 text-red-700 dark:border-red-500/30 dark:text-red-300",
  warning:
    "border-amber-400/30 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:text-amber-300",
  info: "border-sky-400/30 bg-sky-500/10 text-sky-700 dark:border-sky-500/30 dark:text-sky-300",
};

function quoteId(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function escapeLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function literalForType(value: string, type: ColumnType): string {
  const escaped = escapeLiteral(value.trim());
  if (type === "number") return `TRY_CAST('${escaped}' AS DOUBLE)`;
  if (type === "boolean") return `TRY_CAST('${escaped}' AS BOOLEAN)`;
  if (type === "date") return `TRY_CAST('${escaped}' AS TIMESTAMP)`;
  return `'${escaped}'`;
}

function nullSeverity(rate: number): Severity {
  if (rate >= 0.2) return "critical";
  if (rate >= 0.05) return "warning";
  return "info";
}

function countSeverity(rate: number, count: number): Severity {
  if (count === 0) return "info";
  if (rate >= 0.05 || count >= 100) return "critical";
  if (rate >= 0.01 || count >= 20) return "warning";
  return "info";
}

function defaultNullStrategy(column: ColumnProfile): NullStrategy {
  if (column.type === "number") return "median";
  if (column.type === "string") return "mode";
  return "custom";
}

function rowSummaryExpression(columns: ColumnProfile[]): string {
  const previewColumns = columns.slice(0, 3);
  if (!previewColumns.length) return `'row'`;
  return previewColumns
    .map((column) => `COALESCE(CAST(${quoteId(column.name)} AS VARCHAR), 'null')`)
    .join(` || ' • ' || `);
}

function projectionSql(columns: ColumnProfile[], overrides: Record<string, string>): string {
  return columns
    .map((column) => {
      const field = quoteId(column.name);
      return overrides[column.name] ? `${overrides[column.name]} AS ${field}` : field;
    })
    .join(",\n      ");
}

function inferTypeCandidate(
  column: ColumnProfile,
  row: Record<string, unknown>,
): TypeCandidate | null {
  const nonNullCount = toNumber(row.non_null_count);
  if (!nonNullCount) return null;
  const candidates: TypeCandidate[] = [
    {
      target: "number",
      validCount: toNumber(row.numeric_count),
      invalidCount: nonNullCount - toNumber(row.numeric_count),
      nonNullCount,
    },
    {
      target: "date",
      validCount: toNumber(row.date_count),
      invalidCount: nonNullCount - toNumber(row.date_count),
      nonNullCount,
    },
    {
      target: "boolean",
      validCount: toNumber(row.boolean_count),
      invalidCount: nonNullCount - toNumber(row.boolean_count),
      nonNullCount,
    },
  ];

  const best = candidates
    .sort((left, right) => right.validCount / right.nonNullCount - left.validCount / left.nonNullCount)[0];
  const ratio = best.validCount / best.nonNullCount;
  if (column.type === best.target) return null;
  if (ratio < 0.82 || best.validCount < 3) return null;
  return best;
}

function nullFillExpression(
  tableName: string,
  column: ColumnProfile,
  strategy: NullStrategy,
  customValue: string,
): string {
  const tableSql = quoteId(tableName);
  const field = quoteId(column.name);
  if (strategy === "mean") {
    return `COALESCE(${field}, (SELECT AVG(CAST(${field} AS DOUBLE)) FROM ${tableSql} WHERE ${field} IS NOT NULL))`;
  }
  if (strategy === "median") {
    return `COALESCE(${field}, (SELECT MEDIAN(CAST(${field} AS DOUBLE)) FROM ${tableSql} WHERE ${field} IS NOT NULL))`;
  }
  if (strategy === "mode") {
    return `COALESCE(${field}, (SELECT ${field} FROM ${tableSql} WHERE ${field} IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC, CAST(${field} AS VARCHAR) ASC LIMIT 1))`;
  }
  return `COALESCE(${field}, ${literalForType(customValue, column.type)})`;
}

export default function DataCleaner({
  tableName,
  columns,
  onCleanComplete,
}: DataCleanerProps) {
  const [issues, setIssues] = useState<DataIssue[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [taskProgress, setTaskProgress] = useState<{ total: number; done: number; label: string } | null>(null);
  const [nullStrategies, setNullStrategies] = useState<Record<string, NullStrategy>>({});
  const [nullValues, setNullValues] = useState<Record<string, string>>({});

  const columnMap = useMemo(
    () => new Map(columns.map((column) => [column.name, column])),
    [columns],
  );
  const summary = useMemo(
    () => ({
      issuesFound: issues.length,
      issuesFixed: history.length,
      rowsAffected: history.reduce((sum, entry) => sum + entry.affectedRows, 0),
    }),
    [history, issues.length],
  );
  const progressPercent = useMemo(() => {
    if (taskProgress) return taskProgress.total ? (taskProgress.done / taskProgress.total) * 100 : 0;
    const total = summary.issuesFound + summary.issuesFixed;
    return total ? (summary.issuesFixed / total) * 100 : 100;
  }, [summary, taskProgress]);

  async function rewriteTable(selectSql: string, label: string, issueId: string, affectedRows: number) {
    const sourceSql = quoteId(tableName);
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const tempTable = quoteId(`${tableName}__clean_${stamp}`);
    const backupTableName = `${tableName}__backup_${stamp}`;
    const backupSql = quoteId(backupTableName);

    await runQuery(`DROP TABLE IF EXISTS ${tempTable}`);
    await runQuery(`DROP TABLE IF EXISTS ${backupSql}`);
    await runQuery(`CREATE TABLE ${tempTable} AS ${selectSql}`);
    await runQuery(`ALTER TABLE ${sourceSql} RENAME TO ${backupSql}`);

    try {
      await runQuery(`ALTER TABLE ${tempTable} RENAME TO ${sourceSql}`);
      const entry: HistoryEntry = {
        id: stamp,
        issueId,
        label,
        affectedRows,
        backupTable: backupTableName,
        createdAt: Date.now(),
      };
      startTransition(() => setHistory((current) => [entry, ...current]));
      return entry;
    } catch (error) {
      await runQuery(`ALTER TABLE ${backupSql} RENAME TO ${sourceSql}`).catch(() => undefined);
      await runQuery(`DROP TABLE IF EXISTS ${tempTable}`).catch(() => undefined);
      throw error;
    }
  }

  async function restoreHistoryEntry(entry: HistoryEntry) {
    const sourceSql = quoteId(tableName);
    const backupSql = quoteId(entry.backupTable);
    const tempSql = quoteId(`${tableName}__restore_${Date.now()}`);
    await runQuery(`ALTER TABLE ${sourceSql} RENAME TO ${tempSql}`);
    try {
      await runQuery(`ALTER TABLE ${backupSql} RENAME TO ${sourceSql}`);
      await runQuery(`DROP TABLE ${tempSql}`);
    } catch (error) {
      await runQuery(`ALTER TABLE ${tempSql} RENAME TO ${sourceSql}`).catch(() => undefined);
      throw error;
    }
  }

  const scanIssues = useCallback(async () => {
    if (!tableName || !columns.length) {
      setIssues([]);
      setRowCount(0);
      return;
    }

    setLoading(true);
    setNotice(null);
    try {
      const tableSql = quoteId(tableName);
      const nullSql = columns
        .map((column, index) => `COUNT(*) FILTER (WHERE ${quoteId(column.name)} IS NULL) AS "n${index}"`)
        .join(", ");
      const whitespaceColumns = columns.filter((column) => column.type === "string" || column.type === "unknown");
      const whitespaceSql = whitespaceColumns
        .map(
          (column, index) =>
            `COUNT(*) FILTER (WHERE ${quoteId(column.name)} IS NOT NULL AND CAST(${quoteId(column.name)} AS VARCHAR) <> TRIM(CAST(${quoteId(column.name)} AS VARCHAR))) AS "w${index}"`,
        )
        .join(", ");

      const [rowCountRows, nullRows, whitespaceRows, duplicateRows, outlierRows, typeRows] = await Promise.all([
        runQuery(`SELECT COUNT(*) AS cnt FROM ${tableSql}`),
        runQuery(`SELECT ${nullSql || "0 AS placeholder"} FROM ${tableSql}`),
        runQuery(`SELECT ${whitespaceSql || "0 AS placeholder"} FROM ${tableSql}`),
        runQuery(`
          WITH duplicate_groups AS (
            SELECT COUNT(*) AS duplicate_count
            FROM ${tableSql}
            GROUP BY ${columns.map((column) => quoteId(column.name)).join(", ")}
            HAVING COUNT(*) > 1
          )
          SELECT
            COALESCE(SUM(duplicate_count), 0) AS duplicate_rows,
            COUNT(*) AS duplicate_groups
          FROM duplicate_groups
        `),
        Promise.all(
          columns
            .filter((column) => column.type === "number")
            .map(async (column) => {
              const field = quoteId(column.name);
              const rows = await runQuery(`
                WITH bounds AS (
                  SELECT
                    quantile_cont(${field}, 0.25) AS q1,
                    quantile_cont(${field}, 0.75) AS q3
                  FROM ${tableSql}
                  WHERE ${field} IS NOT NULL
                )
                SELECT
                  COALESCE(q1 - 1.5 * (q3 - q1), 0) AS lower_bound,
                  COALESCE(q3 + 1.5 * (q3 - q1), 0) AS upper_bound,
                  COUNT(*) FILTER (
                    WHERE ${field} IS NOT NULL
                      AND (${field} < q1 - 1.5 * (q3 - q1) OR ${field} > q3 + 1.5 * (q3 - q1))
                  ) AS outlier_rows
                FROM ${tableSql}, bounds
              `);
              return { column, row: rows[0] ?? {} };
            }),
        ),
        Promise.all(
          columns
            .filter((column) => column.type === "string" || column.type === "unknown")
            .map(async (column) => {
              const field = quoteId(column.name);
              const rows = await runQuery(`
                SELECT
                  COUNT(*) FILTER (WHERE ${field} IS NOT NULL) AS non_null_count,
                  COUNT(*) FILTER (WHERE ${field} IS NOT NULL AND TRY_CAST(${field} AS DOUBLE) IS NOT NULL) AS numeric_count,
                  COUNT(*) FILTER (WHERE ${field} IS NOT NULL AND TRY_CAST(${field} AS TIMESTAMP) IS NOT NULL) AS date_count,
                  COUNT(*) FILTER (
                    WHERE ${field} IS NOT NULL
                      AND LOWER(TRIM(CAST(${field} AS VARCHAR))) IN ('true', 'false', 'yes', 'no', '1', '0')
                  ) AS boolean_count
                FROM ${tableSql}
              `);
              return { column, row: rows[0] ?? {} };
            }),
        ),
      ]);

      const totalRows = toNumber(rowCountRows[0]?.cnt);
      const nextIssues: DataIssue[] = [];
      const nullSummary = nullRows[0] ?? {};
      const whitespaceSummary = whitespaceRows[0] ?? {};

      columns.forEach((column, index) => {
        const nullCount = toNumber(nullSummary[`n${index}`]);
        if (nullCount > 0) {
          const severity = nullSeverity(totalRows ? nullCount / totalRows : 0);
          nextIssues.push({
            id: `nulls:${column.name}`,
            type: "nulls",
            severity,
            columnName: column.name,
            description: `${formatNumber(nullCount)} rows are missing a value in ${column.name}.`,
            affectedRows: nullCount,
            suggestedFix:
              column.type === "number"
                ? "Fill with median or mean."
                : column.type === "string"
                  ? "Fill with the mode or a custom label."
                  : "Fill with a custom fallback value.",
          });
        }
      });

      whitespaceColumns.forEach((column, index) => {
        const affectedRows = toNumber(whitespaceSummary[`w${index}`]);
        if (affectedRows > 0) {
          nextIssues.push({
            id: `whitespace:${column.name}`,
            type: "whitespace",
            severity: countSeverity(totalRows ? affectedRows / totalRows : 0, affectedRows),
            columnName: column.name,
            description: `${formatNumber(affectedRows)} rows have leading or trailing whitespace.`,
            affectedRows,
            suggestedFix: "Trim whitespace in place.",
          });
        }
      });

      const duplicateRow = duplicateRows[0] ?? {};
      const duplicateCount = toNumber(duplicateRow.duplicate_rows);
      if (duplicateCount > 0) {
        nextIssues.push({
          id: "duplicates:dataset",
          type: "duplicates",
          severity: countSeverity(totalRows ? duplicateCount / totalRows : 0, duplicateCount),
          columnName: "All columns",
          description: `${formatNumber(duplicateCount)} rows are duplicated across the full row signature.`,
          affectedRows: duplicateCount,
          duplicateGroups: toNumber(duplicateRow.duplicate_groups),
          suggestedFix: "Keep the first copy and remove later duplicates.",
        });
      }

      outlierRows.forEach(({ column, row }) => {
        const affectedRows = toNumber(row.outlier_rows);
        if (affectedRows > 0) {
          nextIssues.push({
            id: `outliers:${column.name}`,
            type: "outliers",
            severity: countSeverity(totalRows ? affectedRows / totalRows : 0, affectedRows),
            columnName: column.name,
            description: `${formatNumber(affectedRows)} rows sit outside the IQR bounds for ${column.name}.`,
            affectedRows,
            outlierBounds: {
              lower: toNumber(row.lower_bound),
              upper: toNumber(row.upper_bound),
            },
            suggestedFix: "Remove rows outside the interquartile range.",
          });
        }
      });

      typeRows.forEach(({ column, row }) => {
        const candidate = inferTypeCandidate(column, row);
        if (!candidate) return;
        const severity: Severity =
          column.type === "unknown" || candidate.invalidCount === 0 ? "warning" : "info";
        nextIssues.push({
          id: `type:${column.name}`,
          type: "type_mismatches",
          severity,
          columnName: column.name,
          description: `${formatPercent((candidate.validCount / candidate.nonNullCount) * 100, 0)} of non-null values look like ${candidate.target} values.`,
          affectedRows: candidate.validCount,
          typeCandidate: candidate,
          suggestedFix: `Cast ${column.name} to ${candidate.target}.`,
        });
      });

      startTransition(() => {
        setIssues(
          nextIssues.sort(
            (left, right) =>
              ["critical", "warning", "info"].indexOf(left.severity) -
                ["critical", "warning", "info"].indexOf(right.severity) ||
              right.affectedRows - left.affectedRows,
          ),
        );
        setRowCount(totalRows);
        setNullStrategies((current) =>
          Object.fromEntries(
            columns.map((column) => [column.name, current[column.name] ?? defaultNullStrategy(column)]),
          ),
        );
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to scan data quality issues.",
      });
    } finally {
      setLoading(false);
    }
  }, [columns, tableName]);

  useEffect(() => {
    void scanIssues();
  }, [scanIssues]);

  function selectSqlForIssue(issue: DataIssue): string {
    const tableSql = quoteId(tableName);
    if (issue.type === "duplicates") {
      const partition = columns.map((column) => quoteId(column.name)).join(", ");
      return `
        SELECT ${columns.map((column) => quoteId(column.name)).join(", ")}
        FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY ${partition}) AS __row_rank
          FROM ${tableSql}
        ) deduped
        WHERE __row_rank = 1
      `;
    }

    if (issue.type === "outliers") {
      const field = quoteId(issue.columnName);
      return `
        WITH bounds AS (
          SELECT
            quantile_cont(${field}, 0.25) AS q1,
            quantile_cont(${field}, 0.75) AS q3
          FROM ${tableSql}
          WHERE ${field} IS NOT NULL
        )
        SELECT
          ${projectionSql(columns, {})}
        FROM ${tableSql}, bounds
        WHERE ${field} IS NULL OR (
          ${field} >= q1 - 1.5 * (q3 - q1)
          AND ${field} <= q3 + 1.5 * (q3 - q1)
        )
      `;
    }

    const column = columnMap.get(issue.columnName);
    if (!column) throw new Error(`Unknown column: ${issue.columnName}`);
    if (issue.type === "nulls") {
      const strategy = nullStrategies[column.name] ?? defaultNullStrategy(column);
      if (strategy === "custom" && !(nullValues[column.name] ?? "").trim()) {
        throw new Error(`Provide a custom value for ${column.name} before applying the fix.`);
      }
      return `
        SELECT
          ${projectionSql(columns, {
            [column.name]: nullFillExpression(tableName, column, strategy, nullValues[column.name] ?? ""),
          })}
        FROM ${tableSql}
      `;
    }

    if (issue.type === "whitespace") {
      const field = quoteId(column.name);
      return `
        SELECT
          ${projectionSql(columns, {
            [column.name]: `CASE WHEN ${field} IS NULL THEN ${field} ELSE TRIM(CAST(${field} AS VARCHAR)) END`,
          })}
        FROM ${tableSql}
      `;
    }

    if (!issue.typeCandidate) {
      throw new Error(`No inferred target type is available for ${column.name}.`);
    }
    const field = quoteId(column.name);
    const castType =
      issue.typeCandidate.target === "number"
        ? "DOUBLE"
        : issue.typeCandidate.target === "date"
          ? "TIMESTAMP"
          : "BOOLEAN";
    return `
      SELECT
        ${projectionSql(columns, {
          [column.name]: `TRY_CAST(${field} AS ${castType})`,
        })}
      FROM ${tableSql}
    `;
  }

  async function handlePreview(issue: DataIssue) {
    setPreviewLoading(issue.id);
    setNotice(null);
    try {
      const tableSql = quoteId(tableName);
      const rowSummary = rowSummaryExpression(columns);
      let sql = "";
      if (issue.type === "duplicates") {
        const partition = columns.map((column) => quoteId(column.name)).join(", ");
        sql = `
          SELECT
            CAST(${rowSummary} AS VARCHAR) AS before_value,
            'Removed duplicate row' AS after_value,
            CAST(__row_rank AS VARCHAR) AS detail
          FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY ${partition}) AS __row_rank
            FROM ${tableSql}
          ) duplicate_rows
          WHERE __row_rank > 1
          LIMIT ${PREVIEW_LIMIT}
        `;
      } else if (issue.type === "outliers") {
        const field = quoteId(issue.columnName);
        sql = `
          WITH bounds AS (
            SELECT quantile_cont(${field}, 0.25) AS q1, quantile_cont(${field}, 0.75) AS q3
            FROM ${tableSql}
            WHERE ${field} IS NOT NULL
          )
          SELECT
            CAST(${field} AS VARCHAR) AS before_value,
            'Removed row' AS after_value,
            CAST(${rowSummary} AS VARCHAR) AS detail
          FROM ${tableSql}, bounds
          WHERE ${field} IS NOT NULL
            AND (${field} < q1 - 1.5 * (q3 - q1) OR ${field} > q3 + 1.5 * (q3 - q1))
          LIMIT ${PREVIEW_LIMIT}
        `;
      } else {
        const column = columnMap.get(issue.columnName);
        if (!column) throw new Error(`Unknown column: ${issue.columnName}`);
        const field = quoteId(column.name);
        if (issue.type === "nulls") {
          const strategy = nullStrategies[column.name] ?? defaultNullStrategy(column);
          if (strategy === "custom" && !(nullValues[column.name] ?? "").trim()) {
            throw new Error(`Provide a custom value for ${column.name} before previewing the fix.`);
          }
          sql = `
            SELECT
              'null' AS before_value,
              CAST(${nullFillExpression(tableName, column, strategy, nullValues[column.name] ?? "")} AS VARCHAR) AS after_value,
              CAST(${rowSummary} AS VARCHAR) AS detail
            FROM ${tableSql}
            WHERE ${field} IS NULL
            LIMIT ${PREVIEW_LIMIT}
          `;
        } else if (issue.type === "whitespace") {
          sql = `
            SELECT
              CAST(${field} AS VARCHAR) AS before_value,
              CAST(TRIM(CAST(${field} AS VARCHAR)) AS VARCHAR) AS after_value,
              CAST(${rowSummary} AS VARCHAR) AS detail
            FROM ${tableSql}
            WHERE ${field} IS NOT NULL AND CAST(${field} AS VARCHAR) <> TRIM(CAST(${field} AS VARCHAR))
            LIMIT ${PREVIEW_LIMIT}
          `;
        } else if (issue.typeCandidate) {
          const castType =
            issue.typeCandidate.target === "number"
              ? "DOUBLE"
              : issue.typeCandidate.target === "date"
                ? "TIMESTAMP"
                : "BOOLEAN";
          sql = `
            SELECT
              CAST(${field} AS VARCHAR) AS before_value,
              CAST(TRY_CAST(${field} AS ${castType}) AS VARCHAR) AS after_value,
              CAST(${rowSummary} AS VARCHAR) AS detail
            FROM ${tableSql}
            WHERE ${field} IS NOT NULL AND TRY_CAST(${field} AS ${castType}) IS NOT NULL
            LIMIT ${PREVIEW_LIMIT}
          `;
        }
      }

      const rows = await runQuery(sql);
      setPreview({
        issueId: issue.id,
        title: `${issue.columnName} preview`,
        sql,
        rows: rows.map((row, index) => ({
          id: `${issue.id}-${index}`,
          before: String(row.before_value ?? "null"),
          after: String(row.after_value ?? "null"),
          detail: String(row.detail ?? "sample row"),
        })),
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to build the preview.",
      });
    } finally {
      setPreviewLoading(null);
    }
  }

  async function applyIssue(issue: DataIssue, refreshAfter = true) {
    const actionLabel =
      issue.type === "duplicates"
        ? "Removed duplicate rows"
        : issue.type === "outliers"
          ? `Removed ${issue.columnName} outliers`
          : issue.type === "whitespace"
            ? `Trimmed ${issue.columnName}`
            : issue.type === "type_mismatches"
              ? `Fixed ${issue.columnName} type`
              : `Filled nulls in ${issue.columnName}`;
    const selectSql = selectSqlForIssue(issue);
    await rewriteTable(selectSql, actionLabel, issue.id, issue.affectedRows);
    if (refreshAfter) await scanIssues();
  }

  async function handleApplyIssue(issue: DataIssue) {
    setBusy(true);
    setNotice(null);
    try {
      await applyIssue(issue);
      setNotice({ tone: "success", message: `${issue.suggestedFix} Applied to ${tableName}.` });
      onCleanComplete?.();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to apply the cleaning fix.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleBulkApply(severity: Exclude<Severity, "info">) {
    const targets = issues.filter((issue) => issue.severity === severity);
    if (!targets.length) {
      setNotice({ tone: "info", message: `No ${severity} issues are available.` });
      return;
    }
    setBusy(true);
    setTaskProgress({ total: targets.length, done: 0, label: "Preparing" });
    try {
      for (const [index, issue] of targets.entries()) {
        setTaskProgress({ total: targets.length, done: index, label: issue.columnName });
        await applyIssue(issue, false);
      }
      setTaskProgress({ total: targets.length, done: targets.length, label: "Done" });
      await scanIssues();
      setNotice({ tone: "success", message: `Applied ${targets.length} ${severity} fixes.` });
      onCleanComplete?.();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : `Failed to apply ${severity} fixes.`,
      });
    } finally {
      setBusy(false);
      setTimeout(() => setTaskProgress(null), 450);
    }
  }

  async function handleUndoLatest() {
    const latest = history[0];
    if (!latest) return;
    setBusy(true);
    setNotice(null);
    try {
      await restoreHistoryEntry(latest);
      startTransition(() => setHistory((current) => current.slice(1)));
      await scanIssues();
      setNotice({ tone: "success", message: `Reverted: ${latest.label}.` });
      onCleanComplete?.();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to undo the latest fix.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleResetAll() {
    if (!history.length) return;
    setBusy(true);
    setTaskProgress({ total: history.length, done: 0, label: "Resetting" });
    try {
      for (const [index, entry] of history.entries()) {
        setTaskProgress({ total: history.length, done: index, label: entry.label });
        await restoreHistoryEntry(entry);
      }
      setHistory([]);
      setPreview(null);
      setTaskProgress({ total: history.length, done: history.length, label: "Done" });
      await scanIssues();
      setNotice({ tone: "success", message: "Reverted every applied cleaning step." });
      onCleanComplete?.();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to reset the cleaning history.",
      });
    } finally {
      setBusy(false);
      setTimeout(() => setTaskProgress(null), 450);
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      className="overflow-hidden rounded-3xl border border-white/15 bg-white/10 shadow-2xl shadow-slate-950/15 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45"
    >
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
              <DatabaseZap className="h-3.5 w-3.5" />
              Data Cleaner
            </div>
            <h2 className="mt-3 text-xl font-semibold text-slate-950 dark:text-slate-50">
              Interactive cleaning workbench for {tableName}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Scan the dataset for nulls, duplicates, outliers, whitespace drift, and type mismatches, preview the SQL fix,
              then rewrite the DuckDB table in place.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleBulkApply("critical")}
              disabled={busy || loading}
              className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300"
            >
              Fix All Critical
            </button>
            <button
              type="button"
              onClick={() => handleBulkApply("warning")}
              disabled={busy || loading}
              className="rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-300"
            >
              Fix All Warnings
            </button>
            <button
              type="button"
              onClick={handleResetAll}
              disabled={busy || !history.length}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200"
            >
              <RotateCcw className="h-4 w-4" />
              Reset All
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Rows", value: formatNumber(rowCount) },
            { label: "Issues found", value: formatNumber(summary.issuesFound) },
            { label: "Issues fixed", value: formatNumber(summary.issuesFixed) },
            { label: "Rows affected", value: formatNumber(summary.rowsAffected) },
          ].map((card) => (
            <div key={card.label} className="rounded-2xl border border-white/10 bg-white/10 p-4 dark:bg-slate-950/35">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{card.label}</p>
              <p className="mt-3 text-2xl font-semibold text-slate-950 dark:text-slate-50">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>{taskProgress ? taskProgress.label : "Cleaning progress"}</span>
            <span>{formatPercent(progressPercent, 0)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200/60 dark:bg-slate-800/80">
            <motion.div
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.24, ease: EASE }}
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-sky-500 to-emerald-400"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-6 p-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <AnimatePresence mode="wait">
            {notice && (
              <motion.div
                key={notice.message}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: EASE }}
                className={`rounded-2xl border px-4 py-3 text-sm ${
                  notice.tone === "success"
                    ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : notice.tone === "error"
                      ? "border-red-400/25 bg-red-500/10 text-red-700 dark:text-red-300"
                      : "border-sky-400/25 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                }`}
              >
                {notice.message}
              </motion.div>
            )}
          </AnimatePresence>

          {loading ? (
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-5 text-sm text-slate-500 dark:bg-slate-950/35 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-cyan-500" />
              Scanning DuckDB for quality issues...
            </div>
          ) : issues.length === 0 ? (
            <div className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-5 py-6 text-sm text-emerald-800 dark:text-emerald-300">
              No active issues are left in the current table snapshot.
            </div>
          ) : (
            issues.map((issue, index) => {
              const column = columnMap.get(issue.columnName);
              const nullStrategy = column ? nullStrategies[column.name] ?? defaultNullStrategy(column) : "custom";
              return (
                <motion.article
                  key={issue.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, delay: index * 0.02, ease: EASE }}
                  className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${SEVERITY_STYLES[issue.severity]}`}>
                          {issue.severity}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                          {issue.type.replaceAll("_", " ")}
                        </span>
                      </div>
                      <h3 className="mt-3 text-lg font-semibold text-slate-950 dark:text-slate-50">{issue.columnName}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{issue.description}</p>
                      <div className="mt-3 flex flex-wrap gap-4 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <span>{formatNumber(issue.affectedRows)} affected rows</span>
                        <span>{issue.suggestedFix}</span>
                        {issue.duplicateGroups ? <span>{formatNumber(issue.duplicateGroups)} duplicate groups</span> : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handlePreview(issue)}
                        disabled={busy || previewLoading === issue.id}
                        className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200"
                      >
                        {previewLoading === issue.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                        Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApplyIssue(issue)}
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Wand2 className="h-4 w-4" />
                        {issue.type === "duplicates"
                          ? "Remove Duplicates"
                          : issue.type === "outliers"
                            ? "Remove Outliers"
                            : issue.type === "whitespace"
                              ? "Trim Whitespace"
                              : issue.type === "type_mismatches"
                                ? "Fix Types"
                                : "Fill Nulls"}
                      </button>
                    </div>
                  </div>

                  {issue.type === "nulls" && column ? (
                    <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-black/10 p-4 md:grid-cols-[0.9fr_1.1fr]">
                      <label className="text-sm text-slate-600 dark:text-slate-300">
                        <span className="mb-2 block font-medium text-slate-800 dark:text-slate-100">Fill strategy</span>
                        <select
                          value={nullStrategy}
                          onChange={(event) =>
                            setNullStrategies((current) => ({
                              ...current,
                              [column.name]: event.target.value as NullStrategy,
                            }))
                          }
                          className="w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-cyan-400 dark:text-slate-100"
                        >
                          {column.type === "number" ? <option value="mean">Mean</option> : null}
                          {column.type === "number" ? <option value="median">Median</option> : null}
                          <option value="mode">Mode</option>
                          <option value="custom">Custom value</option>
                        </select>
                      </label>
                      <label className="text-sm text-slate-600 dark:text-slate-300">
                        <span className="mb-2 block font-medium text-slate-800 dark:text-slate-100">Custom value</span>
                        <input
                          value={nullValues[column.name] ?? ""}
                          onChange={(event) =>
                            setNullValues((current) => ({
                              ...current,
                              [column.name]: event.target.value,
                            }))
                          }
                          placeholder="Used when strategy = custom"
                          className="w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-cyan-400 dark:text-slate-100"
                        />
                      </label>
                    </div>
                  ) : null}
                </motion.article>
              );
            })
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-50">
                  <Sparkles className="h-4 w-4 text-cyan-500" />
                  Preview
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Before and after samples from the pending DuckDB rewrite.
                </p>
              </div>
              {preview ? (
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-white/15 dark:text-slate-300"
                >
                  Clear
                </button>
              ) : null}
            </div>

            {preview ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
                  {preview.title}
                </div>
                {preview.rows.length ? (
                  preview.rows.map((row) => (
                    <div key={row.id} className="rounded-2xl border border-white/10 bg-black/10 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{row.detail}</p>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Before</p>
                          <p className="mt-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200">{row.before}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">After</p>
                          <p className="mt-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">{row.after}</p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-5 text-sm text-slate-500 dark:text-slate-400">
                    No sample rows were returned for this preview.
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-8 text-sm text-slate-500 dark:text-slate-400">
                Pick an issue and preview the change set before applying it.
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-50">
                  <History className="h-4 w-4 text-cyan-500" />
                  History and Undo
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Latest change can be reverted in place.</p>
              </div>
              <button
                type="button"
                onClick={handleUndoLatest}
                disabled={busy || !history.length}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200"
              >
                <RotateCcw className="h-4 w-4" />
                Undo
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {history.length ? (
                history.map((entry, index) => (
                  <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/10 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{entry.label}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {formatNumber(entry.affectedRows)} rows • {new Date(entry.createdAt).toLocaleTimeString()}
                        </p>
                      </div>
                      {index === 0 ? (
                        <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
                          latest
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-sm text-slate-500 dark:text-slate-400">
                  Applied fixes will appear here with undo support.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-50">
              <BadgeInfo className="h-4 w-4 text-cyan-500" />
              Issue guide
            </p>
            <div className="mt-4 grid gap-3">
              {[
                { icon: AlertTriangle, label: "Critical", copy: "Immediate risk to completeness or row integrity." },
                { icon: Eraser, label: "Warning", copy: "Recommended cleanup that is likely safe to batch." },
                { icon: CheckCircle2, label: "Info", copy: "Low-risk drift that can be handled later." },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-black/10 p-4">
                  <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <item.icon className="h-4 w-4 text-cyan-500" />
                    {item.label}
                  </p>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{item.copy}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
