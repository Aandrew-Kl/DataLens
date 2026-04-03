import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import WaterfallChart from "@/components/charts/waterfall-chart";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

const mockChartInstance = {
  getDataURL: jest.fn(() => "data:image/png;base64,waterfall"),
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
    name: "step",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Revenue", "Returns"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [120, -30],
  },
];

function getOption(): Record<string, unknown> {
  const lastCall = chartPropsSpy.mock.calls.at(-1);
  return ((lastCall?.[0] as Record<string, unknown>)?.option ?? {}) as Record<string, unknown>;
}

describe("WaterfallChart", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue([]);
    mockChartInstance.getDataURL.mockClear();
    chartPropsSpy.mockClear();
  });

  it("renders the initial empty state before any query runs", () => {
    render(<WaterfallChart tableName="orders" columns={columns} />);

    expect(
      screen.getByText("Build the chart to calculate the running totals."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).not.toBeInTheDocument();
  });

  it("builds a waterfall option and ledger from query results", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { category: "Revenue", value: 120, source_order: 1 },
      { category: "Returns", value: -30, source_order: 2 },
    ]);

    render(<WaterfallChart tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /Build chart/i }));

    await waitFor(() => {
      const option = getOption();
      const xAxis = option.xAxis as { data?: string[] };
      expect(xAxis.data).toEqual(["Revenue", "Returns", "Total"]);
    });

    expect(screen.getByTestId("echart")).toBeInTheDocument();
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("Returns")).toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument();
  });

  it("respects the selected sort mode when building the chart", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { category: "Revenue", value: 120, source_order: 1 },
      { category: "Returns", value: -30, source_order: 2 },
      { category: "Fees", value: 15, source_order: 3 },
    ]);

    render(<WaterfallChart tableName="orders" columns={columns} />);

    await user.selectOptions(screen.getAllByRole("combobox")[2], "ascending");
    await user.click(screen.getByRole("button", { name: /Build chart/i }));

    await waitFor(() => {
      const option = getOption();
      const xAxis = option.xAxis as { data?: string[] };
      expect(xAxis.data).toEqual(["Returns", "Fees", "Revenue", "Total"]);
    });
  });

  it("toggles connector lines in the chart option", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { category: "Revenue", value: 120, source_order: 1 },
      { category: "Returns", value: -30, source_order: 2 },
    ]);

    render(<WaterfallChart tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /Build chart/i }));

    await waitFor(() => {
      const option = getOption();
      const series = option.series as Array<{ data?: unknown[] }>;
      expect(series[3]?.data).toEqual([120, 90, 90]);
    });

    fireEvent.click(screen.getByRole("checkbox", { name: /Show connectors/i }));

    await waitFor(() => {
      const option = getOption();
      const series = option.series as Array<{ data?: unknown[] }>;
      expect(series[3]?.data).toEqual([]);
    });
  });

  it("exports the rendered chart as a PNG", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { category: "Revenue", value: 120, source_order: 1 },
      { category: "Returns", value: -30, source_order: 2 },
    ]);

    render(<WaterfallChart tableName="orders" columns={columns} />);

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

  it("shows query failures from DuckDB", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockRejectedValue(new Error("Waterfall failed"));

    render(<WaterfallChart tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /Build chart/i }));

    expect(await screen.findByText("Waterfall failed")).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).not.toBeInTheDocument();
  });
});
