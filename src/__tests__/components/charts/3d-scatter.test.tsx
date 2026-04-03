import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Scatter3D from "@/components/charts/3d-scatter";
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
      ref: React.Ref<unknown>,
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
jest.mock("echarts/charts", () => ({ ScatterChart: {} }));
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
    name: "x_metric",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [1, 2],
  },
  {
    name: "y_metric",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [3, 4],
  },
  {
    name: "z_metric",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [5, 6],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["A", "B"],
  },
];

async function renderComponent(nextColumns = columns) {
  await act(async () => {
    render(<Scatter3D tableName="orders" columns={nextColumns} />);
  });
}

describe("Scatter3D", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the projected fallback view and summary cards", async () => {
    mockRunQuery.mockResolvedValueOnce([
      { x_value: 1, y_value: 2, z_value: 3, category_value: "A" },
      { x_value: 4, y_value: 5, z_value: 6, category_value: "B" },
    ]);

    await renderComponent();

    expect(
      await screen.findByText(/rotatable projected fallback/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("exports the current scatter view as PNG", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValueOnce([
      { x_value: 1, y_value: 2, z_value: 3, category_value: "A" },
    ]);

    await renderComponent();
    await screen.findByText(/rotatable projected fallback/i);

    await user.click(screen.getByRole("button", { name: /Export PNG/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      [expect.any(Uint8Array)],
      "orders-3d-scatter.png",
      "image/png",
    );
  });

  it("shows a validation error when fewer than three numeric columns are available", async () => {
    await renderComponent([
      {
        name: "x_metric",
        type: "number",
        nullCount: 0,
        uniqueCount: 4,
        sampleValues: [1, 2],
      },
      {
        name: "segment",
        type: "string",
        nullCount: 0,
        uniqueCount: 2,
        sampleValues: ["A", "B"],
      },
    ]);

    expect(
      await screen.findByText("Choose X, Y, and Z numeric columns."),
    ).toBeInTheDocument();
  });
});
