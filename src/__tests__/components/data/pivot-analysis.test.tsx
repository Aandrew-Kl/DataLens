import {
  act,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PivotAnalysis from "@/components/data/pivot-analysis";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

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
    uniqueCount: 2,
    sampleValues: ["East", "West"],
  },
  {
    name: "channel",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Online", "Retail"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [40, 60, 80],
  },
];

async function renderAsync(targetColumns = columns) {
  await act(async () => {
    render(<PivotAnalysis tableName="orders" columns={targetColumns} />);
  });

  await waitFor(() => {
    expect(
      screen.queryByText("Building pivot analysis…"),
    ).not.toBeInTheDocument();
  });
}

describe("PivotAnalysis", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the empty state when fewer than two usable columns exist", () => {
    render(
      <PivotAnalysis
        tableName="orders"
        columns={[
          {
            name: "sales",
            type: "number",
            nullCount: 0,
            uniqueCount: 5,
            sampleValues: [10, 20],
          },
        ]}
      />,
    );

    expect(
      screen.getByText("Pivot analysis needs at least two usable columns."),
    ).toBeInTheDocument();
  });

  it("loads a pivot table with totals", async () => {
    mockRunQuery.mockResolvedValue([
      { row_key: "East", column_key: "Online", metric_value: 60 },
      { row_key: "East", column_key: "Retail", metric_value: 120 },
      { row_key: "West", column_key: "Online", metric_value: 40 },
      { row_key: "West", column_key: "Retail", metric_value: 80 },
    ]);

    await renderAsync();

    expect(await screen.findByText("Sum of sales")).toBeInTheDocument();
    expect(screen.getByText("Heatmapped pivot table")).toBeInTheDocument();
    expect(screen.getByText("East")).toBeInTheDocument();
    expect(screen.getByText("Column total")).toBeInTheDocument();
    expect(screen.getAllByText("300").length).toBeGreaterThan(0);
  });

  it("exports the pivot as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { row_key: "East", column_key: "Online", metric_value: 60 },
      { row_key: "East", column_key: "Retail", metric_value: 120 },
      { row_key: "West", column_key: "Online", metric_value: 40 },
      { row_key: "West", column_key: "Retail", metric_value: 80 },
    ]);

    await renderAsync();

    await user.click(screen.getByRole("button", { name: /Export pivot CSV/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("Row total"),
      "orders-sales-sum-pivot-analysis.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("surfaces query failures", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("Pivot query exploded"));

    await renderAsync();

    expect(await screen.findByText("Pivot query exploded")).toBeInTheDocument();
  });
});
