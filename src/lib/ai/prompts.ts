import type { ColumnProfile } from "@/types/dataset";

function formatSchema(columns: ColumnProfile[]): string {
  return columns
    .map(
      (c) =>
        `- "${c.name}" (${c.type}, ${c.uniqueCount} unique values, ${c.nullCount} nulls${
          c.min !== undefined ? `, range: ${c.min} to ${c.max}` : ""
        }${c.mean !== undefined ? `, mean: ${c.mean}` : ""})`
    )
    .join("\n");
}

export function sqlGenerationPrompt(
  question: string,
  tableName: string,
  columns: ColumnProfile[]
): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content: `You are a SQL expert. Generate a single DuckDB SQL query to answer the user's question.

TABLE: "${tableName}"
COLUMNS:
${formatSchema(columns)}

RULES:
- Return ONLY the SQL query, nothing else. No markdown, no explanation.
- Always use double quotes for table and column names.
- Use DuckDB SQL dialect.
- For date operations use DuckDB functions (date_part, date_trunc, etc.)
- LIMIT results to 1000 rows max.
- If asked for "top N" use ORDER BY + LIMIT.
- For percentages, multiply by 100 and round to 2 decimal places.
- If the question is ambiguous, make a reasonable assumption.`,
    },
    {
      role: "user",
      content: question,
    },
  ];
}

export function chartRecommendationPrompt(
  sql: string,
  resultColumns: string[],
  sampleData: Record<string, unknown>[],
  rowCount: number
): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content: `You are a data visualization expert. Given a SQL query result, recommend the best chart type.

Return ONLY a JSON object with this exact structure (no markdown, no backticks):
{"type":"bar|line|pie|scatter|histogram|area","title":"Chart Title","xAxis":"column_name","yAxis":"column_name"}

RULES:
- For time series data → "line" or "area"
- For categorical comparisons → "bar"
- For proportions/percentages → "pie" (only if ≤10 categories)
- For correlation between two numbers → "scatter"
- For distribution of a single number → "histogram"
- xAxis and yAxis must be actual column names from the result
- Title should be concise and descriptive (max 8 words)`,
    },
    {
      role: "user",
      content: `SQL: ${sql}
Columns: ${resultColumns.join(", ")}
Row count: ${rowCount}
Sample (first 3 rows): ${JSON.stringify(sampleData.slice(0, 3))}`,
    },
  ];
}

export function autoDashboardPrompt(
  tableName: string,
  columns: ColumnProfile[],
  rowCount: number
): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content: `You are a data analyst. Given a dataset schema, suggest 4-6 insightful charts and 3-4 key metrics for an auto-generated dashboard.

Return ONLY a JSON object (no markdown, no backticks):
{
  "metrics": [
    {"label":"Metric Name","column":"column_name","aggregation":"count|sum|avg|min|max","emoji":"📊"}
  ],
  "charts": [
    {"type":"bar|line|pie|scatter|histogram|area","title":"Chart Title","sql":"SELECT ... FROM \\"${tableName}\\" ...","xAxis":"col","yAxis":"col"}
  ]
}

RULES:
- Use DuckDB SQL dialect with double-quoted identifiers.
- Make charts reveal interesting patterns (distributions, top-N, trends, correlations).
- Metrics should be high-level KPIs (total count, sum, average of key columns).
- SQL must be valid and reference the exact table "${tableName}" with exact column names.
- Prefer aggregations that reveal insights.
- LIMIT chart queries to 20 rows for readability.`,
    },
    {
      role: "user",
      content: `Table: "${tableName}" (${rowCount} rows)
Columns:
${formatSchema(columns)}`,
    },
  ];
}

export function summaryPrompt(
  question: string,
  data: Record<string, unknown>[],
  rowCount: number
): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content: `You are a data analyst. Write a brief, insightful 1-2 sentence summary of the query results. Be specific with numbers. No markdown.`,
    },
    {
      role: "user",
      content: `Question: "${question}"
Total rows: ${rowCount}
Data: ${JSON.stringify(data.slice(0, 20))}`,
    },
  ];
}

export function suggestQuestionsPrompt(
  tableName: string,
  columns: ColumnProfile[],
  rowCount: number
): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content: `You are a data analyst. Suggest 6 interesting questions a business user would ask about this dataset.

Return ONLY a JSON array of strings (no markdown, no backticks):
["Question 1?", "Question 2?", ...]

Make questions specific and actionable. Reference actual column names. Mix simple (counts, totals) with complex (trends, comparisons, outliers).`,
    },
    {
      role: "user",
      content: `Table: "${tableName}" (${rowCount} rows)
Columns:
${formatSchema(columns)}`,
    },
  ];
}
