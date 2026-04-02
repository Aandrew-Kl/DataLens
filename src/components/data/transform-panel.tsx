"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowUpDown,
  Check,
  DatabaseZap,
  Eye,
  Filter,
  History,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Sigma,
  Sparkles,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import type { ColumnProfile } from "@/types/dataset";
import { runQuery } from "@/lib/duckdb/client";
import FormulaEditor from "./formula-editor";

interface TransformPanelProps {
  tableName: string;
  columns: ColumnProfile[];
  onTransformComplete: () => void;
}

type TransformKind = "filter" | "sort" | "group" | "computed" | "rename" | "drop";
type FilterOperator =
  | "="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "contains"
  | "starts_with"
  | "ends_with"
  | "is_null"
  | "is_not_null";
type SortDirection = "ASC" | "DESC";
type AggregateFunction = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";
type StatusState =
  | {
      type: "error" | "success";
      message: string;
    }
  | null;

interface FilterDraft {
  column: string;
  operator: FilterOperator;
  value: string;
}

interface SortDraft {
  column: string;
  direction: SortDirection;
}

interface AggregationDraft {
  id: string;
  functionName: AggregateFunction;
  column: string;
  alias: string;
}

interface GroupDraft {
  groupBy: string[];
  aggregates: AggregationDraft[];
}

interface ComputedDraft {
  name: string;
  expression: string;
}

interface RenameDraft {
  column: string;
  newName: string;
}

interface DropDraft {
  column: string;
}

interface BuildResult {
  label: string;
  statement: string;
  error?: string;
}

interface PreviewResult extends BuildResult {
  viewName: string;
  createViewSql: string;
}

interface HistoryEntry {
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

const FILTER_OPERATORS: Array<{
  value: FilterOperator;
  label: string;
  needsValue: boolean;
}> = [
  { value: "=", label: "Equals", needsValue: true },
  { value: "!=", label: "Does not equal", needsValue: true },
  { value: ">", label: "Greater than", needsValue: true },
  { value: ">=", label: "Greater or equal", needsValue: true },
  { value: "<", label: "Less than", needsValue: true },
  { value: "<=", label: "Less or equal", needsValue: true },
  { value: "contains", label: "Contains", needsValue: true },
  { value: "starts_with", label: "Starts with", needsValue: true },
  { value: "ends_with", label: "Ends with", needsValue: true },
  { value: "is_null", label: "Is null", needsValue: false },
  { value: "is_not_null", label: "Is not null", needsValue: false },
];

const TRANSFORM_TABS = [
  { key: "filter", label: "Filter rows", icon: Filter },
  { key: "sort", label: "Sort", icon: ArrowUpDown },
  { key: "group", label: "Group & aggregate", icon: Sigma },
  { key: "computed", label: "Add computed column", icon: Sparkles },
  { key: "rename", label: "Rename column", icon: Pencil },
  { key: "drop", label: "Drop column", icon: Trash2 },
] as const satisfies ReadonlyArray<{
  key: TransformKind;
  label: string;
  icon: typeof Filter;
}>;

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sanitizeForViewName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "dataset";
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "DuckDB rejected the transformation.";
}

function mapDuckDbType(typeName: string): ColumnProfile["type"] {
  const normalized = typeName.toLowerCase();

  if (
    /tinyint|smallint|integer|bigint|hugeint|utinyint|usmallint|uinteger|ubigint|float|double|decimal|numeric|real/.test(
      normalized
    )
  ) {
    return "number";
  }

  if (/bool/.test(normalized)) {
    return "boolean";
  }

  if (/date|time|timestamp/.test(normalized)) {
    return "date";
  }

  if (/char|text|string|varchar|uuid|json/.test(normalized)) {
    return "string";
  }

  return "unknown";
}

function makeViewName(baseTableName: string, kind: TransformKind, version: number): string {
  return `${sanitizeForViewName(baseTableName)}_${kind}_v${version}`;
}

function defaultAggregateAlias(aggregate: AggregationDraft): string {
  const suffix = aggregate.column
    ? sanitizeForViewName(aggregate.column)
    : "rows";

  if (aggregate.functionName === "COUNT" && !aggregate.column) {
    return "row_count";
  }

  return `${aggregate.functionName.toLowerCase()}_${suffix}`;
}

function createAggregationDraft(): AggregationDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    functionName: "COUNT",
    column: "",
    alias: "row_count",
  };
}

function getOperatorMeta(operator: FilterOperator) {
  return FILTER_OPERATORS.find((item) => item.value === operator) ?? FILTER_OPERATORS[0];
}

