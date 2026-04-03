"use client";

import { create } from "zustand";
import { runQuery } from "@/lib/duckdb/client";
import {
  compilePipeline,
  type PipelineStep,
  type SavedPipeline,
} from "@/lib/utils/pipeline-builder";
import type { ColumnProfile } from "@/types/dataset";

const MAX_EXECUTION_HISTORY = 20;

export interface PipelineExecutionRecord {
  id: string;
  pipelineId: string;
  status: "success" | "error";
  durationMs: number;
  startedAt: number;
  finishedAt: number;
  rowCount: number;
  sql: string;
  errorMessage: string | null;
}

interface ExecutePipelineInput {
  pipelineId: string;
  tableName: string;
  columns: ColumnProfile[];
}

interface PipelineStore {
  pipelines: SavedPipeline[];
  activePipelineId: string | null;
  executionHistory: PipelineExecutionRecord[];
  addPipeline: (pipeline: Omit<SavedPipeline, "savedAt">) => void;
  removePipeline: (id: string) => void;
  updatePipeline: (
    id: string,
    patch: Partial<Omit<SavedPipeline, "id" | "savedAt">>,
  ) => void;
  executePipeline: (
    input: ExecutePipelineInput,
  ) => Promise<PipelineExecutionRecord | null>;
  clearHistory: () => void;
}

function createExecutionId(): string {
  return `pipeline_run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function appendExecution(
  history: PipelineExecutionRecord[],
  record: PipelineExecutionRecord,
): PipelineExecutionRecord[] {
  return [record, ...history].slice(0, MAX_EXECUTION_HISTORY);
}

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  pipelines: [],
  activePipelineId: null,
  executionHistory: [],

  addPipeline: (pipeline) =>
    set((state) => {
      const nextPipeline: SavedPipeline = {
        ...cloneValue(pipeline),
        steps: pipeline.steps.map((step) => ({ ...step })),
        savedAt: Date.now(),
      };

      return {
        pipelines: [nextPipeline, ...state.pipelines],
        activePipelineId: nextPipeline.id,
      };
    }),

  removePipeline: (id) =>
    set((state) => {
      const nextPipelines = state.pipelines.filter((pipeline) => pipeline.id !== id);
      return {
        pipelines: nextPipelines,
        activePipelineId:
          state.activePipelineId === id ? nextPipelines[0]?.id ?? null : state.activePipelineId,
      };
    }),

  updatePipeline: (id, patch) =>
    set((state) => {
      const nextPipelines = state.pipelines.map((pipeline) =>
        pipeline.id === id
          ? {
              ...pipeline,
              ...cloneValue(patch),
              steps: patch.steps
                ? patch.steps.map((step) => ({ ...step }))
                : pipeline.steps.map((step) => ({ ...step })),
              savedAt: Date.now(),
            }
          : pipeline,
      );

      return {
        pipelines: nextPipelines,
        activePipelineId: id,
      };
    }),

  executePipeline: async ({ pipelineId, tableName, columns }) => {
    const pipeline = get().pipelines.find((candidate) => candidate.id === pipelineId);
    const startedAt = Date.now();

    if (!pipeline) {
      const failedRecord: PipelineExecutionRecord = {
        id: createExecutionId(),
        pipelineId,
        status: "error",
        durationMs: 0,
        startedAt,
        finishedAt: startedAt,
        rowCount: 0,
        sql: "",
        errorMessage: "Pipeline not found.",
      };

      set((state) => ({
        executionHistory: appendExecution(state.executionHistory, failedRecord),
      }));
      return failedRecord;
    }

    const compiled = compilePipeline(
      tableName,
      columns,
      pipeline.steps.map((step: PipelineStep) => ({ ...step })),
    );

    try {
      const rows = await runQuery(compiled.sql);
      const finishedAt = Date.now();
      const successRecord: PipelineExecutionRecord = {
        id: createExecutionId(),
        pipelineId,
        status: "success",
        durationMs: finishedAt - startedAt,
        startedAt,
        finishedAt,
        rowCount: rows.length,
        sql: compiled.sql,
        errorMessage: null,
      };

      set((state) => ({
        activePipelineId: pipelineId,
        executionHistory: appendExecution(state.executionHistory, successRecord),
      }));

      return successRecord;
    } catch (error) {
      const finishedAt = Date.now();
      const failureRecord: PipelineExecutionRecord = {
        id: createExecutionId(),
        pipelineId,
        status: "error",
        durationMs: finishedAt - startedAt,
        startedAt,
        finishedAt,
        rowCount: 0,
        sql: compiled.sql,
        errorMessage:
          error instanceof Error ? error.message : "Pipeline execution failed.",
      };

      set((state) => ({
        activePipelineId: pipelineId,
        executionHistory: appendExecution(state.executionHistory, failureRecord),
      }));

      return failureRecord;
    }
  },

  clearHistory: () => set({ executionHistory: [] }),
}));
