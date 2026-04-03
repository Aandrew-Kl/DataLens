import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SteppedLineChart from "@/components/charts/stepped-line-chart";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

const chartPropsSpy = jest.fn();

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
      props: Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) {
      chartPropsSpy(props);
      React.useImperativeHandle(ref, () => ({
        getEchartsInstance: () => ({
          getDataURL: () => "data:image/png;base64,Zm9v",
        }),
      }));
      return React.createElement("div", { "data-testid": "echart" });
    }),
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ LineChart: {} }));
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
    name: "ordered_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["2026-01-01", "2026-01-02"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [100, 120],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [30, 36],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<SteppedLineChart tableName="orders" columns={columns} />);
  });
}

describe("SteppedLineChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("renders the stepped chart controls and empty chart", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Compare series transitions with explicit step boundaries",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Step type")).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
  });

  it("builds the chart and updates the ECharts step mode", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { x_value: "2026-01-01", revenue: 100, profit: 30 },
      { x_value: "2026-01-02", revenue: 120, profit: 36 },
    ]);

    await renderAsync();
    fireEvent.change(screen.getByLabelText("Step type"), {
      target: { value: "middle" },
    });
    await user.click(screen.getByRole("button", { name: "Build chart" }));

    expect(await screen.findByText(/Rendered 2 stepped points across 2 series/i)).toBeInTheDocument();

    const option = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
      series?: Array<{ step?: string }>;
    };
    expect(option.series?.[0]?.step).toBe("middle");
    expect(option.series?.[1]?.step).toBe("middle");
  });

  it("exports PNG and CSV after the chart is rendered", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { x_value: "2026-01-01", revenue: 100, profit: 30 },
      { x_value: "2026-01-02", revenue: 120, profit: 36 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Build chart" }));
    await screen.findByText(/Rendered 2 stepped points/i);

    await user.click(screen.getByRole("button", { name: "Export PNG" }));
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "orders-stepped-line-chart.png",
      "image/png",
    );
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("x_value,revenue,profit"),
      "orders-stepped-line-chart.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
