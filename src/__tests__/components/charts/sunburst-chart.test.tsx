import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";

import SunburstChart from "@/components/charts/sunburst-chart";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("echarts-for-react/lib/core", () => {
  const chartPropsSpy = jest.fn();
  const React = require("react") as typeof import("react");
  return {
    __esModule: true,
    default: React.forwardRef(function MockChart(
      props: Record<string, unknown>,
      _ref: React.Ref<unknown>,
    ) {
      chartPropsSpy(props);
      return React.createElement("div", {
        "data-testid": "echart",
        "data-option": JSON.stringify(props.option ?? null),
      });
    }),
    chartPropsSpy,
  };
});
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ SunburstChart: {} }));
jest.mock("echarts/components", () => ({ TooltipComponent: {} }));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const { chartPropsSpy } = jest.requireMock("echarts-for-react/lib/core") as {
  chartPropsSpy: jest.Mock;
};

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["North", "South"],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Retail", "SMB"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [10, 20],
  },
];

async function renderAsync(nextColumns = columns) {
  await act(async () => {
    render(<SunburstChart tableName="sales" columns={nextColumns} />);
  });
}

function getLatestChartProps() {
  const latestCall = chartPropsSpy.mock.calls.at(-1);
  return (latestCall?.[0] ?? {}) as Record<string, unknown>;
}

describe("SunburstChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
    mockRunQuery.mockResolvedValue([
      { region: "North", segment: "Retail", revenue: 120 },
      { region: "North", segment: "SMB", revenue: 80 },
      { region: "South", segment: "Retail", revenue: 60 },
    ]);
  });

  it("shows an error when there are not enough hierarchy columns", async () => {
    await renderAsync([
      columns[0],
      columns[2],
    ]);

    expect(
      await screen.findByText("Choose at least two hierarchy columns and one numeric value column."),
    ).toBeInTheDocument();
  });

  it("renders a sunburst option with the computed total", async () => {
    await renderAsync();

    await waitFor(() => {
      expect(screen.getByTestId("echart")).toBeInTheDocument();
    });

    expect(screen.getByText(/Total value:\s*260/)).toBeInTheDocument();
    const option = JSON.parse(screen.getByTestId("echart").getAttribute("data-option") ?? "{}") as {
      series?: Array<{ type?: string }>;
    };
    expect(option.series?.[0]?.type).toBe("sunburst");
  });

  it("updates the breadcrumb path when a node is clicked", async () => {
    await renderAsync();

    await waitFor(() => {
      expect(screen.getByTestId("echart")).toBeInTheDocument();
    });

    const onEvents = getLatestChartProps().onEvents as { click?: (params: unknown) => void };
    await act(async () => {
      onEvents.click?.({
        treePathInfo: [{ name: "North" }, { name: "Retail" }],
      });
    });

    await waitFor(() => {
      expect(screen.getByText("North / Retail")).toBeInTheDocument();
    });
  });
});
