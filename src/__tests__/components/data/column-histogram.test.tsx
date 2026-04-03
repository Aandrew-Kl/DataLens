import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ColumnHistogram from "@/components/data/column-histogram";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("echarts-for-react/lib/core", () => {
  const MockChart = React.forwardRef(function MockChart(
    _props: Record<string, unknown>,
    _ref: React.Ref<unknown>,
  ) {
    return <div data-testid="echarts-mock" />;
  });
  MockChart.displayName = "MockChart";
  return { __esModule: true, default: MockChart };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ BarChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const columns = [
  {
    name: "price",
    type: "number",
    nullCount: 0,
    uniqueCount: 50,
    sampleValues: [10, 20, 30],
  },
  {
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: ["A", "B"],
  },
] as ColumnProfile[];

describe("ColumnHistogram", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the empty-state message when columns are empty", async () => {
    await act(async () => {
      render(<ColumnHistogram tableName="orders" columns={[] as ColumnProfile[]} />);
    });

    expect(
      screen.getByText("Histograms require at least one profiled column."),
    ).toBeInTheDocument();
  });

  it("renders the column select and analyze button when columns are provided", async () => {
    await act(async () => {
      render(<ColumnHistogram tableName="orders" columns={columns} />);
    });

    expect(
      screen.getByText(
        "Pick a column to profile its distribution and then export the histogram.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /analyze column/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("price")).toBeInTheDocument();
  });

  it("analyzes a numeric column and displays the distribution table", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { value: 10 },
      { value: 20 },
      { value: 30 },
      { value: 40 },
    ]);

    await act(async () => {
      render(<ColumnHistogram tableName="orders" columns={columns} />);
    });

    await user.click(screen.getByRole("button", { name: /analyze column/i }));

    expect(await screen.findByText("Distribution table")).toBeInTheDocument();
    expect(screen.getByText("Bucket")).toBeInTheDocument();
    expect(screen.getByText("Count")).toBeInTheDocument();
    expect(screen.getByText("Mean")).toBeInTheDocument();
    expect(screen.getByText("Median")).toBeInTheDocument();
  });
});
