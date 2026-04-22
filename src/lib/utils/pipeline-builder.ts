import { buildMetricExpression, quoteIdentifier } from "@/lib/utils/sql";
import type { ColumnProfile } from "@/types/dataset";

export type StepType =
  | "filter"
  | "sort"
  | "group"
  | "aggregate"
  | "join"
  | "rename"
  | "cast"
  | "add-column"
  | "remove-column"
  | "deduplicate"
  | "sample";

export type FilterOperator = "=" | "!=" | ">" | ">=" | "<" | "<=" | "contains";
export type SortDirection = "ASC" | "DESC";
export type AggregateFunction = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";
export type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL";
export type SampleMode = "rows" | "percent";

export interface PipelineStep {
  id: string;
  type: StepType;
  column: string;
  operator: FilterOperator;
  value: string;
  direction: SortDirection;
  columns: string[];
  groupColumns: string[];
  aggregateFunction: AggregateFunction;
  aggregateColumn: string;
  aggregateAlias: string;
  joinTable: string;
  joinType: JoinType;
  leftColumn: string;
  rightColumn: string;
  rightColumns: string;
  newName: string;
  newType: string;
  expression: string;
  sampleMode: SampleMode;
  sampleSize: number;
}

export interface SavedPipeline {
  id: string;
  name: string;
  savedAt: number;
  steps: PipelineStep[];
}

export interface CompiledPipeline {
  sql: string;
  columns: string[];
}

