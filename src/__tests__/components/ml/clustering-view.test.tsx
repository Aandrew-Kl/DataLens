import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ClusteringView from "@/components/ml/clustering-view";
import { runQuery } from "@/lib/duckdb/client";
import { exportToCSV } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
  getTableRowCount: jest.fn().mockResolvedValue(100),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/",
}));

jest.mock("@/lib/utils/export", () => ({
  exportToCSV: jest.fn(),
}));

jest.mock("echarts-for-react/lib/core", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: React.forwardRef(function MockChart(
      props: Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) {
      return React.createElement("div", { ref, "data-testid": "echart" });
    }),
  };
});

jest.mock("echarts/core", () => ({ use: jest.fn() }));
jest.mock("echarts/charts", () => ({ ScatterChart: {} }));
jest.mock("echarts/components", () => ({
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}));
jest.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const mockRunQuery = jest.mocked(runQuery);
const mockExportToCSV = jest.mocked(exportToCSV);

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [100, 120],
  },
  {
    name: "profit",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [20, 30],
  },
  {
    name: "orders",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [4, 5],
  },
];

function mockKMeansRun() {
  mockRunQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("COUNT(*) AS cluster_size")) {
      return [
        { cluster_id: 0, cluster_size: 2, variance: 1.5, c1: 110, c2: 22 },
        { cluster_id: 1, cluster_size: 1, variance: 0.5, c1: 180, c2: 36 },
      ];
    }

    if (sql.includes("JOIN") && sql.includes("ORDER BY a.cluster_id, s.point_id")) {
      return [
        { point_id: 1, cluster_id: 0, f1: 100, f2: 20 },
        { point_id: 2, cluster_id: 0, f1: 120, f2: 24 },
        { point_id: 3, cluster_id: 1, f1: 180, f2: 36 },
      ];
    }

    return [];
  });
}

describe("ClusteringView", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockExportToCSV.mockReset();
    mockKMeansRun();
  });

  it("renders the clustering workspace with its default status", () => {
    const user = userEvent.setup();

    render(<ClusteringView tableName="orders" columns={columns} />);

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "K-means and DBSCAN in DuckDB SQL",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Pick 2-3 numeric columns and run clustering."),
    ).toBeInTheDocument();
    expect(screen.getByText("Selected features")).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument();

    void user;
  });

  it("blocks execution when fewer than two features are selected", async () => {
    const user = userEvent.setup();

    render(<ClusteringView tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "profit" }));
    await user.click(screen.getByRole("button", { name: "Run clustering" }));

    expect(
      screen.getByText("Select exactly 2 or 3 numeric columns for clustering."),
    ).toBeInTheDocument();
  });

  it("runs k-means and renders the resulting summary", async () => {
    const user = userEvent.setup();

    render(<ClusteringView tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Run clustering" }));

    await waitFor(() => {
      expect(
        screen.getByText("K-means completed with 2 clusters."),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Clusters found")).toBeInTheDocument();
    expect(
      screen.queryByText("Run clustering to inspect centroids, cluster sizes, and variance."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("110")).toBeInTheDocument();
    expect(screen.getByText("180")).toBeInTheDocument();
  });

  it("exports assignments after a successful run", async () => {
    const user = userEvent.setup();

    render(<ClusteringView tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Run clustering" }));

    await waitFor(() => {
      expect(
        screen.getByText("K-means completed with 2 clusters."),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(mockExportToCSV).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          point_id: 1,
          cluster_id: 0,
          revenue: 100,
          profit: 20,
        }),
      ]),
      "orders-kmeans-clusters.csv",
    );
  });
});
