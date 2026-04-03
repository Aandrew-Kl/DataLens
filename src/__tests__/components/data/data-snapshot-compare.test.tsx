import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataSnapshotCompare from "@/components/data/data-snapshot-compare";
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
    uniqueCount: 20,
    sampleValues: [10, 20, 30],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [3, 6, 9],
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

function mockSuccessfulSnapshotQueries() {
  mockRunQuery.mockImplementation(async (sql) => {
    if (sql === "SHOW TABLES") {
      return [
        { name: "orders" },
        { name: "__snapshot_orders_baseline" },
      ];
    }

    if (sql.includes('DESCRIBE "orders"')) {
      return [
        { column_name: "amount", column_type: "DOUBLE" },
        { column_name: "profit", column_type: "INTEGER" },
        { column_name: "status", column_type: "VARCHAR" },
      ];
    }

    if (sql.includes('DESCRIBE "__snapshot_orders_baseline"')) {
      return [
        { column_name: "amount", column_type: "DOUBLE" },
        { column_name: "profit", column_type: "DOUBLE" },
        { column_name: "status", column_type: "BOOLEAN" },
        { column_name: "new_metric", column_type: "BIGINT" },
      ];
    }

    if (
      sql.includes("COUNT(*) AS row_count") &&
      sql.includes('FROM "orders"')
    ) {
      return [{ row_count: 120 }];
    }

    if (
      sql.includes("COUNT(*) AS row_count") &&
      sql.includes('FROM "__snapshot_orders_baseline"')
    ) {
      return [{ row_count: 110 }];
    }

    if (
      sql.includes('TRY_CAST("amount" AS DOUBLE) AS value') &&
      sql.includes('FROM "orders"')
    ) {
      return [{ value: 10 }, { value: 20 }, { value: 30 }, { value: 40 }];
    }

    if (
      sql.includes('TRY_CAST("amount" AS DOUBLE) AS value') &&
      sql.includes('FROM "__snapshot_orders_baseline"')
    ) {
      return [{ value: 12 }, { value: 18 }, { value: 36 }, { value: 44 }];
    }

    if (
      sql.includes('TRY_CAST("profit" AS DOUBLE) AS value') &&
      sql.includes('FROM "orders"')
    ) {
      return [{ value: 4 }, { value: 8 }, { value: 12 }, { value: 16 }];
    }

    if (
      sql.includes('TRY_CAST("profit" AS DOUBLE) AS value') &&
      sql.includes('FROM "__snapshot_orders_baseline"')
    ) {
      return [{ value: 5 }, { value: 9 }, { value: 14 }, { value: 17 }];
    }

    return [];
  });
}

async function renderCompare() {
  await act(async () => {
    render(<DataSnapshotCompare tableName="orders" columns={columns} />);
  });
}

describe("DataSnapshotCompare", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("shows the empty state when no matching snapshot tables exist", async () => {
    mockRunQuery.mockResolvedValue([{ name: "orders" }, { name: "customers" }]);

    await renderCompare();

    expect(
      await screen.findByText("No snapshot tables available for comparison yet."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).not.toBeInTheDocument();
  });

  it("renders the schema diff table and default histogram for the first shared metric", async () => {
    mockSuccessfulSnapshotQueries();

    await renderCompare();

    expect(
      await screen.findByText("Value distribution comparison"),
    ).toBeInTheDocument();
    expect(screen.getByText("Column diff table")).toBeInTheDocument();
    expect(screen.getByText("new_metric")).toBeInTheDocument();
    expect(screen.getAllByText("type changed").length).toBeGreaterThan(0);

    await waitFor(() => {
      const option = getChartOption();
      const xAxis = option.xAxis as Record<string, unknown>;
      const series = option.series as Array<Record<string, unknown>>;

      expect(xAxis.name).toBe("amount");
      expect(series[0]?.name).toBe("orders");
      expect(series[1]?.name).toBe("__snapshot_orders_baseline");
    });
  });

  it("switches the shared metric and exports the comparison report", async () => {
    const user = userEvent.setup();
    mockSuccessfulSnapshotQueries();

    await renderCompare();
    await screen.findByText("Value distribution comparison");

    await act(async () => {
      await user.selectOptions(screen.getByLabelText(/Shared metric/i), "profit");
    });

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('TRY_CAST("profit" AS DOUBLE) AS value'),
      );
    });

    await user.click(
      screen.getByRole("button", { name: /Export comparison report/i }),
    );

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("summary,left_row_count,120"),
      "orders-vs-__snapshot_orders_baseline-snapshot-comparison.csv",
      "text/csv;charset=utf-8;",
    );
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("diff,status,VARCHAR,BOOLEAN,type-changed"),
      "orders-vs-__snapshot_orders_baseline-snapshot-comparison.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("surfaces comparison failures from DuckDB", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql === "SHOW TABLES") {
        return [
          { name: "orders" },
          { name: "__snapshot_orders_baseline" },
        ];
      }

      throw new Error("Schema lookup failed");
    });

    await renderCompare();

    expect(await screen.findByText("Schema lookup failed")).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).not.toBeInTheDocument();
  });
});
