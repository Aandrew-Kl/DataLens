import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";

import NetworkGraph from "@/components/charts/network-graph";
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
jest.mock("echarts/charts", () => ({ GraphChart: {} }));
jest.mock("echarts/components", () => ({ TooltipComponent: {} }));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const { chartPropsSpy } = jest.requireMock("echarts-for-react/lib/core") as {
  chartPropsSpy: jest.Mock;
};

const networkColumns: ColumnProfile[] = [
  {
    name: "source",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Alice", "Bob"],
  },
  {
    name: "target",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["Carol", "Dana"],
  },
  {
    name: "amount",
    type: "number",
    nullCount: 0,
    uniqueCount: 6,
    sampleValues: [1, 2, 3],
  },
];

async function renderNetwork(columns = networkColumns) {
  await act(async () => {
    render(<NetworkGraph tableName="relationships" columns={columns} />);
  });
}

function getLatestChartProps() {
  const latestCall = chartPropsSpy.mock.calls.at(-1);
  return (latestCall?.[0] ?? {}) as Record<string, unknown>;
}

describe("NetworkGraph", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chartPropsSpy.mockClear();
  });

  it("shows an empty state when fewer than two categorical columns are available", async () => {
    await renderNetwork([
      {
        name: "amount",
        type: "number",
        nullCount: 0,
        uniqueCount: 6,
        sampleValues: [1, 2, 3],
      },
    ]);

    expect(
      await screen.findByText(
        "At least two categorical columns are required to derive source and target nodes.",
      ),
    ).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("renders graph data and highlights a clicked node", async () => {
    mockRunQuery.mockResolvedValue([
      { source_name: "Alice", target_name: "Bob", edge_value: 6 },
      { source_name: "Alice", target_name: "Carol", edge_value: 4 },
      { source_name: "Bob", target_name: "Dana", edge_value: 3 },
    ]);

    await renderNetwork();

    expect(await screen.findByText("Densest node")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();

    const initialProps = getLatestChartProps();
    const initialOption = initialProps.option as {
      series?: Array<{ data?: Array<Record<string, unknown>> }>;
    };
    const initialNode = initialOption.series?.[0]?.data?.find((node) => node.name === "Alice");

    expect(initialNode?.itemStyle).toMatchObject({ borderWidth: expect.any(Number) });

    const onEvents = initialProps.onEvents as { click?: (params: unknown) => void };
    await act(async () => {
      onEvents.click?.({ dataType: "node", name: "Alice" });
    });

    await waitFor(() => {
      expect(screen.getByText("Focus: Alice")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
      expect(screen.getByText("Carol")).toBeInTheDocument();
    });

    const selectedProps = getLatestChartProps();
    const selectedOption = selectedProps.option as {
      series?: Array<{ data?: Array<Record<string, unknown>> }>;
    };
    const selectedNode = selectedOption.series?.[0]?.data?.find((node) => node.name === "Alice");

    expect(selectedNode?.itemStyle).toMatchObject({ borderWidth: 3 });
  });

  it("surfaces DuckDB failures", async () => {
    mockRunQuery.mockRejectedValue(new Error("Network failed"));

    await renderNetwork();

    expect(await screen.findByText("Network failed")).toBeInTheDocument();
  });
});
