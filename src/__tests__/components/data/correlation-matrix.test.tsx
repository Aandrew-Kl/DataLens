import { fireEvent, render, screen } from "@testing-library/react";

import CorrelationMatrix from "@/components/data/correlation-matrix";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const numericColumns: ColumnProfile[] = [
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [10, 20, 30],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [5, 10, 15],
  },
  {
    name: "cost",
    type: "number",
    nullCount: 1,
    uniqueCount: 11,
    sampleValues: [2, 4, 8],
  },
];

describe("CorrelationMatrix", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders an empty state when there are no numeric columns", () => {
    render(
      <CorrelationMatrix
        tableName="sales"
        columns={[
          {
            name: "region",
            type: "string",
            nullCount: 0,
            uniqueCount: 4,
            sampleValues: ["East", "West"],
          },
        ]}
      />,
    );

    expect(screen.getByText("No numeric columns available")).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("renders the matrix and updates the hover detail", async () => {
    mockRunQuery.mockResolvedValue([
      { row_name: "sales", column_name: "sales", correlation: 1, pair_count: 10 },
      { row_name: "sales", column_name: "profit", correlation: 0.82, pair_count: 8 },
      { row_name: "sales", column_name: "cost", correlation: 0.12, pair_count: 8 },
      { row_name: "profit", column_name: "sales", correlation: 0.82, pair_count: 8 },
      { row_name: "profit", column_name: "profit", correlation: 1, pair_count: 8 },
      { row_name: "profit", column_name: "cost", correlation: -0.63, pair_count: 7 },
      { row_name: "cost", column_name: "sales", correlation: 0.12, pair_count: 8 },
      { row_name: "cost", column_name: "profit", correlation: -0.63, pair_count: 7 },
      { row_name: "cost", column_name: "cost", correlation: 1, pair_count: 9 },
    ]);

    render(<CorrelationMatrix tableName="sales" columns={numericColumns} />);

    expect(
      await screen.findByText(/Pearson heatmap across 3 numeric columns/i),
    ).toBeInTheDocument();
    expect(screen.getByText("sales × profit")).toBeInTheDocument();
    expect(screen.getByText("profit × cost")).toBeInTheDocument();

    const targetCell = screen.getByTitle("sales × profit: 0.8200");
    fireEvent.mouseEnter(targetCell);

    expect(
      await screen.findByText("Exact Pearson coefficient: 0.8200"),
    ).toBeInTheDocument();
    expect(screen.getByText("8 paired rows")).toBeInTheDocument();

    fireEvent.mouseLeave(targetCell);
    expect(
      await screen.findByText("Hover a cell to inspect the exact coefficient"),
    ).toBeInTheDocument();
  });

  it("shows query errors", async () => {
    mockRunQuery.mockRejectedValue(new Error("Correlation failed"));

    render(<CorrelationMatrix tableName="sales" columns={numericColumns} />);

    expect(await screen.findByText("Correlation failed")).toBeInTheDocument();
  });
});
