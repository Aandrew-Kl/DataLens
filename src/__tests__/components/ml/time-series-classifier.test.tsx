import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TimeSeriesClassifier from "@/components/ml/time-series-classifier";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

const chartPropsSpy = jest.fn();

jest.mock("framer-motion");
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
jest.mock("echarts/charts", () => ({ BarChart: {}, LineChart: {} }));
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
    uniqueCount: 10,
    sampleValues: ["2026-01-01", "2026-01-02"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [10, 12, 15],
  },
  {
    name: "margin",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [3, 4, 5],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<TimeSeriesClassifier tableName="orders" columns={columns} />);
  });
}

describe("TimeSeriesClassifier", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("renders the classification workspace", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Classify trend, seasonality, cycles, and residual noise",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Classify pattern" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export analysis CSV" }),
    ).toBeDisabled();
    expect(screen.getAllByTestId("echart")).toHaveLength(2);
  });

  it("classifies a series and updates the confidence chart", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { bucket_date: "2026-01-01", bucket_value: 12, sample_count: 3 },
      { bucket_date: "2026-01-02", bucket_value: 14, sample_count: 3 },
      { bucket_date: "2026-01-03", bucket_value: 16, sample_count: 3 },
      { bucket_date: "2026-01-04", bucket_value: 18, sample_count: 3 },
      { bucket_date: "2026-01-05", bucket_value: 21, sample_count: 3 },
      { bucket_date: "2026-01-06", bucket_value: 24, sample_count: 3 },
      { bucket_date: "2026-01-07", bucket_value: 28, sample_count: 3 },
      { bucket_date: "2026-01-08", bucket_value: 30, sample_count: 3 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Classify pattern" }));

    expect(
      await screen.findByText(/detected with .* confidence\./i),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/Trend-dominant|Seasonal|Cyclical|Random \/ noisy/).length,
    ).toBeGreaterThan(0);

    const lastOption = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
      series?: unknown[];
    };
    expect(lastOption.series).toHaveLength(1);
  });

  it("exports the decomposition rows as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { bucket_date: "2026-01-01", bucket_value: 12, sample_count: 3 },
      { bucket_date: "2026-01-02", bucket_value: 14, sample_count: 3 },
      { bucket_date: "2026-01-03", bucket_value: 16, sample_count: 3 },
      { bucket_date: "2026-01-04", bucket_value: 18, sample_count: 3 },
      { bucket_date: "2026-01-05", bucket_value: 21, sample_count: 3 },
      { bucket_date: "2026-01-06", bucket_value: 24, sample_count: 3 },
      { bucket_date: "2026-01-07", bucket_value: 28, sample_count: 3 },
      { bucket_date: "2026-01-08", bucket_value: 30, sample_count: 3 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Classify pattern" }));
    await screen.findByText(/detected with .* confidence\./i);

    await user.click(screen.getByRole("button", { name: "Export analysis CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("iso_date,value,trend,seasonal,residual,classification,confidence"),
      "orders-time-series-classification.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
