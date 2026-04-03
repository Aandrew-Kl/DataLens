import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AnomalyDetector from "@/components/ml/anomaly-detector";
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
      return React.createElement("div", { "data-testid": "anomaly-chart" });
    },
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({
  BarChart: {},
  ScatterChart: {},
}));
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
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [10, 100],
  },
  {
    name: "margin",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [4, 20],
  },
];

const metricRows = [
  { __row_id: 1, __metric_value: 10, amount: 10, status: "ok" },
  { __row_id: 2, __metric_value: 10, amount: 10, status: "ok" },
  { __row_id: 3, __metric_value: 10, amount: 10, status: "ok" },
  { __row_id: 4, __metric_value: 10, amount: 10, status: "ok" },
  { __row_id: 5, __metric_value: 10, amount: 10, status: "ok" },
  { __row_id: 6, __metric_value: 100, amount: 100, status: "outlier" },
];

async function renderDetector(targetColumns: ColumnProfile[] = columns) {
  await act(async () => {
    render(<AnomalyDetector tableName="orders" columns={targetColumns} />);
  });
}

describe("ML AnomalyDetector", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
    mockRunQuery.mockResolvedValue(metricRows);
  });

  it("renders the detector workspace before analysis", async () => {
    await renderDetector();

    expect(
      screen.getByText(
        "Run anomaly detection to compare values against the selected z-score threshold.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /export outlier rows csv/i }),
    ).toBeDisabled();
  });

  it("flags outliers and renders the distribution chart", async () => {
    const user = userEvent.setup();

    await renderDetector();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /sigma threshold/i }),
      "2",
    );
    await user.click(screen.getByRole("button", { name: /detect anomalies/i }));

    expect(
      await screen.findByText("Flagged 1 outliers at 2σ in 6 sampled rows."),
    ).toBeInTheDocument();
    expect(screen.getByText("Row 6")).toBeInTheDocument();
    expect(screen.getByText("16.7%")).toBeInTheDocument();

    const option = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
      series?: Array<{ type?: string }>;
    };
    expect(option.series?.[0]?.type).toBe("bar");
    expect(option.series?.[1]?.type).toBe("scatter");
  });

  it("exports the flagged outlier rows as CSV", async () => {
    const user = userEvent.setup();

    await renderDetector();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /sigma threshold/i }),
      "2",
    );
    await user.click(screen.getByRole("button", { name: /detect anomalies/i }));
    await screen.findByText("Flagged 1 outliers at 2σ in 6 sampled rows.");

    await user.click(
      screen.getByRole("button", { name: /export outlier rows csv/i }),
    );

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalledWith(
        expect.stringContaining("__z_score"),
        "orders-amount-outliers.csv",
        "text/csv;charset=utf-8;",
      );
    });
  });
});
