import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CustomerLifetimeValue from "@/components/analytics/customer-lifetime-value";
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
    name: "customer_id",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["c1", "c2"],
  },
  {
    name: "order_date",
    type: "date",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: ["2026-01-01", "2026-02-01"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [200, 300],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<CustomerLifetimeValue tableName="orders" columns={columns} />);
  });
}

describe("CustomerLifetimeValue", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("renders the CLV workspace before calculations run", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Estimate customer lifetime value from observed revenue",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
  });

  it("calculates CLV tiers and renders the distribution chart", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { user_id: "c1", order_date: "2026-01-01", revenue_value: 200 },
      { user_id: "c1", order_date: "2026-02-01", revenue_value: 300 },
      { user_id: "c1", order_date: "2026-03-01", revenue_value: 400 },
      { user_id: "c2", order_date: "2026-03-01", revenue_value: 100 },
      { user_id: "c2", order_date: "2026-03-15", revenue_value: 120 },
      { user_id: "c3", order_date: "2026-03-20", revenue_value: 50 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Calculate CLV" }));

    expect(
      await screen.findByText("Calculated CLV for 3 customers across 3 tiers."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("c1").length).toBeGreaterThan(0);

    await waitFor(() => {
      const option = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
        xAxis?: { data?: string[] };
      };
      expect(option.xAxis?.data).toEqual(["Core", "Growth", "High Value", "VIP"]);
    });
  });

  it("exports the CLV table as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { user_id: "c1", order_date: "2026-01-01", revenue_value: 200 },
      { user_id: "c1", order_date: "2026-02-01", revenue_value: 300 },
      { user_id: "c1", order_date: "2026-03-01", revenue_value: 400 },
      { user_id: "c2", order_date: "2026-03-01", revenue_value: 100 },
      { user_id: "c2", order_date: "2026-03-15", revenue_value: 120 },
      { user_id: "c3", order_date: "2026-03-20", revenue_value: 50 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Calculate CLV" }));
    await screen.findByText("Calculated CLV for 3 customers across 3 tiers.");
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("user_id,total_revenue,order_count,average_order_value,clv,tier"),
      "orders-customer-lifetime-value.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
