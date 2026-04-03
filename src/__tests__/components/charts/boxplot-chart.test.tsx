import {
  act,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import BoxplotChart from "@/components/charts/boxplot-chart";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: React.forwardRef(function MockChart(
      props: Record<string, unknown>,
      _ref: React.Ref<unknown>,
    ) {
      return React.createElement("div", { "data-testid": "echart" });
    }),
  };
});
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({
  BoxplotChart: {},
  ScatterChart: {},
}));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);

const chartColumns: ColumnProfile[] = [
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 40,
    sampleValues: [10, 20],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 40,
    sampleValues: [2, 4],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["East", "West"],
  },
];

function installBoxplotMock() {
  mockRunQuery.mockImplementation(async (sql) => {
    if (sql.includes("COALESCE(whiskers.whisker_min, whiskers.raw_min)")) {
      return [
        {
          metric_name: "sales",
          group_label: "All rows",
          row_count: 50,
          mean_value: 56,
          q1_value: 35,
          median_value: 50,
          q3_value: 68,
          raw_min: 10,
          raw_max: 120,
          whisker_min: 12,
          whisker_max: 98,
          outlier_count: 1,
        },
        {
          metric_name: "profit",
          group_label: "All rows",
          row_count: 50,
          mean_value: 22,
          q1_value: 12,
          median_value: 20,
          q3_value: 28,
          raw_min: -5,
          raw_max: 60,
          whisker_min: 0,
          whisker_max: 45,
          outlier_count: 0,
        },
      ];
    }
    if (sql.includes("outlier_rank <= 18")) {
      return [{ metric_name: "sales", group_label: "All rows", metric_value: 120 }];
    }
    if (sql.includes("sample_rank <= 42")) {
      return [
        { metric_name: "sales", group_label: "All rows", metric_value: 48 },
        { metric_name: "profit", group_label: "All rows", metric_value: 18 },
      ];
    }
    return [];
  });
}

async function renderBoxplot(columns: ColumnProfile[]) {
  await act(async () => {
    render(<BoxplotChart tableName="orders" columns={columns} />);
  });

  await waitFor(() => {
    expect(screen.queryByText("Loading box plot…")).not.toBeInTheDocument();
  });
}

describe("BoxplotChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the chart shell and statistical summaries", async () => {
    installBoxplotMock();

    await renderBoxplot(chartColumns);

    expect(
      await screen.findByText("Compare median, quartiles, whiskers, and outliers"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
    expect(screen.getByText("Median: 50")).toBeInTheDocument();
    expect(screen.getByText("Median: 20")).toBeInTheDocument();
  });

  it("skips the sample-point query when overlay points are disabled", async () => {
    const user = userEvent.setup();

    installBoxplotMock();
    await renderBoxplot(chartColumns);

    mockRunQuery.mockClear();

    await user.click(
      screen.getByRole("checkbox", { name: /overlay points/i }),
    );

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledTimes(2);
    });

    expect(
      mockRunQuery.mock.calls.every(
        ([sql]) => !String(sql).includes("sample_rank <= 42"),
      ),
    ).toBe(true);
  });

  it("shows a validation error when there are no numeric columns", async () => {
    await renderBoxplot([
      {
        name: "region",
        type: "string",
        nullCount: 0,
        uniqueCount: 2,
        sampleValues: ["East", "West"],
      },
    ]);

    expect(
      await screen.findByText("Choose at least one numeric column to render a box plot."),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("surfaces query failures in the panel", async () => {
    mockRunQuery.mockRejectedValue(new Error("Boxplot failed"));

    await renderBoxplot(chartColumns);

    expect(await screen.findByText("Boxplot failed")).toBeInTheDocument();
  });
});
