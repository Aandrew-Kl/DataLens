import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PivotTableBuilder from "@/components/data/pivot-table-builder";
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
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["A", "B"],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["East", "West"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [5, 10, 20],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<PivotTableBuilder tableName="orders" columns={columns} />);
  });
}

describe("PivotTableBuilder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders pivot field selectors", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Build an interactive pivot table",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Build pivot" })).toBeInTheDocument();
  });

  it("builds the pivot table with totals", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { pivot_row: "A", pivot_column: "East", pivot_value: 10 },
      { pivot_row: "B", pivot_column: "East", pivot_value: 5 },
      { pivot_row: "B", pivot_column: "West", pivot_value: 20 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Build pivot" }));

    expect(await screen.findByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getAllByText("35").length).toBeGreaterThan(0);
    expect(screen.getByText("East")).toBeInTheDocument();
  });

  it("exports the rendered pivot table as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { pivot_row: "A", pivot_column: "East", pivot_value: 10 },
      { pivot_row: "B", pivot_column: "East", pivot_value: 5 },
      { pivot_row: "B", pivot_column: "West", pivot_value: 20 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Build pivot" }));
    expect((await screen.findAllByText("35")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("row,East,West,Total"),
      "orders-pivot-table.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
