import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PivotTableAdvanced from "@/components/data/pivot-table-advanced";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
  getTableRowCount: jest.fn().mockResolvedValue(100),
  profileTable: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;
const mockDownloadFile = downloadFile as jest.MockedFunction<typeof downloadFile>;

const columns: ColumnProfile[] = [
  {
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["A", "B"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: [10, 20],
  },
];

describe("PivotTableAdvanced", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockDownloadFile.mockReset();
  });

  it("shows a notice when exporting before a pivot is run", async () => {
    const user = userEvent.setup();

    render(<PivotTableAdvanced tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(screen.getByText("Run the pivot before exporting.")).toBeInTheDocument();
  });

  it("adds a calculated field definition", async () => {
    const user = userEvent.setup();

    render(<PivotTableAdvanced tableName="orders" columns={columns} />);

    fireEvent.change(screen.getByPlaceholderText("margin_pct"), {
      target: { value: "margin_pct" },
    });
    fireEvent.change(screen.getByPlaceholderText("sum_revenue / count_revenue"), {
      target: { value: "sum_sales / sum_sales" },
    });

    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText('Added calculated field "margin_pct".')).toBeInTheDocument();
    expect(screen.getByText("margin_pct")).toBeInTheDocument();
    expect(screen.getByText("sum_sales / sum_sales")).toBeInTheDocument();
  });

  it("runs a pivot and supports drill-down on a result cell", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("WITH pivot_base")) {
        return [
          { category: "A", sum_sales: 10 },
          { category: "B", sum_sales: 20 },
        ];
      }

      if (sql.includes(`WHERE CAST("category" AS VARCHAR) = 'A'`)) {
        return [{ category: "A", sales: 10 }];
      }

      return [];
    });

    render(<PivotTableAdvanced tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Run pivot" }));

    await waitFor(() => {
      expect(screen.getByText("Pivot returned 2 grouped rows.")).toBeInTheDocument();
      expect(screen.getByRole("table")).toBeInTheDocument();
      expect(screen.getByText("Grand total")).toBeInTheDocument();
    });

    await user.click(within(screen.getByRole("table")).getByRole("button", { name: "10" }));

    await waitFor(() => {
      expect(screen.getByText("Drill-down")).toBeInTheDocument();
      expect(screen.getByText("A • Values")).toBeInTheDocument();
      expect(screen.getAllByText("A").length).toBeGreaterThan(0);
    });
  });

  it("exports the current pivot to CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValueOnce([
      { category: "A", sum_sales: 10 },
      { category: "B", sum_sales: 20 },
    ]);

    render(<PivotTableAdvanced tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Run pivot" }));

    await waitFor(() => {
      expect(screen.getByText("Pivot returned 2 grouped rows.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("Rows,Values • sum_sales,Row total"),
      "orders-pivot.csv",
      "text/csv;charset=utf-8",
    );
  });

  it("shows pivot query failures", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockRejectedValueOnce(new Error("Pivot query failed"));

    render(<PivotTableAdvanced tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Run pivot" }));

    await waitFor(() => {
      expect(screen.getByText("Pivot query failed")).toBeInTheDocument();
    });
  });
});
