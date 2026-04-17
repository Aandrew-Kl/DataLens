import { request } from "./client";
import type { SentimentResult, SummarizeResult, QueryGenerateResult } from "./types";

export async function sentiment(texts: string[]): Promise<SentimentResult> {
  return request<SentimentResult>("POST", "/api/v1/ai/sentiment", {
    data: texts.map((text) => ({ text })),
    text_column: "text",
  });
}

export async function summarize(
  data: Record<string, unknown>[],
  columns: string[],
): Promise<SummarizeResult> {
  return request<SummarizeResult>("POST", "/api/v1/ai/summarize", {
    data,
    text_columns: columns,
  });
}

export async function generateQuery(
  question: string,
  table_name: string,
  columns: { name: string; type?: string }[],
): Promise<QueryGenerateResult> {
  return request<QueryGenerateResult>("POST", "/api/v1/ai/generate-query", { question, table_name, columns });
}