function parseFilterValue(column: ColumnProfile, rawValue: string): string | null {
  const trimmedValue = rawValue.trim();

  if (column.type === "number") {
    const numericValue = Number(trimmedValue);
    return Number.isFinite(numericValue) ? String(numericValue) : null;
  }

  if (column.type === "boolean") {
    const normalized = trimmedValue.toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) {
      return "TRUE";
    }
    if (["false", "0", "no"].includes(normalized)) {
      return "FALSE";
    }
    return null;
  }

  return quoteLiteral(trimmedValue);
}

function buildFilterStatement(
  sourceName: string,
  availableColumns: ColumnProfile[],
  draft: FilterDraft
): BuildResult {
  const column = availableColumns.find((item) => item.name === draft.column);

  if (!column) {
    return {
      label: "Filter rows",
      statement: "",
      error: "Choose a valid column to filter.",
    };
  }

  const operator = getOperatorMeta(draft.operator);
  const columnSql = quoteIdentifier(column.name);

  if (operator.needsValue && draft.value.trim().length === 0) {
    return {
      label: `Filter rows on ${column.name}`,
      statement: "",
      error: "Provide a value for the filter.",
    };
  }

  let predicate = "";

  if (!operator.needsValue) {
    predicate =
      draft.operator === "is_null"
        ? `${columnSql} IS NULL`
        : `${columnSql} IS NOT NULL`;
  } else if (
    draft.operator === "contains" ||
    draft.operator === "starts_with" ||
    draft.operator === "ends_with"
  ) {
    const pattern =
      draft.operator === "contains"
        ? `%${draft.value}%`
        : draft.operator === "starts_with"
        ? `${draft.value}%`
        : `%${draft.value}`;

    predicate = `LOWER(CAST(${columnSql} AS VARCHAR)) LIKE LOWER(${quoteLiteral(
      pattern
    )})`;
  } else {
    const parsedValue = parseFilterValue(column, draft.value);

    if (parsedValue === null) {
      return {
        label: `Filter rows on ${column.name}`,
        statement: "",
        error: `The value "${draft.value}" does not match the ${column.type} column type.`,
      };
    }

    predicate = `${columnSql} ${draft.operator} ${parsedValue}`;
  }

  return {
    label: `Filter rows on ${column.name}`,
    statement: `SELECT *\nFROM ${quoteIdentifier(sourceName)}\nWHERE ${predicate}`,
  };
}

function buildSortStatement(
  sourceName: string,
  availableColumns: ColumnProfile[],
  draft: SortDraft
): BuildResult {
  const column = availableColumns.find((item) => item.name === draft.column);

  if (!column) {
    return {
      label: "Sort rows",
      statement: "",
      error: "Choose a valid column to sort by.",
    };
  }

  return {
    label: `Sort by ${column.name} ${draft.direction.toLowerCase()}`,
    statement: `SELECT *\nFROM ${quoteIdentifier(sourceName)}\nORDER BY ${quoteIdentifier(
      column.name
    )} ${draft.direction} NULLS LAST`,
  };
}

function buildGroupStatement(
  sourceName: string,
  availableColumns: ColumnProfile[],
  draft: GroupDraft
): BuildResult {
  const groupColumns = draft.groupBy.filter((name) =>
    availableColumns.some((column) => column.name === name)
  );

  if (draft.aggregates.length === 0) {
    return {
      label: "Group & aggregate",
      statement: "",
      error: "Add at least one aggregation.",
    };
  }

  const seenNames = new Set(groupColumns.map((name) => name.toLowerCase()));
  const selectLines = groupColumns.map((name) => `  ${quoteIdentifier(name)}`);

  for (const aggregate of draft.aggregates) {
    const alias = aggregate.alias.trim() || defaultAggregateAlias(aggregate);
    const aliasKey = alias.toLowerCase();

    if (seenNames.has(aliasKey)) {
      return {
        label: "Group & aggregate",
        statement: "",
        error: `The output name "${alias}" is duplicated.`,
      };
    }

    seenNames.add(aliasKey);

    if (aggregate.functionName === "COUNT") {
      const target = aggregate.column ? quoteIdentifier(aggregate.column) : "*";
      selectLines.push(
        `  COUNT(${target}) AS ${quoteIdentifier(alias)}`
      );
      continue;
    }

    const column = availableColumns.find((item) => item.name === aggregate.column);

    if (!column) {
      return {
        label: "Group & aggregate",
        statement: "",
        error: `Choose a source column for ${aggregate.functionName}.`,
      };
    }

    selectLines.push(
      `  ${aggregate.functionName}(${quoteIdentifier(column.name)}) AS ${quoteIdentifier(alias)}`
    );
  }

  const lines = [
    "SELECT",
    selectLines.join(",\n"),
    `FROM ${quoteIdentifier(sourceName)}`,
  ];

  if (groupColumns.length > 0) {
    lines.push(`GROUP BY ${groupColumns.map(quoteIdentifier).join(", ")}`);
    lines.push(`ORDER BY ${groupColumns.map(quoteIdentifier).join(", ")}`);
  }

  return {
    label:
      groupColumns.length > 0
        ? `Group by ${groupColumns.join(", ")}`
        : "Aggregate all rows",
    statement: lines.join("\n"),
  };
}

