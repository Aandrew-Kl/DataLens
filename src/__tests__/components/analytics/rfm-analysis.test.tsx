import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RfmAnalysis from "@/components/analytics/rfm-analysis";
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
jest.mock("echarts/charts", () => ({
  BarChart: {},
  ScatterChart: {},
}));
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
    name: "purchase_date",
    type: "date",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: [],
  },
  {
    name: "customer_id",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["u1", "u2"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: [100, 200],
  },
];

const rfmRows = [
  { __rfm_date: "2026-03-01", __rfm_user_id: "u1", __rfm_amount: 100 },
  { __rfm_date: "2026-03-20", __rfm_user_id: "u1", __rfm_amount: 200 },
  { __rfm_date: "2026-02-10", __rfm_user_id: "u2", __rfm_amount: 50 },
  { __rfm_date: "2026-01-05", __rfm_user_id: "u3", __rfm_amount: 400 },
  { __rfm_date: "2026-01-25", __rfm_user_id: "u3", __rfm_amount: 50 },
];

async function renderAsync() {
  await act(async () => {
    render(<RfmAnalysis tableName="orders" columns={columns} />);
  });
}

describe("RfmAnalysis", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
    mockRunQuery.mockResolvedValue(rfmRows);
  });

  it("renders the initial RFM guidance", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Recency, frequency, and monetary scoring",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Choose a date, user, and amount column to score customers."),
    ).toHaveLength(2);
  });

  it("scores customers and renders both RFM charts", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Score customers" }));

    expect(
      await screen.findByText("Scored 3 customers into 2 segments."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Loyal").length).toBeGreaterThan(0);
    expect(screen.getByText("30.67 days")).toBeInTheDocument();
    expect(screen.getAllByTestId("echart")).toHaveLength(2);

    const options = chartPropsSpy.mock.calls.map(
      (call) =>
        (call[0] as { option?: { series?: Array<{ type?: string }> } }).option,
    );
    expect(options.some((option) => option?.series?.[0]?.type === "scatter")).toBe(true);
    expect(options.some((option) => option?.series?.[0]?.type === "bar")).toBe(true);
  });

  it("exports the scored customer rows as CSV", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Score customers" }));
    await screen.findByText("Scored 3 customers into 2 segments.");

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalledWith(
        expect.stringContaining("user_id,recency_days,frequency"),
        "orders-rfm-analysis.csv",
        "text/csv;charset=utf-8;",
      );
    });
  });
});
