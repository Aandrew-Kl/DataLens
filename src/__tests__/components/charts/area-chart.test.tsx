import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";

import AreaChart from "@/components/charts/area-chart";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("framer-motion");

jest.mock("echarts-for-react/lib/core", () => ({
  __esModule: true,
  default: function MockChart(props: {
    option?: { series?: Array<{ stack?: string }> };
  }) {
    const seriesCount = props.option?.series?.length ?? 0;
    const stacked = props.option?.series?.[0]?.stack === "total";
    return (
      <div
        data-testid="echart"
        data-series-count={String(seriesCount)}
        data-stacked={String(stacked)}
      />
    );
  },
}));

jest.mock("echarts/core", () => ({
  use: jest.fn(),
  graphic: {
    LinearGradient: class MockLinearGradient {
      constructor(..._args: unknown[]) {}
    },
  },
}));

jest.mock("echarts/charts", () => ({ LineChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "ordered_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["2026-01-01", "2026-01-02"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [100, 120],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["North", "South"],
  },
];

describe("AreaChart", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  async function renderAreaChart(targetColumns: ColumnProfile[]) {
    await act(async () => {
      render(<AreaChart tableName="orders" columns={targetColumns} />);
    });
  }

  it("shows the empty state when the chart cannot infer a dimension and measure", async () => {
    await renderAreaChart([
      {
        name: "status",
        type: "string",
        nullCount: 0,
        uniqueCount: 2,
        sampleValues: ["new", "won"],
      },
    ]);

    await waitFor(() => {
      expect(
        screen.getByText("Area chart needs one dimension and one numeric measure"),
      ).toBeInTheDocument();
    });

    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("renders the chart and rebuilds the query when grouping and aggregation change", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('COALESCE(CAST("region" AS VARCHAR), \'Unknown\') AS group_label')) {
        return [
          {
            x_label: "2026-01-01",
            x_number: null,
            x_time: "2026-01-01T00:00:00.000Z",
            group_label: "North",
            metric_value: 100,
          },
          {
            x_label: "2026-01-01",
            x_number: null,
            x_time: "2026-01-01T00:00:00.000Z",
            group_label: "South",
            metric_value: 80,
          },
        ];
      }

      return [
        {
          x_label: "2026-01-01",
          x_number: null,
          x_time: "2026-01-01T00:00:00.000Z",
          group_label: "All rows",
          metric_value: 180,
        },
        {
          x_label: "2026-01-02",
          x_number: null,
          x_time: "2026-01-02T00:00:00.000Z",
          group_label: "All rows",
          metric_value: 220,
        },
      ];
    });

    await renderAreaChart(columns);

    await waitFor(() => {
      expect(screen.getByTestId("echart")).toBeInTheDocument();
      expect(screen.getByText("Layer numeric movement across one shared X-axis")).toBeInTheDocument();
      expect(screen.getByText("Buckets")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getAllByRole("combobox")[2], {
        target: { value: "region" },
      });
    });

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE(CAST("region" AS VARCHAR), \'Unknown\') AS group_label'),
      );
      expect(screen.getByText("North")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getAllByRole("combobox")[3], {
        target: { value: "AVG" },
      });
    });

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(expect.stringContaining("AVG(metric_value)"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox"));
    });

    expect(screen.getByTestId("echart")).toHaveAttribute("data-stacked", "false");
  });
});
