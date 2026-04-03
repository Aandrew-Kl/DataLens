import { render, screen, waitFor } from "@testing-library/react";
import SparklineGrid from "@/components/charts/sparkline-grid";
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

const numericColumns: ColumnProfile[] = [
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [10, 20],
    min: 10,
    max: 120,
    mean: 65,
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [1, 2],
    min: 1,
    max: 12,
    mean: 6.5,
  },
];

describe("SparklineGrid", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  it("shows an empty state when there are no numeric columns", () => {
    render(
      <SparklineGrid
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

    expect(screen.getByText("No numeric columns available")).toBeInTheDocument();
  });

  it("renders sampled rows with sparkline previews", async () => {
    mockRunQuery.mockResolvedValue([
      { sales: 10, profit: 1 },
      { sales: 20, profit: 2 },
      { sales: 30, profit: 3 },
    ]);

    render(<SparklineGrid tableName="orders" columns={numericColumns} />);

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('USING SAMPLE 120 ROWS'),
      );
      expect(screen.getByText("sales")).toBeInTheDocument();
      expect(screen.getByText("profit")).toBeInTheDocument();
      expect(screen.getAllByTestId("echart").length).toBeGreaterThan(0);
    });
  });

  it("shows insufficient data when a sampled series is too short", async () => {
    mockRunQuery.mockResolvedValue([
      { sales: 10, profit: null },
      { sales: 20, profit: null },
    ]);

    render(<SparklineGrid tableName="orders" columns={numericColumns} />);

    await waitFor(() => {
      const profitRow = screen.getByText("profit").closest("div");
      expect(profitRow).not.toBeNull();
      expect(screen.getByText("insufficient data")).toBeInTheDocument();
    });
  });

  it("shows sampling errors from DuckDB", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("Sparkline preview failed"));

    render(<SparklineGrid tableName="orders" columns={numericColumns} />);

    await waitFor(() => {
      expect(screen.getByText("Sparkline preview failed")).toBeInTheDocument();
    });
  });
});
