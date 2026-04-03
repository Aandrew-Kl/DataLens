import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TreemapChart from "@/components/charts/treemap-chart";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

const mockChartInstance = {
  getDataURL: jest.fn(() => "data:image/png;base64,treemap"),
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
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["West", "East"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [100, 80],
  },
  {
    name: "channel",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Online", "Retail"],
  },
];

function getOption(): Record<string, unknown> {
  const lastCall = chartPropsSpy.mock.calls.at(-1);
  return ((lastCall?.[0] as Record<string, unknown>)?.option ?? {}) as Record<string, unknown>;
}

describe("TreemapChart", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue([]);
    mockChartInstance.getDataURL.mockClear();
    chartPropsSpy.mockClear();
  });

  it("renders the empty treemap state before a query runs", () => {
    render(<TreemapChart tableName="orders" columns={columns} />);

    expect(
      screen.getByText(
        "Build the treemap to start drilling into categories and nested segments.",
      ),
    ).toBeInTheDocument();
  });

  it("builds nested groups and treemap metrics from query rows", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { category_name: "West", nested_name: "Online", metric: 100 },
      { category_name: "West", nested_name: "Retail", metric: 60 },
      { category_name: "East", nested_name: "Online", metric: 80 },
    ]);

    render(<TreemapChart tableName="orders" columns={columns} />);

    await user.selectOptions(screen.getAllByRole("combobox")[2], "channel");
    await user.click(screen.getByRole("button", { name: /Build chart/i }));

    expect(await screen.findByText("West")).toBeInTheDocument();
    expect(screen.getByText("2 nested segments")).toBeInTheDocument();

    await waitFor(() => {
      const option = getOption();
      const series = option.series as Array<{ colorMappingBy?: string }>;
      expect(series[0]?.colorMappingBy).toBe("value");
      expect(option.visualMap).toBeDefined();
    });
  });

  it("switches from value coloring to category coloring", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { category_name: "West", nested_name: "Online", metric: 100 },
      { category_name: "West", nested_name: "Retail", metric: 60 },
      { category_name: "East", nested_name: "Online", metric: 80 },
    ]);

    render(<TreemapChart tableName="orders" columns={columns} />);

    await user.selectOptions(screen.getAllByRole("combobox")[2], "channel");
    await user.click(screen.getByRole("button", { name: /Build chart/i }));
    await screen.findByTestId("echart");

    await user.selectOptions(screen.getAllByRole("combobox")[3], "category");

    await waitFor(() => {
      const option = getOption();
      const series = option.series as Array<{ colorMappingBy?: string }>;
      expect(series[0]?.colorMappingBy).toBe("index");
      expect(option.visualMap).toBeUndefined();
    });
  });

  it("exports the treemap image", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { category_name: "West", nested_name: "Online", metric: 100 },
      { category_name: "West", nested_name: "Retail", metric: 60 },
      { category_name: "East", nested_name: "Online", metric: 80 },
    ]);

    render(<TreemapChart tableName="orders" columns={columns} />);

    await user.selectOptions(screen.getAllByRole("combobox")[2], "channel");
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

  it("shows query errors when treemap generation fails", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockRejectedValue(new Error("Treemap failed"));

    render(<TreemapChart tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /Build chart/i }));

    expect(await screen.findByText("Treemap failed")).toBeInTheDocument();
  });
});
