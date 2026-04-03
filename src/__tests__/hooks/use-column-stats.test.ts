import { renderHook, act, waitFor } from "@testing-library/react";

import { useColumnStats } from "@/hooks/use-column-stats";
import { runQuery } from "@/lib/duckdb/client";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function makeStatsRow(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    row_count: 12,
    non_null_count: 10,
    distinct_count: 8,
    null_count: 2,
    min_value: 1,
    max_value: 99,
    mean_value: 12.5,
    median_value: 10,
    stddev_value: 3.25,
    p25_value: 5,
    p50_value: 10,
    p75_value: 20,
    p95_value: 30,
    p99_value: 40,
    ...overrides,
  };
}

describe("useColumnStats", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    jest.restoreAllMocks();
  });

  it("returns the empty state without querying when table or column is missing", async () => {
    const { result } = renderHook(() => useColumnStats("", ""));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current).toMatchObject({
      tableName: "",
      columnName: "",
      count: 0,
      nonNullCount: 0,
      distinctCount: 0,
      nullCount: 0,
      refreshedAt: null,
      error: null,
    });
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("loads statistics, normalizes scalar values, and quotes identifiers safely", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_123_456);
    mockRunQuery.mockResolvedValueOnce([
      makeStatsRow({
        row_count: BigInt(10),
        non_null_count: "8",
        distinct_count: 6,
        null_count: 2,
        min_value: false,
        max_value: "zeta",
        mean_value: "3.5",
        median_value: BigInt(3),
        stddev_value: 1.25,
        p25_value: "2",
        p50_value: 3,
        p75_value: 4.5,
        p95_value: null,
        p99_value: undefined,
      }),
    ]);

    const { result } = renderHook(() => useColumnStats('ord"ers', 'flag"ged'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.count).toBe(10);
    });

    expect(mockRunQuery).toHaveBeenCalledWith(expect.stringContaining('"ord""ers"'));
    expect(mockRunQuery).toHaveBeenCalledWith(expect.stringContaining('"flag""ged"'));
    expect(result.current).toMatchObject({
      tableName: 'ord"ers',
      columnName: 'flag"ged',
      count: 10,
      nonNullCount: 8,
      distinctCount: 6,
      nullCount: 2,
      min: false,
      max: "zeta",
      mean: 3.5,
      median: 3,
      stddev: 1.25,
      percentiles: {
        p25: 2,
        p50: 3,
        p75: 4.5,
        p95: null,
        p99: null,
      },
      refreshedAt: 1_700_000_123_456,
      error: null,
    });
  });

  it("reuses cached statistics when switching back to a previously loaded column", async () => {
    mockRunQuery
      .mockResolvedValueOnce([makeStatsRow({ row_count: 5, mean_value: 10 })])
      .mockResolvedValueOnce([makeStatsRow({ row_count: 7, mean_value: 14 })]);

    const { result, rerender } = renderHook(
      ({ tableName, columnName }: { tableName: string; columnName: string }) =>
        useColumnStats(tableName, columnName),
      {
        initialProps: {
          tableName: "orders",
          columnName: "sales",
        },
      },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.count).toBe(5);
    });

    rerender({ tableName: "orders", columnName: "profit" });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.count).toBe(7);
    });

    mockRunQuery.mockClear();

    rerender({ tableName: "orders", columnName: "sales" });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.columnName).toBe("sales");
      expect(result.current.count).toBe(5);
    });

    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("surfaces query failures on the hook state", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("stats unavailable"));

    const { result } = renderHook(() => useColumnStats("orders", "sales"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe("stats unavailable");
    });

    expect(result.current.count).toBe(0);
    expect(result.current.refreshedAt).toBeNull();
  });

  it("ignores stale responses after the table or column changes mid-request", async () => {
    const firstRequest = createDeferred<Record<string, unknown>[]>();
    const secondRequest = createDeferred<Record<string, unknown>[]>();

    mockRunQuery
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);

    const { result, rerender } = renderHook(
      ({ tableName, columnName }: { tableName: string; columnName: string }) =>
        useColumnStats(tableName, columnName),
      {
        initialProps: {
          tableName: "orders",
          columnName: "sales",
        },
      },
    );

    rerender({ tableName: "orders", columnName: "profit" });

    await act(async () => {
      firstRequest.resolve([makeStatsRow({ row_count: 1, mean_value: 1 })]);
      await firstRequest.promise;
    });

    expect(result.current.columnName).toBe("profit");
    expect(result.current.loading).toBe(true);
    expect(result.current.count).toBe(0);

    await act(async () => {
      secondRequest.resolve([makeStatsRow({ row_count: 9, mean_value: 9 })]);
      await secondRequest.promise;
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.columnName).toBe("profit");
      expect(result.current.count).toBe(9);
      expect(result.current.mean).toBe(9);
    });
  });
});
