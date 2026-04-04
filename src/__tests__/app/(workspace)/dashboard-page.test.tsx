import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DashboardPage from "@/app/(workspace)/dashboard/page";
import { exportToCSV } from "@/lib/utils/export";
import { runQuery } from "@/lib/duckdb/client";
import type { DatasetMeta, ColumnProfile } from "@/types/dataset";
import type { SavedChartConfig } from "@/stores/chart-store";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/dashboard",
}));

jest.mock("framer-motion", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const MotionComponent = React.forwardRef(function MotionComponent(
    props: { children?: React.ReactNode } & Record<string, unknown>,
    ref: React.ForwardedRef<Element>,
  ) {
    return React.createElement("div", { ...props, ref }, props.children);
  });

  return {
    __esModule: true,
    motion: new Proxy(
      {},
      {
        get: () => MotionComponent,
      },
    ),
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
  };
});

jest.mock("echarts", () => ({}));

jest.mock("echarts-for-react", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

jest.mock("@/lib/utils/export", () => ({
  exportToCSV: jest.fn(),
  formatBytes: () => "1 MB",
}));

jest.mock("@/components/query/query-history", () => ({
  __esModule: true,
  default: () => <div>Query history placeholder</div>,
}));

const mockRunQuery = jest.mocked(runQuery);
const mockExportToCSV = jest.mocked(exportToCSV);

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["East", "West"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: [10, 20, 30],
  },
];

const defaultDataset: DatasetMeta = {
  id: "dataset-1",
  name: "Sales",
  fileName: "sales_data.csv",
  rowCount: 420,
  columnCount: 2,
  columns,
  uploadedAt: Date.now() - 3600_000,
  sizeBytes: 1024 * 1024,
};

const savedChart: SavedChartConfig = {
  id: "chart-1",
  type: "bar",
  title: "Revenue by region",
  xAxis: "region",
  yAxis: "revenue",
  createdAt: Date.now() - 120_000,
  updatedAt: Date.now() - 60_000,
  columns: ["region", "revenue"],
  options: {
    datasetId: defaultDataset.id,
  },
};

let datasetState = {
  datasets: [defaultDataset],
  activeDatasetId: defaultDataset.id,
  addDataset: jest.fn(),
  removeDataset: jest.fn(),
  setActiveDataset: jest.fn(),
  getActiveDataset: jest.fn(),
};

let queryStoreState = {
  history: [],
  lastResult: null,
  isQuerying: false,
  addToHistory: jest.fn(),
  setLastResult: jest.fn(),
  setIsQuerying: jest.fn(),
};

jest.mock("@/stores/dataset-store", () => ({
  useDatasetStore: jest.fn((selector) => {
    return typeof selector === "function" ? selector(datasetState) : datasetState;
  }),
}));

jest.mock("@/stores/query-store", () => ({
  useQueryStore: jest.fn((selector) => {
    return typeof selector === "function" ? selector(queryStoreState) : queryStoreState;
  }),
}));

const chartStoreState = {
  savedCharts: [savedChart],
  activeChartId: savedChart.id,
  chartHistory: [savedChart],
  addChart: jest.fn(),
  removeChart: jest.fn(),
  updateChart: jest.fn(),
  duplicateChart: jest.fn(),
  reorderCharts: jest.fn(),
  clearAll: jest.fn(),
};

jest.mock("@/stores/chart-store", () => ({
  useChartStore: Object.assign(
    jest.fn((selector) => {
      return typeof selector === "function" ? selector(chartStoreState) : chartStoreState;
    }),
    {
      setState: jest.fn(),
    },
  ),
}));

const mockedChartStoreModule = jest.requireMock("@/stores/chart-store") as {
  useChartStore: jest.Mock & { setState: jest.Mock };
};

const mockSetChartState = mockedChartStoreModule.useChartStore.setState;

