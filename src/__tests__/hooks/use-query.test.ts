import { act, renderHook, waitFor } from "@testing-library/react";

import { useQuery } from "@/hooks/use-query";
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

beforeEach(() => {
  mockRunQuery.mockReset();
});

describe("useQuery", () => {
  it("starts in loading and transitions to success with rows", async () => {
    const deferred = createDeferred<Record<string, unknown>[]>();
    mockRunQuery.mockReturnValueOnce(deferred.promise);

    const { result } = renderHook(() => useQuery("SELECT 1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    await act(async () => {
      deferred.resolve([{ value: 1 }]);
      await deferred.promise;
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([{ value: 1 }]);
    expect(result.current.error).toBeNull();
  });

  it("transitions to an error state when the query rejects", async () => {
    const deferred = createDeferred<Record<string, unknown>[]>();
    mockRunQuery.mockReturnValueOnce(deferred.promise);

    const { result } = renderHook(() => useQuery("SELECT 1"));

    expect(result.current.loading).toBe(true);

    await act(async () => {
      deferred.reject(new Error("Boom"));
      await deferred.promise.catch(() => undefined);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("Boom");
  });

  it("falls back to a generic message for non-Error rejections", async () => {
    const deferred = createDeferred<Record<string, unknown>[]>();
    mockRunQuery.mockReturnValueOnce(deferred.promise);

    const { result } = renderHook(() => useQuery("SELECT 1"));

    await act(async () => {
      deferred.reject("string reason");
      await deferred.promise.catch(() => undefined);
    });

    await waitFor(() => expect(result.current.error).toBe("Failed to run DuckDB query."));
  });

  it("does not fire when sql is null", () => {
    renderHook(() => useQuery(null));
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("does not fire when enabled is false, and fires once enabled flips true", async () => {
    mockRunQuery.mockResolvedValue([{ value: 42 }]);

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useQuery("SELECT 1", { enabled }),
      { initialProps: { enabled: false } },
    );

    expect(mockRunQuery).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockRunQuery).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual([{ value: 42 }]);
  });

  it("re-runs the query when sql changes mid-flight and drops the stale response", async () => {
    const firstDeferred = createDeferred<Record<string, unknown>[]>();
    const secondDeferred = createDeferred<Record<string, unknown>[]>();
    mockRunQuery
      .mockReturnValueOnce(firstDeferred.promise)
      .mockReturnValueOnce(secondDeferred.promise);

    const { result, rerender } = renderHook(
      ({ sql }: { sql: string }) => useQuery(sql),
      { initialProps: { sql: "SELECT 1" } },
    );

    expect(result.current.loading).toBe(true);

    rerender({ sql: "SELECT 2" });

    await act(async () => {
      firstDeferred.resolve([{ stale: true }]);
      secondDeferred.resolve([{ fresh: true }]);
      await Promise.all([firstDeferred.promise, secondDeferred.promise]);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([{ fresh: true }]);
  });

  it("ignores results that resolve after unmount", async () => {
    const deferred = createDeferred<Record<string, unknown>[]>();
    mockRunQuery.mockReturnValueOnce(deferred.promise);

    const { result, unmount } = renderHook(() => useQuery("SELECT 1"));
    expect(result.current.loading).toBe(true);

    unmount();

    await act(async () => {
      deferred.resolve([{ value: 99 }]);
      await deferred.promise;
    });

    // No state update means no crash + no act warnings. Nothing else to assert.
    expect(result.current.data).toBeNull();
  });

  it("refetch triggers a second runQuery call", async () => {
    mockRunQuery
      .mockResolvedValueOnce([{ run: 1 }])
      .mockResolvedValueOnce([{ run: 2 }]);

    const { result } = renderHook(() => useQuery("SELECT 1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([{ run: 1 }]);

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.data).toEqual([{ run: 2 }]));
    expect(mockRunQuery).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate runQuery calls under StrictMode-style double mount", async () => {
    mockRunQuery.mockResolvedValue([{ ok: true }]);

    const { result, rerender } = renderHook(
      ({ sql }: { sql: string }) => useQuery(sql),
      { initialProps: { sql: "SELECT 1" } },
    );

    // Simulate the component being forced to re-render with an identical sql —
    // the effect dependency array keys off `requestKey` which stays stable, so
    // the in-flight request should not be aborted or re-issued.
    rerender({ sql: "SELECT 1" });
    rerender({ sql: "SELECT 1" });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockRunQuery).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual([{ ok: true }]);
  });
});
