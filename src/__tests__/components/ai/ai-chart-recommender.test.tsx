import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AIChartRecommender from "@/components/ai/ai-chart-recommender";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

const chartPropsSpy = jest.fn();

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: function MockChart(props: Record<string, unknown>) {
      chartPropsSpy(props);
      return React.createElement("div", { "data-testid": "echart" });
    },
  };
});
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({
  BarChart: {},
  LineChart: {},
  PieChart: {},
  ScatterChart: {},
}));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "order_date",
    type: "date",
    nullCount: 0,
    uniqueCount: 30,
    sampleValues: ["2026-01-01", "2026-01-02"],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 30,
    sampleValues: [100, 120],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 30,
    sampleValues: [40, 45],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<AIChartRecommender tableName="sales" columns={columns} />);
  });
}

describe("AIChartRecommender", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("renders the recommendation workspace", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Recommend the best chart based on schema signals",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate recommendations" })).toBeInTheDocument();
  });

  it("builds recommendation cards from schema information", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Generate recommendations" }));

    expect(screen.getByText("revenue over order_date")).toBeInTheDocument();
    expect(screen.getByText("revenue by region")).toBeInTheDocument();
    expect(screen.getByText("region composition")).toBeInTheDocument();
  });

  it("loads a preview query and renders a chart preview", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { label: "East", value: 120 },
      { label: "West", value: 90 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Generate recommendations" }));
    await user.click(screen.getByRole("button", { name: /revenue by region/i }));

    expect(await screen.findByText("Previewing bar chart using 2 sampled rows.")).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();

    const option = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
      series?: Array<{ type?: string }>;
    };
    expect(option.series?.[0]?.type).toBe("bar");
  });
});
