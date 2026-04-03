import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import SchemaEvolution from "@/components/data/schema-evolution";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));
jest.mock("echarts-for-react/lib/core", () => {
  const chartPropsSpy = jest.fn();
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      chartPropsSpy(props);
      return null;
    },
    chartPropsSpy,
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
const { chartPropsSpy } = jest.requireMock("echarts-for-react/lib/core") as {
  chartPropsSpy: jest.Mock;
};

const schemaColumns: ColumnProfile[] = [
  {
    name: "order_id",
    type: "number",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: [1, 2, 3],
  },
];

async function renderSchema() {
  await act(async () => {
    render(<SchemaEvolution tableName="orders" columns={schemaColumns} />);
  });
}

function mockSchemaQueries() {
  mockRunQuery.mockImplementation(async (sql) => {
    if (sql === "SHOW TABLES") {
      return [
        { name: "orders" },
        { name: "__snapshot_orders_baseline" },
        { name: "__snapshot_orders_q2" },
      ];
    }

    if (sql === 'DESCRIBE "orders"') {
      return [
        { column_name: "order_id", column_type: "BIGINT" },
        { column_name: "amount", column_type: "DOUBLE" },
        { column_name: "status", column_type: "VARCHAR" },
      ];
    }

    if (sql === 'DESCRIBE "__snapshot_orders_baseline"') {
      return [
        { column_name: "order_id", column_type: "BIGINT" },
        { column_name: "status", column_type: "BOOLEAN" },
        { column_name: "legacy_code", column_type: "VARCHAR" },
      ];
    }

    if (sql === 'DESCRIBE "__snapshot_orders_q2"') {
      return [
        { column_name: "order_id", column_type: "BIGINT" },
        { column_name: "amount", column_type: "DOUBLE" },
      ];
    }

    return [];
  });
}

describe("SchemaEvolution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("shows an empty state when no snapshot tables exist", async () => {
    mockRunQuery.mockResolvedValue([{ name: "orders" }, { name: "customers" }]);

    await renderSchema();

    expect(
      await screen.findByText("No snapshot tables were found with the `__snapshot_` prefix."),
    ).toBeInTheDocument();
  });

  it("renders timeline counts and schema diff details", async () => {
    mockSchemaQueries();

    await renderSchema();

    expect(await screen.findByText("Snapshot timeline")).toBeInTheDocument();
    expect(screen.getByText("legacy_code")).toBeInTheDocument();
    expect(screen.getByText("Current: VARCHAR")).toBeInTheDocument();
    expect(screen.getByText("Snapshot: BOOLEAN")).toBeInTheDocument();

    await waitFor(() => {
      const latestCall = chartPropsSpy.mock.calls.at(-1);
      const props = (latestCall?.[0] ?? {}) as {
        option?: { xAxis?: { data?: string[] } };
      };

      expect(props.option?.xAxis?.data).toEqual(
        expect.arrayContaining(["orders baseline", "orders q2"]),
      );
    });
  });

  it("switches the active snapshot from the chart event and exports the diff", async () => {
    mockSchemaQueries();

    await renderSchema();
    await screen.findByText("Snapshot timeline");

    const latestCall = chartPropsSpy.mock.calls.at(-1);
    const props = (latestCall?.[0] ?? {}) as {
      onEvents?: { click?: (params: unknown) => void };
    };

    await act(async () => {
      props.onEvents?.click?.({ name: "orders q2" });
    });

    await waitFor(() => {
      expect(screen.getByText("orders q2")).toBeInTheDocument();
      expect(screen.getByText("No columns were removed relative to this snapshot.")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export schema diff" }));
    });

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("summary,orders,__snapshot_orders_q2,1,0,0,2"),
      "orders-__snapshot_orders_q2-schema-diff.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
