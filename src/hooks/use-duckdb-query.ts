"use client";

import { useCallback, useEffect, useState } from "react";
import { runQuery } from "@/lib/duckdb/client";

export interface UseDuckDBQueryResult<T = Record<string, unknown>[]> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDuckDBQuery<T = Record<string, unknown>[]>(
  sql: string | null,
  deps: unknown[] = [],
): UseDuckDBQueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!sql) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;

    setData(null);
    setLoading(true);
    setError(null);

    runQuery(sql)
      .then((rows) => {
        if (!active) return;
        setData(rows as T);
      })
      .catch((queryError: unknown) => {
        if (!active) return;
        setData(null);
        setError(
          queryError instanceof Error
            ? queryError.message
            : "Failed to run DuckDB query.",
        );
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [sql, refreshKey, ...deps]);

  return { data, loading, error, refetch };
}
