"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { runQuery } from "@/lib/duckdb/client";

export interface ColumnStatistics {
  tableName: string;
  columnName: string;
  loading: boolean;
  count: number;
  nonNullCount: number;
  distinctCount: number;
  nullCount: number;
  min: number | string | boolean | null;
  max: number | string | boolean | null;
  mean: number | null;
  median: number | null;
  stddev: number | null;
  percentiles: {
    p25: number | null;
    p50: number | null;
    p75: number | null;
    p95: number | null;
    p99: number | null;
  };
  refreshedAt: number | null;
  error: string | null;
}

type CachedColumnStatistics = Omit<ColumnStatistics, "loading">;

const EMPTY_STATS: ColumnStatistics = {
  tableName: "",
  columnName: "",
  loading: false,
  count: 0,
  nonNullCount: 0,
  distinctCount: 0,
  nullCount: 0,
  min: null,
  max: null,
  mean: null,
  median: null,
  stddev: null,
  percentiles: {
    p25: null,
    p50: null,
    p75: null,
    p95: null,
    p99: null,
  },
  refreshedAt: null,
  error: null,
};

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function toNumber(value: unknown): number | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function toScalar(value: unknown): number | string | boolean | null {
  if (
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  return value == null ? null : String(value);
}

async function queryColumnStatistics(
  tableName: string,
  columnName: string,
): Promise<CachedColumnStatistics> {
  const table = quoteIdentifier(tableName);
  const column = quoteIdentifier(columnName);
  const rows = await runQuery(`
    WITH source AS (
      SELECT
        ${column} AS column_value,
        TRY_CAST(${column} AS DOUBLE) AS numeric_value
      FROM ${table}
    )
    SELECT
      COUNT(*) AS row_count,
      COUNT(column_value) AS non_null_count,
      COUNT(DISTINCT column_value) AS distinct_count,
      COUNT(*) FILTER (WHERE column_value IS NULL) AS null_count,
      MIN(column_value) AS min_value,
      MAX(column_value) AS max_value,
      AVG(numeric_value) AS mean_value,
      MEDIAN(numeric_value) AS median_value,
      STDDEV_SAMP(numeric_value) AS stddev_value,
      QUANTILE_CONT(numeric_value, 0.25) AS p25_value,
      QUANTILE_CONT(numeric_value, 0.50) AS p50_value,
      QUANTILE_CONT(numeric_value, 0.75) AS p75_value,
      QUANTILE_CONT(numeric_value, 0.95) AS p95_value,
      QUANTILE_CONT(numeric_value, 0.99) AS p99_value
    FROM source
  `);

  const row = rows[0] ?? {};

  return {
    tableName,
    columnName,
    count: toNumber(row.row_count) ?? 0,
    nonNullCount: toNumber(row.non_null_count) ?? 0,
    distinctCount: toNumber(row.distinct_count) ?? 0,
    nullCount: toNumber(row.null_count) ?? 0,
    min: toScalar(row.min_value),
    max: toScalar(row.max_value),
    mean: toNumber(row.mean_value),
    median: toNumber(row.median_value),
    stddev: toNumber(row.stddev_value),
    percentiles: {
      p25: toNumber(row.p25_value),
      p50: toNumber(row.p50_value),
      p75: toNumber(row.p75_value),
      p95: toNumber(row.p95_value),
      p99: toNumber(row.p99_value),
    },
    refreshedAt: Date.now(),
    error: null,
  };
}

export function useColumnStats(
  tableName: string,
  columnName: string,
): ColumnStatistics {
  const cacheRef = useRef<Map<string, CachedColumnStatistics>>(new Map());
  const requestIdRef = useRef(0);
  const cacheKey = useMemo(() => `${tableName}::${columnName}`, [columnName, tableName]);
  const [statistics, setStatistics] = useState<ColumnStatistics>(() => {
    const cached = cacheRef.current.get(cacheKey);
    return cached
      ? { ...cached, loading: false }
      : {
          ...EMPTY_STATS,
          tableName,
          columnName,
          loading: Boolean(tableName) && Boolean(columnName),
        };
  });

  const refresh = useEffectEvent(async () => {
    if (!tableName || !columnName) {
      setStatistics({
        ...EMPTY_STATS,
        tableName,
        columnName,
        loading: false,
      });
      return;
    }

    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setStatistics({ ...cached, loading: false });
      return;
    }

    const currentRequestId = requestIdRef.current + 1;
    requestIdRef.current = currentRequestId;

    setStatistics((current) => ({
      ...current,
      tableName,
      columnName,
      loading: true,
      error: null,
    }));

    try {
      const nextStatistics = await queryColumnStatistics(tableName, columnName);
      cacheRef.current.set(cacheKey, nextStatistics);

      if (requestIdRef.current === currentRequestId) {
        setStatistics({ ...nextStatistics, loading: false });
      }
    } catch (error) {
      if (requestIdRef.current === currentRequestId) {
        setStatistics((current) => ({
          ...current,
          tableName,
          columnName,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to compute column statistics.",
        }));
      }
    }
  });

  useEffect(() => {
    void refresh();
  }, [cacheKey]);

  return statistics;
}
