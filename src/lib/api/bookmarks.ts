import { request } from "./client";

interface BackendBookmarkRecord {
  id: string;
  user_id: string;
  dataset_id: string | null;
  table_name: string | null;
  label: string;
  description: string | null;
  column_name: string | null;
  sql_text: string | null;
  view_state: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface BookmarkRecord {
  id: string;
  datasetId: string | null;
  tableName: string | null;
  label: string;
  description: string | null;
  columnName: string | null;
  sql: string | null;
  viewState: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface BookmarkMutation {
  id?: string;
  datasetId?: string | null;
  tableName?: string | null;
  label: string;
  description?: string | null;
  columnName?: string | null;
  sql?: string | null;
  viewState?: Record<string, unknown> | null;
}

export type BookmarkUpdateMutation = Omit<BookmarkMutation, "id">;

function fromBackend(record: BackendBookmarkRecord): BookmarkRecord {
  return {
    id: record.id,
    datasetId: record.dataset_id,
    tableName: record.table_name,
    label: record.label,
    description: record.description,
    columnName: record.column_name,
    sql: record.sql_text,
    viewState: record.view_state,
    createdAt: new Date(record.created_at).getTime(),
    updatedAt: new Date(record.updated_at).getTime(),
  };
}

function toBackend(payload: BookmarkMutation) {
  return {
    ...(payload.id ? { id: payload.id } : {}),
    dataset_id: payload.datasetId ?? null,
    table_name: payload.tableName ?? null,
    label: payload.label,
    description: payload.description ?? null,
    column_name: payload.columnName ?? null,
    sql_text: payload.sql ?? null,
    view_state: payload.viewState ?? null,
  };
}

export const bookmarksApi = {
  async list(): Promise<BookmarkRecord[]> {
    const records = await request<BackendBookmarkRecord[]>("GET", "/api/bookmarks");
    return records.map(fromBackend);
  },

  async create(payload: BookmarkMutation): Promise<BookmarkRecord> {
    const record = await request<BackendBookmarkRecord>(
      "POST",
      "/api/bookmarks",
      toBackend(payload),
    );
    return fromBackend(record);
  },

  async update(id: string, payload: BookmarkUpdateMutation): Promise<BookmarkRecord> {
    const record = await request<BackendBookmarkRecord>(
      "PATCH",
      `/api/bookmarks/${id}`,
      toBackend(payload),
    );
    return fromBackend(record);
  },

  async delete(id: string): Promise<void> {
    await request<void>("DELETE", `/api/bookmarks/${id}`);
  },
};
