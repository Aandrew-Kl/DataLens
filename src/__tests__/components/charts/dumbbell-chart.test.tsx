import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DumbbellChart from "@/components/charts/dumbbell-chart";
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
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["SMB", "Enterprise"],
  },
  {
    name: "min_sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [10, 20],
  },
  {
    name: "max_sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [20, 40],
  },
];

async function renderComponent() {
  await act(async () => {
    render(<DumbbellChart tableName="orders" columns={columns} />);
  });
}

describe("DumbbellChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the dumbbell chart shell", async () => {
    await renderComponent();

    expect(screen.getByText("Show the gap between two values for every category")).toBeInTheDocument();
  });

  it("builds a dumbbell chart from min and max values", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { category_label: "SMB", min_value: 10, max_value: 20 },
      { category_label: "Enterprise", min_value: 15, max_value: 35 },
    ]);

    await renderComponent();
    await user.click(screen.getByRole("button", { name: /Build dumbbell chart/i }));

    expect(await screen.findByTestId("echart")).toBeInTheDocument();
    expect(screen.getByText("Widest Spread")).toBeInTheDocument();
  });

  it("exports dumbbell chart data as CSV and PNG", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([{ category_label: "SMB", min_value: 10, max_value: 20 }]);

    await renderComponent();
    await user.click(screen.getByRole("button", { name: /Build dumbbell chart/i }));
    await screen.findByTestId("echart");
    await user.click(screen.getByRole("button", { name: /Export CSV/i }));
    await user.click(screen.getByRole("button", { name: /Export PNG/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("category,min_value,max_value,spread"),
      "orders-dumbbell-chart.csv",
      "text/csv;charset=utf-8;",
    );
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.any(Array),
      "orders-dumbbell-chart.png",
      "image/png",
    );
  });
});
