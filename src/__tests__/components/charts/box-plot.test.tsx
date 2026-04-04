import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import BoxPlot from "@/components/charts/box-plot";
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
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: React.forwardRef(function MockChart(
      _props: Record<string, unknown>,
      ref: React.Ref<unknown>,
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
jest.mock("echarts/charts", () => ({
  BoxplotChart: {},
  ScatterChart: {},
}));
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
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [10, 20],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [3, 8],
  },
];

async function renderComponent(nextColumns = columns) {
  await act(async () => {
    render(<BoxPlot tableName="orders" columns={nextColumns} />);
  });
}

function installMockRows() {
  mockRunQuery.mockImplementation(async (sql) => {
    if (sql.includes("outlier_count")) {
      return [
        {
          metric_name: "profit",
          whisker_min: 1,
          q1_value: 6,
          median_value: 18,
          q3_value: 24,
          whisker_max: 30,
          mean_value: 17,
          row_count: 50,
          outlier_count: 1,
        },
        {
          metric_name: "sales",
          whisker_min: 4,
          q1_value: 12,
          median_value: 20,
          q3_value: 28,
          whisker_max: 42,
          mean_value: 21,
          row_count: 50,
          outlier_count: 2,
        },
      ];
    }
    return [{ metric_name: "sales", metric_value: 88 }];
  });
}

describe("BoxPlot", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the chart shell and statistical summaries", async () => {
    installMockRows();

    await renderComponent();

    expect(
      await screen.findByText("Compare min, Q1, median, Q3, and max for each numeric field"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
    expect(screen.getByText("Median: 18")).toBeInTheDocument();
    expect(screen.getByText("Median: 20")).toBeInTheDocument();
  });

  it("exports the computed box plot summary as CSV", async () => {
    const user = userEvent.setup();

    installMockRows();
    await renderComponent();
    await screen.findByText("Median: 20");

    await user.click(screen.getByRole("button", { name: /Export CSV/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("metric,min,q1,median,q3,max,mean,row_count,outlier_count"),
      "orders-box-plot.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("shows a validation error when no numeric columns are available", async () => {
    await renderComponent([
      {
        name: "region",
        type: "string",
        nullCount: 0,
        uniqueCount: 2,
        sampleValues: ["East", "West"],
      },
    ]);

    expect(
      await screen.findByText("Choose at least one numeric column to render the box plot."),
    ).toBeInTheDocument();
  });
});
