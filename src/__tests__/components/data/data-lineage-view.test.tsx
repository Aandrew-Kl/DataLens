import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import DataLineageView from "@/components/data/data-lineage-view";
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
  const React = require("react") as typeof import("react");
  return {
    __esModule: true,
    default: React.forwardRef(function MockChart(
      props: Record<string, unknown>,
      _ref: React.Ref<unknown>,
    ) {
      chartPropsSpy(props);
      return React.createElement("div", {
        "data-testid": "echart",
        "data-option": JSON.stringify(props.option ?? null),
      });
    }),
    chartPropsSpy,
  };
});
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ GraphChart: {} }));
jest.mock("echarts/components", () => ({ TooltipComponent: {} }));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);
const { chartPropsSpy } = jest.requireMock("echarts-for-react/lib/core") as {
  chartPropsSpy: jest.Mock;
};

const columns: ColumnProfile[] = [
  {
    name: "customer_id",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [1, 2],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["North", "South"],
  },
];

function installLineageMock() {
  mockRunQuery.mockImplementation(async (sql: string) => {
    if (sql === "SHOW TABLES") {
      return [{ name: "sales_rollup" }, { name: "orders" }, { name: "shipments" }];
    }
    if (sql.includes('DESCRIBE "sales_rollup"')) {
      return [{ column_name: "customer_id" }, { column_name: "region" }, { column_name: "revenue" }];
    }
    if (sql.includes('DESCRIBE "orders"')) {
      return [{ column_name: "customer_id" }, { column_name: "region" }, { column_name: "order_total" }];
    }
    if (sql.includes('DESCRIBE "shipments"')) {
      return [{ column_name: "customer_id" }, { column_name: "carrier" }];
    }
    if (sql.includes('COUNT(*) AS row_count FROM "sales_rollup"')) {
      return [{ row_count: 120 }];
    }
    if (sql.includes('COUNT(*) AS row_count FROM "orders"')) {
      return [{ row_count: 90 }];
    }
    if (sql.includes('COUNT(*) AS row_count FROM "shipments"')) {
      return [{ row_count: 150 }];
    }
    return [];
  });
}

async function renderAsync() {
  await act(async () => {
    render(<DataLineageView tableName="sales_rollup" columns={columns} />);
  });

  await waitFor(() => {
    expect(screen.getByTestId("echart")).toBeInTheDocument();
  });
}

function getLatestChartProps() {
  const latestCall = chartPropsSpy.mock.calls.at(-1);
  return (latestCall?.[0] ?? {}) as Record<string, unknown>;
}

describe("DataLineageView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
    installLineageMock();
  });

  it("renders lineage metrics and a graph option", async () => {
    await renderAsync();

    expect(screen.getByText("Trace provenance across related tables")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    const option = JSON.parse(screen.getByTestId("echart").getAttribute("data-option") ?? "{}") as {
      series?: Array<{ type?: string }>;
    };
    expect(option.series?.[0]?.type).toBe("graph");
  });

  it("updates the selected node details when a graph node is clicked", async () => {
    await renderAsync();

    const onEvents = getLatestChartProps().onEvents as { click?: (params: unknown) => void };
    await act(async () => {
      onEvents.click?.({ dataType: "node", data: { id: "orders" } });
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 3, name: "orders" })).toBeInTheDocument();
    });
  });

  it("exports the lineage map as JSON", async () => {
    await renderAsync();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export lineage map" }));
    });

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalledWith(
        expect.stringContaining('"tableName": "sales_rollup"'),
        "sales_rollup-lineage-map.json",
        "application/json;charset=utf-8;",
      );
    });
  });
});
