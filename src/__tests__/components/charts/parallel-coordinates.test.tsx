import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";

import ParallelCoordinates from "@/components/charts/parallel-coordinates";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("framer-motion");

jest.mock("echarts-for-react/lib/core", () => ({
  __esModule: true,
  default: function MockChart() {
    return <div data-testid="echart" />;
  },
}));

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ ParallelChart: {} }));
jest.mock("echarts/components", () => ({
  LegendComponent: {},
  ParallelComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);

const fullColumns: ColumnProfile[] = [
  { name: "revenue", type: "number", nullCount: 0, uniqueCount: 10, sampleValues: [100, 120] },
  { name: "cost", type: "number", nullCount: 0, uniqueCount: 10, sampleValues: [60, 80] },
  { name: "margin", type: "number", nullCount: 0, uniqueCount: 10, sampleValues: [40, 40] },
  { name: "profit", type: "number", nullCount: 0, uniqueCount: 10, sampleValues: [20, 35] },
  { name: "segment", type: "string", nullCount: 0, uniqueCount: 2, sampleValues: ["SMB", "Enterprise"] },
];

describe("ParallelCoordinates", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  async function renderParallel(columns: ColumnProfile[]) {
    await act(async () => {
      render(<ParallelCoordinates tableName="orders" columns={columns} />);
    });
  }

  it("shows the empty state when there are fewer than three numeric columns", async () => {
    await renderParallel([
      fullColumns[0],
      fullColumns[1],
      fullColumns[4],
    ]);

    await waitFor(() => {
      expect(
        screen.getByText("Parallel coordinates need at least three numeric columns"),
      ).toBeInTheDocument();
    });

    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("renders the chart, reloads when color grouping changes, and hides the chart below three axes", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('CAST("segment" AS VARCHAR) AS __category')) {
        return [
          { axis_0: 100, axis_1: 70, axis_2: 30, axis_3: 20, __category: "Enterprise" },
          { axis_0: 120, axis_1: 80, axis_2: 40, axis_3: 30, __category: "SMB" },
        ];
      }

      return [
        { axis_0: 100, axis_1: 70, axis_2: 30, axis_3: 20 },
        { axis_0: 120, axis_1: 80, axis_2: 40, axis_3: 30 },
        { axis_0: 140, axis_1: 90, axis_2: 50, axis_3: 40 },
      ];
    });

    await renderParallel(fullColumns);

    await waitFor(() => {
      expect(screen.getByText("Parallel coordinates")).toBeInTheDocument();
      expect(screen.getByTestId("echart")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "segment" },
      });
    });

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('CAST("segment" AS VARCHAR) AS __category'),
      );
    });

    await act(async () => {
      fireEvent.change(screen.getByRole("slider"), {
        target: { value: "0.6" },
      });
    });

    expect(screen.getByText("0.60")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "margin" }));
      fireEvent.click(screen.getByRole("button", { name: "profit" }));
    });

    await waitFor(() => {
      expect(
        screen.getByText("Select at least three axes to render the plot"),
      ).toBeInTheDocument();
    });
  });
});
