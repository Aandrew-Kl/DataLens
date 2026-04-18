import { Suspense, act, type ReactNode } from "react";
import { render, screen, waitFor, type RenderResult } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import DataOpsPage from "@/app/(workspace)/data-ops/page";
import SqlPage from "@/app/(workspace)/sql/page";
import DonutChart from "@/components/charts/donut-chart";
import StackedBarChart from "@/components/charts/stacked-bar-chart";
import SteppedLineChart from "@/components/charts/stepped-line-chart";
import { DataLensSocket } from "@/lib/api/websocket";
import { runQuery } from "@/lib/duckdb/client";
import { useDatasetStore } from "@/stores/dataset-store";
import { useQueryStore } from "@/stores/query-store";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";

expect.extend(toHaveNoViolations);

jest.mock("framer-motion");
jest.mock("@/lib/api/websocket", () => {
  const actual = jest.requireActual("@/lib/api/websocket");

  return {
    ...actual,
    DataLensSocket: jest.fn(),
  };
});
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));
jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual<typeof import("react")>("react");

  return {
    __esModule: true,
    default: React.forwardRef(function MockChart(
      _props: Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) {
      React.useImperativeHandle(ref, () => ({
        getEchartsInstance: () => ({
          getDataURL: () => "data:image/png;base64,Zm9v",
        }),
      }));

      return React.createElement("div", { "data-testid": "mock-echarts" });
    }),
  };
});
jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({
  LineChart: {},
  BarChart: {},
  PieChart: {},
}));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockSocketConstructor = jest.mocked(DataLensSocket);
const mockRunQuery = jest.mocked(runQuery);

const chartColumns: ColumnProfile[] = [
  {
    name: "ordered_at",
    type: "date",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["2026-01-01", "2026-01-02"],
  },
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["East", "West", "North"],
  },
  {
    name: "product",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Widget", "Gadget"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [100, 120],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [30, 36],
  },
];

const salesDataset: DatasetMeta = {
  id: "sales",
  name: "Sales",
  fileName: "sales.csv",
  rowCount: 420,
  columnCount: chartColumns.length,
  columns: chartColumns,
  uploadedAt: 1_700_000_000_000,
  sizeBytes: 4096,
};

const socketInstance = {
  connect: jest.fn(),
  disconnect: jest.fn(),
  send: jest.fn(),
  onMessage: jest.fn(),
  onProgress: jest.fn(),
  onConnectionStateChange: jest.fn(),
};

function resetStores() {
  useDatasetStore.setState({ datasets: [], activeDatasetId: null });
  useQueryStore.setState({ history: [], lastResult: null, isQuerying: false });
}

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div role="status">Loading workspace content</div>}>
      {children}
    </Suspense>
  );
}

async function renderDataOpsPage(): Promise<RenderResult> {
  await act(async () => {
    useDatasetStore.setState({
      datasets: [salesDataset],
      activeDatasetId: salesDataset.id,
    });
  });

  return render(<DataOpsPage />, { wrapper: TestProviders }) as RenderResult;
}

async function renderStackedBarChart(): Promise<RenderResult> {
  let view!: RenderResult;

  await act(async () => {
    view = render(
      <StackedBarChart tableName="orders" columns={chartColumns} />,
    );
  });

  return view;
}

async function renderDonutChart(): Promise<RenderResult> {
  let view!: RenderResult;

  await act(async () => {
    view = render(
      <DonutChart tableName="orders" columns={chartColumns} />,
    );
  });

  return view;
}

describe("a11y smoke tests: workspace pages and charts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    document.body.style.overflow = "";
    resetStores();
    mockSocketConstructor.mockImplementation(
      () => socketInstance as unknown as DataLensSocket,
    );
  });

  afterEach(() => {
    window.localStorage.clear();
    resetStores();
  });

  it("data-ops page has no a11y violations", async () => {
    const { container } = await renderDataOpsPage();

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Data Operations" }),
      ).toBeInTheDocument();
    });

    expect(await axe(container)).toHaveNoViolations();
  });

  it("sql page has no a11y violations", async () => {
    useDatasetStore.setState({
      datasets: [salesDataset],
      activeDatasetId: salesDataset.id,
    });

    const { container } = render(<SqlPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "SQL Editor" }),
      ).toBeInTheDocument();
    });

    expect(await axe(container)).toHaveNoViolations();
  });

  it("stepped line chart wrapper has no a11y violations", async () => {
    const { container } = render(
      <SteppedLineChart tableName="orders" columns={chartColumns} />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          level: 2,
          name: "Compare series transitions with explicit step boundaries",
        }),
      ).toBeInTheDocument();
    });

    expect(await axe(container)).toHaveNoViolations();
  });

  it("stacked bar chart wrapper has no a11y violations", async () => {
    mockRunQuery.mockResolvedValue([
      { category: "East", series: "Widget", value: 100 },
      { category: "East", series: "Gadget", value: 80 },
      { category: "West", series: "Widget", value: 120 },
      { category: "West", series: "Gadget", value: 60 },
    ]);

    const { container } = await renderStackedBarChart();

    await waitFor(() => {
      expect(screen.getByText(/2 series/i)).toBeInTheDocument();
    });

    expect(await axe(container)).toHaveNoViolations();
  });

  it("pie chart wrapper has no a11y violations", async () => {
    mockRunQuery.mockResolvedValue([
      { category_label: "North", metric_value: 100 },
      { category_label: "South", metric_value: 60 },
    ]);

    const { container } = await renderDonutChart();

    await waitFor(() => {
      expect(
        screen.getByText("Compare category share with a hover-highlighted ring"),
      ).toBeInTheDocument();
    });

    expect(await axe(container)).toHaveNoViolations();
  });
});
