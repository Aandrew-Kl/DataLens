import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import OutlierExplorer from "@/components/data/outlier-explorer";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

const chartPropsSpy = jest.fn();

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
    default: (props: Record<string, unknown>) => {
      chartPropsSpy(props);
      return React.createElement("div", { "data-testid": "echart" });
    },
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ BoxplotChart: {}, ScatterChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "amount",
    type: "number",
    nullCount: 1,
    uniqueCount: 10,
    sampleValues: [10, 100],
  },
];

async function renderExplorer(targetColumns: ColumnProfile[]) {
  await act(async () => {
    render(<OutlierExplorer tableName="orders" columns={targetColumns} />);
  });
}

describe("OutlierExplorer", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockDownloadFile.mockReset();
    chartPropsSpy.mockClear();
  });

  it("renders the box plot and detected outlier rows", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("median_value") && sql.includes("lower_bound")) {
        return [
          {
            row_count: 10,
            non_null_count: 9,
            q1: 10,
            median_value: 12,
            q3: 14,
            iqr: 4,
            lower_bound: 4,
            upper_bound: 20,
            min_value: 8,
            max_value: 120,
          },
        ];
      }

      if (sql.includes('CAST("amount" AS DOUBLE) AS __metric')) {
        return [
          {
            id: 1,
            amount: 120,
            __metric: 120,
            __is_outlier: true,
          },
          {
            id: 2,
            amount: 12,
            __metric: 12,
            __is_outlier: false,
          },
        ];
      }

      return [];
    });

    await renderExplorer(columns);

    expect(await screen.findByText("120.00")).toBeInTheDocument();
    expect(screen.getByText("Outlier")).toBeInTheDocument();

    await waitFor(() => {
      const option = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
        series?: Array<{ type?: string }>;
      };
      expect(option.series?.[0]?.type).toBe("boxplot");
      expect(option.series?.[1]?.type).toBe("scatter");
    });
  });

  it("filters to clean rows and exports the visible slice", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("median_value") && sql.includes("lower_bound")) {
        return [
          {
            row_count: 10,
            non_null_count: 9,
            q1: 10,
            median_value: 12,
            q3: 14,
            iqr: 4,
            lower_bound: 4,
            upper_bound: 20,
            min_value: 8,
            max_value: 120,
          },
        ];
      }

      if (sql.includes('CAST("amount" AS DOUBLE) AS __metric')) {
        return [
          {
            id: 1,
            amount: 120,
            __metric: 120,
            __is_outlier: true,
          },
          {
            id: 2,
            amount: 12,
            __metric: 12,
            __is_outlier: false,
          },
        ];
      }

      return [];
    });

    await renderExplorer(columns);
    await screen.findByText("Outlier");

    await user.click(screen.getByRole("button", { name: "Exclude outliers" }));
    expect(await screen.findByText("Clean")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Export CSV/i }));

    expect(mockDownloadFile).toHaveBeenCalledTimes(1);
    expect(String(mockDownloadFile.mock.calls[0]?.[0])).toContain('"false"');
    expect(String(mockDownloadFile.mock.calls[0]?.[0])).not.toContain('"true"');
  });

  it("shows an empty state without numeric columns", async () => {
    await renderExplorer([
      {
        name: "status",
        type: "string",
        nullCount: 0,
        uniqueCount: 2,
        sampleValues: ["new", "won"],
      },
    ]);

    expect(
      screen.getByText("Select a numeric column to explore outliers."),
    ).toBeInTheDocument();
  });

  it("surfaces explorer query failures", async () => {
    mockRunQuery.mockRejectedValue(new Error("explorer failed"));

    await renderExplorer(columns);

    expect(await screen.findByText("explorer failed")).toBeInTheDocument();
  });
});
