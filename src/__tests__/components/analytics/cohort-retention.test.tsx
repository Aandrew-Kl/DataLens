import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CohortRetention from "@/components/analytics/cohort-retention";
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
jest.mock("echarts/charts", () => ({
  HeatmapChart: {},
  ScatterChart: {},
}));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
  VisualMapComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "signup_date",
    type: "date",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: [],
  },
  {
    name: "user_id",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["u1", "u2"],
  },
];

const cohortRows = [
  { __event_date: "2026-01-05", __user_id: "u1" },
  { __event_date: "2026-02-02", __user_id: "u1" },
  { __event_date: "2026-01-11", __user_id: "u2" },
  { __event_date: "2026-02-06", __user_id: "u3" },
  { __event_date: "2026-03-09", __user_id: "u3" },
];

async function renderAsync() {
  await act(async () => {
    render(<CohortRetention tableName="orders" columns={columns} />);
  });
}

describe("CohortRetention", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
    mockRunQuery.mockResolvedValue(cohortRows);
  });

  it("renders the initial guidance state", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Monthly cohort retention",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Build monthly cohorts to map retention and reveal drop-off points.",
      ),
    ).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  });

  it("builds monthly cohorts and renders the heatmap summary", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Build cohorts" }));

    expect(
      await screen.findByText("Processed 3 users across 2 cohorts."),
    ).toBeInTheDocument();
    expect(screen.getByText("75.0%")).toBeInTheDocument();
    expect(screen.getAllByText("2026-02").length).toBeGreaterThan(0);
    expect(screen.getAllByText("M1").length).toBeGreaterThan(0);

    const option = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
      series?: Array<{ type?: string }>;
    };
    expect(option.series?.[0]?.type).toBe("heatmap");
    expect(option.series?.[1]?.type).toBe("scatter");
  });

  it("exports the cohort retention rows as CSV", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Build cohorts" }));
    await screen.findByText("Processed 3 users across 2 cohorts.");

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalledWith(
        expect.stringContaining("cohort_month,month_offset"),
        "orders-signup_date-cohort-retention.csv",
        "text/csv;charset=utf-8;",
      );
    });
  });
});
