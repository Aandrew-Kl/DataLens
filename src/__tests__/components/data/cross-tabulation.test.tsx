import {
  act,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CrossTabulation from "@/components/data/cross-tabulation";
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
    default: React.forwardRef(function MockChart(props: Record<string, unknown>) {
      chartPropsSpy(props);
      return React.createElement("div", { "data-testid": "echart" });
    }),
  };
});

jest.mock("echarts/charts", () => ({}));
jest.mock("echarts/components", () => ({}));
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/renderers", () => ({}));

const mockRunQuery = jest.mocked(runQuery);
const mockDownloadFile = jest.mocked(downloadFile);

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["East", "West"],
  },
  {
    name: "channel",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Online", "Retail"],
  },
];

function getChartOption() {
  const lastCall = chartPropsSpy.mock.calls.at(-1);
  const firstArg = lastCall?.[0];

  if (
    typeof firstArg === "object" &&
    firstArg !== null &&
    "option" in firstArg &&
    typeof firstArg.option === "object" &&
    firstArg.option !== null
  ) {
    return firstArg.option as Record<string, unknown>;
  }

  return {};
}

async function renderAsync(targetColumns = columns) {
  await act(async () => {
    render(<CrossTabulation tableName="orders" columns={targetColumns} />);
  });

  await waitFor(() => {
    expect(
      screen.queryByText("Building contingency table…"),
    ).not.toBeInTheDocument();
  });
}

describe("CrossTabulation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("shows the empty state when there are not enough categorical columns", () => {
    render(
      <CrossTabulation
        tableName="orders"
        columns={[
          {
            name: "sales",
            type: "number",
            nullCount: 0,
            uniqueCount: 4,
            sampleValues: [10, 20],
          },
        ]}
      />,
    );

    expect(
      screen.getByText(
        "Cross tabulation requires at least two low-cardinality categorical columns.",
      ),
    ).toBeInTheDocument();
  });

  it("loads chi-square metrics and the residual heatmap", async () => {
    mockRunQuery.mockResolvedValue([
      { row_key: "East", column_key: "Online", observed_count: 30 },
      { row_key: "East", column_key: "Retail", observed_count: 10 },
      { row_key: "West", column_key: "Online", observed_count: 10 },
      { row_key: "West", column_key: "Retail", observed_count: 30 },
    ]);

    await renderAsync();

    expect(await screen.findByText("region by channel")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("0.500")).toBeInTheDocument();
    expect(screen.getAllByText("30 observed")).toHaveLength(2);
    expect(screen.getAllByText("20 expected")).toHaveLength(4);

    const option = getChartOption();
    const series = option.series as Array<{ type?: string }>;
    expect(series[0]?.type).toBe("heatmap");
  });

  it("exports the contingency table", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { row_key: "East", column_key: "Online", observed_count: 30 },
      { row_key: "East", column_key: "Retail", observed_count: 10 },
      { row_key: "West", column_key: "Online", observed_count: 10 },
      { row_key: "West", column_key: "Retail", observed_count: 30 },
    ]);

    await renderAsync();

    await user.click(
      screen.getByRole("button", { name: /Export contingency CSV/i }),
    );

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("row,column,observed,expected,residual"),
      "orders-region-channel-cross-tabulation.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("surfaces query failures", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("Contingency query failed"));

    await renderAsync();

    expect(
      await screen.findByText("Contingency query failed"),
    ).toBeInTheDocument();
  });
});
