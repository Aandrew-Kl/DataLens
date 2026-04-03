import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import FunnelChart from "@/components/charts/funnel-chart";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

const mockChartInstance = {
  getDataURL: jest.fn(() => "data:image/png;base64,funnel"),
};

const chartPropsSpy = jest.fn();

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

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
        getEchartsInstance: () => mockChartInstance,
      }));
      return React.createElement("div", { "data-testid": "echart" });
    }),
  };
});

jest.mock("echarts/charts", () => ({}));
jest.mock("echarts/components", () => ({}));
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/renderers", () => ({}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const columns: ColumnProfile[] = [
  {
    name: "stage",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Visitors", "Leads"],
  },
  {
    name: "count",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [200, 120],
  },
];

function getOption(): Record<string, unknown> {
  const lastCall = chartPropsSpy.mock.calls.at(-1);
  return ((lastCall?.[0] as Record<string, unknown>)?.option ?? {}) as Record<string, unknown>;
}

describe("FunnelChart", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue([]);
    mockChartInstance.getDataURL.mockClear();
    chartPropsSpy.mockClear();
  });

  it("renders the funnel placeholder before loading data", () => {
    render(<FunnelChart tableName="orders" columns={columns} />);

    expect(
      screen.getByText("Build the funnel to compare stage volume and conversion rates."),
    ).toBeInTheDocument();
  });

  it("builds stage metrics and chart data from DuckDB results", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { stage_name: "Visitors", stage_value: 200 },
      { stage_name: "Leads", stage_value: 120 },
      { stage_name: "Won", stage_value: 60 },
    ]);

    render(<FunnelChart tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /Build chart/i }));

    expect(await screen.findByText("1. Visitors")).toBeInTheDocument();
    expect(screen.getByText("30.0%")).toBeInTheDocument();

    await waitFor(() => {
      const option = getOption();
      const series = option.series as Array<{ data?: unknown[]; type?: string }>;
      expect(series[0]?.type).toBe("funnel");
      expect(series[0]?.data).toHaveLength(3);
    });
  });

  it("updates the chart orientation after data is loaded", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { stage_name: "Visitors", stage_value: 200 },
      { stage_name: "Leads", stage_value: 120 },
      { stage_name: "Won", stage_value: 60 },
    ]);

    render(<FunnelChart tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /Build chart/i }));
    await screen.findByTestId("echart");

    await user.selectOptions(screen.getAllByRole("combobox")[2], "horizontal");

    await waitFor(() => {
      const option = getOption();
      const series = option.series as Array<{ orient?: string }>;
      expect(series[0]?.orient).toBe("horizontal");
    });
  });

  it("exports the current funnel chart", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { stage_name: "Visitors", stage_value: 200 },
      { stage_name: "Leads", stage_value: 120 },
      { stage_name: "Won", stage_value: 60 },
    ]);

    render(<FunnelChart tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /Build chart/i }));
    await screen.findByTestId("echart");

    await user.click(screen.getByRole("button", { name: /Export PNG/i }));

    expect(mockChartInstance.getDataURL).toHaveBeenCalledWith(
      expect.objectContaining({
        backgroundColor: "#f8fafc",
        pixelRatio: 2,
        type: "png",
      }),
    );
  });

  it("surfaces query errors in the UI", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockRejectedValue(new Error("Funnel failed"));

    render(<FunnelChart tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /Build chart/i }));

    expect(await screen.findByText("Funnel failed")).toBeInTheDocument();
  });
});