function buildComputedStatement(
  sourceName: string,
  availableColumns: ColumnProfile[],
  draft: ComputedDraft
): BuildResult {
  const trimmedName = draft.name.trim();
  const trimmedExpression = draft.expression.trim();

  if (!trimmedName || !trimmedExpression) {
    return {
      label: "Add computed column",
      statement: "",
      error: "Save a validated formula before creating the view.",
    };
  }

  if (
    availableColumns.some(
      (column) => column.name.toLowerCase() === trimmedName.toLowerCase()
    )
  ) {
    return {
      label: `Add computed column ${trimmedName}`,
      statement: "",
      error: `A column named "${trimmedName}" already exists in this relation.`,
    };
  }

  return {
    label: `Add computed column ${trimmedName}`,
    statement: `SELECT *,\n  ${trimmedExpression} AS ${quoteIdentifier(
      trimmedName
    )}\nFROM ${quoteIdentifier(sourceName)}`,
  };
}

function buildRenameStatement(
  sourceName: string,
  availableColumns: ColumnProfile[],
  draft: RenameDraft
): BuildResult {
  const existingColumn = availableColumns.find((item) => item.name === draft.column);
  const trimmedNewName = draft.newName.trim();

  if (!existingColumn) {
    return {
      label: "Rename column",
      statement: "",
      error: "Choose a valid column to rename.",
    };
  }

  if (!trimmedNewName) {
    return {
      label: `Rename ${existingColumn.name}`,
      statement: "",
      error: "Provide a new column name.",
    };
  }

  if (trimmedNewName.toLowerCase() === existingColumn.name.toLowerCase()) {
    return {
      label: `Rename ${existingColumn.name}`,
      statement: "",
      error: "The new column name must be different from the current name.",
    };
  }

  if (
    availableColumns.some(
      (column) => column.name !== existingColumn.name && column.name.toLowerCase() === trimmedNewName.toLowerCase()
    )
  ) {
    return {
      label: `Rename ${existingColumn.name}`,
      statement: "",
      error: `A column named "${trimmedNewName}" already exists.`,
    };
  }

  const projection = availableColumns
    .map((column) =>
      column.name === existingColumn.name
        ? `  ${quoteIdentifier(column.name)} AS ${quoteIdentifier(trimmedNewName)}`
        : `  ${quoteIdentifier(column.name)}`
    )
    .join(",\n");

  return {
    label: `Rename ${existingColumn.name} to ${trimmedNewName}`,
    statement: `SELECT\n${projection}\nFROM ${quoteIdentifier(sourceName)}`,
  };
}

function buildDropStatement(
  sourceName: string,
  availableColumns: ColumnProfile[],
  draft: DropDraft
): BuildResult {
  const existingColumn = availableColumns.find((item) => item.name === draft.column);

  if (!existingColumn) {
    return {
      label: "Drop column",
      statement: "",
      error: "Choose a valid column to drop.",
    };
  }

  const remainingColumns = availableColumns.filter(
    (column) => column.name !== existingColumn.name
  );

  if (remainingColumns.length === 0) {
    return {
      label: `Drop ${existingColumn.name}`,
      statement: "",
      error: "At least one column must remain in the result.",
    };
  }

  const projection = remainingColumns
    .map((column) => `  ${quoteIdentifier(column.name)}`)
    .join(",\n");

  return {
    label: `Drop ${existingColumn.name}`,
    statement: `SELECT\n${projection}\nFROM ${quoteIdentifier(sourceName)}`,
  };
}

