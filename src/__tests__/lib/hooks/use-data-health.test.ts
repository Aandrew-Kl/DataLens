import { renderHook } from "@testing-library/react";
import { runQuery } from "@/lib/duckdb/client";
import { useDataHealth } from "@/lib/hooks/use-data-health";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

describe("useDataHealth", () => {
  const mockedRunQuery = runQuery as jest.Mock;

  beforeEach(() => {
    mockedRunQuery.mockReset();
  });

  it("returns default health when tableName is empty", () => {
    const { result } = renderHook(() => useDataHealth("", []));

    expect(result.current).toEqual({
      score: 0,
      grade: "F",
      issues: [],
      loading: false,
    });
  });

  it("returns default health when columns array is empty", () => {
    const { result } = renderHook(() => useDataHealth("people", []));

    expect(result.current).toEqual({
      score: 0,
      grade: "F",
      issues: [],
      loading: false,
    });
  });

  it("returns loading state initially for valid inputs", () => {
    const columns: ColumnProfile[] = [
      {
        name: "age",
        type: "number",
        nullCount: 0,
        uniqueCount: 3,
        sampleValues: [1, 2, 3],
      },
    ];

    mockedRunQuery.mockResolvedValue([{ row_count: 100 }]);

    const { result } = renderHook(() => useDataHealth("users", columns));

    expect(result.current).toEqual({
      score: 0,
      grade: "F",
      issues: [],
      loading: true,
    });
  });
});
