import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";

import DataForecast from "@/components/data/data-forecast";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));
jest.mock("echarts-for-react/lib/core");
jest.mock("echarts/charts", () => ({ LineChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "day",
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
    sampleValues: [20, 25],
  },
];

function getChartOption() {
  const raw = screen.getByTestId("echart").getAttribute("data-option");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

const forecastRows = [
  { bucket_date: "2026-01-01", bucket_value: 100 },
  { bucket_date: "2026-01-02", bucket_value: 120 },
  { bucket_date: "2026-01-03", bucket_value: 130 },
  { bucket_date: "2026-01-04", bucket_value: 150 },
];

async function renderAsync(rows = forecastRows) {
  mockRunQuery.mockResolvedValue(rows);

  await act(async () => {
    render(<DataForecast tableName="sales" columns={columns} />);
  });

  await waitFor(
    () => {
      expect(screen.queryByText("Building forecast…")).not.toBeInTheDocument();
    },
    { timeout: 5000 },
  );
}

describe("DataForecast", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders forecast metrics and a line-chart option from time-series rows", async () => {
    await renderAsync();

    expect(screen.getByText("MAE")).toBeInTheDocument();
    expect(screen.getByText("Moving average")).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();

    const option = getChartOption();
    const series = option.series as Array<Record<string, unknown>>;
    expect(series).toHaveLength(5);
    expect(series[0]?.name).toBe("Actual");
    expect(series[4]?.name).toBe("Forecast");
  });

  it("updates the selected forecasting method", async () => {
    await renderAsync();

    expect(screen.getByText("Moving average")).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getAllByRole("combobox")[2] as HTMLSelectElement, {
        target: { value: "linear" },
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("Building forecast…")).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        (screen.getAllByRole("combobox")[2] as HTMLSelectElement).value,
      ).toBe("linear");
      expect(screen.getAllByText("Linear extrapolation").length).toBeGreaterThan(0);
    });
  });

  it("exports the computed forecast rows", async () => {
    const user = userEvent.setup();
    await renderAsync();

    await screen.findByText("Export forecast");
    await user.click(screen.getByRole("button", { name: /Export forecast/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("date,actual,fitted,forecast,lower,upper"),
      "sales-forecast.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("shows the insufficient-history error when too few periods exist", async () => {
    await renderAsync([
      { bucket_date: "2026-01-01", bucket_value: 100 },
      { bucket_date: "2026-01-02", bucket_value: 120 },
    ]);

    expect(
      screen.getByText("Forecasting needs at least three non-null time periods."),
    ).toBeInTheDocument();
  });

  it("rebuilds the chart option when dark mode changes", async () => {
    await renderAsync();

    expect(
      ((getChartOption().legend as Record<string, unknown>).textStyle as Record<string, unknown>)
        .color,
    ).toBe("#475569");

    await act(async () => {
      document.documentElement.classList.add("dark");
      fireEvent.click(document.body);
    });

    await waitFor(() => {
      expect(
        ((getChartOption().legend as Record<string, unknown>).textStyle as Record<string, unknown>)
          .color,
      ).toBe("#cbd5e1");
    });

    await act(async () => {
      document.documentElement.classList.remove("dark");
      fireEvent.click(document.body);
    });
  });
});
