import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import FunnelAnalysis from "@/components/analytics/funnel-analysis";
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
jest.mock("echarts/charts", () => ({ FunnelChart: {} }));
jest.mock("echarts/components", () => ({
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "visited",
    type: "boolean",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [true, false],
  },
  {
    name: "signed_up",
    type: "boolean",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [true, false],
  },
  {
    name: "activated",
    type: "boolean",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [true, false],
  },
  {
    name: "purchased",
    type: "boolean",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [true, false],
  },
];

const funnelRows = [
  { visited: true, signed_up: true, activated: true, purchased: true },
  { visited: true, signed_up: true, activated: false, purchased: false },
  { visited: true, signed_up: false, activated: false, purchased: false },
  { visited: true, signed_up: true, activated: true, purchased: false },
];

async function renderAsync() {
  await act(async () => {
    render(<FunnelAnalysis tableName="orders" columns={columns} />);
  });
}

describe("FunnelAnalysis", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
    mockRunQuery.mockResolvedValue(funnelRows);
  });

  it("renders the initial funnel workspace", async () => {
    await renderAsync();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Conversion funnel analysis",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Choose at least two step columns, then build the funnel."),
    ).toHaveLength(2);
  });

  it("blocks analysis when fewer than two steps are selected", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "signed_up" }));
    await user.click(screen.getByRole("button", { name: "activated" }));
    await user.click(screen.getByRole("button", { name: "purchased" }));
    await user.click(screen.getByRole("button", { name: "Build funnel" }));

    expect(
      screen.getByText("Select at least two funnel step columns."),
    ).toBeInTheDocument();
  });

  it("builds the funnel summary and renders the funnel chart", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Build funnel" }));

    expect(
      await screen.findByText("Overall conversion 25.0% across 4 rows."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("purchased").length).toBeGreaterThan(0);
    expect(screen.getAllByText("50.0%").length).toBeGreaterThan(0);

    const option = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
      series?: Array<{ type?: string }>;
    };
    expect(option.series?.[0]?.type).toBe("funnel");
  });

  it("exports the funnel step metrics as CSV", async () => {
    const user = userEvent.setup();

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Build funnel" }));
    await screen.findByText("Overall conversion 25.0% across 4 rows.");

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalledWith(
        expect.stringContaining("step,count,conversion_rate"),
        "orders-funnel-analysis.csv",
        "text/csv;charset=utf-8;",
      );
    });
  });
});
