import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScatterMatrix from "@/components/charts/scatter-matrix";
import { runQuery } from "@/lib/duckdb/client";
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

jest.mock("echarts-for-react", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: React.forwardRef(function MockChart(
      props: Record<string, unknown>,
      ref: React.ForwardedRef<HTMLDivElement>,
    ) {
      return React.createElement("div", { ref, "data-testid": "echart" });
    }),
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const matrixColumns: ColumnProfile[] = [
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [10, 20],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [2, 4],
  },
  {
    name: "discount",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [1, 3],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Retail", "Enterprise"],
  },
];

describe("ScatterMatrix", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue([
      { sales: 100, profit: 20, discount: 5, __category: "Retail" },
      { sales: 120, profit: 24, discount: 6, __category: "Retail" },
      { sales: 90, profit: 18, discount: 4, __category: "Enterprise" },
    ]);
  });

  it("shows the numeric guard when there are not enough numeric columns", () => {
    render(
      <ScatterMatrix
        tableName="orders"
        columns={[
          {
            name: "segment",
            type: "string",
            nullCount: 0,
            uniqueCount: 2,
            sampleValues: ["A", "B"],
          },
        ]}
      />,
    );

    expect(
      screen.getByText("Scatter matrix needs at least two numeric columns"),
    ).toBeInTheDocument();
  });

  it("loads a matrix sample and renders the selected column summary", async () => {
    render(<ScatterMatrix tableName="orders" columns={matrixColumns} />);

    expect(screen.getByText("3 selected")).toBeInTheDocument();

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('USING SAMPLE 320 ROWS'),
      );
      expect(screen.getAllByText("sales").length).toBeGreaterThan(0);
      expect(screen.getAllByText("profit").length).toBeGreaterThan(0);
    });
  });

  it("applies category coloring and renders the legend", async () => {
    const user = userEvent.setup();

    render(<ScatterMatrix tableName="orders" columns={matrixColumns} />);

    await user.selectOptions(screen.getByRole("combobox"), "segment");

    await waitFor(() => {
      expect(screen.getByText("segment")).toBeInTheDocument();
    });
  });

  it("shows query failures from DuckDB", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("Matrix sample failed"));

    render(<ScatterMatrix tableName="orders" columns={matrixColumns} />);

    await waitFor(() => {
      expect(screen.getByText("Matrix sample failed")).toBeInTheDocument();
    });
  });
});
