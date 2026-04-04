import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DistributionAnalyzer from "@/components/data/distribution-analyzer";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

const mockChartInstance = {
  getDataURL: jest.fn(() => "data:image/png;base64,aGVsbG8="),
};

const chartPropsSpy = jest.fn();

jest.mock("framer-motion");
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
    default: React.forwardRef(function MockChart(
      props: Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) {
      chartPropsSpy(props);
      React.useImperativeHandle(ref, () => ({
        getEchartsInstance: () => mockChartInstance,
      }));
      return React.createElement("div", { "data-testid": "echart" });
    }),
  };
});
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({
  BarChart: {},
  LineChart: {},
  ScatterChart: {},
}));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: [10, 20],
  },
];

async function renderAsync(targetColumns: ColumnProfile[]) {
  await act(async () => {
    render(<DistributionAnalyzer tableName="sales" columns={targetColumns} />);
  });
}

describe("DistributionAnalyzer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the empty state when no numeric columns exist", async () => {
    await renderAsync([
      {
        name: "segment",
        type: "string",
        nullCount: 0,
        uniqueCount: 4,
        sampleValues: ["A", "B"],
      },
    ]);

    expect(
      await screen.findByText("Choose a numeric column to analyze its distribution."),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("exports the chart as PNG", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue(
      Array.from({ length: 24 }, (_, index) => ({ value: index + 1 })),
    );

    await renderAsync(columns);
    await screen.findByTestId("echart");

    await user.click(screen.getByRole("button", { name: /Export PNG/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "sales-revenue-distribution.png",
      "image/png",
    );
  });

  it("surfaces load failures", async () => {
    mockRunQuery.mockRejectedValue(new Error("Distribution failed"));

    await renderAsync(columns);

    expect(await screen.findByText("Distribution failed")).toBeInTheDocument();
  });
});
