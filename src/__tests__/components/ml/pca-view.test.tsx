import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PCAView from "@/components/ml/pca-view";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

const chartPropsSpy = jest.fn();

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
    default: function MockChart(props: Record<string, unknown>) {
      chartPropsSpy(props);
      return React.createElement("div", { "data-testid": "echart" });
    },
  };
});
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ BarChart: {}, ScatterChart: {} }));
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
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 24,
    sampleValues: [100, 110],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 24,
    sampleValues: [30, 35],
  },
  {
    name: "orders",
    type: "number",
    nullCount: 0,
    uniqueCount: 24,
    sampleValues: [2, 3],
  },
];

const pcaRows = Array.from({ length: 20 }, (_, index) => ({
  revenue: 100 + index * 5,
  profit: 40 + index * 2,
  orders: 3 + index * 0.25,
}));

async function renderAsync() {
  await act(async () => {
    render(<PCAView tableName="orders" columns={columns} />);
  });
}

describe("PCAView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("renders the PCA workspace and disabled export state", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Run PCA on numeric feature space",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compute PCA" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export scores" })).toBeDisabled();
    expect(screen.getAllByTestId("echart")).toHaveLength(2);
  });

  it("computes PCA and renders the loading matrix", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue(pcaRows);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Compute PCA" }));

    expect(
      await screen.findByText(/Explained variance captured by first 2 components:/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText("revenue").length).toBeGreaterThan(0);
    expect(screen.getAllByText("profit").length).toBeGreaterThan(0);

    const varianceOption = chartPropsSpy.mock.calls[chartPropsSpy.mock.calls.length - 2]?.[0]
      ?.option as { xAxis?: { data?: string[] } };
    expect(varianceOption.xAxis?.data).toEqual(["PC1", "PC2", "PC3"]);
  });

  it("exports component scores as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue(pcaRows);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Compute PCA" }));
    await screen.findByText(/Explained variance captured by first 2 components:/i);

    await user.click(screen.getByRole("button", { name: "Export scores" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("row_index,pc1,pc2"),
      "orders-pca-scores.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
