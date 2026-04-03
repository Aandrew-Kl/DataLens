import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";

import DataProfilerLite from "@/components/data/data-profiler-lite";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

const chartPropsSpy = jest.fn();

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("echarts-for-react/lib/core", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    chartPropsSpy(props);
    return null;
  },
}));
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({
  BarChart: {},
  PieChart: {},
}));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 12,
    uniqueCount: 1900,
    sampleValues: [1200, 1400, 1500],
  },
  {
    name: "region",
    type: "string",
    nullCount: 4,
    uniqueCount: 32,
    sampleValues: ["North", "South"],
  },
  {
    name: "created_at",
    type: "date",
    nullCount: 1,
    uniqueCount: 1200,
    sampleValues: ["2025-01-01", "2025-01-02"],
  },
];

async function renderProfiler(targetColumns: ColumnProfile[] = columns) {
  await act(async () => {
    render(
      <DataProfilerLite tableName="orders" columns={targetColumns} />,
    );
  });
}

function getChartOptions() {
  return chartPropsSpy.mock.calls.map(
    (call) => (call[0] as { option?: Record<string, unknown> }).option ?? {},
  );
}

describe("DataProfilerLite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("renders an empty state when no columns are available", async () => {
    await renderProfiler([]);

    expect(
      screen.getByText("Add a dataset before running quick profile diagnostics."),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("renders summary cards, charts, and the most unique columns", async () => {
    mockRunQuery.mockResolvedValue([{ row_count: 2400 }]);

    await renderProfiler();

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        'SELECT COUNT(*) AS row_count FROM "orders"',
      );
    });

    expect(screen.getByText("2.4K")).toBeInTheDocument();
    expect(screen.getByText("Column Type Distribution")).toBeInTheDocument();
    expect(screen.getByText("Null Percentage by Column")).toBeInTheDocument();
    expect(screen.getByText("Top 5 Most Unique Columns")).toBeInTheDocument();
    expect(screen.getByText("revenue")).toBeInTheDocument();

    const chartOptions = getChartOptions();
    expect(
      chartOptions.some((option) => {
        const series = option.series as Array<Record<string, unknown>> | undefined;
        return series?.[0]?.type === "pie";
      }),
    ).toBe(true);
    expect(
      chartOptions.some((option) => {
        const series = option.series as Array<Record<string, unknown>> | undefined;
        return series?.[0]?.type === "bar";
      }),
    ).toBe(true);
  });

  it("shows a query error while preserving the lite profile shell", async () => {
    mockRunQuery.mockRejectedValue(new Error("Profiler query failed"));

    await renderProfiler();

    expect(await screen.findByText("Profiler query failed")).toBeInTheDocument();
    expect(screen.getByText("Top 5 Most Unique Columns")).toBeInTheDocument();
  });
});
