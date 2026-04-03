import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import DataAggregator from "@/components/data/data-aggregator";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["North", "South"],
  },
  {
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["Retail", "SMB"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [10, 25],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [4, 7],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<DataAggregator tableName="sales" columns={columns} />);
  });
}

describe("DataAggregator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunQuery.mockResolvedValue([
      { region: "North", category: "Retail", sum_sales: 40, avg_sales: 20 },
      { region: null, category: null, sum_sales: 120, avg_sales: 30 },
    ]);
  });

  it("previews roll-up results with DuckDB", async () => {
    await renderAsync();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview aggregated rows" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Retail")).toBeInTheDocument();
    });
    expect(mockRunQuery).toHaveBeenCalledWith(expect.stringContaining("GROUP BY ROLLUP"));
  });

  it("adds COUNT aggregation to the generated SQL when enabled", async () => {
    await renderAsync();

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "COUNT" })[0] as HTMLButtonElement);
    });

    expect(screen.getByText(/COUNT\("sales"\) AS "count_sales"/)).toBeInTheDocument();
  });

  it("exports the preview rows as CSV", async () => {
    await renderAsync();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview aggregated rows" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Retail")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    });

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("region,category,sum_sales,avg_sales"),
      "sales-aggregated.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
