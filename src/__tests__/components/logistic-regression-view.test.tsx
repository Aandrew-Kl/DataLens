import { act } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import LogisticRegressionView from "@/components/ml/logistic-regression-view";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

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
    default: function MockChart() {
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
    name: "converted",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["yes", "no"],
  },
  {
    name: "feature_a",
    type: "number",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: [0.1, 0.2, 1.2],
  },
  {
    name: "feature_b",
    type: "number",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: [0.2, 0.3, 1.3],
  },
];

async function renderAsync(targetColumns = columns) {
  await act(async () => {
    render(<LogisticRegressionView tableName="orders" columns={targetColumns} />);
  });
}

describe("LogisticRegressionView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the empty state when the required columns are missing", async () => {
    await renderAsync([
      {
        name: "region",
        type: "string",
        nullCount: 0,
        uniqueCount: 3,
        sampleValues: ["West", "East"],
      },
    ]);

    expect(
      screen.getByText(
        "Logistic regression needs one binary target column and at least one numeric feature column.",
      ),
    ).toBeInTheDocument();
  });

  it("fits a logistic model and renders its diagnostics", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { target_value: "no", feature_a: 0.1, feature_b: 0.2 },
      { target_value: "no", feature_a: 0.2, feature_b: 0.1 },
      { target_value: "no", feature_a: 0.3, feature_b: 0.2 },
      { target_value: "no", feature_a: 0.5, feature_b: 0.4 },
      { target_value: "yes", feature_a: 1.2, feature_b: 1.1 },
      { target_value: "yes", feature_a: 1.3, feature_b: 1.2 },
      { target_value: "yes", feature_a: 1.5, feature_b: 1.4 },
      { target_value: "yes", feature_a: 1.6, feature_b: 1.5 },
    ]);

    await renderAsync();

    await user.click(screen.getByRole("button", { name: "Fit model" }));

    expect(await screen.findByText("Confusion matrix")).toBeInTheDocument();
    expect(screen.getByText("feature_a")).toBeInTheDocument();
    expect(screen.getByText("AUC")).toBeInTheDocument();
  });

  it("exports the prediction table as CSV", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { target_value: "no", feature_a: 0.1, feature_b: 0.2 },
      { target_value: "no", feature_a: 0.2, feature_b: 0.1 },
      { target_value: "no", feature_a: 0.3, feature_b: 0.2 },
      { target_value: "no", feature_a: 0.5, feature_b: 0.4 },
      { target_value: "yes", feature_a: 1.2, feature_b: 1.1 },
      { target_value: "yes", feature_a: 1.3, feature_b: 1.2 },
      { target_value: "yes", feature_a: 1.5, feature_b: 1.4 },
      { target_value: "yes", feature_a: 1.6, feature_b: 1.5 },
    ]);

    await renderAsync();

    await user.click(screen.getByRole("button", { name: "Fit model" }));
    await screen.findByText("Confusion matrix");
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("actual,predicted,probability,correct"),
      "orders-converted-logistic-regression.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
