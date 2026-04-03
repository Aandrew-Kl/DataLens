import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ViolinPlot from "@/components/charts/violin-plot";
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
  CustomChart: {},
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

const violinColumns: ColumnProfile[] = [
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["SMB", "Enterprise"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [10, 20],
  },
];

async function renderViolinPlot() {
  await act(async () => {
    render(<ViolinPlot tableName="orders" columns={violinColumns} />);
  });
}

describe("ViolinPlot", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("builds violin summaries for grouped distributions", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { category_value: "SMB", numeric_value: 10 },
      { category_value: "SMB", numeric_value: 14 },
      { category_value: "Enterprise", numeric_value: 25 },
      { category_value: "Enterprise", numeric_value: 30 },
    ]);

    await renderViolinPlot();
    await user.click(screen.getByRole("button", { name: /build violin plot/i }));

    expect(await screen.findByText("SMB")).toBeInTheDocument();
    expect(screen.getByText(/Median 12.00/i)).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
  });

  it("exports the violin plot as PNG and CSV", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { category_value: "SMB", numeric_value: 10 },
      { category_value: "Enterprise", numeric_value: 25 },
    ]);

    await renderViolinPlot();
    await user.click(screen.getByRole("button", { name: /build violin plot/i }));
    await screen.findByText(/Built 2 violins for comparison/i);

    await user.click(screen.getByRole("button", { name: /export png/i }));
    await user.click(screen.getByRole("button", { name: /export csv/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      "orders-segment-amount-violin.png",
      "image/png",
    );
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("group,count,min,q1,median,q3,max"),
      "orders-segment-amount-violin.csv",
      "text/csv;charset=utf-8",
    );
  });

  it("shows query errors when the violin plot cannot be built", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockRejectedValue(new Error("violin failed"));

    await renderViolinPlot();
    await user.click(screen.getByRole("button", { name: /build violin plot/i }));

    expect(await screen.findByText("violin failed")).toBeInTheDocument();
  });
});
