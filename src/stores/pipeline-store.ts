"use client";

import { create } from "zustand";
import { runQuery } from "@/lib/duckdb/client";
import { pipelinesApi } from "@/lib/api/pipelines";
import {
  compilePipeline,
  type PipelineStep,
  type SavedPipeline,
} from "@/lib/utils/pipeline-builder";
import type { ColumnProfile } from "@/types/dataset";
import { useAuthStore } from "@/stores/auth-store";

const MAX_EXECUTION_HISTORY = 20;
const STORAGE_KEY = "datalens-pipelines";

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
  hydrate: () => Promise<void>;
  addPipeline: (pipeline: Omit<SavedPipeline, "savedAt">) => Promise<void>;
  removePipeline: (id: string) => Promise<void>;
  updatePipeline: (
    id: string,
    patch: Partial<Omit<SavedPipeline, "id" | "savedAt">>,
  ) => Promise<void>;
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

function readPipelines(): SavedPipeline[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is SavedPipeline => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as Partial<SavedPipeline>;
        return (
          typeof candidate.id === "string" &&
          typeof candidate.name === "string" &&
          typeof candidate.savedAt === "number" &&
          Array.isArray(candidate.steps) &&
          (typeof candidate.synced === "undefined" || typeof candidate.synced === "boolean")
        );
      })
      .map((pipeline) => ({
        ...pipeline,
        steps: pipeline.steps.map((step) => ({ ...step })),
      }));
  } catch {
    return [];
  }
}

function persistPipelines(pipelines: SavedPipeline[]): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pipelines));
  } catch {
    // Preserve in-memory behavior when storage is unavailable.
  }
}

function hasAuthToken(): boolean {
  return Boolean(useAuthStore.getState().token);
}

function sortPipelines(pipelines: SavedPipeline[]): SavedPipeline[] {
  return [...pipelines].sort((left, right) => right.savedAt - left.savedAt);
}

function syncPipeline(
  currentPipelines: SavedPipeline[],
  expectedSavedAt: number,
  nextPipeline: SavedPipeline,
): SavedPipeline[] {
  return currentPipelines.map((pipeline) => {
    if (pipeline.id !== nextPipeline.id) return pipeline;
    if (pipeline.savedAt > expectedSavedAt) return pipeline;
    return nextPipeline;
  });
}

