import { act } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SurvivalAnalysis from "@/components/ml/survival-analysis";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

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
    default: function MockChart() {
      return React.createElement("div", { "data-testid": "echart" });
    },
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ BarChart: {}, LineChart: {} }));
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
    name: "days_to_event",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [1, 2, 3],
  },
  {
    name: "event_flag",
    type: "boolean",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [true, false],
  },
];

async function renderAsync(targetColumns = columns) {
  await act(async () => {
    render(<SurvivalAnalysis tableName="patients" columns={targetColumns} />);
  });
}

describe("SurvivalAnalysis", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the empty state when the required columns are missing", async () => {
    await renderAsync([
      {
        name: "group",
        type: "string",
        nullCount: 0,
        uniqueCount: 3,
        sampleValues: ["A", "B"],
      },
    ]);

    expect(
      screen.getByText(
        "Survival analysis needs one numeric time column and one binary event column.",
      ),
    ).toBeInTheDocument();
  });

  it("estimates the Kaplan-Meier curve and renders the risk table", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { observed_time: 1, observed_event: "true" },
      { observed_time: 2, observed_event: "false" },
      { observed_time: 3, observed_event: "true" },
      { observed_time: 4, observed_event: "true" },
    ]);

    await renderAsync();

    await user.click(screen.getByRole("button", { name: "Estimate survival" }));

    expect(await screen.findByText("Risk table")).toBeInTheDocument();
    expect(screen.getByText("3.00")).toBeInTheDocument();
  });

  it("exports the survival table as CSV", async () => {
    const user = userEvent.setup();
    mockRunQuery.mockResolvedValue([
      { observed_time: 1, observed_event: "true" },
      { observed_time: 2, observed_event: "false" },
      { observed_time: 3, observed_event: "true" },
      { observed_time: 4, observed_event: "true" },
    ]);

    await renderAsync();

    await user.click(screen.getByRole("button", { name: "Estimate survival" }));
    await screen.findByText("Risk table");
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("time,at_risk,events,censored,survival,hazard"),
      "patients-days_to_event-event_flag-survival-analysis.csv",
      "text/csv;charset=utf-8;",
    );
  });
});
