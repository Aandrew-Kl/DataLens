import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DataTypeOverview from "@/components/data/data-type-overview";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));
jest.mock("echarts-for-react/lib/core", () => {
  const chartPropsSpy = jest.fn();
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      chartPropsSpy(props);
      return null;
    },
    chartPropsSpy,
  };
});
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ PieChart: {} }));
jest.mock("echarts/components", () => ({
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const { chartPropsSpy } = jest.requireMock("echarts-for-react/lib/core") as {
  chartPropsSpy: jest.Mock;
};

const columns: ColumnProfile[] = [
  {
    name: "status",
    type: "string",
    nullCount: 5,
    uniqueCount: 3,
    sampleValues: ["open", "closed"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 2,
    uniqueCount: 10,
    sampleValues: [100, 200],
  },
];

async function renderAsync(tableName: string, targetColumns: ColumnProfile[]) {
  await act(async () => {
    render(<DataTypeOverview tableName={tableName} columns={targetColumns} />);
  });
}

describe("DataTypeOverview", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("renders the donut chart and column inventory", async () => {
    mockRunQuery.mockResolvedValue([{ total_rows: 100 }]);

    await renderAsync("orders-overview-1", columns);

    expect(await screen.findByText("Column inventory")).toBeInTheDocument();
    expect(screen.getByText("status")).toBeInTheDocument();
    expect(screen.getByText("revenue")).toBeInTheDocument();

    await waitFor(() => {
      const option = chartPropsSpy.mock.calls.at(-1)?.[0]?.option as {
        series?: Array<{ type?: string }>;
      };
      expect(option.series?.[0]?.type).toBe("pie");
    });
  });

  it("loads sample values for a clicked column", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*)")) {
        return [{ total_rows: 50 }];
      }
      if (sql.includes('"status"')) {
        return [{ sample_value: "active" }, { sample_value: "inactive" }];
      }
      return [];
    });

    await renderAsync("orders-overview-2", columns);
    await screen.findByText("Column inventory");
    await user.click(screen.getByRole("button", { name: /status/i }));

    expect(await screen.findByText("active")).toBeInTheDocument();
    expect(screen.getByText("inactive")).toBeInTheDocument();
  });

  it("shows an empty state when no columns are provided", async () => {
    await renderAsync("orders-overview-3", []);

    expect(
      screen.getByText(/Add profiled columns to inspect type distribution/i),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});
