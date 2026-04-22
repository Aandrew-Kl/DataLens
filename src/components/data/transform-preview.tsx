"use client";

import { buildMetricExpression, quoteIdentifier } from "@/lib/utils/sql";
import { runQuery } from "@/lib/duckdb/client";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Check, Eye, Play, RotateCcw } from "lucide-react";
import type { ColumnProfile } from "@/types/dataset";
import {
  defaultAggregateAlias,
  getOperatorMeta,
  sanitizeForViewName,
  type ComputedDraft,
  type DropDraft,
  type FilterDraft,
  type GroupDraft,
  type RenameDraft,
  type SortDraft,
  type TransformKind,
  type TransformStatus,
} from "./transform-step-editor";

export interface BuildResult {
  label: string;
  statement: string;
  error?: string;
}

export interface PreviewResult extends BuildResult {
  viewName: string;
  createViewSql: string;
}

export interface HistoryEntry {
  id: string;
  kind: TransformKind;
  label: string;
  viewName: string;
  sourceName: string;
  sql: string;
  createdAt: number;
  rowCount: number;
  columnCount: number;
}

type Drafts = {
  filterDraft: FilterDraft;
  sortDraft: SortDraft;
  groupDraft: GroupDraft;
  computedDraft: ComputedDraft;
  renameDraft: RenameDraft;
  dropDraft: DropDraft;
};

export function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "DuckDB rejected the transformation.";
}

