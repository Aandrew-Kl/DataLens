import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MarketBasketAnalysis from "@/components/analytics/market-basket-analysis";
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

jest.mock("framer-motion", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    motion: new Proxy(
      {},
      {
        get: (_target, tag) =>
          React.forwardRef(function MockMotion(
            props: Record<string, unknown> & { children?: ReactNode },
            ref: React.Ref<Element>,
          ) {
            return React.createElement(String(tag), { ...props, ref }, props.children);
          }),
      },
    ),
  };
});

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
jest.mock("echarts/charts", () => ({ GraphChart: {} }));
jest.mock("echarts/components", () => ({ TooltipComponent: {} }));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "transaction_id",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["T1", "T2"],
  },
  {
    name: "item_name",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Bread", "Milk"],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<MarketBasketAnalysis tableName="orders" columns={columns} />);
  });
}

describe("MarketBasketAnalysis", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("renders the market basket controls and empty chart", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Surface frequent item pairs and their association strength",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze baskets" })).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
  });

  it("computes top item pairs and updates the association network option", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { transaction_id: "T1", item_name: "Bread" },
      { transaction_id: "T1", item_name: "Milk" },
      { transaction_id: "T2", item_name: "Bread" },
      { transaction_id: "T2", item_name: "Butter" },
      { transaction_id: "T3", item_name: "Bread" },
      { transaction_id: "T3", item_name: "Milk" },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Analyze baskets" }));

    expect(await screen.findByText(/Analyzed 3 transactions and ranked 2 item pairs/i)).toBeInTheDocument();
    expect(screen.getByText("Bread + Milk")).toBeInTheDocument();

    const option = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
      series?: Array<{ type?: string; links?: unknown[] }>;
    };
    expect(option.series?.[0]?.type).toBe("graph");
    expect(option.series?.[0]?.links).toHaveLength(2);
  });

  it("exports the pair metrics as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { transaction_id: "T1", item_name: "Bread" },
      { transaction_id: "T1", item_name: "Milk" },
      { transaction_id: "T2", item_name: "Bread" },
      { transaction_id: "T2", item_name: "Butter" },
      { transaction_id: "T3", item_name: "Bread" },
      { transaction_id: "T3", item_name: "Milk" },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Analyze baskets" }));
    await screen.findByText(/Analyzed 3 transactions/i);

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("left_item,right_item,pair_count,support,confidence"),
      "orders-market-basket.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
