import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";

import CorrelationFinder from "@/components/data/correlation-finder";
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
jest.mock("echarts/charts", () => ({
  HeatmapChart: {},
  LineChart: {},
  ScatterChart: {},
}));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  TooltipComponent: {},
  VisualMapComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [10, 20],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [5, 12],
  },
  {
    name: "cost",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [3, 8],
  },
];

describe("CorrelationFinder", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  async function renderFinder(targetColumns: ColumnProfile[]) {
    await act(async () => {
      render(<CorrelationFinder tableName="orders" columns={targetColumns} />);
    });
  }

  it("shows the empty state when fewer than two numeric columns are available", async () => {
    await renderFinder([
      {
        name: "region",
        type: "string",
        nullCount: 0,
        uniqueCount: 2,
        sampleValues: ["North", "South"],
      },
    ]);

    await waitFor(() => {
      expect(
        screen.getByText("Correlation finder needs at least two numeric columns"),
      ).toBeInTheDocument();
    });

    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("renders ranked pairs, updates the active preview, and respects the threshold slider", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("corr(TRY_CAST")) {
        return [
          {
            left_name: "sales",
            right_name: "profit",
            correlation_value: 0.91,
            pair_count: 12,
          },
          {
            left_name: "sales",
            right_name: "cost",
            correlation_value: 0.52,
            pair_count: 12,
          },
          {
            left_name: "profit",
            right_name: "cost",
            correlation_value: 0.18,
            pair_count: 12,
          },
        ];
      }

      if (sql.includes('TRY_CAST("sales" AS DOUBLE) AS left_value') && sql.includes('TRY_CAST("cost" AS DOUBLE) AS right_value')) {
        return [
          { left_value: 10, right_value: 4 },
          { left_value: 20, right_value: 7 },
          { left_value: 30, right_value: 9 },
        ];
      }

      return [
        { left_value: 10, right_value: 5 },
        { left_value: 20, right_value: 10 },
        { left_value: 30, right_value: 15 },
      ];
    });

    await renderFinder(columns);

    await waitFor(() => {
      expect(
        screen.getByText("Rank the strongest Pearson relationships automatically"),
      ).toBeInTheDocument();
      expect(screen.getByText("sales ↔ profit")).toBeInTheDocument();
      expect(screen.getByText("sales vs profit")).toBeInTheDocument();
      expect(screen.getByTestId("echart")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sales ↔ cost/i }));
    });

    await waitFor(() => {
      expect(screen.getByText("sales vs cost")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByRole("slider"), {
        target: { value: "95" },
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText("No pairs cleared the current threshold. Showing the strongest available relationships instead."),
      ).toBeInTheDocument();
      expect(screen.getByText("|r| ≥ 0.95")).toBeInTheDocument();
    });
  });
});
