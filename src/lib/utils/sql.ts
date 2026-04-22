/**
 * SQL identifier quoting and safe metric-expression building helpers.
 *
 * Centralises the two primitives every SQL-touching module in DataLens relies on:
 *   - `quoteIdentifier` — escapes and wraps column / table names so they can be
 *     safely interpolated into DuckDB queries.
 *   - `buildMetricExpression` — validates an aggregation against an allow-list
 *     and produces a properly-quoted metric expression.
 *
 * Previously these lived in two separate files (`sql.ts` + `sql-safe.ts`). They
 * are fused here because they share a single domain (SQL construction) and
 * keeping them together removes the ambiguity of which helper belongs where.
 */

const ALLOWED_AGGREGATIONS = new Set([
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "MEDIAN",
  "STDDEV",
  "VARIANCE",
  "COUNT_DISTINCT",
  "APPROX_COUNT_DISTINCT",
  "FIRST",
  "LAST",
  "LIST",
  "STRING_AGG",
] as const);

export type AggregationType = typeof ALLOWED_AGGREGATIONS extends Set<infer T> ? T : never;

/**
 * Quote a SQL identifier (table or column name) using double-quotes and
 * escaping any internal double-quotes by doubling them.
 */
export function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Validate an aggregation function name against the allow-list.
 * Throws if the function is not supported.
 */
export function validateAggregation(agg: string): AggregationType {
  const upper = agg.toUpperCase().trim();
  if (!ALLOWED_AGGREGATIONS.has(upper as AggregationType)) {
    throw new Error(`Invalid aggregation function: ${agg}`);
  }
  return upper as AggregationType;
}

/**
 * Build a metric expression like `SUM(CAST("sales" AS DOUBLE))` from a
 * validated aggregation function and a column name. Uses `quoteIdentifier`
 * as the default identifier quoter but accepts an override for contexts that
 * need alternative quoting (e.g. `[brackets]`).
 */
export function buildMetricExpression(
  aggregation: string,
  column?: string,
  quoteId?: (s: string) => string,
  options?: { cast?: boolean; preserveCase?: boolean },
): string {
  const safeAgg = validateAggregation(aggregation);
  if (safeAgg === "COUNT" || !column) {
    return "COUNT(*)";
  }
  const quoteFn = quoteId ?? quoteIdentifier;
  if (safeAgg === "COUNT_DISTINCT") {
    return `COUNT(DISTINCT ${quoteFn(column)})`;
  }
  const functionName = options?.preserveCase ? aggregation.trim() : safeAgg;
  if (options?.cast === false) {
    return `${functionName}(${quoteFn(column)})`;
  }
  return `${functionName}(CAST(${quoteFn(column)} AS DOUBLE))`;
}