export function makeViewName(baseTableName: string, kind: TransformKind, version: number): string {
  return `${sanitizeForViewName(baseTableName)}_${kind}_v${version}`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function mapDuckDbType(typeName: string): ColumnProfile["type"] {
  const normalized = typeName.toLowerCase();
  if (/tinyint|smallint|integer|bigint|hugeint|utinyint|usmallint|uinteger|ubigint|float|double|decimal|numeric|real/.test(normalized)) return "number";
  if (/bool/.test(normalized)) return "boolean";
  if (/date|time|timestamp/.test(normalized)) return "date";
  if (/char|text|string|varchar|uuid|json/.test(normalized)) return "string";
  return "unknown";
}

function parseFilterValue(column: ColumnProfile, rawValue: string): string | null {
  const trimmedValue = rawValue.trim();
  if (column.type === "number") {
    const numericValue = Number(trimmedValue);
    return Number.isFinite(numericValue) ? String(numericValue) : null;
  }
  if (column.type === "boolean") {
    const normalized = trimmedValue.toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return "TRUE";
    if (["false", "0", "no"].includes(normalized)) return "FALSE";
    return null;
  }
  return quoteLiteral(trimmedValue);
}

function buildFilterStatement(sourceName: string, columns: ColumnProfile[], draft: FilterDraft): BuildResult {
  const column = columns.find((item) => item.name === draft.column);
  if (!column) return { label: "Filter rows", statement: "", error: "Choose a valid column to filter." };
  const operator = getOperatorMeta(draft.operator);
  const columnSql = quoteIdentifier(column.name);
  if (operator.needsValue && draft.value.trim().length === 0) {
    return { label: `Filter rows on ${column.name}`, statement: "", error: "Provide a value for the filter." };
  }
  let predicate = "";
  if (!operator.needsValue) {
    predicate = draft.operator === "is_null" ? `${columnSql} IS NULL` : `${columnSql} IS NOT NULL`;
  } else if (draft.operator === "contains" || draft.operator === "starts_with" || draft.operator === "ends_with") {
    const pattern = draft.operator === "contains" ? `%${draft.value}%` : draft.operator === "starts_with" ? `${draft.value}%` : `%${draft.value}`;
    predicate = `LOWER(CAST(${columnSql} AS VARCHAR)) LIKE LOWER(${quoteLiteral(pattern)})`;
  } else {
    const parsedValue = parseFilterValue(column, draft.value);
    if (parsedValue === null) {
      return { label: `Filter rows on ${column.name}`, statement: "", error: `The value "${draft.value}" does not match the ${column.type} column type.` };
    }
    predicate = `${columnSql} ${draft.operator} ${parsedValue}`;
  }
  return { label: `Filter rows on ${column.name}`, statement: `SELECT *\nFROM ${quoteIdentifier(sourceName)}\nWHERE ${predicate}` };
}

function buildSortStatement(sourceName: string, columns: ColumnProfile[], draft: SortDraft): BuildResult {
  const column = columns.find((item) => item.name === draft.column);
  if (!column) return { label: "Sort rows", statement: "", error: "Choose a valid column to sort by." };
  return { label: `Sort by ${column.name} ${draft.direction.toLowerCase()}`, statement: `SELECT *\nFROM ${quoteIdentifier(sourceName)}\nORDER BY ${quoteIdentifier(column.name)} ${draft.direction} NULLS LAST` };
}

function buildGroupStatement(sourceName: string, columns: ColumnProfile[], draft: GroupDraft): BuildResult {
  const groupColumns = draft.groupBy.filter((name) => columns.some((column) => column.name === name));
  if (draft.aggregates.length === 0) return { label: "Group & aggregate", statement: "", error: "Add at least one aggregation." };
  const seenNames = new Set(groupColumns.map((name) => name.toLowerCase()));
  const selectLines = groupColumns.map((name) => `  ${quoteIdentifier(name)}`);
  for (const aggregate of draft.aggregates) {
    const alias = aggregate.alias.trim() || defaultAggregateAlias(aggregate);
    const aliasKey = alias.toLowerCase();
    if (seenNames.has(aliasKey)) return { label: "Group & aggregate", statement: "", error: `The output name "${alias}" is duplicated.` };
    seenNames.add(aliasKey);
    if (aggregate.functionName === "COUNT") {
      const target = aggregate.column ? quoteIdentifier(aggregate.column) : "*";
      selectLines.push(`  COUNT(${target}) AS ${quoteIdentifier(alias)}`);
      continue;
    }
    const column = columns.find((item) => item.name === aggregate.column);
    if (!column) return { label: "Group & aggregate", statement: "", error: `Choose a source column for ${aggregate.functionName}.` };
    selectLines.push(`  ${buildMetricExpression(aggregate.functionName, column.name, quoteIdentifier, { cast: false })} AS ${quoteIdentifier(alias)}`);
  }
  const lines = ["SELECT", selectLines.join(",\n"), `FROM ${quoteIdentifier(sourceName)}`];
  if (groupColumns.length > 0) {
    lines.push(`GROUP BY ${groupColumns.map(quoteIdentifier).join(", ")}`);
    lines.push(`ORDER BY ${groupColumns.map(quoteIdentifier).join(", ")}`);
  }
  return { label: groupColumns.length > 0 ? `Group by ${groupColumns.join(", ")}` : "Aggregate all rows", statement: lines.join("\n") };
}

function buildComputedStatement(sourceName: string, columns: ColumnProfile[], draft: ComputedDraft): BuildResult {
  const trimmedName = draft.name.trim();
  const trimmedExpression = draft.expression.trim();
  if (!trimmedName || !trimmedExpression) return { label: "Add computed column", statement: "", error: "Save a validated formula before creating the view." };
  if (columns.some((column) => column.name.toLowerCase() === trimmedName.toLowerCase())) {
    return { label: `Add computed column ${trimmedName}`, statement: "", error: `A column named "${trimmedName}" already exists in this relation.` };
  }
  return { label: `Add computed column ${trimmedName}`, statement: `SELECT *,\n  ${trimmedExpression} AS ${quoteIdentifier(trimmedName)}\nFROM ${quoteIdentifier(sourceName)}` };
}

function buildRenameStatement(sourceName: string, columns: ColumnProfile[], draft: RenameDraft): BuildResult {
  const existingColumn = columns.find((item) => item.name === draft.column);
  const trimmedNewName = draft.newName.trim();
  if (!existingColumn) return { label: "Rename column", statement: "", error: "Choose a valid column to rename." };
  if (!trimmedNewName) return { label: `Rename ${existingColumn.name}`, statement: "", error: "Provide a new column name." };
  if (trimmedNewName.toLowerCase() === existingColumn.name.toLowerCase()) return { label: `Rename ${existingColumn.name}`, statement: "", error: "The new column name must be different from the current name." };
  if (columns.some((column) => column.name !== existingColumn.name && column.name.toLowerCase() === trimmedNewName.toLowerCase())) {
    return { label: `Rename ${existingColumn.name}`, statement: "", error: `A column named "${trimmedNewName}" already exists.` };
  }
  const projection = columns.map((column) => column.name === existingColumn.name ? `  ${quoteIdentifier(column.name)} AS ${quoteIdentifier(trimmedNewName)}` : `  ${quoteIdentifier(column.name)}`).join(",\n");
  return { label: `Rename ${existingColumn.name} to ${trimmedNewName}`, statement: `SELECT\n${projection}\nFROM ${quoteIdentifier(sourceName)}` };
}

function buildDropStatement(sourceName: string, columns: ColumnProfile[], draft: DropDraft): BuildResult {
  const existingColumn = columns.find((item) => item.name === draft.column);
  if (!existingColumn) return { label: "Drop column", statement: "", error: "Choose a valid column to drop." };
  const remainingColumns = columns.filter((column) => column.name !== existingColumn.name);
  if (remainingColumns.length === 0) return { label: `Drop ${existingColumn.name}`, statement: "", error: "At least one column must remain in the result." };
  const projection = remainingColumns.map((column) => `  ${quoteIdentifier(column.name)}`).join(",\n");
  return { label: `Drop ${existingColumn.name}`, statement: `SELECT\n${projection}\nFROM ${quoteIdentifier(sourceName)}` };
}

export async function describeRelation(relationName: string): Promise<ColumnProfile[]> {
  const rows = await runQuery(`DESCRIBE ${quoteIdentifier(relationName)}`);
  return rows.map((row) => ({
    name: String(row.column_name ?? row.column ?? "column"),
    type: mapDuckDbType(String(row.column_type ?? row.type ?? "unknown")),
    nullCount: 0,
    uniqueCount: 0,
    sampleValues: [],
  }));
}

export async function countRows(relationName: string): Promise<number> {
  const rows = await runQuery(`SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(relationName)}`);
  return Number(rows[0]?.row_count ?? 0);
}

export function buildTransformPreview(tableName: string, activeTab: TransformKind, viewVersion: number, sourceName: string, columns: ColumnProfile[], drafts: Drafts): PreviewResult {
  const viewName = makeViewName(tableName, activeTab, viewVersion);
  let buildResult: BuildResult;
  switch (activeTab) {
    case "filter":
      buildResult = buildFilterStatement(sourceName, columns, drafts.filterDraft);
      break;
    case "sort":
      buildResult = buildSortStatement(sourceName, columns, drafts.sortDraft);
      break;
    case "group":
      buildResult = buildGroupStatement(sourceName, columns, drafts.groupDraft);
      break;
    case "computed":
      buildResult = buildComputedStatement(sourceName, columns, drafts.computedDraft);
      break;
    case "rename":
      buildResult = buildRenameStatement(sourceName, columns, drafts.renameDraft);
      break;
    case "drop":
      buildResult = buildDropStatement(sourceName, columns, drafts.dropDraft);
      break;
  }
  return { ...buildResult, viewName, createViewSql: buildResult.statement ? `CREATE OR REPLACE VIEW ${quoteIdentifier(viewName)} AS\n${buildResult.statement};` : "" };
}

function SqlPreview({ preview }: { preview: PreviewResult }) {
  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white/45 p-4 dark:border-gray-700/60 dark:bg-gray-950/35">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">SQL preview</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">The next transformation will materialize this query as a DuckDB view.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-300">
          <Eye className="h-3.5 w-3.5" />
          {preview.viewName}
        </span>
      </div>
      <pre className="overflow-x-auto rounded-xl bg-slate-950/95 px-4 py-3 text-xs leading-6 text-slate-200">{preview.createViewSql}</pre>
    </div>
  );
}

