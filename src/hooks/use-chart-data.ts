"use client";

import { buildMetricExpression, quoteIdentifier } from "@/lib/utils/sql";
import { useDuckDBQuery } from "@/hooks/use-duckdb-query";

export interface UseChartDataConfig {
  tableName: string | null;
  type?: string;
  xColumn?: string;
  yColumn?: string;
  aggregation?: string;
  groupBy?: string;
  limit?: number;
  filters?: string | string[];
}

export interface UseChartDataResult {
  chartData: Record<string, unknown>[];
  loading: boolean;
  error: string | null;
  sql: string | null;
  refetch: () => void;
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (value == null) {
    return fallback;
  }

  const numericValue = Math.floor(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(Math.max(numericValue, 1), 5_000);
}

function defaultLimitForType(type: string, hasGroupBy: boolean): number {
  if (type === "histogram") return 5_000;
  if (type === "scatter") return 400;
  if (type === "pie") return 12;
  if (hasGroupBy) return type === "bar" ? 120 : 200;
  return type === "bar" ? 24 : 80;
}

function normalizeFilters(filters: string | string[] | undefined): string[] {
  if (!filters) {
    return [];
  }

  const filterList = Array.isArray(filters) ? filters : [filters];
  return filterList
    .map((filter) => filter.trim())
    .filter((filter) => filter.length > 0);
}

function buildChartDataSql(config: UseChartDataConfig): string | null {
  const {
    tableName,
    type = "bar",
    xColumn,
    yColumn,
    aggregation = "count",
    groupBy,
    limit,
    filters,
  } = config;

  if (!tableName) {
    return null;
  }

  const normalizedType = type.toLowerCase();
  const safeTable = quoteIdentifier(tableName);
  const safeX = xColumn ? quoteIdentifier(xColumn) : null;
  const safeY = yColumn ? quoteIdentifier(yColumn) : null;
  const safeGroup = groupBy ? quoteIdentifier(groupBy) : null;
  const safeLimit = clampLimit(
    limit,
    defaultLimitForType(normalizedType, Boolean(safeGroup)),
  );
  const extraFilters = normalizeFilters(filters);

  if (normalizedType === "histogram") {
    if (!safeY) return null;
    const whereConditions = [`${safeY} IS NOT NULL`, ...extraFilters];
    return [
      `SELECT ${safeY}`,
      `FROM ${safeTable}`,
      `WHERE ${whereConditions.join(" AND ")}`,
      `LIMIT ${safeLimit}`,
    ].join(" ");
  }

  if (normalizedType === "scatter") {
    if (!safeX || !safeY) return null;
    const whereConditions = [
      `${safeX} IS NOT NULL`,
      `${safeY} IS NOT NULL`,
      ...extraFilters,
    ];
    return [
      `SELECT ${safeX}, ${safeY}`,
      `FROM ${safeTable}`,
      `WHERE ${whereConditions.join(" AND ")}`,
      `LIMIT ${safeLimit}`,
    ].join(" ");
  }

  if (!safeX || (!safeY && aggregation.toUpperCase().trim() !== "COUNT")) {
    return null;
  }

  const metricAlias = safeY ?? quoteIdentifier("value");
  const aggregatedValue = `${buildMetricExpression(aggregation, yColumn, quoteIdentifier, {
    cast: false,
    preserveCase: true,
  })} AS ${metricAlias}`;
  const whereConditions = [`${safeX} IS NOT NULL`];

  if (safeY) {
    whereConditions.push(`${safeY} IS NOT NULL`);
  }

  whereConditions.push(...extraFilters);

  if (normalizedType === "pie") {
    return [
      `SELECT ${safeX}, ${aggregatedValue}`,
      `FROM ${safeTable}`,
      `WHERE ${whereConditions.join(" AND ")}`,
      "GROUP BY 1",
      "ORDER BY 2 DESC",
      `LIMIT ${safeLimit}`,
    ].join(" ");
  }

  if (safeGroup) {
    return [
      `SELECT ${safeX}, ${safeGroup}, ${aggregatedValue}`,
      `FROM ${safeTable}`,
      `WHERE ${whereConditions.join(" AND ")} AND ${safeGroup} IS NOT NULL`,
      "GROUP BY 1, 2",
      "ORDER BY 1 ASC, 2 ASC",
      `LIMIT ${safeLimit}`,
    ].join(" ");
  }

  const orderClause =
    normalizedType === "line" || normalizedType === "area"
      ? "ORDER BY 1 ASC"
      : "ORDER BY 2 DESC";

  return [
    `SELECT ${safeX}, ${aggregatedValue}`,
    `FROM ${safeTable}`,
    `WHERE ${whereConditions.join(" AND ")}`,
    "GROUP BY 1",
    orderClause,
    `LIMIT ${safeLimit}`,
  ].join(" ");
}

function transformChartRows(
  rows: Record<string, unknown>[],
  config: UseChartDataConfig,
): Record<string, unknown>[] {
  const yKey = config.yColumn ?? "value";

  return rows.map((row) => {
    const xValue = config.xColumn ? row[config.xColumn] : undefined;
    const yValue = row[yKey];
    const groupValue = config.groupBy ? row[config.groupBy] : undefined;

    return {
      ...row,
      x_value: xValue,
      y_value: yValue,
      group_value: groupValue,
      label: xValue,
      value: yValue,
    };
  });
}

export function useChartData(config: UseChartDataConfig): UseChartDataResult {
  let configError: string | null = null;
  let sql: string | null = null;

  try {
    sql = buildChartDataSql(config);
  } catch (error) {
    configError = error instanceof Error ? error.message : "Unable to build chart query.";
  }

  const query = useDuckDBQuery(sql);
  const chartData = transformChartRows(query.data ?? [], config);

  return {
    chartData,
    loading: query.loading,
    error: configError ?? query.error,
    sql,
    refetch: query.refetch,
  };
}
