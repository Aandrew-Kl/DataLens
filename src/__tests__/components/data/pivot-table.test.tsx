import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PivotTable from "@/components/data/pivot-table";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;
const mockDownloadFile = downloadFile as jest.MockedFunction<typeof downloadFile>;

const pivotColumns: ColumnProfile[] = [
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
    uniqueCount: 4,
    sampleValues: [5, 10, 20],
    min: 5,
    max: 20,
    mean: 11.67,
    median: 10,
  },
];

function getBodyRowLabels(): string[] {
  const rows = within(screen.getByRole("table")).getAllByRole("row");
  return rows.slice(1, rows.length - 1).map((row) => (row as HTMLTableRowElement).cells[0]?.textContent ?? "");
}

describe("PivotTable", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockDownloadFile.mockReset();
  });

  it("renders pivot results, supports reconfiguration, sorting, and CSV export", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('CAST("region" AS VARCHAR) AS pivot_col')) {
        return [
          { pivot_row: "A", pivot_col: "East", pivot_val: 10 },
          { pivot_row: "B", pivot_col: "East", pivot_val: 5 },
          { pivot_row: "B", pivot_col: "West", pivot_val: 20 },
        ];
      }

      return [
        { pivot_row: "A", pivot_val: 10 },
        { pivot_row: "B", pivot_val: 20 },
      ];
    });

    render(<PivotTable tableName="orders" columns={pivotColumns} />);

    expect(await screen.findByText("Grand Total: 30")).toBeInTheDocument();
    expect(getBodyRowLabels()).toEqual(["A", "B"]);

    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[1], "region");

    expect(await screen.findByText("Grand Total: 35")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "East" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "West" })).toBeInTheDocument();

    const totalHeader = within(screen.getByRole("table")).getByRole("columnheader", {
      name: "Total",
    });

    await user.click(totalHeader);
    await user.click(totalHeader);

    await waitFor(() => {
      expect(getBodyRowLabels()).toEqual(["B", "A"]);
    });

    await user.click(screen.getByTitle("Export as CSV"));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("category,East,West,Total"),
      "pivot_export.csv",
      "text/csv;charset=utf-8;",
    );
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("B,5,20,25"),
      "pivot_export.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("renders an insufficient columns state when the schema is incompatible", () => {
    const numericOnlyColumns: ColumnProfile[] = [
      {
        name: "sales",
        type: "number",
        nullCount: 0,
        uniqueCount: 3,
        sampleValues: [1, 2, 3],
      },
    ];

    render(<PivotTable tableName="orders" columns={numericOnlyColumns} />);

    expect(screen.getByText("Insufficient columns")).toBeInTheDocument();
    expect(
      screen.getByText(
        "A pivot table requires at least one string/date column and one numeric column.",
      ),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("shows query errors from DuckDB", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("Pivot exploded"));

    render(<PivotTable tableName="orders" columns={pivotColumns} />);

    expect(await screen.findByText("Pivot exploded")).toBeInTheDocument();
  });
});
