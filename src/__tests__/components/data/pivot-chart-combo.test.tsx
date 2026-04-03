import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PivotChartCombo from "@/components/data/pivot-chart-combo";
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
jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual("react");
  return {
    __esModule: true,
    default: React.forwardRef(function MockChart(
      _props: Record<string, unknown>,
      ref: React.Ref<{ getEchartsInstance: () => { getDataURL: () => string } }>,
    ) {
      React.useImperativeHandle(ref, () => ({
        getEchartsInstance: () => ({
          getDataURL: () => "data:image/png;base64,QQ==",
        }),
      }));
      return React.createElement("div", { "data-testid": "echart" });
    }),
  };
});
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ BarChart: {}, LineChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

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
    sampleValues: ["Retail", "Online"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [10, 20],
  },
];

async function renderComponent() {
  await act(async () => {
    render(<PivotChartCombo tableName="orders" columns={columns} />);
  });
}

describe("PivotChartCombo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the pivot combo controls", async () => {
    await renderComponent();

    expect(
      screen.getByText("Combine pivot tables and charts in one coordinated workspace"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Build pivot combo/i })).toBeInTheDocument();
  });

  it("builds a pivot result and renders the generated chart", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { pivot_row: "East", pivot_column: "Retail", pivot_value: 20 },
      { pivot_row: "West", pivot_column: "Online", pivot_value: 30 },
    ]);

    await renderComponent();
    await user.click(screen.getByRole("button", { name: /Build pivot combo/i }));

    expect(await screen.findByText("East")).toBeInTheDocument();
    expect(screen.getByText("West")).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
  });

  it("exports the pivot result as CSV and PNG", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { pivot_row: "East", pivot_column: "Retail", pivot_value: 20 },
    ]);

    await renderComponent();
    await user.click(screen.getByRole("button", { name: /Build pivot combo/i }));
    await screen.findByText("East");
    await user.click(screen.getByRole("button", { name: /Export CSV/i }));
    await user.click(screen.getByRole("button", { name: /Export PNG/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("row,Retail,total"),
      "orders-pivot-chart.csv",
      "text/csv;charset=utf-8;",
    );
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.any(Array),
      "orders-pivot-chart.png",
      "image/png",
    );
  });
});
