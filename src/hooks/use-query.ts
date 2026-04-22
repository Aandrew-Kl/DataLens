"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { runQuery } from "@/lib/duckdb/client";

/**
 * The canonical React hook for running a DuckDB query from a component.
 *
 * Wraps `runQuery` from `@/lib/duckdb/client` with:
 *   - loading / error / data state machine
 *   - automatic re-run when `sql` changes
 *   - `enabled` guard to defer execution (e.g. until dependencies arrive)
 *   - `refetch()` to re-run the current query on demand
 *   - abort-on-unmount / abort-on-sql-change safety (stale responses are dropped)
 *
 * The underlying `runQuery` is re-exported so non-component contexts
 * (e.g. Zustand stores, pipeline executors) can keep using the plain
 * promise-based API without reaching into the client module directly.
 *
 * No caching layer is included — that is a future wave.
 */

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface UseQueryOptions {
  /** When `false`, the query is not executed. Defaults to `true`. */
  enabled?: boolean;
}

export interface UseQueryResult<T = Record<string, unknown>> {
  /** The query result rows, or `null` until the first success after the latest sql/refetch. */
  data: T[] | null;
  /** `true` while a query for the current sql/refetch is in flight. */
  loading: boolean;
  /** Human-readable error message if the latest query failed, `null` otherwise. */
  error: string | null;
  /** Manually re-run the query. No-op while `enabled` is false. */
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface QueryState<T> {
  requestKey: string | null;
  data: T[] | null;
  error: string | null;
}

function computeRequestKey(
  sql: string | null,
  enabled: boolean,
  refreshKey: number,
): string | null {
  if (!sql || !enabled) return null;
  return `${refreshKey}:${sql}`;
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Failed to run DuckDB query.";
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Run a DuckDB SQL query and track its state inside a React component.
 *
 * @param sql  - The SQL to execute, or `null` to suppress the query.
 * @param opts - Optional behaviour flags. See {@link UseQueryOptions}.
 * @returns A typed `{ data, loading, error, refetch }` tuple.
 *
 * @example
 *   const { data, loading, error } = useQuery<{ id: number }>(
 *     tableName ? `SELECT id FROM "${tableName}"` : null,
 *     { enabled: !!tableName },
 *   );
 */
export function useQuery<T = Record<string, unknown>>(
  sql: string | null,
  opts: UseQueryOptions = {},
): UseQueryResult<T> {
  const enabled = opts.enabled ?? true;
  const [queryState, setQueryState] = useState<QueryState<T>>({
    requestKey: null,
    data: null,
    error: null,
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const mountedRef = useRef(true);

  const requestKey = computeRequestKey(sql, enabled, refreshKey);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refetch = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!sql || !enabled || !requestKey) {
      return;
    }

    // React 19 + StrictMode runs effects twice in development. The `cancelled`
    // flag guarantees only the most recent invocation's result is committed to
    // state, which makes duplicate runs a no-op from the caller's perspective.
    let cancelled = false;
    const abortController =
      typeof AbortController !== "undefined" ? new AbortController() : null;

    runQuery(sql)
      .then((rows) => {
        if (cancelled || !mountedRef.current) return;
        setQueryState({
          requestKey,
          data: rows as T[],
          error: null,
        });
      })
      .catch((queryError: unknown) => {
        if (cancelled || !mountedRef.current) return;
        setQueryState({
          requestKey,
          data: null,
          error: extractMessage(queryError),
        });
      });

    return () => {
      cancelled = true;
      abortController?.abort();
    };
  }, [enabled, requestKey, sql]);

  const isCurrentRequestResolved = queryState.requestKey === requestKey;

  return {
    data: requestKey && isCurrentRequestResolved ? queryState.data : null,
    loading: requestKey !== null && !isCurrentRequestResolved,
    error: requestKey && isCurrentRequestResolved ? queryState.error : null,
    refetch,
  };
}

// ---------------------------------------------------------------------------
// Re-export runQuery for non-component contexts (pipeline stores, jobs, …).
// ---------------------------------------------------------------------------

export { runQuery };
