import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ColumnDependencyFinder from "@/components/data/column-dependency-finder";
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
    name: "user_id",
    type: "number",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: [1, 2, 3],
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

function mockSuccessfulDependencyQueries() {
  mockRunQuery.mockImplementation(async (sql) => {
    if (sql.includes("COUNT(*) AS row_count")) {
      return [{ row_count: 100 }];
    }

    if (sql.includes("determinant_name") && sql.includes("dependent_name")) {
      return [
        {
          determinant_name: "user_id",
          dependent_name: "country",
          pair_rows: 100,
          determinant_count: 100,
          dependent_count: 3,
          pair_count: 100,
        },
        {
          determinant_name: "country",
          dependent_name: "user_id",
          pair_rows: 100,
          determinant_count: 3,
          dependent_count: 100,
          pair_count: 100,
        },
        {
          determinant_name: "user_id",
          dependent_name: "region",
          pair_rows: 100,
          determinant_count: 100,
          dependent_count: 2,
          pair_count: 100,
        },
        {
          determinant_name: "region",
          dependent_name: "user_id",
          pair_rows: 100,
          determinant_count: 2,
          dependent_count: 100,
          pair_count: 100,
        },
        {
          determinant_name: "country",
          dependent_name: "region",
          pair_rows: 100,
          determinant_count: 3,
          dependent_count: 2,
          pair_count: 3,
        },
        {
          determinant_name: "region",
          dependent_name: "country",
          pair_rows: 100,
          determinant_count: 2,
          dependent_count: 3,
          pair_count: 3,
        },
      ];
    }

    return [];
  });
}

async function renderFinder(targetColumns: ColumnProfile[] = columns) {
  await act(async () => {
    render(
      <ColumnDependencyFinder tableName="orders" columns={targetColumns} />,
    );
  });
}

describe("ColumnDependencyFinder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("shows the empty state when fewer than two columns are available", async () => {
    await renderFinder([
      {
        name: "user_id",
        type: "number",
        nullCount: 0,
        uniqueCount: 100,
        sampleValues: [1, 2, 3],
      },
    ]);

    expect(
      screen.getByText(
        "Add at least two columns before checking functional dependencies.",
      ),
    ).toBeInTheDocument();
    expect(mockRunQuery).toHaveBeenCalledTimes(1);
  });

  it("renders the matrix, summary cards, and strongest dependency rows", async () => {
    mockSuccessfulDependencyQueries();

    await renderFinder();

    expect(await screen.findByText("Dependency matrix")).toBeInTheDocument();
    expect(screen.getByText("Perfect dependencies")).toBeInTheDocument();
    expect(screen.getByText("Potential key columns")).toBeInTheDocument();
    expect(screen.getByText("user_id -> country")).toBeInTheDocument();
    expect(screen.getAllByText("N:1").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Nearly unique and non-null, which is strong key-like behavior."),
    ).toBeInTheDocument();

    await waitFor(() => {
      const option = getChartOption();
      const xAxis = option.xAxis as Record<string, unknown>;
      const series = option.series as Array<Record<string, unknown>>;

      expect(xAxis.name).toBe("Dependent");
      expect(series[0]?.type).toBe("heatmap");
      expect(series[0]?.name).toBe("Dependency strength");
    });
  });

  it("exports the dependency report as CSV", async () => {
    const user = userEvent.setup();
    mockSuccessfulDependencyQueries();

    await renderFinder();

    await screen.findByText("Dependency matrix");
    await user.click(
      screen.getByRole("button", { name: /Export dependency CSV/i }),
    );

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("section,determinant,dependent,strength"),
      "orders-dependency-report.csv",
      "text/csv;charset=utf-8;",
    );
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("candidate,column,uniqueness_ratio"),
      "orders-dependency-report.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("surfaces dependency scan failures", async () => {
    mockRunQuery.mockRejectedValue(new Error("Dependency scan failed badly"));

    await renderFinder();

    expect(
      await screen.findByText("Dependency scan failed badly"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).not.toBeInTheDocument();
  });
});
