import {
  act,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PercentileExplorer from "@/components/data/percentile-explorer";
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
    default: React.forwardRef(function MockChart(
      props: Record<string, unknown>,
      _ref: React.Ref<unknown>,
    ) {
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
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: [10, 20, 30],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: [15, 25, 35],
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
    render(<PercentileExplorer tableName="orders" columns={targetColumns} />);
  });

  await waitFor(() => {
    expect(
      screen.queryByText("Loading percentile explorer…"),
    ).not.toBeInTheDocument();
  });
}

describe("PercentileExplorer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("shows the empty state when no numeric columns exist", () => {
    render(
      <PercentileExplorer
        tableName="orders"
        columns={[
          {
            name: "segment",
            type: "string",
            nullCount: 0,
            uniqueCount: 3,
            sampleValues: ["A", "B"],
          },
        ]}
      />,
    );

    expect(
      screen.getByText(
        "Percentile exploration requires at least one numeric column.",
      ),
    ).toBeInTheDocument();
  });

  it("loads percentile curves and summary values", async () => {
    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('"profit"')) {
        return [
          { metric_value: 15 },
          { metric_value: 25 },
          { metric_value: 35 },
          { metric_value: 45 },
          { metric_value: 55 },
        ];
      }

      return [
        { metric_value: 10 },
        { metric_value: 20 },
        { metric_value: 30 },
        { metric_value: 40 },
        { metric_value: 50 },
      ];
    });

    await renderAsync();

    expect(await screen.findByText("P50 comparison")).toBeInTheDocument();
    expect(screen.getAllByText("30").length).toBeGreaterThan(0);
    expect(screen.getAllByText("35").length).toBeGreaterThan(0);

    const option = getChartOption();
    const series = option.series as Array<{ type?: string }>;
    expect(series).toHaveLength(2);
    expect(series[0]?.type).toBe("line");
  });

  it("exports percentile checkpoints as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('"profit"')) {
        return [
          { metric_value: 15 },
          { metric_value: 25 },
          { metric_value: 35 },
        ];
      }
      return [
        { metric_value: 10 },
        { metric_value: 20 },
        { metric_value: 30 },
      ];
    });

    await renderAsync();

    await user.click(
      screen.getByRole("button", { name: /Export percentile CSV/i }),
    );

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("percentile,sales,profit"),
      "orders-sales-percentiles.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("surfaces query failures", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("Percentile query failed"));

    await renderAsync();

    expect(
      await screen.findByText("Percentile query failed"),
    ).toBeInTheDocument();
  });
});
