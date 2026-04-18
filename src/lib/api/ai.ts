import { request } from "./client";
import type { SentimentResult, SummarizeResult, QueryGenerateResult } from "./types";

export interface QuerySchemaColumn {
  name: string;
  type?: string;
}

export interface GenerateQueryPayload {
  question: string;
  table_name: string;
  schema: QuerySchemaColumn[];
  data: Record<string, unknown>[];
  use_ollama?: boolean;
}

export async function sentiment(texts: string[]): Promise<SentimentResult> {
  return request<SentimentResult>("POST", "/api/ai/sentiment", {
    data: texts.map((text) => ({ text })),
    text_column: "text",
  });
}

export async function summarize(
  data: Record<string, unknown>[],
  columns: string[],
): Promise<SummarizeResult> {
  return request<SummarizeResult>("POST", "/api/ai/summarize", {
    data,
    text_columns: columns,
  });
}

export async function generateQuery(
  payload: GenerateQueryPayload,
): Promise<QueryGenerateResult> {
  return request<QueryGenerateResult>("POST", "/api/ai/generate-query", payload);
}
