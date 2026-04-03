"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Download,
  GripVertical,
  Loader2,
  Play,
  Save,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  STEP_META,
  compilePipeline,
  createPipelineStep,
  toggleSelection,
  type AggregateFunction,
  type FilterOperator,
  type JoinType,
  type PipelineStep,
  type SampleMode,
  type SavedPipeline,
  type SortDirection,
  type StepType,
} from "@/lib/utils/pipeline-builder";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataPipelineProps {
  tableName: string;
  columns: ColumnProfile[];
}

type Notice = { tone: "error" | "success" | "info"; message: string } | null;

const ease = [0.22, 1, 0.36, 1] as const;
const panelClass =
  "overflow-hidden rounded-[28px] border border-white/20 bg-white/75 shadow-[0_24px_90px_-48px_rgba(15,23,42,0.75)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const fieldClass =
  "w-full rounded-2xl border border-slate-200/70 bg-white/85 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700/70 dark:bg-slate-950/65 dark:text-slate-100";
const STORAGE_KEY = "datalens:pipelines";

function readPipelines(tableName: string) {
  if (typeof window === "undefined") return [] as SavedPipeline[];
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY}:${tableName}`);
    const parsed = raw ? (JSON.parse(raw) as SavedPipeline[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePipelines(tableName: string, pipelines: SavedPipeline[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${STORAGE_KEY}:${tableName}`, JSON.stringify(pipelines.slice(0, 12)));
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function EmptyPipelineState() {
  return (
    <div className="rounded-[26px] border border-dashed border-slate-300/80 bg-slate-50/80 p-8 text-center dark:border-slate-700 dark:bg-slate-950/30">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
        <WandSparkles className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-white">No steps yet</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Start by adding a filter, sort, aggregation, or join card. The builder compiles them into a single DuckDB query in execution order.</p>
    </div>
  );
}

function PipelineGuide() {
  return (
    <div className="rounded-[26px] border border-slate-200/70 bg-slate-50/75 p-5 dark:border-slate-800 dark:bg-slate-950/35">
      <p className="text-sm font-semibold text-slate-900 dark:text-white">Pipeline guide</p>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
        <li>Filter and sort steps are row-preserving and work well near the top of the flow.</li>
        <li>Group and aggregate steps reshape the dataset, so later rename or cast steps operate on the new schema.</li>
        <li>Join steps assume the right-side table already exists in DuckDB and lets you choose which columns to project.</li>
        <li>Sampling is usually best at the end when you want a cheaper preview of the final pipeline.</li>
      </ul>
    </div>
  );
}

function PreviewSummary({
  stepCount,
  previewCount,
  previewColumns,
}: {
  stepCount: number;
  previewCount: number;
  previewColumns: string[];
}) {
  const items = [
    { label: "Steps", value: String(stepCount) },
    { label: "Output rows", value: formatNumber(previewCount) },
    { label: "Output columns", value: String(previewColumns.length) },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {items.map((item) => <div key={item.label} className="rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/30"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{item.label}</p><p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{item.value}</p></div>)}
    </div>
  );
}

function PipelineStatusStrip({ steps, savedCount }: { steps: number; savedCount: number }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs font-medium">
      <span className="rounded-full bg-cyan-500/10 px-3 py-1.5 text-cyan-700 dark:text-cyan-300">{steps} active steps</span>
      <span className="rounded-full bg-slate-900/5 px-3 py-1.5 text-slate-700 dark:bg-white/5 dark:text-slate-300">{savedCount} saved flows</span>
    </div>
  );
}

