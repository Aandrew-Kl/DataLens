"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Eye,
  Filter,
  FunctionSquare,
  GripVertical,
  Layers3,
  Link2,
  Loader2,
  Play,
  Plus,
  Sigma,
  Trash2,
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
  toCount,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataPipelineBuilderProps {
  tableName: string;
  columns: ColumnProfile[];
}

type StepType = "filter" | "map" | "aggregate" | "sort" | "join";
type FilterOperator = "=" | "!=" | ">" | ">=" | "<" | "<=" | "contains";
type AggregateFunction = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";
type SortDirection = "ASC" | "DESC";
type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL";

interface PipelineStep {
  id: string;
  type: StepType;
  title: string;
  filterColumn: string;
  filterOperator: FilterOperator;
  filterValue: string;
  expression: string;
  outputColumn: string;
  aggregateFunction: AggregateFunction;
  aggregateColumn: string;
  groupByColumns: string[];
  sortColumn: string;
  sortDirection: SortDirection;
  joinTable: string;
  joinType: JoinType;
  leftColumn: string;
  rightColumn: string;
  rightColumns: string;
}

interface CompiledStage {
  cteName: string;
  step: PipelineStep;
  sql: string;
}

interface StagePreview {
  id: string;
  title: string;
  rowCount: number;
  rows: Record<string, unknown>[];
}

interface PipelineRun {
  sql: string;
  stages: StagePreview[];
  finalRows: Record<string, unknown>[];
  finalRowCount: number;
}

interface StepCardProps {
  columns: string[];
  step: PipelineStep;
  index: number;
  total: number;
  preview: StagePreview | undefined;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onPatch: (patch: Partial<PipelineStep>) => void;
  onDragStart: (stepId: string) => void;
  onDrop: (stepId: string) => void;
}

const FILTER_OPERATORS = ["=", "!=", ">", ">=", "<", "<=", "contains"] as const;
const AGGREGATE_FUNCTIONS = ["COUNT", "SUM", "AVG", "MIN", "MAX"] as const;
const SORT_DIRECTIONS = ["ASC", "DESC"] as const;
const JOIN_TYPES = ["INNER", "LEFT", "RIGHT", "FULL"] as const;
const STEP_OPTIONS = [
  { type: "filter", label: "Filter", icon: Filter },
  { type: "map", label: "Map", icon: FunctionSquare },
  { type: "aggregate", label: "Aggregate", icon: Sigma },
  { type: "sort", label: "Sort", icon: Layers3 },
  { type: "join", label: "Join", icon: Link2 },
] as const satisfies ReadonlyArray<{
  type: StepType;
  label: string;
  icon: typeof Filter;
}>;

