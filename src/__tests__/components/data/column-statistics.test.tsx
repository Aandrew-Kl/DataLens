import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ColumnStatistics from "@/components/data/column-statistics";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

const chartPropsSpy = jest.fn();

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      chartPropsSpy(props);
      return React.createElement("div", { "data-testid": "echart" });
    },
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ BarChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 2,
    uniqueCount: 10,
    sampleValues: [100, 200],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 1,
    uniqueCount: 3,
    sampleValues: ["Enterprise", "SMB"],
  },
];

async function renderStatistics(targetColumns: ColumnProfile[]) {
  await act(async () => {
    render(
      <ColumnStatistics tableName="orders" columns={targetColumns} />,
    );
  });
}

describe("ColumnStatistics", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    chartPropsSpy.mockClear();
  });

  it("renders numeric moments and a histogram", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (
        sql.includes('"segment"') &&
        sql.includes("distinct_count") &&
        sql.includes("null_count")
      ) {
        return [
          {
            row_count: 50,
            non_null_count: 49,
            distinct_count: 3,
            null_count: 1,
          },
        ];
      }

      if (
        sql.includes('"segment"') &&
        sql.includes("GROUP BY 1") &&
        sql.includes("bucket_count")
      ) {
        return [
          { label: "Enterprise", bucket_count: 25 },
          { label: "SMB", bucket_count: 15 },
        ];
      }

      if (sql.includes('AVG(CAST("revenue" AS DOUBLE)) AS mean_value')) {
        return [
          {
            row_count: 50,
            non_null_count: 48,
            distinct_count: 10,
            null_count: 2,
            mean_value: 210.5,
            median_value: 200,
            stddev_value: 18.2,
            variance_value: 331.24,
            skewness_value: 0.7,
            kurtosis_value: 2.4,
          },
        ];
      }

      if (sql.includes("AS mode_value")) {
        return [{ mode_value: 180 }];
      }

      if (sql.includes('"revenue"') && sql.includes("bucket_count")) {
        return [
          { start_value: 100, bucket_count: 4 },
          { start_value: 150, bucket_count: 8 },
        ];
      }

      return [];
    });

    await renderStatistics(columns);

    expect(await screen.findByText("210.50")).toBeInTheDocument();
    expect(screen.getByText("0.70")).toBeInTheDocument();

    await waitFor(() => {
      const option = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
        series?: Array<{ type?: string }>;
      };
      expect(option.series?.[0]?.type).toBe("bar");
    });
  });

  it("switches to categorical value counts", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (
        sql.includes('"segment"') &&
        sql.includes("distinct_count") &&
        sql.includes("null_count")
      ) {
        return [
          {
            row_count: 50,
            non_null_count: 49,
            distinct_count: 3,
            null_count: 1,
          },
        ];
      }

      if (
        sql.includes('"segment"') &&
        sql.includes("GROUP BY 1") &&
        sql.includes("bucket_count")
      ) {
        return [
          { label: "Enterprise", bucket_count: 25 },
          { label: "SMB", bucket_count: 15 },
        ];
      }

      if (sql.includes('AVG(CAST("revenue" AS DOUBLE)) AS mean_value')) {
        return [
          {
            row_count: 50,
            non_null_count: 48,
            distinct_count: 10,
            null_count: 2,
            mean_value: 210.5,
            median_value: 200,
            stddev_value: 18.2,
            variance_value: 331.24,
            skewness_value: 0.7,
            kurtosis_value: 2.4,
          },
        ];
      }

      if (sql.includes("AS mode_value")) {
        return [{ mode_value: 180 }];
      }

      if (sql.includes('"revenue"') && sql.includes("bucket_count")) {
        return [
          { start_value: 100, bucket_count: 4 },
          { start_value: 150, bucket_count: 8 },
        ];
      }

      return [];
    });

    await renderStatistics(columns);
    await screen.findByText("210.50");

    await act(async () => {
      await user.selectOptions(
        screen.getByRole("combobox", { name: /Active column/i }),
        "segment",
      );
    });

    expect(await screen.findByText("Enterprise")).toBeInTheDocument();
    expect(screen.getByText("51.0% of non-null values")).toBeInTheDocument();
  });

  it("shows an empty state when no columns are available", async () => {
    await renderStatistics([]);

    expect(
      screen.getByText("Select a profiled column to inspect detailed statistics."),
    ).toBeInTheDocument();
  });

  it("surfaces query failures", async () => {
    mockRunQuery.mockRejectedValue(new Error("stats failed"));

    await renderStatistics(columns);

    expect(await screen.findByText("stats failed")).toBeInTheDocument();
  });
});
