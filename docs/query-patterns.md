# Query patterns in DataLens components

## TL;DR

| Context                                      | Use                                                |
| -------------------------------------------- | -------------------------------------------------- |
| React component needs rows from DuckDB       | `useQuery(sql, { enabled })` from `@/hooks/use-query` |
| Zustand store, web worker, or CLI job        | Plain `runQuery(sql)` re-exported from the same file |
| Streaming large results                      | `useStreamingQuery` (unchanged)                     |
| Column statistics, table metadata, health   | Existing dedicated hooks (`useColumnStats`, …)      |

The old `useDuckDBQuery` hook still works and is **not** deprecated yet, but
new code should prefer `useQuery`. A follow-up wave will sweep the remaining
call sites.

## `useQuery` API

```ts
function useQuery<T = Record<string, unknown>>(
  sql: string | null,
  opts?: UseQueryOptions,
): UseQueryResult<T>;

interface UseQueryOptions {
  /** When `false`, the query is not executed. Defaults to `true`. */
  enabled?: boolean;
}

interface UseQueryResult<T> {
  data: T[] | null;     // null until the first successful resolution
  loading: boolean;     // true while the current (sql, refreshKey) is in flight
  error: string | null; // error message for the latest query, or null
  refetch: () => void;  // re-run with the same sql
}
```

### Semantics

- **`sql = null` → idle.** `data`, `error`, `loading` all become "neutral"
  (`null` / `false`). The hook issues no request.
- **`enabled: false` → idle.** Same as above. Useful when some prerequisite
  isn't loaded yet (e.g. `enabled: !!tableName`).
- **sql change → cancellation.** If a new sql arrives before the previous
  query resolves, the stale result is dropped on the floor.
- **unmount → cancellation.** No state updates after the component leaves.
- **React 19 + StrictMode safe.** Effects key off a stable `requestKey`
  (`${refreshKey}:${sql}`), so the double-render doesn't issue two queries.

### Examples

#### Simple fetch

```tsx
import { useQuery } from "@/hooks/use-query";

function Preview({ tableName }: { tableName: string }) {
  const { data, loading, error } = useQuery(
    `SELECT * FROM "${tableName}" LIMIT 100`,
  );

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;
  return <Table rows={data ?? []} />;
}
```

#### Deferred fetch

```tsx
const sql = tableName ? `SELECT COUNT(*) AS n FROM "${tableName}"` : null;
const { data } = useQuery<{ n: number }>(sql, { enabled: !!tableName });
const total = data?.[0]?.n ?? 0;
```

#### Manual refetch

```tsx
const { data, refetch } = useQuery(sql);
return <button onClick={refetch}>Refresh</button>;
```

## When NOT to use `useQuery`

- **Pipeline execution.** Stores and orchestration code want plain promises
  and do not live in a React render tree. Use `runQuery` directly (it is
  re-exported from `@/hooks/use-query` or the original `@/lib/duckdb/client`).

- **Streaming.** Query results that arrive as incremental batches should
  continue to use `useStreamingQuery`.

- **Post-processed query results.** If you need to run one query, derive a
  second query from its result, and combine both, either:
  - nest two `useQuery` calls (the second one uses `enabled: !!firstResult`
    to wait for the first), or
  - keep a manual `useEffect` for now and mark it `TODO(wave6)`.

## Migration cheatsheet

Old pattern:

```tsx
const [rows, setRows] = useState<Row[] | null>(null);
const [loading, setLoading] = useState(true);
useEffect(() => {
  let cancelled = false;
  runQuery(sql)
    .then((r) => { if (!cancelled) setRows(r as Row[]); })
    .finally(() => { if (!cancelled) setLoading(false); });
  return () => { cancelled = true; };
}, [sql]);
```

New pattern:

```tsx
const { data, loading } = useQuery<Row>(sql);
```

Derived state (e.g. `stddev` from a row) should live in `useMemo`, not local
`useState`:

```tsx
const { data } = useQuery<{ sd: unknown }>(sql, { enabled: isNumeric });
const stddev = useMemo(() => {
  const raw = data?.[0]?.sd;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Number(n.toFixed(4)) : null;
}, [data]);
```

## Why not add caching here?

Query-result caching is intentionally out of scope for this wave. A
dedicated cache (keyed on sql + dataset version) is planned for a future
wave and will be added under the same hook without breaking callers.
