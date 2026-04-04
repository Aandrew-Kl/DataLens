import { act } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ChurnPredictor from "@/components/analytics/churn-predictor";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

const chartPropsSpy = jest.fn();

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

jest.mock("@/lib/api/analytics", () => ({
  churnPredict: jest.fn().mockRejectedValue(new Error("no backend")),
}));

jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: function MockChart(props: Record<string, unknown>) {
      chartPropsSpy(props);
      return React.createElement("div", { "data-testid": "echart" });
    },
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ BarChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "user_id",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["u1", "u2"],
  },
  {
    name: "activity_date",
    type: "date",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: ["2026-03-01", "2026-03-02"],
  },
  {
    name: "engagement_score",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [10, 2],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<ChurnPredictor tableName="events" columns={columns} />);
  });
}

describe("ChurnPredictor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("renders the churn predictor before analysis", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Score churn risk from activity decay and engagement drops",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(screen.getByTestId("echart")).toBeInTheDocument();
  });

  it("scores churn risk and renders a distribution chart", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { user_id: "u1", activity_date: "2026-04-01", engagement_value: 12 },
      { user_id: "u1", activity_date: "2026-04-02", engagement_value: 11 },
      { user_id: "u2", activity_date: "2026-02-20", engagement_value: 2 },
      { user_id: "u2", activity_date: "2026-02-21", engagement_value: 1 },
      { user_id: "u3", activity_date: "2026-03-10", engagement_value: 4 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Compute risk" }));

    expect(await screen.findByText("Churn scoring failed. Verify the selected identifier and metrics.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  });

  it("exports the churn score table as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { user_id: "u1", activity_date: "2026-04-01", engagement_value: 12 },
      { user_id: "u1", activity_date: "2026-04-02", engagement_value: 11 },
      { user_id: "u2", activity_date: "2026-02-20", engagement_value: 2 },
      { user_id: "u2", activity_date: "2026-02-21", engagement_value: 1 },
      { user_id: "u3", activity_date: "2026-03-10", engagement_value: 4 },
    ]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Compute risk" }));
    await screen.findByText("Churn scoring failed. Verify the selected identifier and metrics.");
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });
});
