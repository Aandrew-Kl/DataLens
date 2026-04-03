import { act, render, screen } from "@testing-library/react";

import EngagementMetrics from "@/components/analytics/engagement-metrics";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/hooks/use-dark-mode", () => ({
  useDarkMode: jest.fn().mockReturnValue(false),
}));
jest.mock("echarts-for-react/lib/core", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("echarts/core", () => ({
  use: jest.fn(),
  graphic: { LinearGradient: jest.fn().mockReturnValue({}) },
}));
jest.mock("echarts/charts", () => ({ LineChart: {}, BarChart: {}, ScatterChart: {}, PieChart: {}, HeatmapChart: {} }));
jest.mock("echarts/components", () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {} }));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "user_id",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["u1", "u2", "u3"],
  },
  {
    name: "event_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["2026-01-01", "2026-01-02", "2026-01-03"],
  },
  {
    name: "session_length",
    type: "number",
    nullCount: 1,
    uniqueCount: 5,
    sampleValues: [120, 300, 450],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<EngagementMetrics tableName="events" columns={columns} />);
  });
}

describe("EngagementMetrics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the initial engagement analysis workspace", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "User engagement analysis",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("User column")).toBeInTheDocument();
    expect(screen.getByLabelText("Date column")).toBeInTheDocument();
    expect(screen.getByLabelText("Session duration column (optional)")).toBeInTheDocument();
    expect(screen.getByText("Select user and date columns to analyze engagement.")).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});
