import { act, render, screen } from "@testing-library/react";

import SurvivalAnalysis from "@/components/ml/survival-analysis";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/hooks/use-dark-mode", () => ({
  useDarkMode: jest.fn().mockReturnValue(false),
}));
jest.mock("echarts-for-react/lib/core", () => ({ __esModule: true, default: () => null }));
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ LineChart: {}, BarChart: {} }));
jest.mock("echarts/components", () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {} }));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "time",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [1, 5, 10],
  },
  {
    name: "event",
    type: "number",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [0, 1],
  },
];

async function renderAsync(targetColumns: ColumnProfile[] = columns): Promise<void> {
  await act(async () => {
    render(<SurvivalAnalysis tableName="patients" columns={targetColumns} />);
  });
}

describe("SurvivalAnalysis", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the survival analysis controls", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Estimate survival probabilities and hazard over time",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Estimate survival" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(screen.getAllByText("time").length).toBeGreaterThan(0);
    expect(screen.getAllByText("event").length).toBeGreaterThan(0);
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});
