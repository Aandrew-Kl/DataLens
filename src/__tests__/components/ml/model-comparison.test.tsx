import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ModelComparison from "@/components/ml/model-comparison";
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
const { chartPropsSpy } = jest.requireMock("echarts-for-react/lib/core") as {
  chartPropsSpy: jest.Mock;
};

const numericColumns: ColumnProfile[] = [
  {
    name: "actual",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [10, 20, 30, 40],
  },
  {
    name: "model_linear",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [9, 19, 31, 43],
  },
  {
    name: "model_tree",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [10, 20, 29, 40],
  },
];

async function renderAsync(columns: ColumnProfile[]) {
  await act(async () => {
    render(<ModelComparison tableName="orders" columns={columns} />);
  });
}

describe("ModelComparison", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("shows an empty state when fewer than two numeric columns exist", async () => {
    await renderAsync([
      {
        name: "status",
        type: "string",
        nullCount: 0,
        uniqueCount: 2,
        sampleValues: ["open", "closed"],
      },
    ]);

    expect(
      screen.getByText(/Add at least two numeric columns to compare predictions/i),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("loads metrics and renders a residual plot for the best model", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { actual_value: 10, model_linear: 8, model_tree: 10 },
      { actual_value: 20, model_linear: 22, model_tree: 19 },
      { actual_value: 30, model_linear: 28, model_tree: 30 },
      { actual_value: 40, model_linear: 44, model_tree: 40 },
    ]);

    await renderAsync(numericColumns);
    await user.click(screen.getByRole("button", { name: /Run comparison/i }));

    expect(await screen.findByText(/Best: model_tree/i)).toBeInTheDocument();

    await waitFor(() => {
      const option = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
        series?: Array<{ type?: string }>;
      };
      expect(option.series?.[0]?.type).toBe("scatter");
      expect(option.series?.at(-1)?.type).toBe("line");
    });
  });

  it("exports the comparison table as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { actual_value: 10, model_linear: 8, model_tree: 10 },
      { actual_value: 20, model_linear: 22, model_tree: 19 },
      { actual_value: 30, model_linear: 28, model_tree: 30 },
      { actual_value: 40, model_linear: 44, model_tree: 40 },
    ]);

    await renderAsync(numericColumns);
    await user.click(screen.getByRole("button", { name: /Run comparison/i }));
    await screen.findByText(/Best: model_tree/i);
    await user.click(screen.getByRole("button", { name: /Export CSV/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("model,r_squared,rmse,mae"),
      "orders-actual-model-comparison.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
