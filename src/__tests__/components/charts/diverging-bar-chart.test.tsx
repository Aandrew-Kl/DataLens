import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import DivergingBarChart from "@/components/charts/diverging-bar-chart";
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
jest.mock("echarts/charts", () => ({ BarChart: {} }));
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

const divergingColumns: ColumnProfile[] = [
  {
    name: "product",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Alpha", "Beta", "Gamma", "Delta"],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [-50, 20, -10, 80],
  },
];

async function renderDivergingBar(columns = divergingColumns) {
  await act(async () => {
    render(<DivergingBarChart tableName="financials" columns={columns} />);
  });
}

function getLatestChartOption() {
  const latestCall = chartPropsSpy.mock.calls.at(-1);
  const props = (latestCall?.[0] ?? {}) as { option?: Record<string, unknown> };
  return props.option ?? {};
}

describe("DivergingBarChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("shows an empty state when there are no label columns", async () => {
    await renderDivergingBar([
      {
        name: "profit",
        type: "number",
        nullCount: 0,
        uniqueCount: 10,
        sampleValues: [-50, 80],
      },
    ]);

    expect(
      await screen.findByText(
        "At least one label column and one numeric column are required.",
      ),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("renders diverging bars with positive/negative counts", async () => {
    mockRunQuery.mockResolvedValue([
      { label: "Alpha", value: -50 },
      { label: "Beta", value: 20 },
      { label: "Gamma", value: -10 },
      { label: "Delta", value: 80 },
    ]);

    await renderDivergingBar();

    await waitFor(() => {
      expect(screen.getByText(/2 positive/)).toBeInTheDocument();
      expect(screen.getByText(/2 negative/)).toBeInTheDocument();
    });

    await waitFor(() => {
      const option = getLatestChartOption();
      const yAxis = option.yAxis as { data?: string[] };
      expect(yAxis.data).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    });
  });

  it("exports the diverging data as CSV", async () => {
    mockRunQuery.mockResolvedValue([
      { label: "Alpha", value: -50 },
      { label: "Beta", value: 20 },
    ]);

    await renderDivergingBar();
    await waitFor(() => {
      expect(screen.getByText(/1 positive/)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export diverging bar chart CSV" }));
    });

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("label,value"),
      "financials-diverging-bar.csv",
      "text/csv;charset=utf-8;",
    );
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("Alpha,-50"),
      "financials-diverging-bar.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
