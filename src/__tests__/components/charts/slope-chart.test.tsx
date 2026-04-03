import { act, render, screen } from "@testing-library/react";

import SlopeChart from "@/components/charts/slope-chart";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/hooks/use-dark-mode", () => ({
  useDarkMode: jest.fn().mockReturnValue(false),
}));

jest.mock("framer-motion");
jest.mock("echarts-for-react/lib/core", () => ({ __esModule: true, default: () => null }));
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ LineChart: {} }));
jest.mock("echarts/components", () => ({ GridComponent: {}, TooltipComponent: {} }));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockUseDarkMode = jest.mocked(useDarkMode);

const columns: ColumnProfile[] = [
  {
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: ["A", "B"],
  },
  {
    name: "value",
    type: "number",
    nullCount: 0,
    uniqueCount: 10,
    sampleValues: [1, 2],
  },
];

async function renderSlopeChart() {
  await act(async () => {
    render(<SlopeChart tableName="sales" columns={columns} />);
  });
}

describe("SlopeChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunQuery.mockResolvedValue([]);
    mockUseDarkMode.mockReturnValue(false);
  });

  it("renders the slope chart workspace and defaults", async () => {
    await renderSlopeChart();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Compare before-and-after movement between two periods",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Slope category column")).toHaveValue("category");
    expect(screen.getByLabelText("Slope period A column")).toHaveValue("value");
    expect(screen.getByLabelText("Slope period B column")).toHaveValue("value");
    expect(screen.getByText("Pick a category and two measure columns to compare before-versus-after movement.")).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});
