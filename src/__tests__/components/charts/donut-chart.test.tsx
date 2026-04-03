import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";

import DonutChart from "@/components/charts/donut-chart";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("framer-motion");

jest.mock("echarts-for-react/lib/core", () => ({
  __esModule: true,
  default: function MockChart(props: {
    option?: { series?: Array<{ data?: Array<unknown>; radius?: [string, string] }> };
  }) {
    const slices = props.option?.series?.[0]?.data?.length ?? 0;
    const innerRadius = props.option?.series?.[0]?.radius?.[0] ?? "";
    return <div data-testid="echart" data-slices={String(slices)} data-inner-radius={innerRadius} />;
  },
}));

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ PieChart: {} }));
jest.mock("echarts/components", () => ({
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["North", "South"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [100, 60],
  },
];

describe("DonutChart", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
  });

  async function renderDonut(targetColumns: ColumnProfile[]) {
    await act(async () => {
      render(<DonutChart tableName="orders" columns={targetColumns} />);
    });
  }

  it("shows the empty state when no category column is available", async () => {
    await renderDonut([
      {
        name: "revenue",
        type: "number",
        nullCount: 0,
        uniqueCount: 30,
        sampleValues: [100, 60],
      },
    ]);

    await waitFor(() => {
      expect(
        screen.getByText("Donut chart needs at least one category column"),
      ).toBeInTheDocument();
    });

    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("renders the donut and updates the query when the metric and inner radius change", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('SUM(TRY_CAST("revenue" AS DOUBLE))')) {
        return [
          { category_label: "North", metric_value: 100 },
          { category_label: "South", metric_value: 60 },
        ];
      }

      return [
        { category_label: "North", metric_value: 4 },
        { category_label: "South", metric_value: 2 },
      ];
    });

    await renderDonut(columns);

    await waitFor(() => {
      expect(screen.getByText("Compare category share with a hover-highlighted ring")).toBeInTheDocument();
      expect(screen.getByTestId("echart")).toHaveAttribute("data-slices", "2");
      expect(screen.getAllByText("66.7%").length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.change(screen.getAllByRole("combobox")[1], {
        target: { value: "revenue" },
      });
    });

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.stringContaining('SUM(TRY_CAST("revenue" AS DOUBLE))'),
      );
      expect(screen.getByText("160")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByRole("slider"), {
        target: { value: "60" },
      });
    });

    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toHaveAttribute("data-inner-radius", "60%");
  });
});
