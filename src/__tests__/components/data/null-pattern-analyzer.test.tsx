import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import NullPatternAnalyzer from "@/components/data/null-pattern-analyzer";
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
jest.mock("echarts-for-react/lib/core", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    chartPropsSpy(props);
    return null;
  },
}));
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({
  HeatmapChart: {},
}));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  TooltipComponent: {},
  VisualMapComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "age",
    type: "number",
    nullCount: 10,
    uniqueCount: 80,
    sampleValues: [18, 22, 30],
  },
  {
    name: "city",
    type: "string",
    nullCount: 20,
    uniqueCount: 12,
    sampleValues: ["Athens", "Berlin"],
  },
  {
    name: "is_active",
    type: "boolean",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [true, false],
  },
];

async function renderAnalyzer(targetColumns: ColumnProfile[] = columns) {
  await act(async () => {
    render(
      <NullPatternAnalyzer tableName="orders" columns={targetColumns} />,
    );
  });
}

function getLatestHeatmapOption() {
  const lastCall = chartPropsSpy.mock.calls.at(-1);
  return (lastCall?.[0] as { option?: Record<string, unknown> })?.option ?? {};
}

describe("NullPatternAnalyzer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("renders an empty state when fewer than two columns have missing values", async () => {
    await renderAnalyzer([
      {
        ...columns[0],
      },
      {
        ...columns[1],
        nullCount: 0,
      },
    ]);

    expect(
      screen.getByText(
        "Add at least two columns with missing values before comparing null patterns.",
      ),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("renders heatmap output and a structured missingness assessment", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*) AS row_count")) {
        return [{ row_count: 100 }];
      }

      return [
        {
          left_name: "age",
          right_name: "age",
          left_null_count: 10,
          right_null_count: 10,
          co_null_count: 10,
        },
        {
          left_name: "age",
          right_name: "city",
          left_null_count: 10,
          right_null_count: 20,
          co_null_count: 8,
        },
        {
          left_name: "city",
          right_name: "city",
          left_null_count: 20,
          right_null_count: 20,
          co_null_count: 20,
        },
      ];
    });

    await renderAnalyzer();

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        'SELECT COUNT(*) AS row_count FROM "orders"',
      );
    });

    expect(screen.getByText("Null Co-occurrence Heatmap")).toBeInTheDocument();
    expect(screen.getByText("Assessment:")).toBeInTheDocument();
    expect(screen.getByText("Likely not random")).toBeInTheDocument();
    expect(screen.getByText("age × city")).toBeInTheDocument();

    const option = getLatestHeatmapOption();
    const series = option.series as Array<Record<string, unknown>>;
    const xAxis = option.xAxis as Record<string, unknown>;

    expect(series[0]?.type).toBe("heatmap");
    expect(xAxis.data).toEqual(["age", "city"]);
  });

  it("exports the pairwise null statistics as CSV", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*) AS row_count")) {
        return [{ row_count: 100 }];
      }

      return [
        {
          left_name: "age",
          right_name: "age",
          left_null_count: 10,
          right_null_count: 10,
          co_null_count: 10,
        },
        {
          left_name: "age",
          right_name: "city",
          left_null_count: 10,
          right_null_count: 20,
          co_null_count: 8,
        },
        {
          left_name: "city",
          right_name: "city",
          left_null_count: 20,
          right_null_count: 20,
          co_null_count: 20,
        },
      ];
    });

    await renderAnalyzer();

    await screen.findByText("Null Co-occurrence Heatmap");

    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("left_column,right_column,left_null_count"),
      "orders-null-patterns.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
