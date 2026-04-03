import { act, render, screen } from "@testing-library/react";

import LogisticRegressionView from "@/components/ml/logistic-regression-view";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/hooks/use-dark-mode", () => ({
  useDarkMode: jest.fn().mockReturnValue(false),
}));
jest.mock("echarts-for-react/lib/core", () => ({ __esModule: true, default: () => null }));
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ LineChart: {}, BarChart: {} }));
jest.mock("echarts/components", () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {} }));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "feature",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [1, 2],
  },
  {
    name: "target",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["yes", "no"],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<LogisticRegressionView tableName="orders" columns={columns} />);
  });
}

describe("LogisticRegressionView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the logistic regression workspace", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Estimate class probabilities and inspect the ROC trade-off",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Choose a binary target, pick numeric features, and fit the logistic model."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("feature")).toHaveLength(1);
    expect(screen.getAllByText("target")).toHaveLength(1);
    expect(screen.getByLabelText("feature")).toBeInTheDocument();
    expect(screen.getByLabelText("target")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fit model" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});
