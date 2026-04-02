import { runQuery } from "./client";
import type { ColumnProfile, ColumnType } from "@/types/dataset";

function mapDuckDBType(duckType: string): ColumnType {
  const t = duckType.toUpperCase();
  if (
    t.includes("INT") ||
    t.includes("FLOAT") ||
    t.includes("DOUBLE") ||
    t.includes("DECIMAL") ||
    t.includes("NUMERIC") ||
    t.includes("REAL") ||
    t.includes("BIGINT") ||
    t.includes("SMALLINT") ||
    t.includes("TINYINT") ||
    t.includes("HUGEINT")
  )
    return "number";
  if (t.includes("DATE") || t.includes("TIME") || t.includes("TIMESTAMP"))
    return "date";
  if (t.includes("BOOL")) return "boolean";
  if (t.includes("VARCHAR") || t.includes("TEXT") || t.includes("CHAR"))
    return "string";
  return "unknown";
}

export async function profileTable(
  tableName: string
): Promise<ColumnProfile[]> {
  // Get schema
  const schemaRows = await runQuery(`DESCRIBE "${tableName}"`);

  const profiles: ColumnProfile[] = [];

  for (const row of schemaRows) {
    const colName = String(row.column_name);
    const colType = mapDuckDBType(String(row.column_type));

    // Get null count and unique count
    const statsResult = await runQuery(
      `SELECT
        COUNT(*) - COUNT("${colName}") AS null_count,
        COUNT(DISTINCT "${colName}") AS unique_count
       FROM "${tableName}"`
    );

    const stats = statsResult[0] || {};

    // Get sample values
    const sampleResult = await runQuery(
      `SELECT DISTINCT "${colName}" AS val FROM "${tableName}" WHERE "${colName}" IS NOT NULL LIMIT 5`
    );
    const sampleValues = sampleResult.map((r) => r.val as string | number | boolean | null);

    const profile: ColumnProfile = {
      name: colName,
      type: colType,
      nullCount: Number(stats.null_count || 0),
      uniqueCount: Number(stats.unique_count || 0),
      sampleValues,
    };

    // Numeric stats
    if (colType === "number") {
      try {
        const numStats = await runQuery(
          `SELECT
            MIN("${colName}") AS min_val,
            MAX("${colName}") AS max_val,
            AVG("${colName}") AS mean_val,
            MEDIAN("${colName}") AS median_val
           FROM "${tableName}" WHERE "${colName}" IS NOT NULL`
        );
        if (numStats[0]) {
          profile.min = Number(numStats[0].min_val);
          profile.max = Number(numStats[0].max_val);
          profile.mean = Number(Number(numStats[0].mean_val).toFixed(2));
          profile.median = Number(Number(numStats[0].median_val).toFixed(2));
        }
      } catch {
        // Some numeric columns might fail on aggregation
      }
    }

    // Date min/max
    if (colType === "date") {
      try {
        const dateStats = await runQuery(
          `SELECT MIN("${colName}")::VARCHAR AS min_val, MAX("${colName}")::VARCHAR AS max_val FROM "${tableName}" WHERE "${colName}" IS NOT NULL`
        );
        if (dateStats[0]) {
          profile.min = String(dateStats[0].min_val);
          profile.max = String(dateStats[0].max_val);
        }
      } catch {
        // ignore
      }
    }

    profiles.push(profile);
  }

  return profiles;
}
