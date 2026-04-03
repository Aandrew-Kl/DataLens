import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataOverview, {
  DATA_OVERVIEW_ACTION_EVENT,
} from "@/components/data/data-overview";
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

  it("dispatches the overview action event from quick actions", async () => {
    const user = userEvent.setup();
    const handler = jest.fn();

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

    window.addEventListener(
      DATA_OVERVIEW_ACTION_EVENT,
      handler as EventListener,
    );

    render(<DataOverview tableName="sales" columns={columns} rowCount={120} />);

    await user.click(await screen.findByRole("button", { name: "Export CSV" }));

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          action: "export-csv",
          tableName: "sales",
          columns: ["revenue", "region", "created_at"],
        },
      }),
    );

    window.removeEventListener(
      DATA_OVERVIEW_ACTION_EVENT,
      handler as EventListener,
    );
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
