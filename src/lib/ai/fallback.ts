import type { ColumnProfile } from "@/types/dataset";

/**
 * Generates basic SQL and insights without Ollama.
 * Used as a fallback when the AI service is unavailable.
 */

export function generateFallbackSQL(
  question: string,
  tableName: string,
  columns: ColumnProfile[]
): string | null {
  const q = question.toLowerCase();
  const numericCols = columns.filter((c) => c.type === "number");
  const stringCols = columns.filter((c) => c.type === "string");
  const dateCols = columns.filter((c) => c.type === "date");

  // Count / how many
  if (q.includes("how many") || q.includes("count") || q.includes("total rows")) {
    return `SELECT COUNT(*) AS total_count FROM "${tableName}"`;
  }

  // Top N
  const topMatch = q.match(/top\s+(\d+)/i);
  if (topMatch && numericCols.length > 0) {
    const limit = parseInt(topMatch[1]);
    const orderCol = numericCols[numericCols.length - 1].name;
    return `SELECT * FROM "${tableName}" ORDER BY "${orderCol}" DESC LIMIT ${limit}`;
  }

  // Average / mean
  if ((q.includes("average") || q.includes("avg") || q.includes("mean")) && numericCols.length > 0) {
    const aggCols = numericCols.map((c) => `AVG("${c.name}") AS avg_${c.name.replace(/\s+/g, "_")}`).join(", ");
    return `SELECT ${aggCols} FROM "${tableName}"`;
  }

  // Sum / total
  if ((q.includes("sum") || q.includes("total")) && numericCols.length > 0) {
    if (stringCols.length > 0) {
      const groupCol = stringCols[0].name;
      const sumCol = numericCols[0].name;
      return `SELECT "${groupCol}", SUM("${sumCol}") AS total FROM "${tableName}" GROUP BY "${groupCol}" ORDER BY total DESC LIMIT 20`;
    }
    const aggCols = numericCols.map((c) => `SUM("${c.name}") AS total_${c.name.replace(/\s+/g, "_")}`).join(", ");
    return `SELECT ${aggCols} FROM "${tableName}"`;
  }

  // Group by / by category / per / breakdown
  if (q.includes("by ") || q.includes("per ") || q.includes("breakdown") || q.includes("group")) {
    if (stringCols.length > 0 && numericCols.length > 0) {
      // Find which column the user might be referring to
      let groupCol = stringCols[0].name;
      for (const col of stringCols) {
        if (q.includes(col.name.toLowerCase())) {
          groupCol = col.name;
          break;
        }
      }
      const sumCol = numericCols[0].name;
      return `SELECT "${groupCol}", SUM("${sumCol}") AS total, COUNT(*) AS count FROM "${tableName}" GROUP BY "${groupCol}" ORDER BY total DESC LIMIT 20`;
    }
  }

  // Trend / over time
  if ((q.includes("trend") || q.includes("over time") || q.includes("monthly") || q.includes("daily")) && dateCols.length > 0 && numericCols.length > 0) {
    const dateCol = dateCols[0].name;
    const valCol = numericCols[0].name;
    return `SELECT DATE_TRUNC('month', "${dateCol}"::DATE) AS month, SUM("${valCol}") AS total FROM "${tableName}" GROUP BY month ORDER BY month`;
  }

  // Distribution / unique values
  if (q.includes("distribution") || q.includes("unique") || q.includes("distinct")) {
    if (stringCols.length > 0) {
      const col = stringCols[0].name;
      return `SELECT "${col}", COUNT(*) AS count FROM "${tableName}" GROUP BY "${col}" ORDER BY count DESC LIMIT 20`;
    }
  }

  // Show all / preview
  if (q.includes("show") || q.includes("preview") || q.includes("sample") || q.includes("first")) {
    return `SELECT * FROM "${tableName}" LIMIT 20`;
  }

  // Default: show summary stats
  if (numericCols.length > 0 && stringCols.length > 0) {
    return `SELECT "${stringCols[0].name}", SUM("${numericCols[0].name}") AS total, COUNT(*) AS count FROM "${tableName}" GROUP BY "${stringCols[0].name}" ORDER BY total DESC LIMIT 15`;
  }

  return `SELECT * FROM "${tableName}" LIMIT 20`;
}

