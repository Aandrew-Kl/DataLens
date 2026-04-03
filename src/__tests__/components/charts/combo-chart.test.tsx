import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import ComboChart from "@/components/charts/combo-chart";
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
jest.mock("echarts/charts", () => ({ BarChart: {}, LineChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);
const { chartPropsSpy } = jest.requireMock("echarts-for-react/lib/core") as {
  chartPropsSpy: jest.Mock;
};

const comboColumns: ColumnProfile[] = [
  {
    name: "month",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Jan", "Feb", "Mar", "Apr"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [100, 200, 150],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [20, 40, 30],
  },
];

async function renderCombo(columns = comboColumns) {
  await act(async () => {
    render(<ComboChart tableName="financials" columns={columns} />);
  });
}

function getLatestChartOption() {
  const latestCall = chartPropsSpy.mock.calls.at(-1);
  const props = (latestCall?.[0] ?? {}) as { option?: Record<string, unknown> };
  return props.option ?? {};
}

describe("ComboChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("shows an empty state when there are fewer than two numeric columns", async () => {
    await renderCombo([
      {
        name: "month",
        type: "string",
        nullCount: 0,
        uniqueCount: 4,
        sampleValues: ["Jan", "Feb"],
      },
      {
        name: "sales",
        type: "number",
        nullCount: 0,
        uniqueCount: 10,
        sampleValues: [100, 200],
      },
    ]);

    expect(
      await screen.findByText(
        "At least two numeric columns are required for bar and line series.",
      ),
    ).toBeInTheDocument();
  });

  it("renders bar and line series with correct types", async () => {
    mockRunQuery.mockResolvedValue([
      { category: "Jan", bar_value: 100, line_value: 20 },
      { category: "Feb", bar_value: 200, line_value: 40 },
      { category: "Mar", bar_value: 150, line_value: 30 },
    ]);

    await renderCombo();

    await waitFor(() => {
      expect(screen.getByText(/3 categories/)).toBeInTheDocument();
    });

    await waitFor(() => {
      const option = getLatestChartOption();
      const series = option.series as Array<{ type?: string; name?: string }>;

      expect(series).toHaveLength(2);
      expect(series[0].type).toBe("bar");
      expect(series[1].type).toBe("line");
    });
  });

  it("exports the combo data as CSV", async () => {
    mockRunQuery.mockResolvedValue([
      { category: "Jan", bar_value: 100, line_value: 20 },
      { category: "Feb", bar_value: 200, line_value: 40 },
    ]);

    await renderCombo();
    await waitFor(() => {
      expect(screen.getByText(/2 categories/)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export combo chart CSV" }));
    });

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("category,sales,profit"),
      "financials-combo.csv",
      "text/csv;charset=utf-8;",
    );
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("Jan,100,20"),
      "financials-combo.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
