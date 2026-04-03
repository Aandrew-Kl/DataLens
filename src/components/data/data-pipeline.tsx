"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  DatabaseZap,
  Download,
  Eye,
  Filter,
  GitBranchPlus,
  GripVertical,
  Loader2,
  Play,
  Plus,
  Rows4,
  Save,
  Sigma,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataPipelineProps {
  tableName: string;
  columns: ColumnProfile[];
}

type StepType =
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
type FilterOperator = "=" | "!=" | ">" | ">=" | "<" | "<=" | "contains";
type SortDirection = "ASC" | "DESC";
type AggregateFunction = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";
type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL";
type SampleMode = "rows" | "percent";
type Notice = { tone: "error" | "success" | "info"; message: string } | null;

interface PipelineStep {
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

interface SavedPipeline {
  id: string;
  name: string;
  savedAt: number;
  steps: PipelineStep[];
}

interface CompiledPipeline {
  sql: string;
  columns: string[];
}

const ease = [0.22, 1, 0.36, 1] as const;
const panelClass =
  "overflow-hidden rounded-[28px] border border-white/20 bg-white/75 shadow-[0_24px_90px_-48px_rgba(15,23,42,0.75)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const fieldClass =
  "w-full rounded-2xl border border-slate-200/70 bg-white/85 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700/70 dark:bg-slate-950/65 dark:text-slate-100";
const STORAGE_KEY = "datalens:pipelines";

const STEP_META: Record<StepType, { label: string; icon: typeof Filter; hint: string }> = {
  filter: { label: "Filter", icon: Filter, hint: "Keep rows matching a condition." },
  sort: { label: "Sort", icon: ArrowDown, hint: "Order rows before downstream steps." },
  group: { label: "Group By", icon: Rows4, hint: "Collapse rows into grouped dimensions." },
  aggregate: { label: "Aggregate", icon: Sigma, hint: "Compute a summary metric." },
  join: { label: "Join", icon: GitBranchPlus, hint: "Bring in columns from another table." },
  rename: { label: "Rename", icon: WandSparkles, hint: "Rename a column in the flow." },
  cast: { label: "Cast Type", icon: DatabaseZap, hint: "Convert a column to another SQL type." },
  "add-column": { label: "Add Column", icon: Plus, hint: "Create a new calculated field." },
  "remove-column": { label: "Remove Column", icon: Trash2, hint: "Drop columns from the result." },
  deduplicate: { label: "Deduplicate", icon: Rows4, hint: "Keep one row per key set." },
  sample: { label: "Sample", icon: Eye, hint: "Preview a slice of the pipeline output." },
};

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseCsvList(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function createStep(type: StepType, columns: ColumnProfile[]): PipelineStep {
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

function loadPipelines(tableName: string) {
  if (typeof window === "undefined") return [] as SavedPipeline[];
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY}:${tableName}`);
    const parsed = raw ? (JSON.parse(raw) as SavedPipeline[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePipelines(tableName: string, pipelines: SavedPipeline[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${STORAGE_KEY}:${tableName}`, JSON.stringify(pipelines.slice(0, 12)));
}

function withColumns(currentColumns: string[], replace: { from: string; to: string }) {
  return currentColumns.map((column) => (column === replace.from ? replace.to : column));
}

function buildSelectProjection(currentColumns: string[], mutate: (column: string) => string) {
  return currentColumns.map((column) => mutate(column)).join(", ");
}

function compilePipeline(tableName: string, baseColumns: ColumnProfile[], steps: PipelineStep[]): CompiledPipeline {
  let currentSource = quoteIdentifier(tableName);
  let currentColumns = baseColumns.map((column) => column.name);
  const ctes: string[] = [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const cte = `pipeline_step_${index + 1}`;
    let stepSql = "";

    if (step.type === "filter") {
      const safeColumn = quoteIdentifier(step.column);
      const clause =
        step.operator === "contains"
          ? `${safeColumn} IS NOT NULL AND LOWER(CAST(${safeColumn} AS VARCHAR)) LIKE LOWER(${quoteLiteral(`%${step.value}%`)})`
          : `${safeColumn} ${step.operator} ${quoteLiteral(step.value)}`;
      stepSql = `SELECT * FROM ${currentSource} WHERE ${clause}`;
    }

    if (step.type === "sort") {
      stepSql = `SELECT * FROM ${currentSource} ORDER BY ${quoteIdentifier(step.column)} ${step.direction} NULLS LAST`;
    }

    if (step.type === "group") {
      const groups = step.groupColumns.length ? step.groupColumns : [step.column];
      stepSql = `SELECT ${groups.map(quoteIdentifier).join(", ")} FROM ${currentSource} GROUP BY ${groups.map(quoteIdentifier).join(", ")}`;
      currentColumns = [...groups];
    }

    if (step.type === "aggregate") {
      const groups = step.groupColumns.filter(Boolean);
      const groupSql = groups.length ? `${groups.map(quoteIdentifier).join(", ")}, ` : "";
      const metric = step.aggregateFunction === "COUNT" && !step.aggregateColumn ? "COUNT(*)" : `${step.aggregateFunction}(${quoteIdentifier(step.aggregateColumn)})`;
      stepSql = `SELECT ${groupSql}${metric} AS ${quoteIdentifier(step.aggregateAlias || "metric_value")} FROM ${currentSource}${groups.length ? ` GROUP BY ${groups.map(quoteIdentifier).join(", ")}` : ""}`;
      currentColumns = [...groups, step.aggregateAlias || "metric_value"];
    }

    if (step.type === "join") {
      const rightColumns = parseCsvList(step.rightColumns);
      const projections = rightColumns.length
        ? rightColumns.map((column) => `r.${quoteIdentifier(column)} AS ${quoteIdentifier(`join_${column}`)}`).join(", ")
        : "";
      stepSql = `SELECT l.*${projections ? `, ${projections}` : ""} FROM ${currentSource} AS l ${step.joinType} JOIN ${quoteIdentifier(step.joinTable)} AS r ON l.${quoteIdentifier(step.leftColumn)} = r.${quoteIdentifier(step.rightColumn)}`;
      currentColumns = [...currentColumns, ...rightColumns.map((column) => `join_${column}`)];
    }

    if (step.type === "rename") {
      const target = step.newName.trim() || `${step.column}_renamed`;
      stepSql = `SELECT ${buildSelectProjection(currentColumns, (column) => column === step.column ? `${quoteIdentifier(column)} AS ${quoteIdentifier(target)}` : quoteIdentifier(column))} FROM ${currentSource}`;
      currentColumns = withColumns(currentColumns, { from: step.column, to: target });
    }

    if (step.type === "cast") {
      stepSql = `SELECT * REPLACE (CAST(${quoteIdentifier(step.column)} AS ${step.newType}) AS ${quoteIdentifier(step.column)}) FROM ${currentSource}`;
    }

    if (step.type === "add-column") {
      const target = step.newName.trim() || "computed_column";
      stepSql = `SELECT *, ${step.expression || "NULL"} AS ${quoteIdentifier(target)} FROM ${currentSource}`;
      currentColumns = [...currentColumns, target];
    }

    if (step.type === "remove-column") {
      const removeColumns = step.columns.length ? step.columns : [step.column];
      stepSql = `SELECT * EXCLUDE (${removeColumns.map(quoteIdentifier).join(", ")}) FROM ${currentSource}`;
      currentColumns = currentColumns.filter((column) => !removeColumns.includes(column));
    }

    if (step.type === "deduplicate") {
      const keys = step.columns.length ? step.columns : currentColumns;
      stepSql = `WITH dedupe AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY ${keys.map(quoteIdentifier).join(", ")} ORDER BY ${keys.map(quoteIdentifier).join(", ")}) AS __rn FROM ${currentSource}) SELECT * EXCLUDE (__rn) FROM dedupe WHERE __rn = 1`;
    }

    if (step.type === "sample") {
      const sampleSize = Math.max(1, Math.round(step.sampleSize));
      stepSql = step.sampleMode === "percent" ? `SELECT * FROM ${currentSource} USING SAMPLE ${sampleSize} PERCENT` : `SELECT * FROM ${currentSource} USING SAMPLE ${sampleSize} ROWS`;
    }

    if (!stepSql) continue;
    ctes.push(`${quoteIdentifier(cte)} AS (${stepSql})`);
    currentSource = quoteIdentifier(cte);
  }

  return {
    sql: ctes.length ? `WITH ${ctes.join(",\n")} SELECT * FROM ${currentSource}` : `SELECT * FROM ${quoteIdentifier(tableName)}`,
    columns: currentColumns,
  };
}

export default function DataPipeline({ tableName, columns }: DataPipelineProps) {
  const columnNames = useMemo(() => columns.map((column) => column.name), [columns]);
  const deferredColumns = useDeferredValue(columns);
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [savedPipelines, setSavedPipelines] = useState<SavedPipeline[]>([]);
  const [pipelineName, setPipelineName] = useState("");
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [previewColumns, setPreviewColumns] = useState<string[]>(columnNames);
  const [previewCount, setPreviewCount] = useState(0);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [runningPipeline, setRunningPipeline] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    setSavedPipelines(loadPipelines(tableName));
  }, [tableName]);

  const compiled = useMemo(() => compilePipeline(tableName, deferredColumns, steps), [deferredColumns, steps, tableName]);

  useEffect(() => {
    let cancelled = false;
    async function refreshPreview() {
      setLoadingPreview(true);
      try {
        const [rows, countRows] = await Promise.all([
          runQuery(`SELECT * FROM (${compiled.sql}) AS pipeline_preview LIMIT 100`),
          runQuery(`SELECT COUNT(*) AS cnt FROM (${compiled.sql}) AS pipeline_count`),
        ]);
        if (cancelled) return;
        startTransition(() => {
          setPreviewRows(rows);
          setPreviewColumns(compiled.columns.length ? compiled.columns : Object.keys(rows[0] ?? {}));
          setPreviewCount(Number(countRows[0]?.cnt ?? 0));
        });
      } catch (cause) {
        if (cancelled) return;
        setPreviewRows([]);
        setPreviewCount(0);
        setNotice({ tone: "error", message: cause instanceof Error ? cause.message : "Preview query failed." });
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }
    void refreshPreview();
    return () => {
      cancelled = true;
    };
  }, [compiled]);

  function updateStep(stepId: string, patch: Partial<PipelineStep>) {
    setSteps((current) => current.map((step) => (step.id === stepId ? { ...step, ...patch } : step)));
  }

  function moveStep(stepId: string, direction: -1 | 1) {
    setSteps((current) => {
      const index = current.findIndex((step) => step.id === stepId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function toggleColumn(selection: string[], name: string) {
    return selection.includes(name) ? selection.filter((column) => column !== name) : [...selection, name];
  }

  function handleAddStep(type: StepType) {
    setSteps((current) => [...current, createStep(type, columns)]);
  }

  function handleSavePipeline() {
    const name = pipelineName.trim() || `${tableName} pipeline`;
    const snapshot: SavedPipeline = { id: makeId(), name, savedAt: Date.now(), steps };
    const next = [snapshot, ...savedPipelines].slice(0, 12);
    setSavedPipelines(next);
    savePipelines(tableName, next);
    setNotice({ tone: "success", message: `Saved "${name}" to localStorage.` });
  }

  async function handleRunPipeline() {
    setRunningPipeline(true);
    try {
      const countRows = await runQuery(`SELECT COUNT(*) AS cnt FROM (${compiled.sql}) AS pipeline_run`);
      setNotice({ tone: "success", message: `Pipeline executed successfully. Final result contains ${formatNumber(Number(countRows[0]?.cnt ?? 0))} rows.` });
    } catch (cause) {
      setNotice({ tone: "error", message: cause instanceof Error ? cause.message : "Pipeline execution failed." });
    } finally {
      setRunningPipeline(false);
    }
  }

  return (
    <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.38, ease }} className={panelClass}>
      <div className="border-b border-white/15 px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:border-cyan-500/20 dark:text-cyan-300"><GitBranchPlus className="h-3.5 w-3.5" />Data pipeline</div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Compose a visual DuckDB workflow</h2>
            <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">Each card becomes a CTE step. The live preview, full run, and SQL export all use the same compiled query so the workflow stays consistent.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleRunPipeline} disabled={runningPipeline} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60">{runningPipeline ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Run pipeline</button>
            <button type="button" onClick={() => downloadFile(`${compiled.sql};\n`, `${tableName}-pipeline.sql`, "text/sql;charset=utf-8;")} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300/80 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900/60"><Download className="h-4 w-4" />Export SQL</button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 px-6 py-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(Object.keys(STEP_META) as StepType[]).map((type) => (
              <button key={type} type="button" onClick={() => handleAddStep(type)} className="rounded-3xl border border-slate-200/70 bg-white/65 p-4 text-left transition hover:border-cyan-300 dark:border-slate-700/70 dark:bg-slate-950/35 dark:hover:border-cyan-500/35">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"><STEP_META[type].icon className="h-4 w-4 text-cyan-500" />{STEP_META[type].label}</div>
                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{STEP_META[type].hint}</p>
              </button>
            ))}
          </div>

          <div className="relative space-y-4">
            {steps.length > 1 && <div className="absolute left-5 top-5 bottom-5 w-px bg-gradient-to-b from-cyan-400/30 via-cyan-500/15 to-transparent" />}
            <AnimatePresence>
              {steps.map((step, index) => (
                <motion.div key={step.id} layout initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.26, ease }} className="relative rounded-[26px] border border-slate-200/70 bg-white/75 p-5 dark:border-slate-800 dark:bg-slate-950/40">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">{index + 1}</div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"><GripVertical className="h-4 w-4 text-slate-400" />{STEP_META[step.type].label}</div>
                        <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{STEP_META[step.type].hint}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => moveStep(step.id, -1)} disabled={index === 0} className="rounded-xl border border-slate-300/80 p-2 text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900/60"><ArrowUp className="h-4 w-4" /></button>
                      <button type="button" onClick={() => moveStep(step.id, 1)} disabled={index === steps.length - 1} className="rounded-xl border border-slate-300/80 p-2 text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900/60"><ArrowDown className="h-4 w-4" /></button>
                      <button type="button" onClick={() => setSteps((current) => current.filter((item) => item.id !== step.id))} className="rounded-xl border border-rose-300/60 p-2 text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {step.type === "filter" && (
                      <>
                        <select value={step.column} onChange={(event) => updateStep(step.id, { column: event.target.value })} className={fieldClass}>{columnNames.map((name) => <option key={name} value={name}>{name}</option>)}</select>
                        <select value={step.operator} onChange={(event) => updateStep(step.id, { operator: event.target.value as FilterOperator })} className={fieldClass}>{["=", "!=", ">", ">=", "<", "<=", "contains"].map((operator) => <option key={operator} value={operator}>{operator}</option>)}</select>
                        <input value={step.value} onChange={(event) => updateStep(step.id, { value: event.target.value })} placeholder="Value" className={fieldClass} />
                      </>
                    )}

                    {step.type === "sort" && (
                      <>
                        <select value={step.column} onChange={(event) => updateStep(step.id, { column: event.target.value })} className={fieldClass}>{columnNames.map((name) => <option key={name} value={name}>{name}</option>)}</select>
                        <select value={step.direction} onChange={(event) => updateStep(step.id, { direction: event.target.value as SortDirection })} className={fieldClass}><option value="ASC">Ascending</option><option value="DESC">Descending</option></select>
                      </>
                    )}

                    {step.type === "group" && (
                      <div className="md:col-span-2 space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Grouping keys</p>
                        <div className="flex flex-wrap gap-2">{columnNames.map((name) => <button key={name} type="button" onClick={() => updateStep(step.id, { groupColumns: toggleColumn(step.groupColumns, name) })} className={`rounded-full border px-3 py-1.5 text-sm transition ${step.groupColumns.includes(name) ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-700 dark:border-cyan-500/35 dark:text-cyan-300" : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300"}`}>{name}</button>)}</div>
                      </div>
                    )}

                    {step.type === "aggregate" && (
                      <>
                        <div className="md:col-span-2 space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Optional group keys</p>
                          <div className="flex flex-wrap gap-2">{columnNames.map((name) => <button key={name} type="button" onClick={() => updateStep(step.id, { groupColumns: toggleColumn(step.groupColumns, name) })} className={`rounded-full border px-3 py-1.5 text-sm transition ${step.groupColumns.includes(name) ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-700 dark:border-cyan-500/35 dark:text-cyan-300" : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300"}`}>{name}</button>)}</div>
                        </div>
                        <select value={step.aggregateFunction} onChange={(event) => updateStep(step.id, { aggregateFunction: event.target.value as AggregateFunction })} className={fieldClass}>{["COUNT", "SUM", "AVG", "MIN", "MAX"].map((aggregation) => <option key={aggregation} value={aggregation}>{aggregation}</option>)}</select>
                        <select value={step.aggregateColumn} onChange={(event) => updateStep(step.id, { aggregateColumn: event.target.value })} className={fieldClass}>{columnNames.map((name) => <option key={name} value={name}>{name}</option>)}</select>
                        <input value={step.aggregateAlias} onChange={(event) => updateStep(step.id, { aggregateAlias: event.target.value })} placeholder="Alias" className={fieldClass} />
                      </>
                    )}

                    {step.type === "join" && (
                      <>
                        <input value={step.joinTable} onChange={(event) => updateStep(step.id, { joinTable: event.target.value })} placeholder="Right table name" className={fieldClass} />
                        <select value={step.joinType} onChange={(event) => updateStep(step.id, { joinType: event.target.value as JoinType })} className={fieldClass}>{["INNER", "LEFT", "RIGHT", "FULL"].map((joinType) => <option key={joinType} value={joinType}>{joinType}</option>)}</select>
                        <select value={step.leftColumn} onChange={(event) => updateStep(step.id, { leftColumn: event.target.value })} className={fieldClass}>{columnNames.map((name) => <option key={name} value={name}>{name}</option>)}</select>
                        <input value={step.rightColumn} onChange={(event) => updateStep(step.id, { rightColumn: event.target.value })} placeholder="Right join column" className={fieldClass} />
                        <input value={step.rightColumns} onChange={(event) => updateStep(step.id, { rightColumns: event.target.value })} placeholder="Right columns to include, comma-separated" className={`${fieldClass} md:col-span-2`} />
                      </>
                    )}

                    {step.type === "rename" && (
                      <>
                        <select value={step.column} onChange={(event) => updateStep(step.id, { column: event.target.value })} className={fieldClass}>{columnNames.map((name) => <option key={name} value={name}>{name}</option>)}</select>
                        <input value={step.newName} onChange={(event) => updateStep(step.id, { newName: event.target.value })} placeholder="New column name" className={fieldClass} />
                      </>
                    )}

                    {step.type === "cast" && (
                      <>
                        <select value={step.column} onChange={(event) => updateStep(step.id, { column: event.target.value })} className={fieldClass}>{columnNames.map((name) => <option key={name} value={name}>{name}</option>)}</select>
                        <input value={step.newType} onChange={(event) => updateStep(step.id, { newType: event.target.value.toUpperCase() })} placeholder="SQL type, e.g. DOUBLE" className={fieldClass} />
                      </>
                    )}

                    {step.type === "add-column" && (
                      <>
                        <input value={step.newName} onChange={(event) => updateStep(step.id, { newName: event.target.value })} placeholder="New column name" className={fieldClass} />
                        <input value={step.expression} onChange={(event) => updateStep(step.id, { expression: event.target.value })} placeholder='Expression, e.g. "revenue" - "cost"' className={`${fieldClass} md:col-span-2`} />
                      </>
                    )}

                    {step.type === "remove-column" && (
                      <div className="md:col-span-2 space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Columns to drop</p>
                        <div className="flex flex-wrap gap-2">{columnNames.map((name) => <button key={name} type="button" onClick={() => updateStep(step.id, { columns: toggleColumn(step.columns, name) })} className={`rounded-full border px-3 py-1.5 text-sm transition ${step.columns.includes(name) ? "border-rose-400/45 bg-rose-500/10 text-rose-700 dark:border-rose-500/35 dark:text-rose-300" : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300"}`}>{name}</button>)}</div>
                      </div>
                    )}

                    {step.type === "deduplicate" && (
                      <div className="md:col-span-2 space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Deduplicate using these keys</p>
                        <div className="flex flex-wrap gap-2">{columnNames.map((name) => <button key={name} type="button" onClick={() => updateStep(step.id, { columns: toggleColumn(step.columns, name) })} className={`rounded-full border px-3 py-1.5 text-sm transition ${step.columns.includes(name) ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-700 dark:border-cyan-500/35 dark:text-cyan-300" : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300"}`}>{name}</button>)}</div>
                      </div>
                    )}

                    {step.type === "sample" && (
                      <>
                        <select value={step.sampleMode} onChange={(event) => updateStep(step.id, { sampleMode: event.target.value as SampleMode })} className={fieldClass}><option value="rows">Rows</option><option value="percent">Percent</option></select>
                        <label className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                          <span className="font-medium">{step.sampleMode === "percent" ? `${step.sampleSize}%` : `${step.sampleSize} rows`}</span>
                          <input type="range" min={1} max={step.sampleMode === "percent" ? 100 : 1000} value={step.sampleSize} onChange={(event) => updateStep(step.id, { sampleSize: Number(event.target.value) })} className="w-full accent-cyan-500" />
                        </label>
                      </>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <div className="rounded-[26px] border border-slate-200/70 bg-slate-50/75 p-5 dark:border-slate-800 dark:bg-slate-950/35">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Save or load pipelines</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Persist reusable flows for this table in localStorage.</p>
              </div>
              <div className="flex gap-2">
                <input value={pipelineName} onChange={(event) => setPipelineName(event.target.value)} placeholder="Pipeline name" className={fieldClass} />
                <button type="button" onClick={handleSavePipeline} className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"><Save className="h-4 w-4" />Save</button>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {savedPipelines.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No saved pipelines yet.</p> : savedPipelines.map((pipeline) => <div key={pipeline.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/45 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-sm font-medium text-slate-900 dark:text-white">{pipeline.name}</p><p className="text-xs text-slate-500 dark:text-slate-400">{pipeline.steps.length} steps · {new Date(pipeline.savedAt).toLocaleString()}</p></div><div className="flex gap-2"><button type="button" onClick={() => setSteps(pipeline.steps)} className="rounded-xl border border-cyan-400/40 px-3 py-2 text-sm text-cyan-700 transition hover:bg-cyan-500/10 dark:text-cyan-300">Load</button><button type="button" onClick={() => { const next = savedPipelines.filter((item) => item.id !== pipeline.id); setSavedPipelines(next); savePipelines(tableName, next); }} className="rounded-xl border border-rose-300/60 px-3 py-2 text-sm text-rose-700 transition hover:bg-rose-500/10 dark:text-rose-300">Delete</button></div></div>)}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {notice && <div className={`rounded-2xl border px-4 py-3 text-sm ${notice.tone === "error" ? "border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-300" : notice.tone === "success" ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"}`}>{notice.message}</div>}

          <div className="rounded-[26px] border border-slate-200/70 bg-white/65 p-5 dark:border-slate-800 dark:bg-slate-950/40">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Live preview</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">First 100 rows from the compiled query · {formatNumber(previewCount)} total rows</p>
              </div>
              {loadingPreview && <Loader2 className="h-4 w-4 animate-spin text-cyan-500" />}
            </div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200/70 dark:border-slate-800">
              <div className="max-h-[420px] overflow-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
                  <thead className="bg-slate-50/80 dark:bg-slate-900/70">
                    <tr>{previewColumns.map((name) => <th key={name} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{name}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70 bg-white/80 dark:divide-slate-800 dark:bg-slate-950/40">
                    {previewRows.map((row, index) => (
                      <tr key={`${index}-${Object.values(row).join("|")}`} className="align-top">
                        {previewColumns.map((name) => <td key={`${index}-${name}`} className="max-w-[220px] truncate px-4 py-3 text-slate-700 dark:text-slate-200">{String(row[name] ?? "null")}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="rounded-[26px] border border-slate-200/70 bg-slate-50/75 p-5 dark:border-slate-800 dark:bg-slate-950/35">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Compiled SQL</p>
            <textarea readOnly value={compiled.sql} className="mt-3 h-72 w-full rounded-2xl border border-slate-200/70 bg-slate-950 px-4 py-3 font-mono text-xs text-slate-100 outline-none dark:border-slate-700" />
          </div>
        </div>
      </div>
    </motion.section>
  );
}
