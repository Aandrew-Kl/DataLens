import { act, render, screen } from "@testing-library/react";

import SeasonalDecomposition from "@/components/analytics/seasonal-decomposition";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("echarts-for-react/lib/core", () => ({ __esModule: true, default: () => null }));
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ LineChart: {} }));
jest.mock("echarts/components", () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {} }));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

jest.mock("@/lib/hooks/use-dark-mode", () => ({
  useDarkMode: jest.fn().mockReturnValue(false),
}));

const columns: ColumnProfile[] = [
  {
    name: "date",
    type: "date",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: ["2024-01-01"],
  },
  {
    name: "value",
    type: "number",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: [100, 200],
  },
];

async function renderAsync(): Promise<void> {
  await act(async () => {
    render(<SeasonalDecomposition tableName="orders" columns={columns} />);
  });
}

describe("SeasonalDecomposition", () => {
  it("renders the seasonal decomposition workspace", async () => {
    await renderAsync();

    expect(
      screen.getByText("Split the series into trend, seasonal signal, and residual noise"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decompose series" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
  });
});
