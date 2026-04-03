import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import CandlestickChart from "@/components/charts/candlestick-chart";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("echarts-for-react/lib/core");
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({
  CandlestickChart: {},
  LineChart: {},
  BarChart: {},
}));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
  DataZoomComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);

const fullColumns: ColumnProfile[] = [
  {
    name: "trade_date",
    type: "date",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: ["2024-01-01", "2024-01-02"],
  },
  {
    name: "open",
    type: "number",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: [10, 11],
  },
  {
    name: "high",
    type: "number",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: [12, 13],
  },
  {
    name: "low",
    type: "number",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: [8, 9],
  },
  {
    name: "close",
    type: "number",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: [11, 12],
  },
  {
    name: "volume",
    type: "number",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: [100, 120],
  },
];

async function renderAsync(nextColumns = fullColumns) {
  await act(async () => {
    render(<CandlestickChart tableName="prices" columns={nextColumns} />);
  });
}

describe("CandlestickChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunQuery.mockResolvedValue([
      {
        date_value: "2024-01-01",
        open_value: 10,
        high_value: 12,
        low_value: 9,
        close_value: 11,
        volume_value: 100,
      },
      {
        date_value: "2024-01-02",
        open_value: 11,
        high_value: 13,
        low_value: 10,
        close_value: 12,
        volume_value: 120,
      },
      {
        date_value: "2024-01-03",
        open_value: 12,
        high_value: 14,
        low_value: 11,
        close_value: 13,
        volume_value: 140,
      },
      {
        date_value: "2024-01-04",
        open_value: 13,
        high_value: 15,
        low_value: 12,
        close_value: 14,
        volume_value: 160,
      },
      {
        date_value: "2024-01-05",
        open_value: 14,
        high_value: 16,
        low_value: 13,
        close_value: 15,
        volume_value: 180,
      },
    ]);
  });

  it("shows a field-selection error when OHLC columns are incomplete", async () => {
    await renderAsync(fullColumns.slice(0, 4));

    expect(
      await screen.findByText("Choose date, open, high, low, and close columns."),
    ).toBeInTheDocument();
  });

  it("renders candlestick and moving-average series", async () => {
    await renderAsync();

    await waitFor(() => {
      expect(screen.getByTestId("echart")).toBeInTheDocument();
    });

    const option = JSON.parse(screen.getByTestId("echart").getAttribute("data-option") ?? "{}") as {
      series?: Array<{ type?: string }>;
    };
    expect(option.series?.map((series) => series.type)).toEqual(
      expect.arrayContaining(["candlestick", "line", "bar"]),
    );
  });

  it("removes the volume series when volume bars are disabled", async () => {
    await renderAsync();

    await waitFor(() => {
      expect(screen.getByTestId("echart")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox"));
    });

    await waitFor(() => {
      const option = JSON.parse(screen.getByTestId("echart").getAttribute("data-option") ?? "{}") as {
        series?: Array<{ type?: string }>;
      };
      expect(option.series?.map((series) => series.type)).toEqual(
        expect.arrayContaining(["candlestick", "line"]),
      );
      expect(option.series?.map((series) => series.type)).not.toContain("bar");
    });
  });
});
