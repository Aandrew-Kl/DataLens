import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";

import ChangeImpactAnalyzer from "@/components/data/change-impact-analyzer";
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
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [10, 20, 30],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["A", "B"],
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

async function renderAsync() {
  await act(async () => {
    render(<ChangeImpactAnalyzer tableName="orders" columns={columns} />);
  });

  await waitForReady();
}

async function waitForReady() {
  await waitFor(() => {
    expect(
      screen.queryByText("Simulating scenario impact…"),
    ).not.toBeInTheDocument();
  });
}

describe("ChangeImpactAnalyzer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
    mockRunQuery.mockResolvedValue([
      { value: 10 },
      { value: 20 },
      { value: 30 },
      { value: 40 },
    ]);
  });

  it("renders an empty state when no numeric columns exist", () => {
    render(
      <ChangeImpactAnalyzer
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
        "No numeric columns available for what-if impact analysis.",
      ),
    ).toBeInTheDocument();
  });

  it("loads the default multiplier scenario and renders summary cards", async () => {
    await renderAsync();

    expect(
      screen.getByText("Applying a 1.10x multiplier to revenue"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("+10.0%").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Export comparison CSV/i })).toBeEnabled();
  });

  it("exports the comparison report as CSV", async () => {
    const user = userEvent.setup();

    await renderAsync();

    await user.click(screen.getByRole("button", { name: /Export comparison CSV/i }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("summary,mean"),
      "orders-revenue-impact-comparison.csv",
      "text/csv;charset=utf-8;",
    );
  });

  it("surfaces DuckDB failures", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("Simulation failed"));

    await renderAsync();

    expect(screen.getByText("Simulation failed")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId("echart")).not.toBeInTheDocument();
    });
  });
});
