import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import HeatmapChart from "@/components/charts/heatmap-chart";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: React.forwardRef(function MockChart(
      props: Record<string, unknown>,
      _ref: React.Ref<unknown>,
    ) {
      return React.createElement("div", { "data-testid": "echart" });
    }),
  };
});
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ HeatmapChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  TooltipComponent: {},
  VisualMapComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);

const heatmapColumns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["East", "West"],
  },
  {
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["New", "Won"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [10, 20],
  },
];

function installHeatmapMock() {
  mockRunQuery.mockResolvedValue([
    { x_label: "East", y_label: "New", cell_value: 10 },
    { x_label: "West", y_label: "New", cell_value: 30 },
    { x_label: "East", y_label: "Won", cell_value: 20 },
  ]);
}

async function renderHeatmap(columns: ColumnProfile[]) {
  await act(async () => {
    render(<HeatmapChart tableName="orders" columns={columns} />);
  });

  await waitFor(() => {
    expect(screen.queryByText("Loading heatmap analysis…")).not.toBeInTheDocument();
  });
}

describe("HeatmapChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders aggregated metrics and the heatmap shell", async () => {
    installHeatmapMock();

    await renderHeatmap(heatmapColumns);

    expect(
      await screen.findByText("Compare two dimensions with an intensity map"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText("2 × 2")).toBeInTheDocument();
    expect(screen.getByText("10 to 30")).toBeInTheDocument();
  });

  it("updates the displayed color range when overrides are entered", async () => {
    installHeatmapMock();

    await renderHeatmap(heatmapColumns);

    fireEvent.change(screen.getByPlaceholderText("10"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByPlaceholderText("30"), {
      target: { value: "40" },
    });

    expect(await screen.findByText("5 to 40")).toBeInTheDocument();
  });

  it("shows a validation error when no dimensions are available", async () => {
    await renderHeatmap([]);

    expect(
      await screen.findByText("Choose both X and Y dimensions to render the heatmap."),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("shows an empty-state error when the query returns no cells", async () => {
    mockRunQuery.mockResolvedValue([]);

    await renderHeatmap(heatmapColumns);

    expect(
      await screen.findByText("The selected combination produced no non-null cells."),
    ).toBeInTheDocument();
  });
});