export function generateFallbackQuestions(
  tableName: string,
  columns: ColumnProfile[]
): string[] {
  const numericCols = columns.filter((c) => c.type === "number");
  const stringCols = columns.filter((c) => c.type === "string");
  const dateCols = columns.filter((c) => c.type === "date");

  const questions: string[] = [];

  questions.push("How many total rows are in the dataset?");

  if (numericCols.length > 0) {
    questions.push(`What is the average ${numericCols[0].name}?`);
  }

  if (stringCols.length > 0 && numericCols.length > 0) {
    questions.push(`Show total ${numericCols[0].name} by ${stringCols[0].name}`);
  }

  if (numericCols.length > 0) {
    questions.push(`Show the top 10 records by ${numericCols[numericCols.length - 1].name}`);
  }

  if (dateCols.length > 0 && numericCols.length > 0) {
    questions.push(`Show the monthly trend of ${numericCols[0].name}`);
  }

  if (stringCols.length > 0) {
    questions.push(`What are the unique values of ${stringCols[0].name}?`);
  }

  return questions.slice(0, 6);
}

export function generateFallbackDashboard(
  tableName: string,
  columns: ColumnProfile[],
  rowCount: number
): { metrics: { label: string; value: string | number; emoji: string; column?: string; aggregation?: string }[]; charts: { id: string; type: string; title: string; sql: string; xAxis?: string; yAxis?: string }[] } {
  const numericCols = columns.filter((c) => c.type === "number");
  const stringCols = columns.filter((c) => c.type === "string");
  const dateCols = columns.filter((c) => c.type === "date");

  const metrics = [
    { label: "Total Rows", value: rowCount, emoji: "📊" },
    { label: "Columns", value: columns.length, emoji: "📋" },
  ];

  if (numericCols.length > 0 && numericCols[0].mean !== undefined) {
    metrics.push({
      label: `Avg ${numericCols[0].name}`,
      value: Math.round(numericCols[0].mean),
      emoji: "📈",
    });
  }

  if (numericCols.length > 1 && numericCols[1].mean !== undefined) {
    metrics.push({
      label: `Avg ${numericCols[1].name}`,
      value: Math.round(numericCols[1].mean),
      emoji: "💰",
    });
  }

  const charts: { id: string; type: string; title: string; sql: string; xAxis: string; yAxis: string }[] = [];

  // Bar chart: first string col vs first numeric col
  if (stringCols.length > 0 && numericCols.length > 0) {
    charts.push({
      id: "chart-1",
      type: "bar",
      title: `${numericCols[0].name} by ${stringCols[0].name}`,
      sql: `SELECT "${stringCols[0].name}", SUM("${numericCols[0].name}") AS total FROM "${tableName}" GROUP BY "${stringCols[0].name}" ORDER BY total DESC LIMIT 15`,
      xAxis: stringCols[0].name,
      yAxis: "total",
    });
  }

  // Pie chart: distribution of first string col
  if (stringCols.length > 0) {
    charts.push({
      id: "chart-2",
      type: "pie",
      title: `${stringCols[0].name} Distribution`,
      sql: `SELECT "${stringCols[0].name}", COUNT(*) AS count FROM "${tableName}" GROUP BY "${stringCols[0].name}" ORDER BY count DESC LIMIT 10`,
      xAxis: stringCols[0].name,
      yAxis: "count",
    });
  }

  // Line chart: time series if date column exists
  if (dateCols.length > 0 && numericCols.length > 0) {
    charts.push({
      id: "chart-3",
      type: "line",
      title: `${numericCols[0].name} Over Time`,
      sql: `SELECT DATE_TRUNC('month', "${dateCols[0].name}"::DATE)::VARCHAR AS month, SUM("${numericCols[0].name}") AS total FROM "${tableName}" GROUP BY month ORDER BY month`,
      xAxis: "month",
      yAxis: "total",
    });
  }

  // Second bar chart with different columns
  if (stringCols.length > 1 && numericCols.length > 0) {
    charts.push({
      id: "chart-4",
      type: "bar",
      title: `${numericCols[0].name} by ${stringCols[1].name}`,
      sql: `SELECT "${stringCols[1].name}", SUM("${numericCols[0].name}") AS total FROM "${tableName}" GROUP BY "${stringCols[1].name}" ORDER BY total DESC LIMIT 15`,
      xAxis: stringCols[1].name,
      yAxis: "total",
    });
  }

  // Scatter if two numeric cols
  if (numericCols.length >= 2) {
    charts.push({
      id: "chart-5",
      type: "scatter",
      title: `${numericCols[0].name} vs ${numericCols[1].name}`,
      sql: `SELECT "${numericCols[0].name}", "${numericCols[1].name}" FROM "${tableName}" LIMIT 200`,
      xAxis: numericCols[0].name,
      yAxis: numericCols[1].name,
    });
  }

  return { metrics, charts };
}