export const STEP_META: Record<StepType, { label: string; hint: string }> = {
  filter: { label: "Filter", hint: "Keep rows matching a condition." },
  sort: { label: "Sort", hint: "Order rows before downstream steps." },
  group: { label: "Group By", hint: "Collapse rows into grouped dimensions." },
  aggregate: { label: "Aggregate", hint: "Compute a summary metric." },
  join: { label: "Join", hint: "Bring in columns from another table." },
  rename: { label: "Rename", hint: "Rename a column in the flow." },
  cast: { label: "Cast Type", hint: "Convert a column to another SQL type." },
  "add-column": { label: "Add Column", hint: "Create a new calculated field." },
  "remove-column": { label: "Remove Column", hint: "Drop columns from the result." },
  deduplicate: { label: "Deduplicate", hint: "Keep one row per key set." },
  sample: { label: "Sample", hint: "Preview a slice of the pipeline output." },
};
function quoteLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseCsvList(value: string) {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function projection(columns: string[], mutate: (column: string) => string) {
  return columns.map((column) => mutate(column)).join(", ");
}

export function createPipelineStep(type: StepType, columns: ColumnProfile[]): PipelineStep {
  const first = columns[0]?.name ?? "";
  const numeric = columns.find((column) => column.type === "number")?.name ?? first;
  return {
    id: makeId(),
    type,
    column: first,
    operator: "=",
    value: "",
    direction: "ASC",
    columns: first ? [first] : [],
    groupColumns: first ? [first] : [],
    aggregateFunction: "COUNT",
    aggregateColumn: numeric,
    aggregateAlias: "metric_value",
    joinTable: "",
    joinType: "LEFT",
    leftColumn: first,
    rightColumn: first,
    rightColumns: first,
    newName: `${first || "column"}_new`,
    newType: "DOUBLE",
    expression: "",
    sampleMode: "rows",
    sampleSize: 100,
  };
}

export function toggleSelection(selection: string[], name: string) {
  return selection.includes(name) ? selection.filter((column) => column !== name) : [...selection, name];
}

export function compilePipeline(tableName: string, baseColumns: ColumnProfile[], steps: PipelineStep[]): CompiledPipeline {
  let currentSource = quoteIdentifier(tableName);
  let currentColumns = baseColumns.map((column) => column.name);
  const ctes: string[] = [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const cte = `pipeline_step_${index + 1}`;
    let sql = "";

    if (step.type === "filter") {
      const safeColumn = quoteIdentifier(step.column);
      const clause = step.operator === "contains" ? `${safeColumn} IS NOT NULL AND LOWER(CAST(${safeColumn} AS VARCHAR)) LIKE LOWER(${quoteLiteral(`%${step.value}%`)})` : `${safeColumn} ${step.operator} ${quoteLiteral(step.value)}`;
      sql = `SELECT * FROM ${currentSource} WHERE ${clause}`;
    } else if (step.type === "sort") {
      sql = `SELECT * FROM ${currentSource} ORDER BY ${quoteIdentifier(step.column)} ${step.direction} NULLS LAST`;
    } else if (step.type === "group") {
      const groups = step.groupColumns.length ? step.groupColumns : [step.column];
      sql = `SELECT ${groups.map(quoteIdentifier).join(", ")} FROM ${currentSource} GROUP BY ${groups.map(quoteIdentifier).join(", ")}`;
      currentColumns = [...groups];
    } else if (step.type === "aggregate") {
      const groups = step.groupColumns.filter(Boolean);
      const metric =
        step.aggregateFunction === "COUNT" && step.aggregateColumn
          ? `COUNT(${quoteIdentifier(step.aggregateColumn)})`
          : buildMetricExpression(step.aggregateFunction, step.aggregateColumn || undefined, quoteIdentifier, { cast: false });
      sql = `SELECT ${groups.length ? `${groups.map(quoteIdentifier).join(", ")}, ` : ""}${metric} AS ${quoteIdentifier(step.aggregateAlias || "metric_value")} FROM ${currentSource}${groups.length ? ` GROUP BY ${groups.map(quoteIdentifier).join(", ")}` : ""}`;
      currentColumns = [...groups, step.aggregateAlias || "metric_value"];
    } else if (step.type === "join") {
      const rightColumns = parseCsvList(step.rightColumns);
      const extra = rightColumns.map((column) => `r.${quoteIdentifier(column)} AS ${quoteIdentifier(`join_${column}`)}`).join(", ");
      sql = `SELECT l.*${extra ? `, ${extra}` : ""} FROM ${currentSource} AS l ${step.joinType} JOIN ${quoteIdentifier(step.joinTable)} AS r ON l.${quoteIdentifier(step.leftColumn)} = r.${quoteIdentifier(step.rightColumn)}`;
      currentColumns = [...currentColumns, ...rightColumns.map((column) => `join_${column}`)];
    } else if (step.type === "rename") {
      const target = step.newName.trim() || `${step.column}_renamed`;
      sql = `SELECT ${projection(currentColumns, (column) => column === step.column ? `${quoteIdentifier(column)} AS ${quoteIdentifier(target)}` : quoteIdentifier(column))} FROM ${currentSource}`;
      currentColumns = currentColumns.map((column) => (column === step.column ? target : column));
    } else if (step.type === "cast") {
      sql = `SELECT * REPLACE (CAST(${quoteIdentifier(step.column)} AS ${step.newType}) AS ${quoteIdentifier(step.column)}) FROM ${currentSource}`;
    } else if (step.type === "add-column") {
      const target = step.newName.trim() || "computed_column";
      sql = `SELECT *, ${step.expression || "NULL"} AS ${quoteIdentifier(target)} FROM ${currentSource}`;
      currentColumns = [...currentColumns, target];
    } else if (step.type === "remove-column") {
      const removeColumns = step.columns.length ? step.columns : [step.column];
      sql = `SELECT * EXCLUDE (${removeColumns.map(quoteIdentifier).join(", ")}) FROM ${currentSource}`;
      currentColumns = currentColumns.filter((column) => !removeColumns.includes(column));
    } else if (step.type === "deduplicate") {
      const keys = step.columns.length ? step.columns : currentColumns;
      sql = `WITH dedupe AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY ${keys.map(quoteIdentifier).join(", ")} ORDER BY ${keys.map(quoteIdentifier).join(", ")}) AS __rn FROM ${currentSource}) SELECT * EXCLUDE (__rn) FROM dedupe WHERE __rn = 1`;
    } else if (step.type === "sample") {
      const sampleSize = Math.max(1, Math.round(step.sampleSize));
      sql = step.sampleMode === "percent" ? `SELECT * FROM ${currentSource} USING SAMPLE ${sampleSize} PERCENT` : `SELECT * FROM ${currentSource} USING SAMPLE ${sampleSize} ROWS`;
    }

    if (!sql) continue;
    ctes.push(`${quoteIdentifier(cte)} AS (${sql})`);
    currentSource = quoteIdentifier(cte);
  }

  return { sql: ctes.length ? `WITH ${ctes.join(",\n")} SELECT * FROM ${currentSource}` : `SELECT * FROM ${quoteIdentifier(tableName)}`, columns: currentColumns };
}
