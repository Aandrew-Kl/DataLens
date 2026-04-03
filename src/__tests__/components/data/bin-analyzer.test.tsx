import {
  act,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import BinAnalyzer from "@/components/data/bin-analyzer";
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
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: [5, 10, 15],
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
    render(<BinAnalyzer tableName="orders" columns={targetColumns} />);
  });

  await waitFor(() => {
    expect(screen.queryByText("Building bins…")).not.toBeInTheDocument();
  });
}

describe("BinAnalyzer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("shows the empty state when no numeric columns exist", () => {
    render(
      <BinAnalyzer
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
      screen.getByText("Bin analysis requires at least one numeric column."),
    ).toBeInTheDocument();
  });

  it("loads bin statistics and a distribution chart", async () => {
    mockRunQuery.mockResolvedValue([
      { metric_value: 5 },
      { metric_value: 8 },
      { metric_value: 12 },
      { metric_value: 18 },
      { metric_value: 25 },
    ]);

    await renderAsync();

    expect(await screen.findByText("equal-width bins for amount")).toBeInTheDocument();
    expect(screen.getByText("Bin distribution")).toBeInTheDocument();

    const option = getChartOption();
    const series = option.series as Array<{ type?: string }>;
    expect(series[0]?.type).toBe("bar");
  });

  it("exports per-bin statistics as CSV", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([
      { metric_value: 5 },
      { metric_value: 8 },
      { metric_value: 12 },
      { metric_value: 18 },
      { metric_value: 25 },
    ]);

    await renderAsync();

    await user.click(screen.getByRole("button", { name: /Export bins CSV/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("label,lower,upper,count,mean,min,max"),
      "orders-amount-equal-width-bins.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("surfaces query failures", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("Bin query failed"));

    await renderAsync();

    expect(await screen.findByText("Bin query failed")).toBeInTheDocument();
  });
});
