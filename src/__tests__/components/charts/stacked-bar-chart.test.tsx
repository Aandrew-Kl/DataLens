import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import StackedBarChart from "@/components/charts/stacked-bar-chart";
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
  const chartPropsSpy = jest.fn();
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      chartPropsSpy(props);
      return null;
    },
    chartPropsSpy,
  };
});
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ BarChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);
const { chartPropsSpy } = jest.requireMock("echarts-for-react/lib/core") as {
  chartPropsSpy: jest.Mock;
};

const stackedColumns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["East", "West", "North"],
  },
  {
    name: "product",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Widget", "Gadget"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [100, 200, 300],
  },
];

async function renderStackedBar(columns = stackedColumns) {
  await act(async () => {
    render(<StackedBarChart tableName="orders" columns={columns} />);
  });
}

function getLatestChartOption() {
  const latestCall = chartPropsSpy.mock.calls.at(-1);
  const props = (latestCall?.[0] ?? {}) as { option?: Record<string, unknown> };
  return props.option ?? {};
}

describe("StackedBarChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("shows an empty state when there are no numeric columns", async () => {
    await renderStackedBar([
      {
        name: "region",
        type: "string",
        nullCount: 0,
        uniqueCount: 3,
        sampleValues: ["East", "West"],
      },
    ]);

    expect(
      await screen.findByText(
        "At least one category column and one numeric column are required.",
      ),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("renders stacked bar series with stack grouping and legend", async () => {
    mockRunQuery.mockResolvedValue([
      { category: "East", series: "Widget", value: 100 },
      { category: "East", series: "Gadget", value: 80 },
      { category: "West", series: "Widget", value: 120 },
      { category: "West", series: "Gadget", value: 60 },
    ]);

    await renderStackedBar();

    await waitFor(() => {
      expect(screen.getByText(/2 series/)).toBeInTheDocument();
    });

    await waitFor(() => {
      const option = getLatestChartOption();
      const series = option.series as Array<{ stack?: string; name?: string }>;
      const legend = option.legend as { data?: string[] };

      expect(legend.data).toEqual(expect.arrayContaining(["Widget", "Gadget"]));
      expect(series).toHaveLength(2);
      expect(series[0].stack).toBe("total");
    });
  });

  it("exports the aggregated data as CSV", async () => {
    mockRunQuery.mockResolvedValue([
      { category: "East", series: "Widget", value: 100 },
      { category: "West", series: "Gadget", value: 60 },
    ]);

    await renderStackedBar();
    await waitFor(() => {
      expect(screen.getByText(/2 series/)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export stacked bar chart CSV" }));
    });

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("category,series,value"),
      "orders-stacked-bar.csv",
      "text/csv;charset=utf-8;",
    );
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("East,Widget,100"),
      "orders-stacked-bar.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
