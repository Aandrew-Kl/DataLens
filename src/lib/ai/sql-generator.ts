import { chat } from "./ollama-client";
import { sqlGenerationPrompt, chartRecommendationPrompt, summaryPrompt } from "./prompts";
import type { ColumnProfile } from "@/types/dataset";
import type { ChartConfig } from "@/types/chart";

export async function generateSQL(
  question: string,
  tableName: string,
  columns: ColumnProfile[]
): Promise<string> {
  const messages = sqlGenerationPrompt(question, tableName, columns);
  const response = await chat(messages);

  // Clean up response — remove markdown code blocks if present
  let sql = response.trim();
  if (sql.startsWith("```")) {
    sql = sql.replace(/^```(?:sql)?\n?/, "").replace(/\n?```$/, "");
  }
  sql = sql.trim();

  // Basic validation
  if (!sql.toUpperCase().startsWith("SELECT")) {
    // Try to extract SELECT statement
    const match = sql.match(/SELECT[\s\S]+/i);
    if (match) {
      sql = match[0];
    }
  }

  return sql;
}

export async function recommendChart(
  sql: string,
  resultColumns: string[],
  sampleData: Record<string, unknown>[],
  rowCount: number
): Promise<ChartConfig | null> {
  try {
    const messages = chartRecommendationPrompt(sql, resultColumns, sampleData, rowCount);
    const response = await chat(messages);

    // Extract JSON from response
    let json = response.trim();
    if (json.startsWith("```")) {
      json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const config = JSON.parse(json);
    return {
      id: crypto.randomUUID(),
      type: config.type || "bar",
      title: config.title || "Chart",
      xAxis: config.xAxis,
      yAxis: config.yAxis,
    };
  } catch {
    return null;
  }
}

export async function generateSummary(
  question: string,
  data: Record<string, unknown>[],
  rowCount: number
): Promise<string> {
  try {
    const messages = summaryPrompt(question, data, rowCount);
    return await chat(messages);
  } catch {
    return "";
  }
}
