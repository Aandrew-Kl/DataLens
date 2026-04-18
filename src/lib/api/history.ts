import { request } from "./client";

interface BackendHistoryRecord {
  id: number;
  user_id: string;
  dataset_id: string;
  question: string | null;
  sql_text: string;
  duration_ms: number;
  created_at: string;
}

export interface HistoryRecord {
  id: string;
  datasetId: string;
  question: string;
  sql: string;
  durationMs: number;
  createdAt: number;
}

export interface HistoryMutation {
  datasetId: string;
  question?: string | null;
  sql: string;
  durationMs?: number;
}

function summarizeSql(sql: string): string {
  const firstLine = sql.split("\n")[0]?.trim() ?? "";
  return firstLine || "Manual SQL";
}

function fromBackend(record: BackendHistoryRecord): HistoryRecord {
  return {
    id: String(record.id),
    datasetId: record.dataset_id,
    question: record.question ?? summarizeSql(record.sql_text),
    sql: record.sql_text,
    durationMs: record.duration_ms,
    createdAt: new Date(record.created_at).getTime(),
  };
}

function toBackend(payload: HistoryMutation) {
  return {
    dataset_id: payload.datasetId,
    question: payload.question ?? null,
    sql_text: payload.sql,
    duration_ms: Math.max(0, Math.round(payload.durationMs ?? 0)),
  };
}

export const historyApi = {
  async list(): Promise<HistoryRecord[]> {
    const records = await request<BackendHistoryRecord[]>("GET", "/api/history");
    return records.map(fromBackend);
  },

  async create(payload: HistoryMutation): Promise<HistoryRecord> {
    const record = await request<BackendHistoryRecord>(
      "POST",
      "/api/history",
      toBackend(payload),
    );
    return fromBackend(record);
  },

  async delete(id: string): Promise<void> {
    const numericId = Number.parseInt(id, 10);
    if (!Number.isInteger(numericId)) {
      return;
    }

    await request<void>("DELETE", `/api/history/${numericId}`);
  },
};