interface TransformPreviewProps {
  preview: PreviewResult;
  status: TransformStatus;
  busyAction: "execute" | "undo" | null;
  isBootstrapping: boolean;
  historyLength: number;
  onExecute: () => void;
  onUndo: () => void;
}

export function TransformPreview({
  preview,
  status,
  busyAction,
  isBootstrapping,
  historyLength,
  onExecute,
  onUndo,
}: TransformPreviewProps) {
  return (
    <>
      {preview.error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-4 text-sm text-red-700 dark:text-red-200">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Transformation is not ready yet</p>
              <p className="mt-1">{preview.error}</p>
            </div>
          </div>
        </div>
      ) : (
        <SqlPreview preview={preview} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onExecute} disabled={Boolean(preview.error) || busyAction !== null || isBootstrapping} className="inline-flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/15 px-4 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-blue-200">
          <Play className="h-4 w-4" />
          {busyAction === "execute" ? "Creating view..." : "Create view"}
        </button>
        <button type="button" onClick={onUndo} disabled={historyLength === 0 || busyAction !== null} className="inline-flex items-center gap-2 rounded-xl border border-gray-200/70 bg-white/70 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-blue-400/50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700/70 dark:bg-gray-950/40 dark:text-gray-200 dark:hover:text-blue-300">
          <RotateCcw className="h-4 w-4" />
          Undo last transform
        </button>
      </div>

      <AnimatePresence mode="wait">
        {status && (
          <motion.div key={status.message} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${status.type === "error" ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-200" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"}`}>
            {status.type === "error" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" />}
            <p>{status.message}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
