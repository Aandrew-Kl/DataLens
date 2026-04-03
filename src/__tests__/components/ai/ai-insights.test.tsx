import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AIInsights from "@/components/ai/ai-insights";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 80,
    sampleValues: [100, 120],
    min: 10,
    max: 400,
  },
  {
    name: "region",
    type: "string",
    nullCount: 2,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 90,
    sampleValues: ["2026-01-01", "2026-01-02"],
    min: "2026-01-01",
    max: "2026-03-01",
  },
];

describe("AIInsights", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  it("renders the generated insight cards after the DuckDB scan completes", async () => {
    mockRunQuery.mockResolvedValue([]);

    render(<AIInsights tableName="sales" columns={columns} rowCount={100} />);

    expect(
      await screen.findByText("Completeness is clean across scanned columns"),
    ).toBeInTheDocument();

    expect(screen.getByText("AI Insights")).toBeInTheDocument();
    expect(
      screen.getByText("Completeness is clean across scanned columns"),
    ).toBeInTheDocument();
    expect(screen.getByText("region behaves like a categorical field")).toBeInTheDocument();
  });

  it("filters the visible insight cards by category", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([]);

    render(<AIInsights tableName="sales" columns={columns} rowCount={100} />);

    expect(
      await screen.findByText("region behaves like a categorical field"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Completeness" }));

    expect(
      screen.getByText("Completeness is clean across scanned columns"),
    ).toBeInTheDocument();
    expect(screen.queryByText("region behaves like a categorical field")).not.toBeInTheDocument();
  });

  it("shows the SQL preview and refreshes the scan", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([]);

    render(<AIInsights tableName="sales" columns={columns} rowCount={100} />);

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledTimes(5);
    });

    await user.click((await screen.findAllByRole("button", { name: /SQL Query/i }))[0]);

    expect(screen.getAllByText(/SELECT/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledTimes(10);
    });
  });

  it("renders an error panel when insight generation fails", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("Insight query failed"));

    render(<AIInsights tableName="sales" columns={columns} rowCount={100} />);

    await waitFor(() => {
      expect(screen.getByText("Insight query failed")).toBeInTheDocument();
    });
  });
});
