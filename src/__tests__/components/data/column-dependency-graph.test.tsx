import { act } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ColumnDependencyGraph from "@/components/data/column-dependency-graph";
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
      return React.createElement("div", { "data-testid": "dependency-graph-chart" });
    },
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ GraphChart: {} }));
jest.mock("echarts/components", () => ({
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "user_id",
    type: "number",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: [1, 2, 3],
  },
  {
    name: "spend",
    type: "number",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: [10, 20, 30],
  },
  {
    name: "country",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["US", "CA", "GB"],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["North America", "Europe"],
  },
];

function mockDependencyQueries() {
  mockRunQuery.mockImplementation(async (sql) => {
    if (sql.includes("COUNT(*) AS row_count")) {
      return [{ row_count: 100 }];
    }

    if (sql.includes("source_name") && sql.includes("target_name")) {
      return [
        {
          source_name: "user_id",
          target_name: "country",
          pair_rows: 100,
          source_count: 100,
          target_count: 3,
          pair_count: 100,
        },
        {
          source_name: "country",
          target_name: "region",
          pair_rows: 100,
          source_count: 3,
          target_count: 2,
          pair_count: 3,
        },
      ];
    }

    if (sql.includes("TRY_CAST")) {
      return [
        { user_id: 1, spend: 10 },
        { user_id: 2, spend: 20 },
        { user_id: 3, spend: 30 },
        { user_id: 4, spend: 40 },
        { user_id: 5, spend: 50 },
        { user_id: 6, spend: 60 },
        { user_id: 7, spend: 70 },
        { user_id: 8, spend: 80 },
      ];
    }

    return [];
  });
}

async function renderGraph(targetColumns: ColumnProfile[] = columns) {
  await act(async () => {
    render(<ColumnDependencyGraph tableName="orders" columns={targetColumns} />);
  });
}

describe("ColumnDependencyGraph", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("shows an empty state when fewer than two columns are available", async () => {
    await renderGraph([columns[0]]);

    expect(
      screen.getByText(
        "Add at least two profiled columns before building a dependency graph.",
      ),
    ).toBeInTheDocument();
  });

  it("analyzes relationships, renders a graph, and shows node details", async () => {
    const user = userEvent.setup();
    mockDependencyQueries();

    await renderGraph();
    await user.click(
      screen.getByRole("button", { name: /analyze dependencies/i }),
    );

    expect(
      await screen.findByText("Dependency graph ready with 4 columns and 3 links."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dependency-graph-chart")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "country" }));

    expect(screen.getByText("Type: string")).toBeInTheDocument();
    expect(
      screen.getByText(
        "country functionally predicts region across 100% of distinct combinations.",
      ),
    ).toBeInTheDocument();

    const option = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
      series?: Array<{ type?: string }>;
    };
    expect(option.series?.[0]?.type).toBe("graph");
  });

  it("exports the dependency results as CSV", async () => {
    const user = userEvent.setup();
    mockDependencyQueries();

    await renderGraph();
    await user.click(
      screen.getByRole("button", { name: /analyze dependencies/i }),
    );
    await screen.findByText("Dependency graph ready with 4 columns and 3 links.");

    await user.click(screen.getByRole("button", { name: /export results/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("source,target,signal,strength,label,detail"),
      "orders-dependency-graph.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
