import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import FeatureImportance from "@/components/ml/feature-importance";
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
jest.mock("echarts/charts", () => ({ BarChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [120, 140],
  },
  {
    name: "spend",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [50, 60],
  },
  {
    name: "discount",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [5, 7],
  },
];

const featureRows = Array.from({ length: 12 }, (_, index) => ({
  target_value: 100 + index * 10,
  spend: 50 + index * 5,
  discount: (index % 4) * 2,
}));

async function renderAsync(targetColumns: ColumnProfile[] = columns) {
  await act(async () => {
    render(<FeatureImportance tableName="orders" columns={targetColumns} />);
  });
}

describe("FeatureImportance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("renders the ranking workspace before analysis", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Rank numeric drivers with permutation-based signal loss",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pick a numeric target column, then run a permutation-based ranking.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("analyzes feature importance and orders the chart by strongest feature", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue(featureRows);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Run analysis" }));

    expect(
      await screen.findByText("Scored 2 features across 12 rows."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("spend").length).toBeGreaterThan(0);
    expect(screen.getAllByText("discount").length).toBeGreaterThan(0);

    const lastOption = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
      yAxis?: { data?: string[] };
    };
    expect(lastOption.yAxis?.data?.[0]).toBe("spend");
  });

  it("exports the scored feature table as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue(featureRows);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Run analysis" }));
    await screen.findByText("Scored 2 features across 12 rows.");

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("feature,permutation_importance,correlation_score"),
      "orders-feature-importance.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("shows a validation error when the target has no remaining numeric features", async () => {
    const user = userEvent.setup();

    await renderAsync([
      {
        name: "revenue",
        type: "number",
        nullCount: 0,
        uniqueCount: 5,
        sampleValues: [100, 110],
      },
    ]);

    await user.click(screen.getByRole("button", { name: "Run analysis" }));

    expect(
      screen.getByText("Choose a target with at least one remaining numeric feature."),
    ).toBeInTheDocument();
  });
});
