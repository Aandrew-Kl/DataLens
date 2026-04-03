import {
  act,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TimeSeriesDecomposer from "@/components/data/time-series-decomposer";
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
    default: React.forwardRef(function MockChart(
      props: Record<string, unknown>,
      _ref: React.Ref<unknown>,
    ) {
      chartPropsSpy(props);
      return React.createElement("div", { "data-testid": "echart" });
    }),
  };
});

jest.mock("echarts/charts", () => ({}));
jest.mock("echarts/components", () => ({}));
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/renderers", () => ({}));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: ["2024-01-01", "2024-01-02"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: [10, 20, 10],
  },
];

function getChartOption() {
  const lastCall = chartPropsSpy.mock.calls.at(-1);
  const firstArg = lastCall?.[0];

  if (
    typeof firstArg === "object" &&
    firstArg !== null &&
    "option" in firstArg &&
    typeof firstArg.option === "object" &&
    firstArg.option !== null
  ) {
    return firstArg.option as Record<string, unknown>;
  }

  return {};
}

async function renderAsync(targetColumns = columns) {
  await act(async () => {
    render(<TimeSeriesDecomposer tableName="orders" columns={targetColumns} />);
  });

  await waitFor(() => {
    expect(
      screen.queryByText("Decomposing the time series…"),
    ).not.toBeInTheDocument();
  });
}

describe("TimeSeriesDecomposer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("shows the empty state when date or numeric columns are missing", () => {
    render(
      <TimeSeriesDecomposer
        tableName="orders"
        columns={[
          {
            name: "segment",
            type: "string",
            nullCount: 0,
            uniqueCount: 3,
            sampleValues: ["A", "B"],
          },
        ]}
      />,
    );

    expect(
      screen.getByText(
        "Time series decomposition requires at least one date column and one numeric column.",
      ),
    ).toBeInTheDocument();
  });

  it("loads a decomposition with detected period and stationarity", async () => {
    mockRunQuery.mockResolvedValue([
      { bucket_date: "2024-01-01", bucket_value: 10 },
      { bucket_date: "2024-01-02", bucket_value: 20 },
      { bucket_date: "2024-01-03", bucket_value: 10 },
      { bucket_date: "2024-01-04", bucket_value: 20 },
      { bucket_date: "2024-01-05", bucket_value: 10 },
      { bucket_date: "2024-01-06", bucket_value: 20 },
      { bucket_date: "2024-01-07", bucket_value: 10 },
      { bucket_date: "2024-01-08", bucket_value: 20 },
    ]);

    await renderAsync();

    expect(
      await screen.findByText("Auto-detected period: 2 observations"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Likely stationary/i)).toBeInTheDocument();

    const option = getChartOption();
    const series = option.series as Array<{ type?: string }>;
    expect(series).toHaveLength(3);
    expect(series[0]?.type).toBe("line");
  });

  it("exports the decomposition as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { bucket_date: "2024-01-01", bucket_value: 10 },
      { bucket_date: "2024-01-02", bucket_value: 20 },
      { bucket_date: "2024-01-03", bucket_value: 10 },
      { bucket_date: "2024-01-04", bucket_value: 20 },
      { bucket_date: "2024-01-05", bucket_value: 10 },
      { bucket_date: "2024-01-06", bucket_value: 20 },
    ]);

    await renderAsync();

    await user.click(
      screen.getByRole("button", { name: /Export decomposition CSV/i }),
    );

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("date,original,trend,seasonal,residual"),
      "orders-sales-time-series-decomposition.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("surfaces query failures", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("Series decomposition failed"));

    await renderAsync();

    expect(
      await screen.findByText("Series decomposition failed"),
    ).toBeInTheDocument();
  });
});
