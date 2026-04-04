import { render, screen } from "@testing-library/react";

import ExplorePage from "@/app/(workspace)/explore/page";
import type { DatasetMeta, ColumnProfile } from "@/types/dataset";
import { runQuery } from "@/lib/duckdb/client";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/explore",
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

jest.mock("@/components/data/data-preview", () => ({
  __esModule: true,
  default: ({ tableName, columns }: { tableName: string; columns: ColumnProfile[] }) => (
    <div>
      Preview: {tableName} ({columns.length})
    </div>
  ),
}));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["East", "West"],
  },
];

const datasetWithColumns: DatasetMeta = {
  id: "dataset-1",
  name: "Sales",
  fileName: "monthly_sales.csv",
  rowCount: 2,
  columnCount: 1,
  columns,
  uploadedAt: Date.now() - 100_000,
  sizeBytes: 1024,
};

const datasetNoColumns: DatasetMeta = {
  id: "dataset-2",
  name: "Empty schema",
  fileName: "empty_schema.csv",
  rowCount: 0,
  columnCount: 0,
  columns: [],
  uploadedAt: Date.now() - 200_000,
  sizeBytes: 512,
};

let datasetState = {
  datasets: [datasetWithColumns],
  activeDatasetId: datasetWithColumns.id as string | null,
  addDataset: jest.fn(),
  removeDataset: jest.fn(),
  setActiveDataset: jest.fn(),
  getActiveDataset: jest.fn(),
};

jest.mock("@/stores/dataset-store", () => ({
  useDatasetStore: jest.fn((selector) => {
    const state = {
      ...datasetState,
      getActiveDataset: () =>
        datasetState.datasets.find((item) => item.id === datasetState.activeDatasetId),
    };

    return typeof selector === "function" ? selector(state) : state;
  }),
}));

jest.mock("@/stores/query-store", () => ({
  useQueryStore: jest.fn((selector) => {
    const state = {
      history: [],
      lastResult: null,
      isQuerying: false,
      addToHistory: jest.fn(),
      setLastResult: jest.fn(),
      setIsQuerying: jest.fn(),
    };

    return typeof selector === "function" ? selector(state) : state;
  }),
}));

jest.mock("@/stores/chart-store", () => ({
  useChartStore: jest.fn(() => ({
    savedCharts: [],
    activeChartId: null,
    chartHistory: [],
    addChart: jest.fn(),
    removeChart: jest.fn(),
    updateChart: jest.fn(),
    duplicateChart: jest.fn(),
    reorderCharts: jest.fn(),
    clearAll: jest.fn(),
  })),
}));

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

describe("ExplorePage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    datasetState = {
      ...datasetState,
      datasets: [datasetWithColumns],
      activeDatasetId: datasetWithColumns.id,
    };
  });

  it("renders the no dataset message when no dataset is active", () => {
    datasetState = {
      ...datasetState,
      datasets: [],
      activeDatasetId: null,
    };

    render(<ExplorePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Explore" })).toBeInTheDocument();
    expect(
      screen.getByText("Select a dataset from the workspace sidebar to load an explorable table."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Browse the active dataset with/i)).toBeInTheDocument();
  });

  it("renders active dataset metadata and preview placeholder", () => {
    render(<ExplorePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Explore" })).toBeInTheDocument();
    expect(screen.getByText("monthly_sales.csv")).toBeInTheDocument();
    expect(screen.getByText("2 rows")).toBeInTheDocument();
    expect(screen.getByText("1 columns")).toBeInTheDocument();
    expect(screen.getByText("Preview: monthly_sales (1)")).toBeInTheDocument();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it("shows empty-column state when schema has no columns", () => {
    datasetState = {
      ...datasetState,
      datasets: [datasetNoColumns],
      activeDatasetId: datasetNoColumns.id,
    };

    render(<ExplorePage />);

    expect(screen.getByText("This dataset has no columns to display.")).toBeInTheDocument();
  });
});
