import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";

import OutlierReport from "@/components/data/outlier-report";
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
    uniqueCount: 6,
    sampleValues: [10, 100],
  },
  {
    name: "category",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["A", "B"],
  },
];

const reportRows = [
  { __row_id: 1, amount: 10, category: "A", __metric: 10 },
  { __row_id: 2, amount: 10, category: "A", __metric: 10 },
  { __row_id: 3, amount: 10, category: "A", __metric: 10 },
  { __row_id: 4, amount: 10, category: "A", __metric: 10 },
  { __row_id: 5, amount: 10, category: "A", __metric: 10 },
  { __row_id: 6, amount: 100, category: "B", __metric: 100 },
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
    render(<OutlierReport tableName="orders" columns={columns} />);
  });

  await waitForReady();
}

async function waitForReady() {
  await waitFor(() => {
    expect(
      screen.queryByText("Building outlier report…"),
    ).not.toBeInTheDocument();
  });
}

describe("OutlierReport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
    mockRunQuery.mockResolvedValue(reportRows);
  });

  it("renders an empty state when no numeric columns are present", () => {
    render(
      <OutlierReport
        tableName="orders"
        columns={[
          {
            name: "category",
            type: "string",
            nullCount: 0,
            uniqueCount: 2,
            sampleValues: ["A", "B"],
          },
        ]}
      />,
    );

    expect(
      screen.getByText("No numeric columns available for outlier analysis."),
    ).toBeInTheDocument();
  });

  it("shows analysis errors", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("Outlier query failed"));

    await renderAsync();

    expect(screen.getByText("Outlier query failed")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId("echart")).not.toBeInTheDocument();
    });
  });
});