function SQLNotes() {
  const notes = [
    "Each step compiles into a named CTE, which keeps the exported SQL readable and debuggable.",
    "The preview query wraps the same compiled SQL and applies only a final `LIMIT 100` for display.",
    "Join steps assume the referenced right-side table already exists in DuckDB under the exact name you provide.",
    "Rename, cast, and add-column steps are schema-shaping operations, so they influence all downstream step pickers conceptually even though this lightweight builder still shows the original column list.",
    "If a preview fails, inspect the SQL panel first. It is the exact statement executed by the preview and run actions.",
  ];

  return (
    <div className="rounded-[26px] border border-slate-200/70 bg-white/65 p-5 dark:border-slate-800 dark:bg-slate-950/40">
      <p className="text-sm font-semibold text-slate-900 dark:text-white">Execution notes</p>
      <div className="mt-3 space-y-3">
        {notes.map((note, index) => (
          <div key={note} className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/10 text-xs font-semibold text-cyan-700 dark:text-cyan-300">{index + 1}</div>
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelinePatterns() {
  const patterns = [
    { title: "Clean then aggregate", detail: "Start with filter, cast, and rename steps before grouping so the aggregate runs on normalized data." },
    { title: "Join late", detail: "If the right table is wide, aggregate or reduce the left side first so the join happens on fewer rows." },
    { title: "Preview often", detail: "Because the SQL panel is always current, failed previews give you a direct statement to inspect and copy into the SQL editor." },
    { title: "Sample last", detail: "Place sampling near the end of the flow when you want a cheap preview of the final result instead of altering upstream logic." },
  ];
  return (
    <div className="rounded-[26px] border border-slate-200/70 bg-slate-50/75 p-5 dark:border-slate-800 dark:bg-slate-950/35">
      <p className="text-sm font-semibold text-slate-900 dark:text-white">Common patterns</p>
      <div className="mt-3 space-y-3">
        {patterns.map((pattern) => (
          <div key={pattern.title} className="rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">
            <p className="text-sm font-medium text-slate-900 dark:text-white">{pattern.title}</p>
            <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{pattern.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StorageNotes() {
  return (
    <div className="rounded-[26px] border border-slate-200/70 bg-white/65 p-5 dark:border-slate-800 dark:bg-slate-950/40">
      <p className="text-sm font-semibold text-slate-900 dark:text-white">Persistence behavior</p>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
        <li>Saved pipelines are scoped to the current table name in localStorage.</li>
        <li>Loading a saved pipeline replaces the in-memory step list immediately.</li>
        <li>The SQL export always reflects the current builder state, not the most recently saved snapshot.</li>
        <li>Preview rows are transient and are not stored with the saved pipeline definition.</li>
      </ul>
    </div>
  );
}

function StepCard({
  step,
  index,
  total,
  columns,
  onUpdate,
  onMove,
  onRemove,
}: {
  step: PipelineStep;
  index: number;
  total: number;
  columns: string[];
  onUpdate: (patch: Partial<PipelineStep>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.26, ease }} className="relative rounded-[26px] border border-slate-200/70 bg-white/75 p-5 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">{index + 1}</div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"><GripVertical className="h-4 w-4 text-slate-400" />{STEP_META[step.type].label}</div>
            <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{STEP_META[step.type].hint}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className="rounded-xl border border-slate-300/80 p-2 text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900/60"><ArrowUp className="h-4 w-4" /></button>
          <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} className="rounded-xl border border-slate-300/80 p-2 text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900/60"><ArrowDown className="h-4 w-4" /></button>
          <button type="button" onClick={onRemove} className="rounded-xl border border-rose-300/60 p-2 text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {step.type === "filter" && (
          <>
            <select value={step.column} onChange={(event) => onUpdate({ column: event.target.value })} className={fieldClass}>{columns.map((name) => <option key={name} value={name}>{name}</option>)}</select>
            <select value={step.operator} onChange={(event) => onUpdate({ operator: event.target.value as FilterOperator })} className={fieldClass}>{["=", "!=", ">", ">=", "<", "<=", "contains"].map((operator) => <option key={operator} value={operator}>{operator}</option>)}</select>
            <input value={step.value} onChange={(event) => onUpdate({ value: event.target.value })} placeholder="Value" className={fieldClass} />
          </>
        )}

        {step.type === "sort" && (
          <>
            <select value={step.column} onChange={(event) => onUpdate({ column: event.target.value })} className={fieldClass}>{columns.map((name) => <option key={name} value={name}>{name}</option>)}</select>
            <select value={step.direction} onChange={(event) => onUpdate({ direction: event.target.value as SortDirection })} className={fieldClass}><option value="ASC">Ascending</option><option value="DESC">Descending</option></select>
          </>
        )}

        {(step.type === "group" || step.type === "remove-column" || step.type === "deduplicate") && (
          <div className="md:col-span-2 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{step.type === "group" ? "Grouping keys" : step.type === "remove-column" ? "Columns to drop" : "Deduplicate using these keys"}</p>
            <div className="flex flex-wrap gap-2">{columns.map((name) => <button key={name} type="button" onClick={() => onUpdate({ [step.type === "group" ? "groupColumns" : "columns"]: toggleSelection(step.type === "group" ? step.groupColumns : step.columns, name) } as Partial<PipelineStep>)} className={`rounded-full border px-3 py-1.5 text-sm transition ${(step.type === "group" ? step.groupColumns : step.columns).includes(name) ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-700 dark:border-cyan-500/35 dark:text-cyan-300" : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300"}`}>{name}</button>)}</div>
          </div>
        )}

        {step.type === "aggregate" && (
          <>
            <div className="md:col-span-2 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Optional group keys</p>
              <div className="flex flex-wrap gap-2">{columns.map((name) => <button key={name} type="button" onClick={() => onUpdate({ groupColumns: toggleSelection(step.groupColumns, name) })} className={`rounded-full border px-3 py-1.5 text-sm transition ${step.groupColumns.includes(name) ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-700 dark:border-cyan-500/35 dark:text-cyan-300" : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300"}`}>{name}</button>)}</div>
            </div>
            <select value={step.aggregateFunction} onChange={(event) => onUpdate({ aggregateFunction: event.target.value as AggregateFunction })} className={fieldClass}>{["COUNT", "SUM", "AVG", "MIN", "MAX"].map((name) => <option key={name} value={name}>{name}</option>)}</select>
            <select value={step.aggregateColumn} onChange={(event) => onUpdate({ aggregateColumn: event.target.value })} className={fieldClass}>{columns.map((name) => <option key={name} value={name}>{name}</option>)}</select>
            <input value={step.aggregateAlias} onChange={(event) => onUpdate({ aggregateAlias: event.target.value })} placeholder="Alias" className={fieldClass} />
          </>
        )}

        {step.type === "join" && (
          <>
            <input value={step.joinTable} onChange={(event) => onUpdate({ joinTable: event.target.value })} placeholder="Right table name" className={fieldClass} />
            <select value={step.joinType} onChange={(event) => onUpdate({ joinType: event.target.value as JoinType })} className={fieldClass}>{["INNER", "LEFT", "RIGHT", "FULL"].map((name) => <option key={name} value={name}>{name}</option>)}</select>
            <select value={step.leftColumn} onChange={(event) => onUpdate({ leftColumn: event.target.value })} className={fieldClass}>{columns.map((name) => <option key={name} value={name}>{name}</option>)}</select>
            <input value={step.rightColumn} onChange={(event) => onUpdate({ rightColumn: event.target.value })} placeholder="Right join column" className={fieldClass} />
            <input value={step.rightColumns} onChange={(event) => onUpdate({ rightColumns: event.target.value })} placeholder="Right columns to include, comma-separated" className={`${fieldClass} md:col-span-2`} />
          </>
        )}

        {step.type === "rename" && (
          <>
            <select value={step.column} onChange={(event) => onUpdate({ column: event.target.value })} className={fieldClass}>{columns.map((name) => <option key={name} value={name}>{name}</option>)}</select>
            <input value={step.newName} onChange={(event) => onUpdate({ newName: event.target.value })} placeholder="New column name" className={fieldClass} />
          </>
        )}

        {step.type === "cast" && (
          <>
            <select value={step.column} onChange={(event) => onUpdate({ column: event.target.value })} className={fieldClass}>{columns.map((name) => <option key={name} value={name}>{name}</option>)}</select>
            <input value={step.newType} onChange={(event) => onUpdate({ newType: event.target.value.toUpperCase() })} placeholder="SQL type, e.g. DOUBLE" className={fieldClass} />
          </>
        )}

        {step.type === "add-column" && (
          <>
            <input value={step.newName} onChange={(event) => onUpdate({ newName: event.target.value })} placeholder="New column name" className={fieldClass} />
            <input value={step.expression} onChange={(event) => onUpdate({ expression: event.target.value })} placeholder='Expression, e.g. "revenue" - "cost"' className={`${fieldClass} md:col-span-2`} />
          </>
        )}

        {step.type === "sample" && (
          <>
            <select value={step.sampleMode} onChange={(event) => onUpdate({ sampleMode: event.target.value as SampleMode })} className={fieldClass}><option value="rows">Rows</option><option value="percent">Percent</option></select>
            <label className="space-y-2 text-sm text-slate-600 dark:text-slate-300"><span className="font-medium">{step.sampleMode === "percent" ? `${step.sampleSize}%` : `${step.sampleSize} rows`}</span><input type="range" min={1} max={step.sampleMode === "percent" ? 100 : 1000} value={step.sampleSize} onChange={(event) => onUpdate({ sampleSize: Number(event.target.value) })} className="w-full accent-cyan-500" /></label>
          </>
        )}
      </div>
    </motion.div>
  );
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
    setSavedPipelines(readPipelines(tableName));
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

  function savePipeline() {
    const snapshot: SavedPipeline = { id: makeId(), name: pipelineName.trim() || `${tableName} pipeline`, savedAt: Date.now(), steps };
    const next = [snapshot, ...savedPipelines].slice(0, 12);
    setSavedPipelines(next);
    writePipelines(tableName, next);
    setNotice({ tone: "success", message: `Saved "${snapshot.name}" to localStorage.` });
  }

  async function runPipeline() {
    setRunningPipeline(true);
    try {
      const rows = await runQuery(`SELECT COUNT(*) AS cnt FROM (${compiled.sql}) AS pipeline_run`);
      setNotice({ tone: "success", message: `Pipeline executed successfully. Final result contains ${formatNumber(Number(rows[0]?.cnt ?? 0))} rows.` });
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
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:border-cyan-500/20 dark:text-cyan-300"><WandSparkles className="h-3.5 w-3.5" />Data pipeline</div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Compose a visual DuckDB workflow</h2>
            <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">Each card becomes a CTE step. The live preview, full run, and SQL export all use the same compiled query so the workflow stays consistent.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={runPipeline} disabled={runningPipeline} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60">{runningPipeline ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Run pipeline</button>
            <button type="button" onClick={() => downloadFile(`${compiled.sql};\n`, `${tableName}-pipeline.sql`, "text/sql;charset=utf-8;")} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300/80 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900/60"><Download className="h-4 w-4" />Export SQL</button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 px-6 py-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(Object.keys(STEP_META) as StepType[]).map((type) => <button key={type} type="button" onClick={() => setSteps((current) => [...current, createPipelineStep(type, columns)])} className="rounded-3xl border border-slate-200/70 bg-white/65 p-4 text-left transition hover:border-cyan-300 dark:border-slate-700/70 dark:bg-slate-950/35 dark:hover:border-cyan-500/35"><p className="text-sm font-semibold text-slate-900 dark:text-white">{STEP_META[type].label}</p><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{STEP_META[type].hint}</p></button>)}
          </div>

          <div className="relative space-y-4">
            {steps.length > 1 && <div className="absolute left-5 top-5 bottom-5 w-px bg-gradient-to-b from-cyan-400/30 via-cyan-500/15 to-transparent" />}
            <AnimatePresence>
              {steps.map((step, index) => <StepCard key={step.id} step={step} index={index} total={steps.length} columns={columnNames} onUpdate={(patch) => updateStep(step.id, patch)} onMove={(direction) => moveStep(step.id, direction)} onRemove={() => setSteps((current) => current.filter((item) => item.id !== step.id))} />)}
            </AnimatePresence>
            {steps.length === 0 && <EmptyPipelineState />}
          </div>

          <div className="rounded-[26px] border border-slate-200/70 bg-slate-50/75 p-5 dark:border-slate-800 dark:bg-slate-950/35">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div><p className="text-sm font-semibold text-slate-900 dark:text-white">Save or load pipelines</p><p className="text-xs text-slate-500 dark:text-slate-400">Persist reusable flows for this table in localStorage.</p></div>
              <div className="flex gap-2"><input value={pipelineName} onChange={(event) => setPipelineName(event.target.value)} placeholder="Pipeline name" className={fieldClass} /><button type="button" onClick={savePipeline} className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"><Save className="h-4 w-4" />Save</button></div>
            </div>
            <div className="mt-4 space-y-3">
              {savedPipelines.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No saved pipelines yet.</p> : savedPipelines.map((pipeline) => <div key={pipeline.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/45 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-sm font-medium text-slate-900 dark:text-white">{pipeline.name}</p><p className="text-xs text-slate-500 dark:text-slate-400">{pipeline.steps.length} steps · {new Date(pipeline.savedAt).toLocaleString()}</p></div><div className="flex gap-2"><button type="button" onClick={() => setSteps(pipeline.steps)} className="rounded-xl border border-cyan-400/40 px-3 py-2 text-sm text-cyan-700 transition hover:bg-cyan-500/10 dark:text-cyan-300">Load</button><button type="button" onClick={() => { const next = savedPipelines.filter((item) => item.id !== pipeline.id); setSavedPipelines(next); writePipelines(tableName, next); }} className="rounded-xl border border-rose-300/60 px-3 py-2 text-sm text-rose-700 transition hover:bg-rose-500/10 dark:text-rose-300">Delete</button></div></div>)}
            </div>
          </div>
          <PipelineGuide />
        </div>

        <div className="space-y-4">
          {notice && <div className={`rounded-2xl border px-4 py-3 text-sm ${notice.tone === "error" ? "border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-300" : notice.tone === "success" ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"}`}>{notice.message}</div>}

          <div className="rounded-[26px] border border-slate-200/70 bg-white/65 p-5 dark:border-slate-800 dark:bg-slate-950/40">
            <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900 dark:text-white">Live preview</p><p className="text-xs text-slate-500 dark:text-slate-400">First 100 rows from the compiled query · {formatNumber(previewCount)} total rows</p></div>{loadingPreview && <Loader2 className="h-4 w-4 animate-spin text-cyan-500" />}</div>
            <div className="mt-4"><PreviewSummary stepCount={steps.length} previewCount={previewCount} previewColumns={previewColumns} /></div>
            <div className="mt-4"><PipelineStatusStrip steps={steps.length} savedCount={savedPipelines.length} /></div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200/70 dark:border-slate-800">
              <div className="max-h-[420px] overflow-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
                  <thead className="bg-slate-50/80 dark:bg-slate-900/70"><tr>{previewColumns.map((name) => <th key={name} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{name}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-200/70 bg-white/80 dark:divide-slate-800 dark:bg-slate-950/40">{previewRows.map((row, index) => <tr key={`${index}-${Object.values(row).join("|")}`} className="align-top">{previewColumns.map((name) => <td key={`${index}-${name}`} className="max-w-[220px] truncate px-4 py-3 text-slate-700 dark:text-slate-200">{String(row[name] ?? "null")}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="rounded-[26px] border border-slate-200/70 bg-slate-50/75 p-5 dark:border-slate-800 dark:bg-slate-950/35">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Compiled SQL</p>
            <textarea readOnly value={compiled.sql} className="mt-3 h-72 w-full rounded-2xl border border-slate-200/70 bg-slate-950 px-4 py-3 font-mono text-xs text-slate-100 outline-none dark:border-slate-700" />
          </div>
          <SQLNotes />
          <PipelinePatterns />
          <StorageNotes />
        </div>
      </div>
    </motion.section>
  );
}
