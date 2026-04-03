import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataOverview from "@/components/data/data-overview";
import { runQuery } from "@/lib/duckdb/client";
import {
  useDataHealth,
  type DataHealth,
} from "@/lib/hooks/use-data-health";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("@/lib/hooks/use-data-health", () => ({
  useDataHealth: jest.fn(),
}));

jest.mock("echarts-for-react");
jest.mock("framer-motion");

const mockRunQuery = jest.mocked(runQuery);
const mockUseDataHealth = jest.mocked(useDataHealth);

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 5,
    uniqueCount: 90,
    sampleValues: [100, 200, 300],
  },
  {
    name: "region",
    type: "string",
    nullCount: 12,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: ["2026-01-01", "2026-01-02"],
  },
];

function buildHealth(overrides: Partial<DataHealth> = {}): DataHealth {
  return {
    score: 88,
    grade: "B",
    issues: [
      {
        severity: "warning",
        column: "region",
        message: "Whitespace drift detected.",
        metric: "trim",
        value: 0.2,
      },
    ],
    loading: false,
    ...overrides,
  };
}

describe("DataOverview", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDataHealth.mockReturnValue(buildHealth());
  });

  it("renders the overview, charts, and health issues", async () => {
    mockRunQuery
      .mockResolvedValueOnce([{ row_count: 120 }])
      .mockResolvedValueOnce([
        {
          column_name: "revenue",
          null_count: 5,
          unique_count: 90,
          non_null_count: 115,
          avg_text_length: 6,
        },
        {
          column_name: "region",
          null_count: 12,
          unique_count: 4,
          non_null_count: 108,
          avg_text_length: 5,
        },
        {
          column_name: "created_at",
          null_count: 0,
          unique_count: 100,
          non_null_count: 120,
          avg_text_length: 10,
        },
      ]);

    render(<DataOverview tableName="sales" columns={columns} rowCount={120} />);

    expect(await screen.findByText("Dataset Overview")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "sales" })).toBeInTheDocument();
    expect(screen.getByText("Top 5 null-heavy columns")).toBeInTheDocument();
    expect(screen.getByText("Whitespace drift detected.")).toBeInTheDocument();
    expect(screen.getAllByTestId("echarts")).toHaveLength(3);
  });

  it("renders the quick action buttons for downstream workflows", async () => {
    mockRunQuery
      .mockResolvedValueOnce([{ row_count: 120 }])
      .mockResolvedValueOnce([
        {
          column_name: "revenue",
          null_count: 5,
          unique_count: 90,
          non_null_count: 115,
          avg_text_length: 6,
        },
      ]);

    render(<DataOverview tableName="sales" columns={columns} rowCount={120} />);

    const exportButton = (await screen.findByText("Export CSV")).closest("button");
    const sqlButton = screen.getByRole("button", { name: /run sql/i });
    const dashboardButton = screen.getByRole("button", { name: /view dashboard/i });
    const reportButton = screen.getByRole("button", { name: /generate report/i });

    expect(exportButton).not.toBeNull();
    expect(sqlButton).toBeInTheDocument();
    expect(dashboardButton).toBeInTheDocument();
    expect(reportButton).toBeInTheDocument();

    fireEvent.click(exportButton ?? document.body);
    expect(exportButton).toBeEnabled();
  });

  it("shows DuckDB query failures and the clean-state health card", async () => {
    mockUseDataHealth.mockReturnValue(buildHealth({ issues: [] }));
    mockRunQuery.mockRejectedValue(new Error("Overview metrics failed"));

    render(<DataOverview tableName="sales" columns={columns} rowCount={120} />);

    expect(await screen.findByText("Overview metrics failed")).toBeInTheDocument();
    expect(
      screen.getByText(/No material issues surfaced\./i),
    ).toBeInTheDocument();
  });
});
