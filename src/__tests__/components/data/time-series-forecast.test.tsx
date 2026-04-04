import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TimeSeriesForecast from "@/components/data/time-series-forecast";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/hooks/use-dark-mode", () => ({ useDarkMode: jest.fn(() => false) }));
jest.mock("@/lib/duckdb/client", () => ({ runQuery: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/utils/export", () => ({ downloadFile: jest.fn() }));
jest.mock("@/lib/api/analytics", () => ({ forecast: jest.fn(() => Promise.reject(new Error("not available"))) }));
jest.mock("echarts-for-react/lib/core", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => <div data-testid="echart" data-option={JSON.stringify(props.option)} />,
}));
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
    uniqueCount: 8,
    sampleValues: ["2026-01-01", "2026-01-02"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: [10, 12],
  },
];

const timeSeriesRows = [
  { bucket_date: "2026-01-01", metric_value: 10 },
  { bucket_date: "2026-01-02", metric_value: 12 },
  { bucket_date: "2026-01-03", metric_value: 14 },
  { bucket_date: "2026-01-04", metric_value: 18 },
  { bucket_date: "2026-01-05", metric_value: 20 },
];

async function renderAndGenerate(user: ReturnType<typeof userEvent.setup>) {
  mockRunQuery.mockResolvedValue(timeSeriesRows);

  await act(async () => {
    render(<TimeSeriesForecast tableName="orders" columns={columns} />);
  });

  // Click the backend toggle to turn it OFF (avoids the async rejection race)
  const backendToggle = screen.getByRole("button", { name: /backend/i });
  await user.click(backendToggle);

  await user.click(screen.getByRole("button", { name: "Generate forecast" }));

  await screen.findByText(/Projected 6 future periods using simple moving average\./i);
}

describe("TimeSeriesForecast", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunQuery.mockResolvedValue([]);
  });

  it("shows the empty guidance when compatible columns are missing", async () => {
    await act(async () => {
      render(
        <TimeSeriesForecast
          tableName="orders"
          columns={[
            {
              name: "status",
              type: "string",
              nullCount: 0,
              uniqueCount: 2,
              sampleValues: ["open", "closed"],
            },
          ]}
        />,
      );
    });

    expect(
      screen.getByText("Choose a date column and numeric column to build a forecast."),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("builds a forecast with confidence bands and preview rows", async () => {
    const user = userEvent.setup();
    await renderAndGenerate(user);

    expect(screen.getByTestId("echart")).toBeInTheDocument();
    expect(screen.getByText("Jan 6, 2026")).toBeInTheDocument();
  });

  it("exports the forecast as CSV", async () => {
    const user = userEvent.setup();
    await renderAndGenerate(user);

    const exportButton = screen.getByRole("button", { name: "Export CSV" });
    await user.click(exportButton);

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalledWith(
        expect.stringContaining("iso_date,type,actual,fitted,forecast,lower,upper"),
        "orders-revenue-forecast.csv",
        "text/csv;charset=utf-8;",
      );
    });
  });
});