jest.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: jest.fn((selector) => {
    const state = {
      isLoading: false,
      profileData: [],
      loadError: null,
      showUploader: false,
      showSettings: false,
      showCommandPalette: false,
      showKeyboardShortcuts: false,
      showExportWizard: false,
      showSharePanel: false,
      previewRows: [],
      selectedPreviewRow: null,
      selectedPreviewRowIndex: null,
      selectedAdvancedColumn: null,
      showColumnDetail: false,
      analyticsColumnName: "",
      savedCharts: [],
      setProfileData: jest.fn(),
      setIsLoading: jest.fn(),
      setLoadError: jest.fn(),
      toggleUploader: jest.fn(),
      setShowUploader: jest.fn(),
      toggleSettings: jest.fn(),
      setShowSettings: jest.fn(),
      toggleCommandPalette: jest.fn(),
      setShowCommandPalette: jest.fn(),
      toggleKeyboardShortcuts: jest.fn(),
      setShowKeyboardShortcuts: jest.fn(),
      toggleExportWizard: jest.fn(),
      setShowExportWizard: jest.fn(),
      toggleSharePanel: jest.fn(),
      setShowSharePanel: jest.fn(),
      setPreviewRows: jest.fn(),
      setSelectedPreviewRow: jest.fn(),
      clearPreviewSelection: jest.fn(),
      setSelectedAdvancedColumn: jest.fn(),
      setShowColumnDetail: jest.fn(),
      setAnalyticsColumnName: jest.fn(),
      setSavedCharts: jest.fn(),
      addSavedChart: jest.fn(),
      removeSavedChart: jest.fn(),
    };

    return typeof selector === "function" ? selector(state) : state;
  }),
}));

jest.mock("@/stores/pipeline-store", () => ({
  usePipelineStore: jest.fn(() => ({
    pipelines: [],
    activePipelineId: null,
    executionHistory: [],
    addPipeline: jest.fn(),
    removePipeline: jest.fn(),
    updatePipeline: jest.fn(),
    executePipeline: jest.fn(),
    clearHistory: jest.fn(),
  })),
}));

jest.mock("@/stores/ui-store", () => ({
  useUIStore: jest.fn(() => ({
    sidebarOpen: true,
    theme: "light",
    toggleSidebar: jest.fn(),
    setTheme: jest.fn(),
    toggleTheme: jest.fn(),
  })),
}));

describe("DashboardPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    datasetState = {
      ...datasetState,
      datasets: [defaultDataset],
      activeDatasetId: defaultDataset.id,
    };
  });

  it("renders headings, metric cards, and quick links", () => {
    render(<DashboardPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "sales_data.csv" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New chart" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ask AI" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "SQL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export sample/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Saved charts" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Revenue by region")).toBeInTheDocument();
  });

  it("opens a saved chart and pushes the charts route", async () => {
    const user = userEvent.setup();

    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: "Open in charts" }));

    expect(mockPush).toHaveBeenCalledWith("/charts");
    expect(mockSetChartState).toHaveBeenCalledWith({ activeChartId: savedChart.id });
  });

  it("exports sample rows from active dataset and displays status", async () => {
    const user = userEvent.setup();

    const rows = [
      { region: "East", revenue: 100 },
      { region: "West", revenue: 200 },
    ];
    mockRunQuery.mockResolvedValue(rows);

    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: /export sample/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith('SELECT * FROM "Sales" LIMIT 1000');
      expect(mockExportToCSV).toHaveBeenCalledWith(
        rows,
        expect.stringMatching(/^sales_data-sample-\d+\.csv$/),
      );
      expect(screen.getByText("Exported 2 rows to CSV.")).toBeInTheDocument();
    });
  });

  it("shows a status message when exporting a dataset with no rows", async () => {
    const user = userEvent.setup();

    datasetState = {
      ...datasetState,
      datasets: [
        {
          ...defaultDataset,
          id: "dataset-empty",
          name: "Empty",
          fileName: "empty.csv",
          rowCount: 0,
        },
      ],
      activeDatasetId: "dataset-empty",
    };

    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: /export sample/i }));

    expect(screen.getByText("Dataset has no rows to export.")).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
    expect(mockExportToCSV).not.toHaveBeenCalled();
  });
});
