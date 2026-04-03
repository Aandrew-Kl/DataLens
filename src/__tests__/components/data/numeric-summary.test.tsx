import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import NumericSummary from "@/components/data/numeric-summary";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({ runQuery: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/utils/export", () => ({ downloadFile: jest.fn() }));
jest.mock("echarts-for-react/lib/core");
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ BarChart: {}, BoxplotChart: {} }));
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
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [1, 2],
  },
];

async function renderAsync(targetColumns: ColumnProfile[]) {
  await act(async () => {
    render(<NumericSummary tableName="orders" columns={targetColumns} />);
  });
}

describe("NumericSummary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the empty guidance when there are no numeric columns", async () => {
    await renderAsync([
      {
        name: "status",
        type: "string",
        nullCount: 0,
        uniqueCount: 2,
        sampleValues: ["open", "closed"],
      },
    ]);

    expect(screen.getByText("Choose a numeric column to summarize.")).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("computes descriptive stats and a distribution shape", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { value: 1 },
      { value: 1 },
      { value: 2 },
      { value: 3 },
      { value: 8 },
      { value: 12 },
    ]);

    await renderAsync(columns);
    await user.click(screen.getByRole("button", { name: "Analyze distribution" }));

    expect(await screen.findByText("Distribution shape indicator")).toBeInTheDocument();
    expect(
      screen.getAllByText(/right-skewed|broad|heavy-tailed|near-normal/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByTestId("echart")).toHaveLength(2);
  });

  it("exports the numeric summary metrics", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { value: 1 },
      { value: 2 },
      { value: 3 },
      { value: 4 },
    ]);

    await renderAsync(columns);
    await user.click(screen.getByRole("button", { name: "Analyze distribution" }));
    await screen.findByText("Distribution shape indicator");
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("skewness"),
      "orders-amount-numeric-summary.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
