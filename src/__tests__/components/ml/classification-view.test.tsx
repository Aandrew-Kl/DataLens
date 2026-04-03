import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ClassificationView from "@/components/ml/classification-view";
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
jest.mock("echarts/charts", () => ({ HeatmapChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  TooltipComponent: {},
  VisualMapComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Enterprise", "SMB"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [100, 110],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [20, 22],
  },
  {
    name: "orders",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [4, 5],
  },
];

const classificationRows = [
  ...Array.from({ length: 10 }, (_, index) => ({
    target_label: "Enterprise",
    revenue: 100 + index * 2,
    profit: 30 + index,
    orders: 5 + index * 0.2,
  })),
  ...Array.from({ length: 10 }, (_, index) => ({
    target_label: "SMB",
    revenue: 300 + index * 2,
    profit: 90 + index,
    orders: 18 + index * 0.2,
  })),
];

async function renderAsync(targetColumns: ColumnProfile[] = columns) {
  await act(async () => {
    render(<ClassificationView tableName="orders" columns={targetColumns} />);
  });
}

describe("ClassificationView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("renders the KNN classification controls and empty chart", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Evaluate categorical prediction quality with K-nearest neighbors",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Choose a categorical target and numeric features, then run KNN classification.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
  });

  it("runs classification and updates the confusion matrix labels", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue(classificationRows);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Run analysis" }));

    expect(
      await screen.findByText("Evaluated 6 holdout predictions across 2 classes."),
    ).toBeInTheDocument();

    const lastOption = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
      xAxis?: { data?: string[] };
      yAxis?: { data?: string[] };
    };
    expect(lastOption.xAxis?.data).toEqual(["Enterprise", "SMB"]);
    expect(lastOption.yAxis?.data).toEqual(["Enterprise", "SMB"]);
  });

  it("exports the holdout predictions after a successful analysis", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue(classificationRows);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Run analysis" }));
    await screen.findByText("Evaluated 6 holdout predictions across 2 classes.");

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("actual,predicted,correct"),
      "orders-classification-predictions.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("shows an error when no numeric features remain selected", async () => {
    const user = userEvent.setup();

    await renderAsync();

    await user.click(screen.getByRole("button", { name: "revenue" }));
    await user.click(screen.getByRole("button", { name: "profit" }));
    await user.click(screen.getByRole("button", { name: "orders" }));
    await user.click(screen.getByRole("button", { name: "Run analysis" }));

    expect(
      screen.getByText("Select one target column and at least one numeric feature."),
    ).toBeInTheDocument();
  });
});
