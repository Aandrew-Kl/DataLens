import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AnomalyDetector from "@/components/data/anomaly-detector";
import { runQuery } from "@/lib/duckdb/client";
import { exportToCSV } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

const mockChartInstance = {
  getDataURL: jest.fn(() => "data:image/png;base64,anomaly"),
};

const chartPropsSpy = jest.fn();

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/utils/export", () => ({
  exportToCSV: jest.fn(),
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
const mockExportToCSV = exportToCSV as jest.MockedFunction<typeof exportToCSV>;

const columns: ColumnProfile[] = [
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [10, 100],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: ["2026-01-01", "2026-01-06"],
  },
];

const pointRows = [
  { __row_id: 1, __metric: 10, amount: 10, created_at: "2026-01-01", category: "A", __date_value: null },
  { __row_id: 2, __metric: 10, amount: 10, created_at: "2026-01-02", category: "A", __date_value: null },
  { __row_id: 3, __metric: 10, amount: 10, created_at: "2026-01-03", category: "A", __date_value: null },
  { __row_id: 4, __metric: 10, amount: 10, created_at: "2026-01-04", category: "A", __date_value: null },
  { __row_id: 5, __metric: 10, amount: 10, created_at: "2026-01-05", category: "A", __date_value: null },
  { __row_id: 6, __metric: 100, amount: 100, created_at: "2026-01-06", category: "B", __date_value: null },
];

const timeSeriesRows = pointRows.map((row) => ({
  ...row,
  __date_value: row.created_at,
}));

function getOption(): Record<string, unknown> {
  const lastCall = chartPropsSpy.mock.calls.at(-1);
  return ((lastCall?.[0] as Record<string, unknown>)?.option ?? {}) as Record<string, unknown>;
}

describe("AnomalyDetector", () => {
  let anchorClickSpy: jest.SpiedFunction<typeof HTMLAnchorElement.prototype.click>;

  beforeAll(() => {
    anchorClickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
  });

  afterAll(() => {
    anchorClickSpy.mockRestore();
  });

  beforeEach(() => {
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue(pointRows);
    mockExportToCSV.mockReset();
    mockChartInstance.getDataURL.mockClear();
    chartPropsSpy.mockClear();
  });

  it("renders the empty detector state before analysis", () => {
    render(<AnomalyDetector tableName="orders" columns={columns} />);

    expect(
      screen.getByText(
        "Run the detector to plot normal observations and anomalies.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export CSV/i })).toBeDisabled();
  });

  it("flags outliers with the selected detection method", async () => {
    const user = userEvent.setup();

    render(<AnomalyDetector tableName="orders" columns={columns} />);

    await user.selectOptions(screen.getAllByRole("combobox")[1], "iqr");
    await user.click(screen.getByRole("button", { name: /Detect anomalies/i }));

    expect(await screen.findByText("Severity: severe")).toBeInTheDocument();
    expect(screen.getAllByText("Row 6")).toHaveLength(2);
    expect(screen.getAllByText(/amount: 100/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Export CSV/i })).toBeEnabled();
  });

  it("adds a time-series line and date axis when time-series mode is enabled", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) =>
      sql.includes('CAST("created_at" AS VARCHAR) AS __date_value')
        ? timeSeriesRows
        : pointRows,
    );

    render(<AnomalyDetector tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("checkbox", { name: /Time series mode/i }));
    await user.selectOptions(screen.getAllByRole("combobox")[1], "iqr");
    await user.click(screen.getByRole("button", { name: /Detect anomalies/i }));

    await waitFor(() => {
      expect(screen.getAllByText("2026-01-06")).toHaveLength(2);
    });

    await waitFor(() => {
      const option = getOption();
      const xAxis = option.xAxis as { name?: string };
      const series = option.series as Array<{ type?: string }>;
      expect(xAxis.name).toBe("created_at");
      expect(series[0]?.type).toBe("line");
    });
  });

  it("exports anomaly rows as CSV", async () => {
    const user = userEvent.setup();

    render(<AnomalyDetector tableName="orders" columns={columns} />);

    await user.selectOptions(screen.getAllByRole("combobox")[1], "iqr");
    await user.click(screen.getByRole("button", { name: /Detect anomalies/i }));
    await waitFor(() => {
      expect(screen.getAllByText("Row 6")).toHaveLength(2);
    });

    await user.click(screen.getByRole("button", { name: /Export CSV/i }));

    await waitFor(() => {
      expect(mockExportToCSV).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            __label: "Row 6",
            __severity: "severe",
            amount: 100,
            category: "B",
          }),
        ],
        "orders-amount-anomalies.csv",
      );
    });
  });

  it("exports the anomaly chart as a PNG", async () => {
    const user = userEvent.setup();

    render(<AnomalyDetector tableName="orders" columns={columns} />);

    await user.selectOptions(screen.getAllByRole("combobox")[1], "iqr");
    await user.click(screen.getByRole("button", { name: /Detect anomalies/i }));
    await screen.findByTestId("echart");

    fireEvent.click(screen.getByRole("button", { name: /^PNG$/i }));

    expect(mockChartInstance.getDataURL).toHaveBeenCalledWith(
      expect.objectContaining({
        backgroundColor: "#f8fafc",
        pixelRatio: 2,
        type: "png",
      }),
    );
  });

  it("shows analysis errors from DuckDB", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockRejectedValue(new Error("Detection failed"));

    render(<AnomalyDetector tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: /Detect anomalies/i }));

    expect(await screen.findByText("Detection failed")).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).not.toBeInTheDocument();
  });
});
