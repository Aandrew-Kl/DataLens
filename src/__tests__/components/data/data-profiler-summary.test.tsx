import React from "react";
import { render, screen } from "@testing-library/react";

import DataProfilerSummary from "@/components/data/data-profiler-summary";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("echarts-for-react");
jest.mock("framer-motion");

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 4,
    uniqueCount: 85,
    sampleValues: [100, 200],
  },
  {
    name: "region",
    type: "string",
    nullCount: 10,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 90,
    sampleValues: ["2026-01-01", "2026-01-02"],
  },
];

describe("DataProfilerSummary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders loading placeholders while metrics are still pending", () => {
    mockRunQuery.mockImplementation(() => new Promise(() => undefined));
    const { container } = render(
      <DataProfilerSummary tableName="sales" columns={columns} rowCount={100} />,
    );

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(8);
  });

  it("renders the executive summary and quality notes after profiling", async () => {
    mockRunQuery
      .mockResolvedValueOnce([
        {
          total_rows: 100,
          total_nulls: 14,
          approx_bytes: 4096,
        },
      ])
      .mockResolvedValueOnce([
        {
          outlier_count: 7,
          non_null_count: 96,
        },
      ]);

    render(
      <DataProfilerSummary tableName="sales" columns={columns} rowCount={100} />,
    );

    expect(
      await screen.findByRole("heading", {
        name: /Profile snapshot for sales/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Column Type Mix")).toBeInTheDocument();
    expect(screen.getByText(/1 outlier-sensitive columns/i)).toBeInTheDocument();
    expect(screen.getByText(/Estimated in-browser footprint is/i)).toBeInTheDocument();
  });

  it("shows an error state when summary profiling fails", async () => {
    mockRunQuery.mockRejectedValue(new Error("Summary profiling failed"));

    render(
      <DataProfilerSummary tableName="sales" columns={columns} rowCount={100} />,
    );

    expect(
      await screen.findByText("Summary profiling failed"),
    ).toBeInTheDocument();
  });
});
