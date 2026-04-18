import { request } from "./client";
import type { PipelineStep } from "@/lib/utils/pipeline-builder";

interface BackendPipelineRecord {
  id: string;
  user_id: string;
  name: string;
  steps: PipelineStep[];
  created_at: string;
  updated_at: string;
}

export interface PipelineRecord {
  id: string;
  name: string;
  steps: PipelineStep[];
  createdAt: number;
  savedAt: number;
}

export interface PipelineMutation {
  id?: string;
  name: string;
  steps: PipelineStep[];
}

function fromBackend(record: BackendPipelineRecord): PipelineRecord {
  return {
    id: record.id,
    name: record.name,
    steps: record.steps,
    createdAt: new Date(record.created_at).getTime(),
    savedAt: new Date(record.updated_at).getTime(),
  };
}

function toBackend(payload: PipelineMutation) {
  return {
    id: payload.id,
    name: payload.name,
    steps: payload.steps,
  };
}

export const pipelinesApi = {
  async list(): Promise<PipelineRecord[]> {
    const records = await request<BackendPipelineRecord[]>("GET", "/api/pipelines");
    return records.map(fromBackend);
  },

  async create(payload: PipelineMutation): Promise<PipelineRecord> {
    const record = await request<BackendPipelineRecord>(
      "POST",
      "/api/pipelines",
      toBackend(payload),
    );
    return fromBackend(record);
  },

  async delete(id: string): Promise<void> {
    await request<void>("DELETE", `/api/pipelines/${id}`);
  },
};
