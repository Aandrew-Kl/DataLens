import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RefObject } from "react";

import ChartExport from "@/components/charts/chart-export";
import { downloadFile } from "@/lib/utils/export";
import type ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
  getTableRowCount: jest.fn().mockResolvedValue(100),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/",
}));

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: React.forwardRef(function MockChart(
      props: Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) {
      return React.createElement("div", { ref, "data-testid": "echart" });
    }),
  };
});

jest.mock("echarts/core", () => ({
  use: jest.fn(),
  init: jest.fn(),
  getInstanceByDom: jest.fn(),
}));
jest.mock("echarts/renderers", () => ({
  SVGRenderer: {},
  CanvasRenderer: {},
}));

const mockDownloadFile = jest.mocked(downloadFile);
const mockEchartsInit = jest.mocked(echarts.init);
const mockGetInstanceByDom = jest.mocked(echarts.getInstanceByDom);

const option: EChartsOption = {
  xAxis: { type: "category", data: ["Jan"] },
  yAxis: { type: "value" },
  series: [{ type: "bar", data: [10] }],
};

function createChartRef(): RefObject<ReactEChartsCore | null> {
  return {
    current: {
      getEchartsInstance: () => ({
        getOption: () => option,
      }),
    } as ReactEChartsCore,
  };
}

describe("ChartExport", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mockDownloadFile.mockReset();
    mockEchartsInit.mockReset();
    mockGetInstanceByDom.mockReset();

    mockEchartsInit.mockReturnValue({
      setOption: jest.fn(),
      renderToSVGString: jest.fn(() => "<svg>chart</svg>"),
      dispose: jest.fn(),
    } as never);
  });

  it("renders session export history on load", () => {
    const user = userEvent.setup();

    window.sessionStorage.setItem(
      "datalens:chart-export-history",
      JSON.stringify([
        {
          id: "history-1",
          format: "png",
          title: "Revenue Trend",
          width: 1440,
          height: 900,
          timestamp: 1_735_689_600_000,
        },
      ]),
    );

    render(<ChartExport chartRef={createChartRef()} chartTitle="Revenue Trend" />);

    expect(screen.getByText("Download history")).toBeInTheDocument();
    expect(screen.getByText("Revenue Trend")).toBeInTheDocument();
    expect(screen.getByText("PNG")).toBeInTheDocument();

    void user;
  });

  it("shows a notice when preview is requested without a chart instance", async () => {
    const user = userEvent.setup();

    render(
      <ChartExport
        chartRef={{ current: null }}
        chartTitle="Revenue Trend"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Refresh preview" }));

    expect(
      screen.getByText("Render the chart before exporting it."),
    ).toBeInTheDocument();
  });

  it("exports SVG and records it in session history", async () => {
    const user = userEvent.setup();

    render(<ChartExport chartRef={createChartRef()} chartTitle="Revenue Trend" />);

    await user.click(screen.getByRole("button", { name: "Export SVG" }));

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalledWith(
        "<svg>chart</svg>",
        "Revenue Trend.svg",
        "image/svg+xml;charset=utf-8",
      );
    });

    expect(screen.getByText("SVG export completed.")).toBeInTheDocument();
    expect(
      JSON.parse(
        window.sessionStorage.getItem("datalens:chart-export-history") ?? "[]",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          format: "svg",
          title: "Revenue Trend",
        }),
      ]),
    );
  });

  it("generates a share URL from the active chart option", async () => {
    const user = userEvent.setup();

    render(<ChartExport chartRef={createChartRef()} chartTitle="Revenue Trend" />);

    await user.click(screen.getByRole("button", { name: "Generate share URL" }));

    expect(screen.getByText("Share URL generated.")).toBeInTheDocument();
    expect(screen.getByText(/chart=/)).toBeInTheDocument();
  });

  it("warns when batch export cannot find mounted charts", async () => {
    const user = userEvent.setup();

    render(<ChartExport chartRef={createChartRef()} chartTitle="Revenue Trend" />);

    await user.click(screen.getByRole("button", { name: "Batch export" }));

    expect(
      screen.getByText("No mounted charts were found for batch export."),
    ).toBeInTheDocument();
  });
});
