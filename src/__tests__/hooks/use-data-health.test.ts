import { renderHook, act, waitFor } from "@testing-library/react";

import { useDataHealth } from "@/hooks/use-data-health";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

function buildCacheKey(tableName: string, columns: ColumnProfile[]): string {
  return `datalens:data-health:${JSON.stringify({
    tableName,
    columns: columns.map((column) => ({
      name: column.name,
      type: column.type,
      nullCount: column.nullCount,
      uniqueCount: column.uniqueCount,
    })),
  })}`;
}

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

const healthColumns: ColumnProfile[] = [
  {
    name: "customer_id",
    type: "string",
    nullCount: 40,
    uniqueCount: 5,
    sampleValues: ["C001", "C002"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 5,
    uniqueCount: 90,
    sampleValues: [10, 20],
  },
];

describe("useDataHealth", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    window.sessionStorage.clear();
    jest.restoreAllMocks();
  });

  it("returns the empty health state without querying when inputs are missing", async () => {
    const { result } = renderHook(() => useDataHealth("", []));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current).toMatchObject({
      score: 0,
      issues: [],
      suggestions: [],
    });
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("computes health issues, suggestions, and caches the result", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('SELECT COUNT(*) AS row_count FROM "orders"')) {
        return [{ row_count: 100 }];
      }

      if (sql.includes("invalid_count")) {
        return [{ column_name: "amount", invalid_count: 8 }];
      }

      if (sql.includes("outlier_count")) {
        return [{ column_name: "amount", outlier_count: 10 }];
      }

      return [];
    });

    const { result } = renderHook(() => useDataHealth("orders", healthColumns));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.issues).toHaveLength(4);
    });

    expect(result.current.score).toBe(67);
    expect(result.current.issues.map((issue) => issue.type)).toEqual([
      "low_uniqueness",
      "high_null_rate",
      "type_mismatch",
      "outlier_column",
    ]);
    expect(result.current.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          column: "customer_id",
          priority: "high",
          message:
            "Deduplicate customer_id or choose a stronger key before joining datasets.",
        }),
        expect.objectContaining({
          column: "amount",
          priority: "medium",
          message: "Column amount may need type conversion or value normalization.",
        }),
      ]),
    );
    expect(window.sessionStorage.getItem(buildCacheKey("orders", healthColumns))).toContain(
      '"score":67',
    );
  });

  it("only runs the row-count query when columns do not need mismatch or outlier checks", async () => {
    const stringColumns: ColumnProfile[] = [
      {
        name: "region",
        type: "string",
        nullCount: 0,
        uniqueCount: 4,
        sampleValues: ["East", "West"],
      },
    ];

    mockRunQuery.mockResolvedValueOnce([{ row_count: 50 }]);

    const { result } = renderHook(() => useDataHealth("orders", stringColumns));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.score).toBe(100);
    expect(result.current.issues).toEqual([]);
    expect(mockRunQuery).toHaveBeenCalledTimes(1);
  });

  it("hydrates from sessionStorage immediately before refreshing in the background", async () => {
    const stringColumns: ColumnProfile[] = [
      {
        name: "region",
        type: "string",
        nullCount: 0,
        uniqueCount: 4,
        sampleValues: ["East", "West"],
      },
    ];

    window.sessionStorage.setItem(
      buildCacheKey("orders", stringColumns),
      JSON.stringify({
        score: 55,
        issues: [
          {
            id: "cached-issue",
            column: "region",
            severity: "medium",
            type: "high_null_rate",
            message: "cached",
            value: 0.5,
          },
        ],
        suggestions: [],
        refreshedAt: 123,
      }),
    );

    const rowCountRequest = createDeferred<Record<string, unknown>[]>();
    mockRunQuery.mockImplementationOnce(() => rowCountRequest.promise);

    const { result } = renderHook(() => useDataHealth("orders", stringColumns));

    expect(result.current.score).toBe(55);

    await act(async () => {
      rowCountRequest.resolve([{ row_count: 50 }]);
      await rowCountRequest.promise;
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.score).toBe(100);
      expect(result.current.issues).toEqual([]);
    });
  });

  it("refreshes again when the document becomes visible", async () => {
    const visibilityColumns: ColumnProfile[] = [
      {
        name: "notes",
        type: "string",
        nullCount: 20,
        uniqueCount: 80,
        sampleValues: ["ok"],
      },
    ];

    mockRunQuery
      .mockResolvedValueOnce([{ row_count: 100 }])
      .mockResolvedValueOnce([{ row_count: 80 }]);

    const { result } = renderHook(() => useDataHealth("orders", visibilityColumns));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.score).toBe(87);
    });

    mockRunQuery.mockClear();

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledTimes(1);
      expect(result.current.loading).toBe(false);
      expect(result.current.score).toBe(84);
    });
  });
});
