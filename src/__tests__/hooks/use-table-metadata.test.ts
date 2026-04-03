import { renderHook, act, waitFor } from "@testing-library/react";

import { useTableMetadata } from "@/hooks/use-table-metadata";
import { runQuery } from "@/lib/duckdb/client";
import { useDatasetStore } from "@/stores/dataset-store";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const baseColumns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [100, 200],
  },
];

function makeDataset(overrides: Partial<DatasetMeta> = {}): DatasetMeta {
  return {
    id: "dataset-1",
    name: "orders",
    fileName: "orders.csv",
    rowCount: 50,
    columnCount: 2,
    columns: baseColumns,
    uploadedAt: 1,
    sizeBytes: 1_024,
    ...overrides,
  };
}

describe("useTableMetadata", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    useDatasetStore.setState({ datasets: [], activeDatasetId: null });
    jest.restoreAllMocks();
  });

  it("loads metadata for DuckDB tables and falls back to COUNT(*) when no dataset metadata exists", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("information_schema.tables")) {
        return [
          { table_name: "orders", column_count: 2 },
          { table_name: "scratch", column_count: "1" },
        ];
      }

      if (sql.includes('COUNT(*) AS row_count FROM "orders"')) {
        return [{ row_count: BigInt(10) }];
      }

      if (sql.includes('COUNT(*) AS row_count FROM "scratch"')) {
        return [{ row_count: "3" }];
      }

      return [];
    });

    const { result } = renderHook(() => useTableMetadata());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.length).toBe(2);
    });

    expect(result.current[0]).toMatchObject({
      tableName: "orders",
      columnCount: 2,
      rowCountEstimate: 10,
      datasetMeta: null,
    });
    expect(result.current[1]).toMatchObject({
      tableName: "scratch",
      columnCount: 1,
      rowCountEstimate: 3,
      datasetMeta: null,
    });
    expect(result.current.error).toBeNull();
  });

  it("uses dataset metadata row counts when the table matches a loaded dataset", async () => {
    const dataset = makeDataset({ name: "orders", rowCount: 99 });
    useDatasetStore.setState({ datasets: [dataset], activeDatasetId: dataset.id });

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("information_schema.tables")) {
        return [
          { table_name: "orders", column_count: 2 },
          { table_name: "scratch", column_count: 1 },
        ];
      }

      if (sql.includes('COUNT(*) AS row_count FROM "scratch"')) {
        return [{ row_count: 7 }];
      }

      return [];
    });

    const { result } = renderHook(() => useTableMetadata());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.length).toBe(2);
    });

    expect(result.current[0]).toMatchObject({
      tableName: "orders",
      rowCountEstimate: 99,
      datasetMeta: dataset,
    });
    expect(
      mockRunQuery.mock.calls.some(([sql]) =>
        sql.includes('COUNT(*) AS row_count FROM "orders"'),
      ),
    ).toBe(false);
  });

  it("refreshes when the dataset signature changes", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("information_schema.tables")) {
        return [{ table_name: "orders", column_count: 2 }];
      }

      if (sql.includes('COUNT(*) AS row_count FROM "orders"')) {
        return [{ row_count: 10 }];
      }

      return [];
    });

    const { result } = renderHook(() => useTableMetadata());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current[0]?.rowCountEstimate).toBe(10);
    });

    mockRunQuery.mockClear();
    act(() => {
      useDatasetStore.setState({
        datasets: [makeDataset({ rowCount: 88 })],
        activeDatasetId: "dataset-1",
      });
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current[0]?.rowCountEstimate).toBe(88);
      expect(result.current[0]?.datasetMeta?.rowCount).toBe(88);
    });

    expect(
      mockRunQuery.mock.calls.some(([sql]) =>
        sql.includes('COUNT(*) AS row_count FROM "orders"'),
      ),
    ).toBe(false);
  });

  it("refreshes again when the polling callback runs", async () => {
    const setIntervalSpy = jest.spyOn(window, "setInterval");

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("information_schema.tables")) {
        return [{ table_name: "orders", column_count: 2 }];
      }

      if (sql.includes('COUNT(*) AS row_count FROM "orders"')) {
        return [{ row_count: 12 }];
      }

      return [];
    });

    renderHook(() => useTableMetadata());

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalled();
    });

    const refreshInterval = setIntervalSpy.mock.calls.find(
      ([, delay]) => delay === 30_000,
    )?.[0];
    if (typeof refreshInterval !== "function") {
      throw new Error("Expected useTableMetadata to register a polling callback.");
    }

    mockRunQuery.mockClear();

    await act(async () => {
      refreshInterval();
    });

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalled();
    });
  });

  it("surfaces metadata loading failures", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("metadata failed"));

    const { result } = renderHook(() => useTableMetadata());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe("metadata failed");
    });

    expect(result.current).toHaveLength(0);
  });
});