async function describeRelation(relationName: string): Promise<ColumnProfile[]> {
  const rows = await runQuery(`DESCRIBE ${quoteIdentifier(relationName)}`);

  return rows.map((row) => {
    const name = String(row.column_name ?? row.column ?? "column");
    const type = String(row.column_type ?? row.type ?? "unknown");

    return {
      name,
      type: mapDuckDbType(type),
      nullCount: 0,
      uniqueCount: 0,
      sampleValues: [],
    };
  });
}

async function countRows(relationName: string): Promise<number> {
  const rows = await runQuery(
    `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(relationName)}`
  );
  return Number(rows[0]?.row_count ?? 0);
}

function TabButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Filter;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        flex items-center gap-2 rounded-2xl border px-3 py-3 text-left text-sm font-medium transition
        ${
          active
            ? "border-blue-500/30 bg-blue-500/15 text-blue-700 dark:text-blue-200"
            : "border-gray-200/60 bg-white/55 text-gray-700 hover:border-blue-400/40 hover:text-blue-600 dark:border-gray-700/60 dark:bg-gray-950/35 dark:text-gray-200 dark:hover:text-blue-300"
        }
      `}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
}

function StatPill({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/60 bg-white/50 dark:bg-gray-950/35 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-50">{value}</p>
    </div>
  );
}

function SqlPreview({
  preview,
}: {
  preview: PreviewResult;
}) {
  return (
    <div className="rounded-2xl border border-gray-200/60 dark:border-gray-700/60 bg-white/45 dark:bg-gray-950/35 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">
            SQL preview
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            The next transformation will materialize this query as a DuckDB view.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-300">
          <Eye className="h-3.5 w-3.5" />
          {preview.viewName}
        </span>
      </div>

      <pre className="overflow-x-auto rounded-xl bg-slate-950/95 px-4 py-3 text-xs leading-6 text-slate-200">
        {preview.createViewSql}
      </pre>
    </div>
  );
}

export default function TransformPanel({
  tableName,
  columns,
  onTransformComplete,
}: TransformPanelProps) {
  const latestColumnsRef = useRef(columns);
  latestColumnsRef.current = columns;

  const [activeTab, setActiveTab] = useState<TransformKind>("filter");
  const [currentSourceName, setCurrentSourceName] = useState(tableName);
  const [currentColumns, setCurrentColumns] = useState<ColumnProfile[]>(columns);
  const [currentRowCount, setCurrentRowCount] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [viewVersion, setViewVersion] = useState(1);
  const [status, setStatus] = useState<StatusState>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [busyAction, setBusyAction] = useState<"execute" | "undo" | null>(null);

  const [filterDraft, setFilterDraft] = useState<FilterDraft>({
    column: columns[0]?.name ?? "",
    operator: "=",
    value: "",
  });
  const [sortDraft, setSortDraft] = useState<SortDraft>({
    column: columns[0]?.name ?? "",
    direction: "ASC",
  });
  const [groupDraft, setGroupDraft] = useState<GroupDraft>({
    groupBy: [],
    aggregates: [createAggregationDraft()],
  });
  const [computedDraft, setComputedDraft] = useState<ComputedDraft>({
    name: "",
    expression: "",
  });
  const [renameDraft, setRenameDraft] = useState<RenameDraft>({
    column: columns[0]?.name ?? "",
    newName: "",
  });
  const [dropDraft, setDropDraft] = useState<DropDraft>({
    column: columns[0]?.name ?? "",
  });

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const latestColumns = latestColumnsRef.current;

      setIsBootstrapping(true);
      setStatus(null);
      setActiveTab("filter");
      setCurrentSourceName(tableName);
      setCurrentColumns(latestColumns);
      setHistory([]);
      setViewVersion(1);
      setComputedDraft({ name: "", expression: "" });
      setFilterDraft({
        column: latestColumns[0]?.name ?? "",
        operator: "=",
        value: "",
      });
      setSortDraft({
        column: latestColumns[0]?.name ?? "",
        direction: "ASC",
      });
      setGroupDraft({
        groupBy: [],
        aggregates: [createAggregationDraft()],
      });
      setRenameDraft({
        column: latestColumns[0]?.name ?? "",
        newName: "",
      });
      setDropDraft({
        column: latestColumns[0]?.name ?? "",
      });

      try {
        const [schema, rowCountResult] = await Promise.all([
          describeRelation(tableName).catch(() => latestColumns),
          countRows(tableName).catch(() => 0),
        ]);

        if (cancelled) {
          return;
        }

        setCurrentColumns(schema.length > 0 ? schema : latestColumns);
        setCurrentRowCount(rowCountResult);
      } catch (error) {
        if (!cancelled) {
          setStatus({
            type: "error",
            message: getErrorMessage(error),
          });
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [tableName]);

  const nextViewName = makeViewName(tableName, activeTab, viewVersion);

  let buildResult: BuildResult;

  switch (activeTab) {
    case "filter":
      buildResult = buildFilterStatement(currentSourceName, currentColumns, filterDraft);
      break;
    case "sort":
      buildResult = buildSortStatement(currentSourceName, currentColumns, sortDraft);
      break;
    case "group":
      buildResult = buildGroupStatement(currentSourceName, currentColumns, groupDraft);
      break;
    case "computed":
      buildResult = buildComputedStatement(currentSourceName, currentColumns, computedDraft);
      break;
    case "rename":
      buildResult = buildRenameStatement(currentSourceName, currentColumns, renameDraft);
      break;
    case "drop":
      buildResult = buildDropStatement(currentSourceName, currentColumns, dropDraft);
      break;
  }

  const preview: PreviewResult = {
    ...buildResult,
    viewName: nextViewName,
    createViewSql: buildResult.statement
      ? `CREATE OR REPLACE VIEW ${quoteIdentifier(nextViewName)} AS\n${buildResult.statement};`
      : "",
  };

  async function handleExecute() {
    if (preview.error || preview.createViewSql.length === 0 || busyAction) {
      return;
    }

    setBusyAction("execute");
    setStatus(null);

    try {
      await runQuery(preview.createViewSql);

      const [schema, rowCountResult] = await Promise.all([
        describeRelation(preview.viewName),
        countRows(preview.viewName),
      ]);

      setHistory((currentHistory) => [
        ...currentHistory,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: activeTab,
          label: preview.label,
          viewName: preview.viewName,
          sourceName: currentSourceName,
          sql: preview.createViewSql,
          createdAt: Date.now(),
          rowCount: rowCountResult,
          columnCount: schema.length,
        },
      ]);
      setCurrentSourceName(preview.viewName);
      setCurrentColumns(schema);
      setCurrentRowCount(rowCountResult);
      setViewVersion((current) => current + 1);
      setComputedDraft({ name: "", expression: "" });
      setStatus({
        type: "success",
        message: `Created view "${preview.viewName}" from ${currentSourceName}.`,
      });
      onTransformComplete();
    } catch (error) {
      setStatus({
        type: "error",
        message: getErrorMessage(error),
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleUndo() {
    const latest = history[history.length - 1];

    if (!latest || busyAction) {
      return;
    }

    setBusyAction("undo");
    setStatus(null);

    try {
      await runQuery(`DROP VIEW IF EXISTS ${quoteIdentifier(latest.viewName)}`);

      const [schema, rowCountResult] = await Promise.all([
        describeRelation(latest.sourceName),
        countRows(latest.sourceName),
      ]);

      setHistory((currentHistory) => currentHistory.slice(0, -1));
      setCurrentSourceName(latest.sourceName);
      setCurrentColumns(schema);
      setCurrentRowCount(rowCountResult);
      setComputedDraft({ name: "", expression: "" });
      setStatus({
        type: "success",
        message: `Undid "${latest.label}" and restored "${latest.sourceName}".`,
      });
      onTransformComplete();
    } catch (error) {
      setStatus({
        type: "error",
        message: getErrorMessage(error),
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="
        rounded-2xl border border-white/30 dark:border-white/10
        bg-white/55 dark:bg-gray-900/55 backdrop-blur-xl
        shadow-[0_20px_80px_-30px_rgba(15,23,42,0.35)]
        overflow-hidden
      "
    >
      <div className="border-b border-gray-200/50 dark:border-gray-700/50 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
              <DatabaseZap className="h-3.5 w-3.5" />
              Transform panel
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
              Build chained DuckDB view transformations
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Every action creates a new view so you can iterate, inspect the generated SQL, and roll back the latest step.
            </p>
          </div>

          <div className="grid min-w-[240px] gap-2 sm:grid-cols-3">
            <StatPill label="Current relation" value={currentSourceName} />
            <StatPill label="Rows" value={formatCount(currentRowCount)} />
            <StatPill label="Columns" value={formatCount(currentColumns.length)} />
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1.35fr)_340px]">
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {TRANSFORM_TABS.map((tab) => (
              <TabButton
                key={tab.key}
                active={activeTab === tab.key}
                icon={tab.icon}
                label={tab.label}
                onClick={() => setActiveTab(tab.key)}
              />
            ))}
          </div>

          <div className="rounded-2xl border border-gray-200/60 dark:border-gray-700/60 bg-white/45 dark:bg-gray-950/35 p-4">
            {activeTab === "filter" && (
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]">
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                    Column
                  </span>
                  <select
                    value={filterDraft.column}
                    onChange={(event) =>
                      setFilterDraft((current) => ({
                        ...current,
                        column: event.target.value,
                      }))
                    }
                    className="h-11 w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100"
                  >
                    <option value="">Select column</option>
                    {currentColumns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                    Operator
                  </span>
                  <select
                    value={filterDraft.operator}
                    onChange={(event) =>
                      setFilterDraft((current) => ({
                        ...current,
                        operator: event.target.value as FilterOperator,
                      }))
                    }
                    className="h-11 w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100"
                  >
                    {FILTER_OPERATORS.map((operator) => (
                      <option key={operator.value} value={operator.value}>
                        {operator.label}
                      </option>
                    ))}
                  </select>
                </label>

                {getOperatorMeta(filterDraft.operator).needsValue ? (
                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                      Value
                    </span>
                    <input
                      value={filterDraft.value}
                      onChange={(event) =>
                        setFilterDraft((current) => ({
                          ...current,
                          value: event.target.value,
                        }))
                      }
                      placeholder="42"
                      className="h-11 w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100 dark:placeholder:text-gray-500"
                    />
                  </label>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-200/70 bg-white/50 px-4 py-3 text-sm text-gray-500 dark:border-gray-700/70 dark:bg-gray-950/30 dark:text-gray-400">
                    This operator does not require a comparison value.
                  </div>
                )}
              </div>
            )}

            {activeTab === "sort" && (
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                    Sort column
                  </span>
                  <select
                    value={sortDraft.column}
                    onChange={(event) =>
                      setSortDraft((current) => ({
                        ...current,
                        column: event.target.value,
                      }))
                    }
                    className="h-11 w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100"
                  >
                    <option value="">Select column</option>
                    {currentColumns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                    Direction
                  </span>
                  <select
                    value={sortDraft.direction}
                    onChange={(event) =>
                      setSortDraft((current) => ({
                        ...current,
                        direction: event.target.value as SortDirection,
                      }))
                    }
                    className="h-11 w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100"
                  >
                    <option value="ASC">Ascending</option>
                    <option value="DESC">Descending</option>
                  </select>
                </label>
              </div>
            )}

            {activeTab === "group" && (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                    Grouping columns
                  </p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Select zero or more columns. If you leave this empty, the panel will aggregate the full relation into one row.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {currentColumns.map((column) => {
                      const selected = groupDraft.groupBy.includes(column.name);

                      return (
                        <button
                          key={column.name}
                          type="button"
                          onClick={() =>
                            setGroupDraft((current) => ({
                              ...current,
                              groupBy: selected
                                ? current.groupBy.filter((name) => name !== column.name)
                                : [...current.groupBy, column.name],
                            }))
                          }
                          className={`
                            rounded-full border px-3 py-1.5 text-xs font-medium transition
                            ${
                              selected
                                ? "border-blue-500/30 bg-blue-500/15 text-blue-700 dark:text-blue-200"
                                : "border-gray-200/70 bg-white/70 text-gray-700 hover:border-blue-400/50 hover:text-blue-600 dark:border-gray-700/70 dark:bg-gray-950/40 dark:text-gray-200 dark:hover:text-blue-300"
                            }
                          `}
                        >
                          {column.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                        Aggregations
                      </p>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Each aggregation becomes one output column in the transformed view.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setGroupDraft((current) => ({
                          ...current,
                          aggregates: [...current.aggregates, createAggregationDraft()],
                        }))
                      }
                      className="inline-flex items-center gap-2 rounded-xl border border-gray-200/70 bg-white/70 px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-blue-400/50 hover:text-blue-600 dark:border-gray-700/70 dark:bg-gray-950/40 dark:text-gray-200 dark:hover:text-blue-300"
                    >
                      <Plus className="h-4 w-4" />
                      Add aggregation
                    </button>
                  </div>

                  <AnimatePresence initial={false}>
                    {groupDraft.aggregates.map((aggregate) => (
                      <motion.div
                        key={aggregate.id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className="grid gap-3 rounded-2xl border border-gray-200/60 bg-white/55 p-3 dark:border-gray-700/60 dark:bg-gray-950/35 lg:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)_48px]"
                      >
                        <select
                          value={aggregate.functionName}
                          onChange={(event) =>
                            setGroupDraft((current) => ({
                              ...current,
                              aggregates: current.aggregates.map((item) =>
                                item.id === aggregate.id
                                  ? {
                                      ...item,
                                      functionName: event.target.value as AggregateFunction,
                                      alias:
                                        event.target.value === "COUNT" && item.alias === ""
                                          ? "row_count"
                                          : item.alias,
                                    }
                                  : item
                              ),
                            }))
                          }
                          className="h-11 rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100"
                        >
                          <option value="COUNT">COUNT</option>
                          <option value="SUM">SUM</option>
                          <option value="AVG">AVG</option>
                          <option value="MIN">MIN</option>
                          <option value="MAX">MAX</option>
                        </select>

                        <select
                          value={aggregate.column}
                          onChange={(event) =>
                            setGroupDraft((current) => ({
                              ...current,
                              aggregates: current.aggregates.map((item) =>
                                item.id === aggregate.id
                                  ? { ...item, column: event.target.value }
                                  : item
                              ),
                            }))
                          }
                          className="h-11 rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100"
                        >
                          <option value="">
                            {aggregate.functionName === "COUNT" ? "All rows (*)" : "Select column"}
                          </option>
                          {currentColumns.map((column) => (
                            <option key={column.name} value={column.name}>
                              {column.name}
                            </option>
                          ))}
                        </select>

                        <input
                          value={aggregate.alias}
                          onChange={(event) =>
                            setGroupDraft((current) => ({
                              ...current,
                              aggregates: current.aggregates.map((item) =>
                                item.id === aggregate.id
                                  ? { ...item, alias: event.target.value }
                                  : item
                              ),
                            }))
                          }
                          placeholder={defaultAggregateAlias(aggregate)}
                          className="h-11 rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100 dark:placeholder:text-gray-500"
                        />

                        <button
                          type="button"
                          onClick={() =>
                            setGroupDraft((current) => ({
                              ...current,
                              aggregates:
                                current.aggregates.length === 1
                                  ? current.aggregates
                                  : current.aggregates.filter((item) => item.id !== aggregate.id),
                            }))
                          }
                          disabled={groupDraft.aggregates.length === 1}
                          className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200/70 bg-white/70 text-gray-500 transition hover:border-red-400/50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-400"
                          aria-label="Remove aggregation"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}

            {activeTab === "computed" && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-dashed border-gray-200/70 bg-white/45 px-4 py-3 text-sm text-gray-600 dark:border-gray-700/70 dark:bg-gray-950/30 dark:text-gray-300">
                  Save a formula from the embedded editor to stage it for the next transform. The SQL preview below updates only after the formula validates successfully.
                </div>

                <FormulaEditor
                  key={`${currentSourceName}-${currentColumns.map((column) => column.name).join("|")}`}
                  tableName={currentSourceName}
                  columns={currentColumns}
                  onSave={(name, expression) => {
                    setComputedDraft({ name, expression });
                    setStatus({
                      type: "success",
                      message: `Staged computed column "${name}". Review the SQL preview and create the view when ready.`,
                    });
                  }}
                />

                {computedDraft.name && (
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200">
                    <p className="font-semibold">Staged formula</p>
                    <p className="mt-1 font-mono text-xs leading-6">
                      {computedDraft.name} = {computedDraft.expression}
                    </p>
                  </div>
                )}
              </div>
            )}

            {activeTab === "rename" && (
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                    Existing column
                  </span>
                  <select
                    value={renameDraft.column}
                    onChange={(event) =>
                      setRenameDraft((current) => ({
                        ...current,
                        column: event.target.value,
                      }))
                    }
                    className="h-11 w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100"
                  >
                    <option value="">Select column</option>
                    {currentColumns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                    New name
                  </span>
                  <input
                    value={renameDraft.newName}
                    onChange={(event) =>
                      setRenameDraft((current) => ({
                        ...current,
                        newName: event.target.value,
                      }))
                    }
                    placeholder="renamed_column"
                    className="h-11 w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100 dark:placeholder:text-gray-500"
                  />
                </label>
              </div>
            )}

            {activeTab === "drop" && (
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                    Column to remove
                  </span>
                  <select
                    value={dropDraft.column}
                    onChange={(event) =>
                      setDropDraft({
                        column: event.target.value,
                      })
                    }
                    className="h-11 w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100"
                  >
                    <option value="">Select column</option>
                    {currentColumns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="rounded-xl border border-dashed border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
                  Dropping a column removes it from the next view only. Use undo to revert the latest step.
                </div>
              </div>
            )}
          </div>

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
            <button
              type="button"
              onClick={handleExecute}
              disabled={Boolean(preview.error) || busyAction !== null || isBootstrapping}
              className="
                inline-flex items-center gap-2 rounded-xl border border-blue-500/30
                bg-blue-500/15 px-4 py-2.5 text-sm font-semibold text-blue-700
                transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60
                dark:text-blue-200
              "
            >
              <Play className="h-4 w-4" />
              {busyAction === "execute" ? "Creating view..." : "Create view"}
            </button>

            <button
              type="button"
              onClick={handleUndo}
              disabled={history.length === 0 || busyAction !== null}
              className="
                inline-flex items-center gap-2 rounded-xl border border-gray-200/70
                bg-white/70 px-4 py-2.5 text-sm font-semibold text-gray-700
                transition hover:border-blue-400/50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50
                dark:border-gray-700/70 dark:bg-gray-950/40 dark:text-gray-200 dark:hover:text-blue-300
              "
            >
              <RotateCcw className="h-4 w-4" />
              Undo last transform
            </button>
          </div>

          <AnimatePresence mode="wait">
            {status && (
              <motion.div
                key={status.message}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className={`
                  flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm
                  ${
                    status.type === "error"
                      ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-200"
                      : "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
                  }
                `}
              >
                {status.type === "error" ? (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <Check className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <p>{status.message}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <aside className="space-y-5">
          <div className="rounded-2xl border border-gray-200/60 dark:border-gray-700/60 bg-white/45 dark:bg-gray-950/35 p-4">
            <div className="flex items-start gap-3">
              <Table2 className="mt-0.5 h-4 w-4 text-blue-500 dark:text-blue-300" />
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                  Active relation
                </p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  New transforms read from <span className="font-mono">{currentSourceName}</span>.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {currentColumns.map((column) => (
                <div
                  key={column.name}
                  className="flex items-center justify-between gap-3 rounded-xl border border-gray-200/60 bg-white/60 px-3 py-2 text-sm dark:border-gray-700/60 dark:bg-gray-950/35"
                >
                  <span className="truncate text-gray-800 dark:text-gray-200">{column.name}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    {column.type}
                  </span>
                </div>
              ))}

              {currentColumns.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-200/70 bg-white/40 px-3 py-4 text-sm text-gray-500 dark:border-gray-700/70 dark:bg-gray-950/25 dark:text-gray-400">
                  {isBootstrapping
                    ? "Loading relation schema..."
                    : "No columns are currently available in this relation."}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200/60 dark:border-gray-700/60 bg-white/45 dark:bg-gray-950/35 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <History className="mt-0.5 h-4 w-4 text-violet-500 dark:text-violet-300" />
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                    Transformation history
                  </p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Undo only removes the latest generated view.
                  </p>
                </div>
              </div>

              <span className="rounded-full border border-gray-200/70 bg-white/70 px-3 py-1 text-xs font-semibold text-gray-600 dark:border-gray-700/70 dark:bg-gray-950/40 dark:text-gray-300">
                {history.length} step{history.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="space-y-3">
              <AnimatePresence initial={false}>
                {history.map((entry) => (
                  <motion.div
                    key={entry.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="rounded-2xl border border-gray-200/60 bg-white/60 p-3 dark:border-gray-700/60 dark:bg-gray-950/35"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                          {entry.label}
                        </p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {entry.viewName} from {entry.sourceName}
                        </p>
                      </div>
                      <span className="text-[11px] text-gray-400 dark:text-gray-500">
                        {new Date(entry.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border border-gray-200/60 bg-white/50 px-3 py-2 text-xs dark:border-gray-700/60 dark:bg-gray-950/25">
                        <span className="font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
                          Rows
                        </span>
                        <p className="mt-1 font-medium text-gray-800 dark:text-gray-200">
                          {formatCount(entry.rowCount)}
                        </p>
                      </div>
                      <div className="rounded-xl border border-gray-200/60 bg-white/50 px-3 py-2 text-xs dark:border-gray-700/60 dark:bg-gray-950/25">
                        <span className="font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
                          Columns
                        </span>
                        <p className="mt-1 font-medium text-gray-800 dark:text-gray-200">
                          {formatCount(entry.columnCount)}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {history.length === 0 && (
                <div className="rounded-2xl border border-dashed border-gray-200/70 bg-white/40 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700/70 dark:bg-gray-950/25 dark:text-gray-400">
                  No transformations have been materialized yet.
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </motion.section>
  );
}
