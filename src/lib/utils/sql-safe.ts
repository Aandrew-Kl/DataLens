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

export function validateAggregation(agg: string): AggregationType {
  const upper = agg.toUpperCase().trim();
  if (!ALLOWED_AGGREGATIONS.has(upper as AggregationType)) {
    throw new Error(`Invalid aggregation function: ${agg}`);
  }
  return upper as AggregationType;
}

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
  const quoteFn = quoteId ?? ((value: string) => `"${value.replaceAll('"', '""')}"`);
  if (safeAgg === "COUNT_DISTINCT") {
    return `COUNT(DISTINCT ${quoteFn(column)})`;
  }
  const functionName = options?.preserveCase ? aggregation.trim() : safeAgg;
  if (options?.cast === false) {
    return `${functionName}(${quoteFn(column)})`;
  }
  return `${functionName}(CAST(${quoteFn(column)} AS DOUBLE))`;
}
