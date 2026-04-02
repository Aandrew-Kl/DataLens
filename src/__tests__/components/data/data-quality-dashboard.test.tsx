import { render, screen, waitFor } from "@testing-library/react";

import DataQualityDashboard from "@/components/data/data-quality-dashboard";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("echarts-for-react");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const dashboardColumns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: ["West", "East"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 20,
    uniqueCount: 80,
    sampleValues: ["2026-03-20", "2026-03-21"],
  },
];

describe("DataQualityDashboard", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  it("renders an empty state when no columns are profiled", () => {
    render(<DataQualityDashboard tableName="orders" columns={[]} />);

    expect(
      screen.getByText("No profiled columns for orders"),
    ).toBeInTheDocument();
  });

  it("renders dashboard metrics and charts from the DuckDB response", async () => {
    mockRunQuery.mockResolvedValue([
      {
        row_count: 100,
        c0_non_null: 100,
        c0_distinct: 10,
        c0_invalid: 0,
        c0_whitespace: 5,
        c0_blank: 0,
        c0_normalized_distinct: 8,
        c0_latest_ts: null,
        c0_earliest_ts: null,
        c1_non_null: 80,
        c1_distinct: 80,
        c1_invalid: 0,
        c1_whitespace: 0,
        c1_blank: 0,
        c1_normalized_distinct: 0,
        c1_latest_ts: "2026-03-20T00:00:00.000Z",
        c1_earliest_ts: "2025-01-01T00:00:00.000Z",
      },
    ]);

    render(
      <DataQualityDashboard tableName="orders" columns={dashboardColumns} />,
    );

    expect(
      await screen.findByText(/Comprehensive quality overview for orders/i),
    ).toBeInTheDocument();
    expect(await screen.findByText("Weakest column")).toBeInTheDocument();
    expect((await screen.findAllByText("region")).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getAllByTestId("echarts").length).toBeGreaterThan(1);
    });
  });

  it("shows an error state when the metrics query fails", async () => {
    mockRunQuery.mockRejectedValue(new Error("Quality metrics failed"));

    render(
      <DataQualityDashboard tableName="orders" columns={dashboardColumns} />,
    );

    expect(
      await screen.findByText("Quality metrics failed to load"),
    ).toBeInTheDocument();
    expect(await screen.findByText("Quality metrics failed")).toBeInTheDocument();
  });
});
