import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import LollipopChart from "@/components/charts/lollipop-chart";
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
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: React.forwardRef(function MockChart(
      _props: Record<string, unknown>,
      ref: React.Ref<{ getEchartsInstance: () => { getDataURL: () => string } }>,
    ) {
      React.useImperativeHandle(ref, () => ({
        getEchartsInstance: () => ({
          getDataURL: () => "data:image/png;base64,QQ==",
        }),
      }));
      return React.createElement("div", { "data-testid": "echart" });
    }),
  };
});
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ CustomChart: {}, ScatterChart: {} }));
jest.mock("echarts/components", () => ({ GridComponent: {}, TooltipComponent: {} }));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["East", "West"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [10, 20],
  },
];

async function renderComponent() {
  await act(async () => {
    render(<LollipopChart tableName="orders" columns={columns} />);
  });
}

describe("LollipopChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the lollipop chart shell", async () => {
    await renderComponent();

    expect(
      screen.getByText("Rank categories with stems and dots instead of full bars"),
    ).toBeInTheDocument();
  });

  it("builds lollipop rows from aggregated category values", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { category_label: "East", metric_value: 20 },
      { category_label: "West", metric_value: 10 },
    ]);

    await renderComponent();
    await user.click(screen.getByRole("button", { name: /Build lollipop chart/i }));

    expect(await screen.findByText("Lollipop Plot")).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("exports lollipop chart data as CSV and PNG", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([{ category_label: "East", metric_value: 20 }]);

    await renderComponent();
    await user.click(screen.getByRole("button", { name: /Build lollipop chart/i }));
    await screen.findByTestId("echart");
    await user.click(screen.getByRole("button", { name: /Export CSV/i }));
    await user.click(screen.getByRole("button", { name: /Export PNG/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("category,value"),
      "orders-lollipop-chart.csv",
      "text/csv;charset=utf-8;",
    );
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.any(Array),
      "orders-lollipop-chart.png",
      "image/png",
    );
  });
});
