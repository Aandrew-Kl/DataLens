import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataProfilerAI from "@/components/data/data-profiler-ai";
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
    nullCount: 4,
    uniqueCount: 90,
    sampleValues: [100, 140],
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
    uniqueCount: 24,
    sampleValues: ["2026-01-01", "2026-02-01"],
    min: "2026-01-01",
    max: "2026-12-01",
  },
  {
    name: "is_active",
    type: "boolean",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [true, false],
  },
];

describe("DataProfilerAI", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    jest.mocked(URL.createObjectURL).mockClear();
  });

  it("shows the loading state while profiling is still in flight", () => {
    mockRunQuery.mockImplementation(() => new Promise(() => undefined));

    render(<DataProfilerAI tableName="sales" columns={columns} rowCount={120} />);

    expect(screen.getByText("Profiling dataset with DuckDB queries...")).toBeInTheDocument();
  });

  it("renders summary stats, findings, and column summaries after profiling", async () => {
    mockRunQuery.mockResolvedValue([]);

    render(<DataProfilerAI tableName="sales" columns={columns} rowCount={120} />);

    await waitFor(() => {
      expect(screen.getByText("Quality score")).toBeInTheDocument();
    });

    expect(screen.getByText("Correlation watchlist")).toBeInTheDocument();
    expect(screen.getAllByText("Cleaning suggestions").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Suggested charts").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { name: "revenue" }),
    ).toBeInTheDocument();
  });

  it("exports the generated markdown report", async () => {
    const user = userEvent.setup();
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    try {
      mockRunQuery.mockResolvedValue([]);

      render(<DataProfilerAI tableName="sales" columns={columns} rowCount={120} />);

      await waitFor(() => {
        expect(screen.getByText("Quality score")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Export markdown" }));

      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(screen.getByText("Markdown export downloaded.")).toBeInTheDocument();
    } finally {
      clickSpy.mockRestore();
    }
  });

  it("shows an error notice when profiling fails", async () => {
    mockRunQuery.mockRejectedValue(new Error("DuckDB unavailable"));

    render(<DataProfilerAI tableName="sales" columns={columns} rowCount={120} />);

    await waitFor(() => {
      expect(screen.getByText("DuckDB unavailable")).toBeInTheDocument();
    });
  });
});
