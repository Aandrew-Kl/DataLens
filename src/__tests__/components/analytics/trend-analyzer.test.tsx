import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TrendAnalyzer from "@/components/analytics/trend-analyzer";
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
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: ["2026-01-01", "2026-01-02"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [100, 120],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [20, 24],
  },
];

async function renderAsync(targetColumns: ColumnProfile[] = columns) {
  await act(async () => {
    render(<TrendAnalyzer tableName="orders" columns={targetColumns} />);
  });
}

describe("TrendAnalyzer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("renders the trend workspace before any analysis runs", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Detect momentum, seasonality, and change points in a time series",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Choose a date field and a numeric metric, then detect movement patterns.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
  });

  it("analyzes a daily series and updates the chart option", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { bucket_date: "2026-01-01", metric_avg: 10 },
      { bucket_date: "2026-01-02", metric_avg: 12 },
      { bucket_date: "2026-01-03", metric_avg: 14 },
      { bucket_date: "2026-01-04", metric_avg: 18 },
      { bucket_date: "2026-01-05", metric_avg: 20 },
      { bucket_date: "2026-01-06", metric_avg: 24 },
      { bucket_date: "2026-01-07", metric_avg: 28 },
      { bucket_date: "2026-01-08", metric_avg: 32 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Analyze trends" }));

    expect(
      await screen.findByText("Detected a up trend with 3 highlighted change points."),
    ).toBeInTheDocument();
    expect(screen.getByText("up")).toBeInTheDocument();

    const lastOption = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
      xAxis?: { data?: string[] };
      series?: unknown[];
    };
    expect(lastOption.xAxis?.data).toHaveLength(8);
    expect(lastOption.series).toHaveLength(3);
  });

  it("exports the analyzed trend series as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { bucket_date: "2026-01-01", metric_avg: 10 },
      { bucket_date: "2026-01-02", metric_avg: 12 },
      { bucket_date: "2026-01-03", metric_avg: 14 },
      { bucket_date: "2026-01-04", metric_avg: 18 },
      { bucket_date: "2026-01-05", metric_avg: 20 },
      { bucket_date: "2026-01-06", metric_avg: 24 },
      { bucket_date: "2026-01-07", metric_avg: 28 },
      { bucket_date: "2026-01-08", metric_avg: 32 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Analyze trends" }));
    await screen.findByText("Detected a up trend with 3 highlighted change points.");

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("iso_date,metric_value,moving_average,trend_line,seasonal_index"),
      "orders-trend-analysis.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("shows a validation error when there are not enough daily buckets", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { bucket_date: "2026-01-01", metric_avg: 10 },
      { bucket_date: "2026-01-02", metric_avg: 12 },
      { bucket_date: "2026-01-03", metric_avg: 14 },
      { bucket_date: "2026-01-04", metric_avg: 16 },
      { bucket_date: "2026-01-05", metric_avg: 18 },
      { bucket_date: "2026-01-06", metric_avg: 20 },
      { bucket_date: "2026-01-07", metric_avg: 22 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Analyze trends" }));

    expect(
      await screen.findByText("At least 8 daily buckets are required for trend analysis."),
    ).toBeInTheDocument();
  });
});
