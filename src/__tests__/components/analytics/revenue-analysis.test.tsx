import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import RevenueAnalysis from "@/components/analytics/revenue-analysis";
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
jest.mock("echarts/core", () => ({
  use: jest.fn(),
  graphic: { LinearGradient: jest.fn().mockReturnValue({}) },
}));
jest.mock("echarts/charts", () => ({ LineChart: {}, BarChart: {} }));
jest.mock("echarts/components", () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {} }));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  { name: "id", type: "number", nullCount: 0, uniqueCount: 10, sampleValues: [1, 2] },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 8,
    sampleValues: [100, 200],
  },
  {
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["A", "B"],
  },
];

async function renderRevenueAnalysis(): Promise<ReactNode> {
  const node: ReactNode = <RevenueAnalysis tableName="sales" columns={columns} />;

  await act(async () => {
    render(node);
  });

  return node;
}

describe("RevenueAnalysis", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders revenue analysis defaults", async () => {
    await renderRevenueAnalysis();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Revenue analysis dashboard",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Revenue column")).toHaveValue("id");
    expect(screen.getByText("Select a revenue column and run the analysis.")).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});
