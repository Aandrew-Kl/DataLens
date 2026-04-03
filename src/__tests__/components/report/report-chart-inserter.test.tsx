import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportChartInserter from "@/components/report/report-chart-inserter";
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
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["West", "East"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: ["2026-01-01", "2026-01-02"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: [10, 20],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<ReportChartInserter tableName="orders" columns={columns} />);
  });
}

describe("ReportChartInserter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("renders chart type cards and preview controls", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Browse chart patterns and stage them for report sections",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview chart" })).toBeInTheDocument();
    expect(screen.getByText("Bar")).toBeInTheDocument();
    expect(screen.getByText("Scatter")).toBeInTheDocument();
  });

  it("loads preview rows and sends an option object to ECharts", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { bucket_label: "West", bucket_value: 22 },
      { bucket_label: "East", bucket_value: 18 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Preview chart" }));

    expect(
      await screen.findByText("Loaded 2 rows for the preview chart."),
    ).toBeInTheDocument();
    const lastOption = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
      series?: unknown[];
    };
    expect(lastOption.series).toHaveLength(1);
  });

  it("adds the current preview to the report section queue", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { bucket_label: "West", bucket_value: 22 },
      { bucket_label: "East", bucket_value: 18 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Preview chart" }));
    await screen.findByText("Loaded 2 rows for the preview chart.");

    await user.click(screen.getByRole("button", { name: "Add to report section" }));

    expect(
      screen.getByText("orders: revenue by region"),
    ).toBeInTheDocument();
  });
});
