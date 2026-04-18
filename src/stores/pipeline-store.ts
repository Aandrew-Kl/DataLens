"use client";

import { create } from "zustand";
import { runQuery } from "@/lib/duckdb/client";
import {
  clearSyncFlag,
  createSyncFailureNotifier,
  hasPendingSync,
  markPendingSync,
} from "@/lib/sync-feedback";
import {
  compilePipeline,
  type PipelineStep,
  type SavedPipeline,
} from "@/lib/utils/pipeline-builder";
import type { ColumnProfile } from "@/types/dataset";

const MAX_EXECUTION_HISTORY = 20;
const STORAGE_KEY = "datalens-pipeline-store";
const notifyPipelineSyncFailure = createSyncFailureNotifier("pipeline");

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
  syncPending: () => void;
}

interface PipelineStorageSnapshot {
  pipelines: SavedPipeline[];
  activePipelineId: string | null;
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

function isSavedPipeline(candidate: unknown): candidate is SavedPipeline {
  if (!candidate || typeof candidate !== "object") return false;

  const pipeline = candidate as Partial<SavedPipeline>;
  return (
    typeof pipeline.id === "string" &&
    typeof pipeline.name === "string" &&
    typeof pipeline.savedAt === "number" &&
    Number.isFinite(pipeline.savedAt) &&
    Array.isArray(pipeline.steps) &&
    (typeof pipeline.synced === "undefined" || typeof pipeline.synced === "boolean")
  );
}

function normalizePipelineSnapshot(
  snapshot: PipelineStorageSnapshot,
): PipelineStorageSnapshot {
  return {
    pipelines: snapshot.pipelines.map((pipeline) => clearSyncFlag(pipeline)),
    activePipelineId: snapshot.activePipelineId,
  };
}

function markPipelinesPending(
  pipelines: SavedPipeline[],
  ids: string[],
): SavedPipeline[] {
  const pendingIds = new Set(ids);
  return pipelines.map((pipeline) =>
    pendingIds.has(pipeline.id) ? markPendingSync(pipeline) : pipeline,
  );
}

function readPipelineSnapshot(): PipelineStorageSnapshot {
  if (typeof window === "undefined") {
    return { pipelines: [], activePipelineId: null };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { pipelines: [], activePipelineId: null };
    }

    const parsed = JSON.parse(raw) as unknown;

    if (Array.isArray(parsed)) {
      const pipelines = parsed.filter(isSavedPipeline);
      return { pipelines, activePipelineId: pipelines[0]?.id ?? null };
    }

    if (!parsed || typeof parsed !== "object") {
      return { pipelines: [], activePipelineId: null };
    }

    const candidate = parsed as Partial<PipelineStorageSnapshot>;
    const pipelines = Array.isArray(candidate.pipelines)
      ? candidate.pipelines.filter(isSavedPipeline)
      : [];
    const activePipelineId =
      typeof candidate.activePipelineId === "string" &&
      pipelines.some((pipeline) => pipeline.id === candidate.activePipelineId)
        ? candidate.activePipelineId
        : pipelines[0]?.id ?? null;

    return { pipelines, activePipelineId };
  } catch {
    return { pipelines: [], activePipelineId: null };
  }
}

function persistPipelineSnapshot(snapshot: PipelineStorageSnapshot): boolean {
  if (typeof window === "undefined") return true;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

const initialSnapshot = readPipelineSnapshot();

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  pipelines: initialSnapshot.pipelines,
  activePipelineId: initialSnapshot.activePipelineId,
  executionHistory: [],

  addPipeline: (pipeline) =>
    set((state) => {
      const nextPipeline: SavedPipeline = {
        ...cloneValue(pipeline),
        steps: pipeline.steps.map((step) => ({ ...step })),
        savedAt: Date.now(),
      };

      const nextPipelines = [
        nextPipeline,
        ...state.pipelines.filter((existing) => existing.id !== nextPipeline.id),
      ];
      const nextActivePipelineId = nextPipeline.id;
      const syncedSnapshot = normalizePipelineSnapshot({
        pipelines: nextPipelines,
        activePipelineId: nextActivePipelineId,
      });

      if (persistPipelineSnapshot(syncedSnapshot)) {
        return syncedSnapshot;
      }

      notifyPipelineSyncFailure();
      return {
        pipelines: markPipelinesPending(nextPipelines, [nextPipeline.id]),
        activePipelineId: nextActivePipelineId,
      };
    }),

  removePipeline: (id) =>
    set((state) => {
      const nextPipelines = state.pipelines.filter((pipeline) => pipeline.id !== id);
      const nextActivePipelineId =
        state.activePipelineId === id ? nextPipelines[0]?.id ?? null : state.activePipelineId;
      const syncedSnapshot = normalizePipelineSnapshot({
        pipelines: nextPipelines,
        activePipelineId: nextActivePipelineId,
      });

      if (persistPipelineSnapshot(syncedSnapshot)) {
        return syncedSnapshot;
      }

      notifyPipelineSyncFailure();
      return {
        pipelines: markPipelinesPending(state.pipelines, [id]),
        activePipelineId: state.activePipelineId,
      };
    }),

  updatePipeline: (id, patch) =>
    set((state) => {
      const index = state.pipelines.findIndex((pipeline) => pipeline.id === id);
      if (index < 0) return state;

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

      const syncedSnapshot = normalizePipelineSnapshot({
        pipelines: nextPipelines,
        activePipelineId: id,
      });

      if (persistPipelineSnapshot(syncedSnapshot)) {
        return syncedSnapshot;
      }

      notifyPipelineSyncFailure();
      return {
        pipelines: markPipelinesPending(nextPipelines, [id]),
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

  syncPending: () => {
    const pendingPipelines = get().pipelines.filter(hasPendingSync);
    if (pendingPipelines.length === 0) {
      return;
    }

    const syncedSnapshot = normalizePipelineSnapshot({
      pipelines: get().pipelines,
      activePipelineId: get().activePipelineId,
    });

    if (persistPipelineSnapshot(syncedSnapshot)) {
      set(syncedSnapshot);
      return;
    }

    notifyPipelineSyncFailure(pendingPipelines.length);
  },
}));
