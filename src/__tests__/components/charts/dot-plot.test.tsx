import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DotPlot from "@/components/charts/dot-plot";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

jest.mock("framer-motion", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    motion: new Proxy(
      {},
      {
        get: (_target, tag) =>
          React.forwardRef(function MockMotion(
            props: Record<string, unknown> & { children?: ReactNode },
            ref: React.Ref<Element>,
          ) {
            return React.createElement(String(tag), { ...props, ref }, props.children);
          }),
      },
    ),
  };
});

jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: React.forwardRef(function MockChart(
      _props: Record<string, unknown>,
      ref: React.Ref<{ getEchartsInstance: () => { getDataURL: () => string } }>,
    ) {
      React.useImperativeHandle(
        ref,
        () => ({
          getEchartsInstance: () => ({
            getDataURL: () => "data:image/png;base64,cG5n",
          }),
        }),
        [],
      );
      return React.createElement("div", { "data-testid": "echart" });
    }),
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({
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

const dotPlotColumns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["East", "West"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [10, 20],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["SMB", "Enterprise"],
  },
];

async function renderDotPlot() {
  await act(async () => {
    render(<DotPlot tableName="orders" columns={dotPlotColumns} />);
  });
}

describe("DotPlot", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("builds the point cloud for the selected category and value columns", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { category_value: "East", numeric_value: 12, group_value: "All rows" },
      { category_value: "West", numeric_value: 20, group_value: "All rows" },
      { category_value: "East", numeric_value: 16, group_value: "All rows" },
    ]);

    await renderDotPlot();
    await user.click(screen.getByRole("button", { name: /build dot plot/i }));

    expect(
      await screen.findByText(/Point cloud ready with 3 observations across 2 categories/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
  });

  it("exports the dot plot as PNG and CSV", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { category_value: "East", numeric_value: 12, group_value: "All rows" },
      { category_value: "West", numeric_value: 20, group_value: "All rows" },
    ]);

    await renderDotPlot();
    await user.click(screen.getByRole("button", { name: /build dot plot/i }));
    await screen.findByText(/Point cloud ready with 2 observations across 2 categories/i);

    await user.click(screen.getByRole("button", { name: /export png/i }));
    await user.click(screen.getByRole("button", { name: /export csv/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      "orders-region-amount-dot-plot.png",
      "image/png",
    );
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("category,group,value,x_position"),
      "orders-region-amount-dot-plot.csv",
      "text/csv;charset=utf-8",
    );
  });

  it("shows query errors when the plot cannot be built", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockRejectedValue(new Error("dot plot failed"));

    await renderDotPlot();
    await user.click(screen.getByRole("button", { name: /build dot plot/i }));

    expect(await screen.findByText("dot plot failed")).toBeInTheDocument();
  });
});
