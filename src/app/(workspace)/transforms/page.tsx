"use client";

import { startTransition, type FormEvent, useEffect, useMemo, useState } from "react";
import { FIELD_CLASS, GLASS_PANEL_CLASS } from "@/lib/utils/advanced-analytics";
import {
  generateId,
  formatDuration,
  formatRelativeTime,
  sanitizeTableName,
} from "@/lib/utils/formatters";
import {
  createPipelineStep,
  STEP_META,
  type PipelineStep,
  type SavedPipeline,
  type StepType,
} from "@/lib/utils/pipeline-builder";
import {
  type PipelineExecutionRecord,
  usePipelineStore,
} from "@/stores/pipeline-store";
import { useDatasetStore } from "@/stores/dataset-store";

const DEFAULT_STEP_TYPE: StepType = "filter";
const STEP_TYPES: StepType[] = [
  "filter",
  "sort",
  "group",
  "aggregate",
  "join",
  "rename",
  "cast",
  "add-column",
  "remove-column",
  "deduplicate",
  "sample",
];

function parseList(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => Boolean(entry));
}

export default function TransformsPage() {
  const pipelines = usePipelineStore((state) => state.pipelines);
  const addPipeline = usePipelineStore((state) => state.addPipeline);
  const removePipeline = usePipelineStore((state) => state.removePipeline);
  const updatePipeline = usePipelineStore((state) => state.updatePipeline);
  const executePipeline = usePipelineStore((state) => state.executePipeline);
  const executionHistory = usePipelineStore((state) => state.executionHistory);
  const clearHistory = usePipelineStore((state) => state.clearHistory);

  const activeDataset = useDatasetStore((state) => state.getActiveDataset());
  const datasetColumns = useMemo(() => activeDataset?.columns ?? [], [activeDataset]);
  const tableName = useMemo(
    () => (activeDataset ? sanitizeTableName(activeDataset.fileName) : ""),
    [activeDataset],
  );
  const columnOptions = useMemo(
    () => datasetColumns.map((column) => column.name),
    [datasetColumns],
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const [pipelineName, setPipelineName] = useState("");
  const [newStepType, setNewStepType] = useState<StepType>(DEFAULT_STEP_TYPE);
  const [isRunning, setIsRunning] = useState(false);
  const [lastExecution, setLastExecution] =
    useState<PipelineExecutionRecord | null>(null);

  const activePipeline = useMemo<SavedPipeline | null>(() => {
    if (activeId) {
      return pipelines.find((pipeline) => pipeline.id === activeId) ?? null;
    }
    return pipelines[0] ?? null;
  }, [activeId, pipelines]);

  useEffect(() => {
    if (!activePipeline?.id) {
      return;
    }

    startTransition(() => {
      setPipelineName((current) =>
        current === activePipeline.name ? current : activePipeline.name,
      );
    });
  }, [activePipeline]);

  useEffect(() => {
    const nextActiveId =
      activeId && pipelines.find((pipeline) => pipeline.id === activeId)
        ? activeId
        : pipelines[0]?.id ?? null;

    if (nextActiveId === activeId) {
      return;
    }

    startTransition(() => {
      setActiveId(nextActiveId);
    });
  }, [activeId, pipelines]);

  function createNewPipeline() {
    const id = generateId();
    const initialStep = createPipelineStep(DEFAULT_STEP_TYPE, datasetColumns);
    addPipeline({
      id,
      name: `Pipeline ${pipelines.length + 1}`,
      steps: [initialStep],
    });
    setActiveId(id);
    setPipelineName(`Pipeline ${pipelines.length + 1}`);
  }

  function selectPipeline(id: string) {
    setActiveId(id);
  }

  async function runActivePipeline() {
    if (!activePipeline) {
      return;
    }
    if (!activeDataset) {
      return;
    }

    setIsRunning(true);

    const record = await executePipeline({
      pipelineId: activePipeline.id,
      tableName,
      columns: datasetColumns,
    });

    setLastExecution(record);
    setIsRunning(false);
  }

  function renameActivePipeline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activePipeline) {
      return;
    }
    const nextName = pipelineName.trim() || "Pipeline";
    updatePipeline(activePipeline.id, { name: nextName });
  }

  function removeActivePipeline(id: string) {
    removePipeline(id);
    if (activeId === id) {
      setActiveId(null);
    }
  }

  function addStep() {
    if (!activePipeline) return;
    const nextStep = createPipelineStep(newStepType, datasetColumns);
    updatePipeline(activePipeline.id, {
      steps: [...activePipeline.steps, nextStep],
    });
  }

  function removeStep(index: number) {
    if (!activePipeline) return;
    updatePipeline(activePipeline.id, {
      steps: activePipeline.steps.filter((_, stepIndex) => stepIndex !== index),
    });
  }

  function updateStep(index: number, patch: Partial<PipelineStep>) {
    if (!activePipeline) return;
    const nextSteps = activePipeline.steps.map((step, stepIndex) =>
      stepIndex === index ? { ...step, ...patch } : step,
    );
    updatePipeline(activePipeline.id, { steps: nextSteps });
  }

  function changeStepType(index: number, nextType: StepType) {
    if (!activePipeline) return;
    const baseStep = createPipelineStep(nextType, datasetColumns);
    const nextSteps = activePipeline.steps.map((step, stepIndex) =>
      stepIndex === index ? { ...baseStep, id: step.id } : step,
    );
    updatePipeline(activePipeline.id, { steps: nextSteps });
  }

  const historyToShow = lastExecution
    ? [lastExecution, ...executionHistory.filter((entry) => entry.id !== lastExecution.id)]
    : executionHistory;

  return (
    <section className="space-y-5">
      <section className={`${GLASS_PANEL_CLASS} p-4`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
              Transform Pipelines
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Build SQL-ready transformations and execute them against the active dataset.
            </p>
          </div>
          <button
            type="button"
            onClick={createNewPipeline}
            className="inline-flex rounded-2xl border border-white/20 bg-white/80 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:bg-white dark:border-white/10 dark:bg-slate-950/55 dark:text-slate-100 dark:hover:bg-slate-900/90"
          >
            + New pipeline
          </button>
        </div>
      </section>

      <section className={`${GLASS_PANEL_CLASS} p-4`}>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Saved pipelines</h2>

        {activeDataset ? (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Active dataset: {activeDataset.fileName} • {activeDataset.rowCount.toLocaleString()} rows
          </p>
        ) : (
          <p className="mt-1 text-xs text-rose-500 dark:text-rose-300">
            No active dataset selected. You can still define pipelines now, but execution is disabled.
          </p>
        )}

        {pipelines.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-white/25 bg-white/50 px-4 py-4 text-sm text-slate-500 dark:border-white/10 dark:bg-slate-950/35">
            No pipelines yet. Click <span className="font-medium">New pipeline</span> to begin.
          </div>
        ) : (
          <div className="mt-4 grid gap-2">
            {pipelines.map((pipeline) => {
              const isActive = pipeline.id === activePipeline?.id;
              return (
                <div
                  key={pipeline.id}
                  className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${
                    isActive
                      ? "border-cyan-400/40 bg-cyan-500/10 text-slate-900 dark:text-white"
                      : "border-white/20 bg-white/60 text-slate-700 dark:bg-slate-950/40 dark:text-slate-200"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => selectPipeline(pipeline.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="font-medium">{pipeline.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {pipeline.steps.length} step{pipeline.steps.length === 1 ? "" : "s"} • {formatRelativeTime(pipeline.savedAt)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeActivePipeline(pipeline.id)}
                    className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-500/20 dark:text-rose-200"
                  >
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className={`${GLASS_PANEL_CLASS} p-4`}>
        {!activePipeline ? (
          <div className="rounded-2xl border border-white/25 bg-white/55 px-4 py-4 text-sm text-slate-500 dark:border-white/10 dark:bg-slate-950/35">
            Pick a saved pipeline to begin editing its steps.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <form onSubmit={renameActivePipeline} className="flex-1 min-w-72">
                <label
                  htmlFor="transforms-pipeline-name"
                  className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200"
                >
                  Pipeline name
                </label>
                <div className="flex gap-2">
                  <input
                    id="transforms-pipeline-name"
                    value={pipelineName}
                    onChange={(event) => setPipelineName(event.target.value)}
                    className={FIELD_CLASS}
                    placeholder="Pipeline name"
                    aria-label="Pipeline name"
                  />
                  <button
                    type="submit"
                    className="rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-slate-950/55"
                  >
                    Save
                  </button>
                </div>
              </form>
              <div className="min-w-[220px] flex-1">
                <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">Add step</p>
                <div className="flex gap-2">
                  <select
                    value={newStepType}
                    onChange={(event) => setNewStepType(event.target.value as StepType)}
                    className={FIELD_CLASS}
                  >
                    {STEP_TYPES.map((stepType) => (
                      <option key={stepType} value={stepType}>
                        {STEP_META[stepType].label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={addStep}
                    className="rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-slate-950/55 dark:text-slate-100"
                  >
                    Add
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {STEP_META[newStepType].hint}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void runActivePipeline()}
                disabled={!activeDataset || isRunning}
                className="rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRunning ? "Executing..." : "Execute"}
              </button>
            </div>

            <div className="space-y-3">
              {activePipeline.steps.length === 0 ? (
                <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-slate-700 dark:border-cyan-500/20 dark:bg-cyan-500/15 dark:text-slate-200">
                  This pipeline has no steps yet. Add one with the control above.
                </div>
              ) : null}

              {activePipeline.steps.map((step, index) => (
                <div
                  key={step.id}
                  className="rounded-2xl border border-white/20 bg-white/55 p-4 dark:border-white/10 dark:bg-slate-950/35"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        Step {index + 1}: {STEP_META[step.type].label}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{STEP_META[step.type].hint}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={step.type}
                        onChange={(event) =>
                          changeStepType(index, event.target.value as StepType)
                        }
                        className={FIELD_CLASS}
                      >
                        {STEP_TYPES.map((stepType) => (
                          <option key={stepType} value={stepType}>
                            {STEP_META[stepType].label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeStep(index)}
                        className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700 transition hover:bg-rose-500/20 dark:text-rose-200"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {step.type === "filter" ? (
                      <>
                        <label className="space-y-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Filter column</span>
                          <select
                            value={step.column}
                            onChange={(event) =>
                              updateStep(index, { column: event.target.value })
                            }
                            className={FIELD_CLASS}
                          >
                            {columnOptions.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Operator</span>
                          <select
                            value={step.operator}
                            onChange={(event) =>
                              updateStep(index, { operator: event.target.value as PipelineStep["operator"] })
                            }
                            className={FIELD_CLASS}
                          >
                            <option value="=">=</option>
                            <option value="!=">!=</option>
                            <option value=">">&gt;</option>
                            <option value=">=">&gt;=</option>
                            <option value="<">&lt;</option>
                            <option value="<=">&lt;=</option>
                            <option value="contains">contains</option>
                          </select>
                        </label>
                        <label className="space-y-1 sm:col-span-2">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Value</span>
                          <input
                            value={step.value}
                            onChange={(event) => updateStep(index, { value: event.target.value })}
                            className={FIELD_CLASS}
                            placeholder='e.g. "US"'
                          />
                        </label>
                      </>
                    ) : null}

                    {step.type === "sort" ? (
                      <>
                        <label className="space-y-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Sort by</span>
                          <select
                            value={step.column}
                            onChange={(event) => updateStep(index, { column: event.target.value })}
                            className={FIELD_CLASS}
                          >
                            {columnOptions.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Direction</span>
                          <select
                            value={step.direction}
                            onChange={(event) =>
                              updateStep(index, { direction: event.target.value as PipelineStep["direction"] })
                            }
                            className={FIELD_CLASS}
                          >
                            <option value="ASC">ASC</option>
                            <option value="DESC">DESC</option>
                          </select>
                        </label>
                      </>
                    ) : null}

                    {step.type === "group" ? (
                      <label className="space-y-1 sm:col-span-2">
                        <span className="text-xs text-slate-600 dark:text-slate-300">Group columns</span>
                        <input
                          value={step.groupColumns.join(", ")}
                          onChange={(event) =>
                            updateStep(index, {
                              groupColumns: parseList(event.target.value),
                            })
                          }
                          className={FIELD_CLASS}
                          placeholder="col_a, col_b"
                        />
                      </label>
                    ) : null}

                    {step.type === "aggregate" ? (
                      <>
                        <label className="space-y-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Group by</span>
                          <input
                            value={step.groupColumns.join(", ")}
                            onChange={(event) =>
                              updateStep(index, { groupColumns: parseList(event.target.value) })
                            }
                            className={FIELD_CLASS}
                            placeholder="col_a, col_b"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Aggregate function</span>
                          <select
                            value={step.aggregateFunction}
                            onChange={(event) =>
                              updateStep(index, {
                                aggregateFunction:
                                  event.target.value as PipelineStep["aggregateFunction"],
                              })
                            }
                            className={FIELD_CLASS}
                          >
                            <option value="COUNT">COUNT</option>
                            <option value="SUM">SUM</option>
                            <option value="AVG">AVG</option>
                            <option value="MIN">MIN</option>
                            <option value="MAX">MAX</option>
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Metric column</span>
                          <select
                            value={step.aggregateColumn}
                            onChange={(event) =>
                              updateStep(index, { aggregateColumn: event.target.value })
                            }
                            className={FIELD_CLASS}
                          >
                            {columnOptions.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Alias</span>
                          <input
                            value={step.aggregateAlias}
                            onChange={(event) =>
                              updateStep(index, { aggregateAlias: event.target.value })
                            }
                            className={FIELD_CLASS}
                            placeholder="metric_value"
                          />
                        </label>
                      </>
                    ) : null}

                    {step.type === "join" ? (
                      <>
                        <label className="space-y-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Join table</span>
                          <input
                            value={step.joinTable}
                            onChange={(event) => updateStep(index, { joinTable: event.target.value })}
                            className={FIELD_CLASS}
                            placeholder="other_table"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Join type</span>
                          <select
                            value={step.joinType}
                            onChange={(event) =>
                              updateStep(index, { joinType: event.target.value as PipelineStep["joinType"] })
                            }
                            className={FIELD_CLASS}
                          >
                            <option value="INNER">INNER</option>
                            <option value="LEFT">LEFT</option>
                            <option value="RIGHT">RIGHT</option>
                            <option value="FULL">FULL</option>
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Left column</span>
                          <select
                            value={step.leftColumn}
                            onChange={(event) => updateStep(index, { leftColumn: event.target.value })}
                            className={FIELD_CLASS}
                          >
                            {columnOptions.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Right column</span>
                          <input
                            value={step.rightColumn}
                            onChange={(event) =>
                              updateStep(index, { rightColumn: event.target.value })
                            }
                            className={FIELD_CLASS}
                            placeholder="matching_column"
                          />
                        </label>
                        <label className="space-y-1 sm:col-span-2">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Right columns</span>
                          <input
                            value={step.rightColumns}
                            onChange={(event) =>
                              updateStep(index, { rightColumns: event.target.value })
                            }
                            className={FIELD_CLASS}
                            placeholder="col_one, col_two"
                          />
                        </label>
                      </>
                    ) : null}

                    {step.type === "rename" ? (
                      <>
                        <label className="space-y-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Source column</span>
                          <select
                            value={step.column}
                            onChange={(event) => updateStep(index, { column: event.target.value })}
                            className={FIELD_CLASS}
                          >
                            {columnOptions.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300">New name</span>
                          <input
                            value={step.newName}
                            onChange={(event) =>
                              updateStep(index, { newName: event.target.value })
                            }
                            className={FIELD_CLASS}
                            placeholder="renamed_column"
                          />
                        </label>
                      </>
                    ) : null}

                    {step.type === "cast" ? (
                      <>
                        <label className="space-y-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Column</span>
                          <select
                            value={step.column}
                            onChange={(event) => updateStep(index, { column: event.target.value })}
                            className={FIELD_CLASS}
                          >
                            {columnOptions.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300">New type</span>
                          <input
                            value={step.newType}
                            onChange={(event) => updateStep(index, { newType: event.target.value })}
                            className={FIELD_CLASS}
                            placeholder="DOUBLE"
                          />
                        </label>
                      </>
                    ) : null}

                    {step.type === "add-column" ? (
                      <>
                        <label className="space-y-1 sm:col-span-2">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Column name</span>
                          <input
                            value={step.newName}
                            onChange={(event) => updateStep(index, { newName: event.target.value })}
                            className={FIELD_CLASS}
                            placeholder="computed_value"
                          />
                        </label>
                        <label className="space-y-1 sm:col-span-2">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Expression</span>
                          <textarea
                            rows={3}
                            value={step.expression}
                            onChange={(event) => updateStep(index, { expression: event.target.value })}
                            className={FIELD_CLASS}
                            placeholder="col_a * 1.2"
                          />
                        </label>
                      </>
                    ) : null}

                    {step.type === "remove-column" ? (
                      <label className="space-y-1 sm:col-span-2">
                        <span className="text-xs text-slate-600 dark:text-slate-300">Columns to remove</span>
                        <input
                          value={step.columns.join(", ")}
                          onChange={(event) =>
                            updateStep(index, {
                              columns: parseList(event.target.value),
                            })
                          }
                          className={FIELD_CLASS}
                          placeholder="drop_this, drop_that"
                        />
                      </label>
                    ) : null}

                    {step.type === "deduplicate" ? (
                      <label className="space-y-1 sm:col-span-2">
                        <span className="text-xs text-slate-600 dark:text-slate-300">Deduplicate keys</span>
                        <input
                          value={step.columns.join(", ")}
                          onChange={(event) =>
                            updateStep(index, {
                              columns: parseList(event.target.value),
                            })
                          }
                          className={FIELD_CLASS}
                          placeholder="customer_id, transaction_id"
                        />
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Leave empty to use all columns.
                        </p>
                      </label>
                    ) : null}

                    {step.type === "sample" ? (
                      <>
                        <label className="space-y-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Mode</span>
                          <select
                            value={step.sampleMode}
                            onChange={(event) =>
                              updateStep(index, { sampleMode: event.target.value as PipelineStep["sampleMode"] })
                            }
                            className={FIELD_CLASS}
                          >
                            <option value="rows">rows</option>
                            <option value="percent">percent</option>
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs text-slate-600 dark:text-slate-300">
                            Sample size ({step.sampleMode === "percent" ? "percent" : "rows"})
                          </span>
                          <input
                            type="number"
                            min={1}
                            max={step.sampleMode === "percent" ? 100 : undefined}
                            value={String(step.sampleSize)}
                            onChange={(event) =>
                              updateStep(index, { sampleSize: Number(event.target.value || 1) })
                            }
                            className={FIELD_CLASS}
                          />
                        </label>
                      </>
                    ) : null}

                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className={`${GLASS_PANEL_CLASS} p-4`}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Execution results</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              History includes last {executionHistory.length} runs.
            </p>
          </div>
          <button
            type="button"
            onClick={clearHistory}
            className="rounded-2xl border border-white/20 bg-white/80 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-slate-950/55 dark:text-slate-100"
          >
            Clear history
          </button>
        </div>

        {historyToShow.length === 0 ? (
          <div className="rounded-2xl border border-white/25 bg-white/50 px-4 py-4 text-sm text-slate-500 dark:border-white/10 dark:bg-slate-950/35">
            Run a pipeline to populate execution history.
          </div>
        ) : (
          <div className="space-y-3">
            {historyToShow.map((record) => (
              <div
                key={record.id}
                className={`rounded-2xl border px-4 py-3 ${
                  record.status === "success"
                    ? "border-emerald-300/35 bg-emerald-500/10 text-slate-700 dark:border-emerald-500/20 dark:bg-emerald-500/10"
                    : "border-rose-300/30 bg-rose-500/10 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10"
                }`}
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <p className="font-semibold">
                    {record.status === "success" ? "Success" : "Error"}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-300">
                    {formatRelativeTime(record.finishedAt)} • {formatDuration(record.durationMs)}
                  </p>
                </div>
                <p className="text-xs">
                  Rows: {record.rowCount.toLocaleString()} • Pipeline ID: {record.pipelineId}
                </p>
                {record.sql ? (
                  <pre className="mt-2 overflow-x-auto rounded-xl border border-white/15 bg-slate-950/80 p-3 text-xs text-slate-100">
                    {record.sql}
                  </pre>
                ) : null}
                {record.errorMessage ? (
                  <p className="mt-2 text-xs text-rose-700 dark:text-rose-200">{record.errorMessage}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
