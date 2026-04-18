export interface QueryRequest {
  question: string;
  datasetId: string;
}

export interface QueryResult {
  sql: string;
  data: Record<string, unknown>[];
  columns: string[];
  rowCount: number;
  chart?: import("./chart").ChartConfig;
  summary?: string;
  executionTimeMs: number;
}

export interface SavedQuery {
  id: string;
  question: string;
  sql: string;
  datasetId: string;
  createdAt: number;
  synced?: boolean;
}
