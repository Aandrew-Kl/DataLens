import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import CorrelationExplorer from "@/components/data/correlation-explorer";
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
  const chartPropsSpy = jest.fn();
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      chartPropsSpy(props);
      return null;
    },
    chartPropsSpy,
  };
});
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({
  HeatmapChart: {},
  LineChart: {},
  ScatterChart: {},
}));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
  VisualMapComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);
const { chartPropsSpy } = jest.requireMock("echarts-for-react/lib/core") as {
  chartPropsSpy: jest.Mock;
};

const numericColumns: ColumnProfile[] = [
  {
    name: "age",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [20, 30, 40],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [100, 200, 300],
  },
  {
    name: "margin",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [10, 20, 30],
  },
];

async function renderExplorer(columns = numericColumns) {
  await act(async () => {
    render(<CorrelationExplorer tableName="orders" columns={columns} />);
  });
}

function installCorrelationMocks() {
  mockRunQuery.mockImplementation(async (sql) => {
    if (sql.includes("USING SAMPLE 320 ROWS")) {
      if (sql.includes('"age"') && sql.includes('"margin"')) {
        return [
          { left_value: 20, right_value: 8 },
          { left_value: 30, right_value: 11 },
        ];
      }

      return [
        { left_value: 20, right_value: 100 },
        { left_value: 30, right_value: 150 },
      ];
    }

    return [
      { left_name: "age", right_name: "age", correlation_value: 1, pair_count: 0 },
      { left_name: "age", right_name: "revenue", correlation_value: 0.91, pair_count: 12 },
      { left_name: "age", right_name: "margin", correlation_value: 0.44, pair_count: 12 },
      { left_name: "revenue", right_name: "revenue", correlation_value: 1, pair_count: 0 },
      { left_name: "revenue", right_name: "margin", correlation_value: 0.51, pair_count: 12 },
      { left_name: "margin", right_name: "margin", correlation_value: 1, pair_count: 0 },
    ];
  });
}

function getLatestHeatmapProps() {
  const matchingCall = [...chartPropsSpy.mock.calls]
    .map((call) => call[0] as Record<string, unknown>)
    .reverse()
    .find((props) => {
      const option = props.option as { series?: Array<{ type?: string }> } | undefined;
      return option?.series?.[0]?.type === "heatmap";
    });

  return matchingCall ?? {};
}

describe("CorrelationExplorer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("shows an empty state when fewer than two numeric columns exist", async () => {
    await renderExplorer([
      {
        name: "segment",
        type: "string",
        nullCount: 0,
        uniqueCount: 3,
        sampleValues: ["Enterprise", "SMB"],
      },
    ]);

    expect(
      await screen.findByText(
        "At least two numeric columns are required to explore pairwise correlations.",
      ),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("renders the matrix and updates the scatter preview when a cell is clicked", async () => {
    installCorrelationMocks();

    await renderExplorer();

    expect(await screen.findByText("Correlation matrix")).toBeInTheDocument();
    expect(screen.getByText("Scatter preview for age vs revenue")).toBeInTheDocument();

    const heatmapProps = getLatestHeatmapProps();
    const onEvents = heatmapProps.onEvents as { click?: (params: unknown) => void };

    await act(async () => {
      onEvents.click?.({ value: [2, 0, 0.44, 12] });
    });

    await waitFor(() => {
      expect(screen.getByText("Scatter preview for age vs margin")).toBeInTheDocument();
    });

    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringContaining('TRY_CAST("age" AS DOUBLE) AS left_value'),
    );
    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringContaining('TRY_CAST("margin" AS DOUBLE) AS right_value'),
    );
  });

  it("switches to Spearman and exports the matrix as CSV", async () => {
    installCorrelationMocks();

    await renderExplorer();
    await screen.findByText("Correlation matrix");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Spearman" }));
    });

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(expect.stringContaining("RANK() OVER"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export correlation CSV" }));
    });

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("method,left_column,right_column,correlation,pair_count"),
      "orders-spearman-correlation-matrix.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
