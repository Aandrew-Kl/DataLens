"use client";

import { useCallback, useEffect, useState } from "react";
import { runQuery } from "@/lib/duckdb/client";

export interface UseDuckDBQueryResult<T = Record<string, unknown>[]> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

interface QueryState<T> {
  requestKey: string | null;
  data: T | null;
  error: string | null;
}

export function useDuckDBQuery<T = Record<string, unknown>[]>(
  sql: string | null,
): UseDuckDBQueryResult<T> {
  const [queryState, setQueryState] = useState<QueryState<T>>({
    requestKey: null,
    data: null,
    error: null,
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const requestKey = sql ? `${refreshKey}:${sql}` : null;

  const refetch = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!sql || !requestKey) {
      return;
    }

    let active = true;

    runQuery(sql)
      .then((rows) => {
        if (!active) return;
        setQueryState({
          requestKey,
          data: rows as T,
          error: null,
        });
      })
      .catch((queryError: unknown) => {
        if (!active) return;
        setQueryState({
          requestKey,
          data: null,
          error:
            queryError instanceof Error
              ? queryError.message
              : "Failed to run DuckDB query.",
        });
      });

    return () => {
      active = false;
    };
  }, [requestKey, sql]);

  const isCurrentRequestResolved = queryState.requestKey === requestKey;

  return {
    data: requestKey && isCurrentRequestResolved ? queryState.data : null,
    loading: requestKey !== null && !isCurrentRequestResolved,
    error: requestKey && isCurrentRequestResolved ? queryState.error : null,
    refetch,
  };
}
