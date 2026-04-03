import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import BubbleChart from "@/components/charts/bubble-chart";
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
jest.mock("echarts/charts", () => ({ ScatterChart: {} }));
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

const bubbleColumns: ColumnProfile[] = [
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [100, 200, 300],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [10, 20, 30],
  },
  {
    name: "volume",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [1, 2, 3],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["Enterprise", "SMB"],
  },
];

async function renderBubble(columns = bubbleColumns) {
  await act(async () => {
    render(<BubbleChart tableName="orders" columns={columns} />);
  });
}

function getLatestChartOption() {
  const latestCall = chartPropsSpy.mock.calls.at(-1);
  const props = (latestCall?.[0] ?? {}) as { option?: Record<string, unknown> };
  return props.option ?? {};
}

describe("BubbleChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("shows an empty state when there are not enough numeric columns", async () => {
    await renderBubble([
      {
        name: "segment",
        type: "string",
        nullCount: 0,
        uniqueCount: 3,
        sampleValues: ["Enterprise", "SMB"],
      },
    ]);

    expect(
      await screen.findByText(
        "At least two numeric columns are required to place bubbles on X and Y axes.",
      ),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("renders grouped bubble series and legend categories", async () => {
    mockRunQuery.mockResolvedValue([
      { x_value: 10, y_value: 2, size_value: 100, color_value: "Enterprise" },
      { x_value: 12, y_value: 5, size_value: 80, color_value: "SMB" },
      { x_value: 9, y_value: 4, size_value: 60, color_value: "Enterprise" },
    ]);

    await renderBubble();

    expect(await screen.findByText("Legend groups")).toBeInTheDocument();

    await waitFor(() => {
      const option = getLatestChartOption();
      const legend = option.legend as { data?: string[] };
      const series = option.series as Array<Record<string, unknown>>;

      expect(legend.data).toEqual(expect.arrayContaining(["Enterprise", "SMB"]));
      expect(series).toHaveLength(2);
    });
  });

  it("exports the plotted rows as CSV", async () => {
    mockRunQuery.mockResolvedValue([
      { x_value: 10, y_value: 2, size_value: 100, color_value: "Enterprise" },
      { x_value: 12, y_value: 5, size_value: 80, color_value: "SMB" },
    ]);

    await renderBubble();
    await screen.findByText("Legend groups");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export bubble chart CSV" }));
    });

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("sales,profit,volume,segment"),
      "orders-bubble-chart.csv",
      "text/csv;charset=utf-8;",
    );
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("10,2,100,Enterprise"),
      "orders-bubble-chart.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