function createStepId() {
  return `pipeline-step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function parseCsvList(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function escapeCsvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  if (/[,"\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function buildTable(columns: Record<string, unknown>[]) {
  if (columns.length === 0) return "";
  const headers = Object.keys(columns[0] ?? {});
  return [
    headers.join(","),
    ...columns.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(",")),
  ].join("\n");
}

function makeStep(type: StepType, columns: ColumnProfile[]): PipelineStep {
  const firstColumn = columns[0]?.name ?? "";
  const firstNumeric = columns.find((column) => column.type === "number")?.name ?? firstColumn;
  return {
    id: createStepId(),
    type,
    title: `${type[0]?.toUpperCase() ?? ""}${type.slice(1)} step`,
    filterColumn: firstColumn,
    filterOperator: "=",
    filterValue: "",
    expression: firstColumn ? `LOWER(CAST(${quoteIdentifier(firstColumn)} AS VARCHAR))` : "NULL",
    outputColumn: firstColumn ? `${firstColumn}_mapped` : "mapped_value",
    aggregateFunction: "COUNT",
    aggregateColumn: firstNumeric,
    groupByColumns: firstColumn ? [firstColumn] : [],
    sortColumn: firstColumn,
    sortDirection: "ASC",
    joinTable: "",
    joinType: "LEFT",
    leftColumn: firstColumn,
    rightColumn: firstColumn,
    rightColumns: firstColumn,
  };
}

function toggleSelection(current: string[], value: string) {
  return current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value];
}

function moveStep(steps: PipelineStep[], index: number, direction: -1 | 1) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= steps.length) return steps;
  const next = [...steps];
  const [step] = next.splice(index, 1);
  next.splice(targetIndex, 0, step);
  return next;
}

function reorderSteps(steps: PipelineStep[], draggedId: string, targetId: string) {
  const draggedIndex = steps.findIndex((step) => step.id === draggedId);
  const targetIndex = steps.findIndex((step) => step.id === targetId);
  if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) {
    return steps;
  }
  const next = [...steps];
  const [step] = next.splice(draggedIndex, 1);
  next.splice(targetIndex, 0, step);
  return next;
}

function buildFilterClause(step: PipelineStep) {
  const column = quoteIdentifier(step.filterColumn);
  if (step.filterOperator === "contains") {
    return `${column} IS NOT NULL AND LOWER(CAST(${column} AS VARCHAR)) LIKE LOWER(${quoteLiteral(`%${step.filterValue}%`)})`;
  }
  return `${column} ${step.filterOperator} ${quoteLiteral(step.filterValue)}`;
}

function buildAggregateExpression(step: PipelineStep) {
  if (step.aggregateFunction === "COUNT") {
    return "COUNT(*)";
  }
  return `${step.aggregateFunction}(TRY_CAST(${quoteIdentifier(step.aggregateColumn)} AS DOUBLE))`;
}

function buildStepSql(step: PipelineStep, source: string) {
  if (step.type === "filter") {
    return `SELECT * FROM ${source} WHERE ${buildFilterClause(step)}`;
  }

  if (step.type === "map") {
    const alias = step.outputColumn.trim() || "mapped_value";
    const expression = step.expression.trim() || "NULL";
    return `SELECT *, ${expression} AS ${quoteIdentifier(alias)} FROM ${source}`;
  }

  if (step.type === "aggregate") {
    const groups = step.groupByColumns.filter(Boolean);
    const selectList = [
      ...groups.map((column) => quoteIdentifier(column)),
      `${buildAggregateExpression(step)} AS ${quoteIdentifier(step.outputColumn.trim() || "metric_value")}`,
    ];
    return [
      "SELECT",
      `  ${selectList.join(",\n  ")}`,
      `FROM ${source}`,
      groups.length > 0
        ? `GROUP BY ${groups.map((column) => quoteIdentifier(column)).join(", ")}`
        : "",
      groups.length > 0
        ? `ORDER BY ${groups.map((column) => quoteIdentifier(column)).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (step.type === "sort") {
    return `SELECT * FROM ${source} ORDER BY ${quoteIdentifier(step.sortColumn)} ${step.sortDirection} NULLS LAST`;
  }

  const selectedRightColumns = parseCsvList(step.rightColumns);
  const projections = selectedRightColumns
    .map((column) => `r.${quoteIdentifier(column)} AS ${quoteIdentifier(`join_${column}`)}`)
    .join(", ");

  return `SELECT l.*${projections ? `, ${projections}` : ""} FROM ${source} AS l ${step.joinType} JOIN ${quoteIdentifier(step.joinTable)} AS r ON l.${quoteIdentifier(step.leftColumn)} = r.${quoteIdentifier(step.rightColumn)}`;
}

function compilePipeline(tableName: string, steps: PipelineStep[]) {
  const compiledStages: CompiledStage[] = [];
  let source = quoteIdentifier(tableName);

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const cteName = `pipeline_builder_stage_${index + 1}`;
    const sql = buildStepSql(step, source);
    compiledStages.push({ cteName, step, sql });
    source = quoteIdentifier(cteName);
  }

  const withClause =
    compiledStages.length > 0
      ? `WITH ${compiledStages.map((stage) => `${quoteIdentifier(stage.cteName)} AS (${stage.sql})`).join(",\n")}`
      : "";
  const finalSql = withClause
    ? `${withClause}\nSELECT * FROM ${source}`
    : `SELECT * FROM ${quoteIdentifier(tableName)}`;

  return {
    finalSql,
    stages: compiledStages,
  };
}

async function previewStage(
  tableName: string,
  steps: PipelineStep[],
  stageIndex: number,
) {
  const compiled = compilePipeline(tableName, steps.slice(0, stageIndex + 1));
  const stage = compiled.stages[compiled.stages.length - 1];
  if (!stage) {
    return {
      id: `preview-${stageIndex}`,
      title: "Preview",
      rowCount: 0,
      rows: [],
    } satisfies StagePreview;
  }

  const rows = await runQuery(
    `${compiled.finalSql.replace(`SELECT * FROM ${quoteIdentifier(stage.cteName)}`, `SELECT * FROM ${quoteIdentifier(stage.cteName)} LIMIT 6`)}`,
  );
  const counts = await runQuery(
    `${compiled.finalSql.replace(`SELECT * FROM ${quoteIdentifier(stage.cteName)}`, `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(stage.cteName)}`)}`,
  );

  return {
    id: stage.step.id,
    title: stage.step.title,
    rowCount: toCount(counts[0]?.row_count),
    rows,
  } satisfies StagePreview;
}

function PreviewTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/20 px-4 py-5 text-sm text-slate-500 dark:text-slate-400">
        No preview rows yet.
      </div>
    );
  }

  const headers = Object.keys(rows[0] ?? {});
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/20">
      <table className="min-w-full text-left text-sm text-slate-700 dark:text-slate-200">
        <thead className="bg-slate-950/5 text-xs uppercase tracking-[0.16em] text-slate-500 dark:bg-white/5 dark:text-slate-400">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-4 py-3">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`preview-row-${index}`} className="border-t border-white/15">
              {headers.map((header) => (
                <td key={`${index}-${header}`} className="px-4 py-3 align-top">
                  {escapeCsvCell(row[header]) || "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PipelineStepCard({
  columns,
  step,
  index,
  total,
  preview,
  onMove,
  onRemove,
  onPatch,
  onDragStart,
  onDrop,
}: StepCardProps) {
  return (
    <motion.article
      layout
      draggable
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
      onDragStart={() => onDragStart(step.id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => onDrop(step.id)}
      className={`${GLASS_CARD_CLASS} space-y-4 p-5`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
            <GripVertical className="h-4 w-4" />
          </div>
          <div>
            <input
              aria-label={`Step title ${index + 1}`}
              value={step.title}
              onChange={(event) => onPatch({ title: event.currentTarget.value })}
              className="w-full bg-transparent text-base font-semibold text-slate-950 outline-none dark:text-white"
            />
            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {step.type} step
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className={BUTTON_CLASS}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            className={BUTTON_CLASS}
          >
            <ArrowDown className="h-4 w-4" />
          </button>
          <button type="button" onClick={onRemove} className={BUTTON_CLASS}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {step.type === "filter" ? (
          <>
            <select
              aria-label={`Filter column ${index + 1}`}
              value={step.filterColumn}
              onChange={(event) => onPatch({ filterColumn: event.currentTarget.value })}
              className={FIELD_CLASS}
            >
              {columns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
            <select
              aria-label={`Filter operator ${index + 1}`}
              value={step.filterOperator}
              onChange={(event) =>
                onPatch({ filterOperator: event.currentTarget.value as FilterOperator })
              }
              className={FIELD_CLASS}
            >
              {FILTER_OPERATORS.map((operator) => (
                <option key={operator} value={operator}>
                  {operator}
                </option>
              ))}
            </select>
            <input
              aria-label={`Filter value ${index + 1}`}
              value={step.filterValue}
              onChange={(event) => onPatch({ filterValue: event.currentTarget.value })}
              className={`${FIELD_CLASS} md:col-span-2`}
              placeholder="Comparison value"
            />
          </>
        ) : null}

        {step.type === "map" ? (
          <>
            <input
              aria-label={`Map expression ${index + 1}`}
              value={step.expression}
              onChange={(event) => onPatch({ expression: event.currentTarget.value })}
              className={`${FIELD_CLASS} md:col-span-2`}
              placeholder='Example: CONCAT("city", " / ", "region")'
            />
            <input
              aria-label={`Output column ${index + 1}`}
              value={step.outputColumn}
              onChange={(event) => onPatch({ outputColumn: event.currentTarget.value })}
              className={FIELD_CLASS}
              placeholder="Output column"
            />
          </>
        ) : null}

        {step.type === "aggregate" ? (
          <>
            <div className="space-y-2 md:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Group by
              </p>
              <div className="flex flex-wrap gap-2">
                {columns.map((column) => {
                  const selected = step.groupByColumns.includes(column);
                  return (
                    <button
                      key={column}
                      type="button"
                      onClick={() =>
                        onPatch({ groupByColumns: toggleSelection(step.groupByColumns, column) })
                      }
                      className={
                        selected
                          ? "rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-700 dark:text-cyan-300"
                          : "rounded-full border border-white/20 bg-white/60 px-3 py-1.5 text-sm text-slate-600 dark:bg-slate-950/40 dark:text-slate-300"
                      }
                    >
                      {column}
                    </button>
                  );
                })}
              </div>
            </div>
            <select
              aria-label={`Aggregate function ${index + 1}`}
              value={step.aggregateFunction}
              onChange={(event) =>
                onPatch({ aggregateFunction: event.currentTarget.value as AggregateFunction })
              }
              className={FIELD_CLASS}
            >
              {AGGREGATE_FUNCTIONS.map((aggregation) => (
                <option key={aggregation} value={aggregation}>
                  {aggregation}
                </option>
              ))}
            </select>
            <select
              aria-label={`Aggregate column ${index + 1}`}
              value={step.aggregateColumn}
              onChange={(event) => onPatch({ aggregateColumn: event.currentTarget.value })}
              className={FIELD_CLASS}
            >
              {columns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
            <input
              aria-label={`Aggregate alias ${index + 1}`}
              value={step.outputColumn}
              onChange={(event) => onPatch({ outputColumn: event.currentTarget.value })}
              className={`${FIELD_CLASS} md:col-span-2`}
              placeholder="Metric alias"
            />
          </>
        ) : null}

        {step.type === "sort" ? (
          <>
            <select
              aria-label={`Sort column ${index + 1}`}
              value={step.sortColumn}
              onChange={(event) => onPatch({ sortColumn: event.currentTarget.value })}
              className={FIELD_CLASS}
            >
              {columns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
            <select
              aria-label={`Sort direction ${index + 1}`}
              value={step.sortDirection}
              onChange={(event) =>
                onPatch({ sortDirection: event.currentTarget.value as SortDirection })
              }
              className={FIELD_CLASS}
            >
              {SORT_DIRECTIONS.map((direction) => (
                <option key={direction} value={direction}>
                  {direction}
                </option>
              ))}
            </select>
          </>
        ) : null}

        {step.type === "join" ? (
          <>
            <input
              aria-label={`Join table ${index + 1}`}
              value={step.joinTable}
              onChange={(event) => onPatch({ joinTable: event.currentTarget.value })}
              className={FIELD_CLASS}
              placeholder="Right-side table"
            />
            <select
              aria-label={`Join type ${index + 1}`}
              value={step.joinType}
              onChange={(event) => onPatch({ joinType: event.currentTarget.value as JoinType })}
              className={FIELD_CLASS}
            >
              {JOIN_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <select
              aria-label={`Left join column ${index + 1}`}
              value={step.leftColumn}
              onChange={(event) => onPatch({ leftColumn: event.currentTarget.value })}
              className={FIELD_CLASS}
            >
              {columns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
            <input
              aria-label={`Right join column ${index + 1}`}
              value={step.rightColumn}
              onChange={(event) => onPatch({ rightColumn: event.currentTarget.value })}
              className={FIELD_CLASS}
              placeholder="Right-side key"
            />
            <input
              aria-label={`Right join columns ${index + 1}`}
              value={step.rightColumns}
              onChange={(event) => onPatch({ rightColumns: event.currentTarget.value })}
              className={`${FIELD_CLASS} md:col-span-2`}
              placeholder="Comma-separated columns to include"
            />
          </>
        ) : null}
      </div>

      {preview ? (
        <div className="space-y-3 rounded-2xl border border-white/20 bg-white/45 p-4 dark:bg-slate-950/20">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Step preview</p>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              {formatNumber(preview.rowCount)} rows
            </p>
          </div>
          <PreviewTable rows={preview.rows} />
        </div>
      ) : null}
    </motion.article>
  );
}

export default function DataPipelineBuilder({
  tableName,
  columns,
}: DataPipelineBuilderProps) {
  const columnNames = useMemo(() => columns.map((column) => column.name), [columns]);
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [draggedStepId, setDraggedStepId] = useState<string | null>(null);
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(
    "Add steps, drag them into order, preview each stage, then execute the full pipeline.",
  );

  const compiled = useMemo(() => compilePipeline(tableName, steps), [steps, tableName]);

  async function handlePreview() {
    if (steps.length === 0) {
      setNotice("Add at least one pipeline step before previewing.");
      return;
    }

    setLoading(true);
    setNotice("Previewing every pipeline stage...");

    try {
      const stagePreviews: StagePreview[] = [];
      for (let index = 0; index < steps.length; index += 1) {
        stagePreviews.push(await previewStage(tableName, steps, index));
      }
      const finalRows = await runQuery(`SELECT * FROM (${compiled.finalSql}) AS pipeline_preview LIMIT 12`);
      const finalCounts = await runQuery(
        `SELECT COUNT(*) AS row_count FROM (${compiled.finalSql}) AS pipeline_count`,
      );
      setRun({
        sql: compiled.finalSql,
        stages: stagePreviews,
        finalRows,
        finalRowCount: toCount(finalCounts[0]?.row_count),
      });
      setNotice(`Previewed ${formatNumber(stagePreviews.length)} stages successfully.`);
    } catch (error) {
      setRun(null);
      setNotice(error instanceof Error ? error.message : "Pipeline preview failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleExecute() {
    if (steps.length === 0) {
      setNotice("Add steps before executing the pipeline.");
      return;
    }

    setLoading(true);
    setNotice("Executing full pipeline...");

    try {
      const finalRows = await runQuery(`SELECT * FROM (${compiled.finalSql}) AS pipeline_result LIMIT 20`);
      const finalCounts = await runQuery(
        `SELECT COUNT(*) AS row_count FROM (${compiled.finalSql}) AS pipeline_total`,
      );
      setRun((current) => ({
        sql: compiled.finalSql,
        stages: current?.stages ?? [],
        finalRows,
        finalRowCount: toCount(finalCounts[0]?.row_count),
      }));
      setNotice(`Executed pipeline with ${formatNumber(toCount(finalCounts[0]?.row_count))} output rows.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Pipeline execution failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleExportJson() {
    downloadFile(
      JSON.stringify({ tableName, steps }, null, 2),
      `${tableName}-pipeline.json`,
      "application/json;charset=utf-8;",
    );
  }

  function updateStep(stepId: string, patch: Partial<PipelineStep>) {
    setSteps((current) =>
      current.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
    );
  }

  const previewsById = run?.stages.reduce<Record<string, StagePreview>>((collection, preview) => {
    collection[preview.id] = preview;
    return collection;
  }, {});

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} space-y-6 p-6`}
    >
      <div className="flex flex-col gap-4 border-b border-white/20 pb-6 dark:border-white/10 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
            <Layers3 className="h-3.5 w-3.5" />
            Data Pipeline Builder
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
              Chain transforms, preview each stage, and export the full pipeline
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Build a visual flow with filter, map, aggregate, sort, and join steps.
              Drag cards to reorder execution, inspect the rows emitted by every step, and
              export the pipeline definition as JSON.
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {STEP_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.type}
                type="button"
                onClick={() => setSteps((current) => [...current, makeStep(option.type, columns)])}
                className={BUTTON_CLASS}
              >
                <Plus className="h-4 w-4" />
                <Icon className="h-4 w-4" />
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={handlePreview} className={BUTTON_CLASS}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Preview stages
            </button>
            <button type="button" onClick={handleExecute} className={BUTTON_CLASS}>
              <Play className="h-4 w-4" />
              Execute full pipeline
            </button>
            <button type="button" onClick={handleExportJson} className={BUTTON_CLASS}>
              <Download className="h-4 w-4" />
              Export pipeline JSON
            </button>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">{notice}</p>

          {steps.length === 0 ? (
            <div className={`${GLASS_CARD_CLASS} border-dashed p-8 text-center`}>
              <p className="text-base font-semibold text-slate-900 dark:text-white">No steps yet</p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Start with a filter or map step, then drag cards to change the execution order.
              </p>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {steps.map((step, index) => (
                <PipelineStepCard
                  key={step.id}
                  columns={columnNames}
                  step={step}
                  index={index}
                  total={steps.length}
                  preview={previewsById?.[step.id]}
                  onMove={(direction) =>
                    setSteps((current) => moveStep(current, index, direction))
                  }
                  onRemove={() =>
                    setSteps((current) => current.filter((entry) => entry.id !== step.id))
                  }
                  onPatch={(patch) => updateStep(step.id, patch)}
                  onDragStart={(stepId) => setDraggedStepId(stepId)}
                  onDrop={(targetId) =>
                    setSteps((current) =>
                      draggedStepId ? reorderSteps(current, draggedStepId, targetId) : current,
                    )
                  }
                />
              ))}
            </AnimatePresence>
          )}
        </div>

        <div className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Compiled SQL</p>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                {formatNumber(steps.length)} steps
              </p>
            </div>
            <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-950 px-4 py-4 text-xs leading-6 text-slate-100">
              {compiled.finalSql}
            </pre>
          </div>

          <div className={`${GLASS_CARD_CLASS} space-y-4 p-5`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Final output</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {run ? `${formatNumber(run.finalRowCount)} rows after execution` : "Run the pipeline to inspect the output."}
                </p>
              </div>
              {run?.finalRows.length ? (
                <button
                  type="button"
                  onClick={() =>
                    downloadFile(
                      buildTable(
                        run.finalRows.filter((row): row is Record<string, unknown> => isRecord(row)),
                      ),
                      `${tableName}-pipeline-output.csv`,
                      "text/csv;charset=utf-8;",
                    )
                  }
                  className={BUTTON_CLASS}
                >
                  <Download className="h-4 w-4" />
                  Export output CSV
                </button>
              ) : null}
            </div>
            <PreviewTable rows={run?.finalRows ?? []} />
          </div>
        </div>
      </div>
    </motion.section>
  );
}