function appendExecution(
  history: PipelineExecutionRecord[],
  record: PipelineExecutionRecord,
): PipelineExecutionRecord[] {
  return [record, ...history].slice(0, MAX_EXECUTION_HISTORY);
}

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  pipelines: readPipelines(),
  activePipelineId: readPipelines()[0]?.id ?? null,
  executionHistory: [],

  hydrate: async () => {
    const localPipelines = sortPipelines(readPipelines());
    const currentActivePipelineId = get().activePipelineId;

    if (!hasAuthToken()) {
      set({
        pipelines: localPipelines,
        activePipelineId:
          currentActivePipelineId && localPipelines.some((pipeline) => pipeline.id === currentActivePipelineId)
            ? currentActivePipelineId
            : localPipelines[0]?.id ?? null,
      });
      return;
    }

    try {
      const remotePipelines = sortPipelines(
        (await pipelinesApi.list()).map((pipeline) => ({
          id: pipeline.id,
          name: pipeline.name,
          savedAt: pipeline.savedAt,
          steps: pipeline.steps.map((step) => ({ ...step })),
          synced: true,
        })),
      );

      persistPipelines(remotePipelines);
      set({
        pipelines: remotePipelines,
        activePipelineId:
          currentActivePipelineId && remotePipelines.some((pipeline) => pipeline.id === currentActivePipelineId)
            ? currentActivePipelineId
            : remotePipelines[0]?.id ?? null,
      });
    } catch {
      set({
        pipelines: localPipelines,
        activePipelineId:
          currentActivePipelineId && localPipelines.some((pipeline) => pipeline.id === currentActivePipelineId)
            ? currentActivePipelineId
            : localPipelines[0]?.id ?? null,
      });
    }
  },

  addPipeline: async (pipeline) => {
    const nextPipeline: SavedPipeline = {
      ...cloneValue(pipeline),
      steps: pipeline.steps.map((step) => ({ ...step })),
      savedAt: Date.now(),
      synced: false,
    };
    const nextPipelines = sortPipelines([nextPipeline, ...get().pipelines.filter((item) => item.id !== nextPipeline.id)]);
    persistPipelines(nextPipelines);
    set({
      pipelines: nextPipelines,
      activePipelineId: nextPipeline.id,
    });

    if (!hasAuthToken()) {
      return;
    }

    try {
      const remotePipeline = await pipelinesApi.create({
        id: nextPipeline.id,
        name: nextPipeline.name,
        steps: nextPipeline.steps,
      });
      const syncedPipeline: SavedPipeline = {
        id: remotePipeline.id,
        name: remotePipeline.name,
        savedAt: remotePipeline.savedAt,
        steps: remotePipeline.steps.map((step) => ({ ...step })),
        synced: true,
      };
      const syncedPipelines = sortPipelines(
        syncPipeline(get().pipelines, nextPipeline.savedAt, syncedPipeline),
      );
      persistPipelines(syncedPipelines);
      set({ pipelines: syncedPipelines, activePipelineId: syncedPipeline.id });
    } catch {
      // Preserve local-only behavior when remote persistence is unavailable.
    }
  },

  removePipeline: async (id) => {
    const nextPipelines = get().pipelines.filter((pipeline) => pipeline.id !== id);
    persistPipelines(nextPipelines);
    set({
      pipelines: nextPipelines,
      activePipelineId:
        get().activePipelineId === id ? nextPipelines[0]?.id ?? null : get().activePipelineId,
    });

    if (!hasAuthToken()) {
      return;
    }

    try {
      await pipelinesApi.delete(id);
    } catch {
      // Preserve local-only behavior when remote persistence is unavailable.
    }
  },

  updatePipeline: async (id, patch) => {
    const currentPipeline = get().pipelines.find((pipeline) => pipeline.id === id);
    if (!currentPipeline) {
      return;
    }

    const optimisticPipeline: SavedPipeline = {
      ...currentPipeline,
      ...cloneValue(patch),
      steps: patch.steps
        ? patch.steps.map((step) => ({ ...step }))
        : currentPipeline.steps.map((step) => ({ ...step })),
      savedAt: Date.now(),
      synced: currentPipeline.synced ?? false,
    };
    const nextPipelines = sortPipelines(
      get().pipelines.map((pipeline) =>
        pipeline.id === id ? optimisticPipeline : pipeline,
      ),
    );
    persistPipelines(nextPipelines);
    set({
      pipelines: nextPipelines,
      activePipelineId: id,
    });

    if (!hasAuthToken()) {
      return;
    }

    try {
      const remotePipeline = currentPipeline.synced
        ? await pipelinesApi.update(optimisticPipeline.id, {
            name: optimisticPipeline.name,
            steps: optimisticPipeline.steps,
          })
        : await pipelinesApi.create({
            id: optimisticPipeline.id,
            name: optimisticPipeline.name,
            steps: optimisticPipeline.steps,
          });
      const syncedPipeline: SavedPipeline = {
        id: remotePipeline.id,
        name: remotePipeline.name,
        savedAt: remotePipeline.savedAt,
        steps: remotePipeline.steps.map((step) => ({ ...step })),
        synced: true,
      };
      const syncedPipelines = sortPipelines(
        syncPipeline(get().pipelines, optimisticPipeline.savedAt, syncedPipeline),
      );
      persistPipelines(syncedPipelines);
      set({
        pipelines: syncedPipelines,
        activePipelineId: id,
      });
    } catch {
      // Preserve local-only behavior when remote persistence is unavailable.
    }
  },

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
