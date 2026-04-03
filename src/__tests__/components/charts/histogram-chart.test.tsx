import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import HistogramChart from "@/components/charts/histogram-chart";
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
  BarChart: {},
  LineChart: {},
}));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  MarkLineComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const histogramColumns: ColumnProfile[] = [
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [10, 20],
  },
];

async function renderHistogram() {
  await act(async () => {
    render(<HistogramChart tableName="orders" columns={histogramColumns} />);
  });
}

describe("HistogramChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("builds a histogram and shows summary statistics", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { numeric_value: 10 },
      { numeric_value: 20 },
      { numeric_value: 20 },
      { numeric_value: 30 },
    ]);

    await renderHistogram();
    await user.click(screen.getByRole("button", { name: /build histogram/i }));

    expect((await screen.findAllByText("20.00")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Built 12 bins from 4 observations/i)).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
  });

  it("exports the histogram as PNG and CSV", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { numeric_value: 10 },
      { numeric_value: 20 },
      { numeric_value: 30 },
    ]);

    await renderHistogram();
    await user.click(screen.getByRole("button", { name: /build histogram/i }));
    await screen.findByText(/Built 12 bins from 3 observations/i);

    await user.click(screen.getByRole("button", { name: /export png/i }));
    await user.click(screen.getByRole("button", { name: /export csv/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      "orders-amount-histogram.png",
      "image/png",
    );
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("bin_start,bin_end,label,count,density"),
      "orders-amount-histogram.csv",
      "text/csv;charset=utf-8",
    );
  });

  it("shows query failures in the status panel", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockRejectedValue(new Error("histogram failed"));

    await renderHistogram();
    await user.click(screen.getByRole("button", { name: /build histogram/i }));

    expect(await screen.findByText("histogram failed")).toBeInTheDocument();
  });
});
