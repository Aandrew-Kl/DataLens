import { render, screen } from "@testing-library/react";

import ProfilePage from "@/app/(workspace)/profile/page";
import type { DatasetMeta, ColumnProfile } from "@/types/dataset";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
  usePathname: jest.fn(() => "/profile"),
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

jest.mock("@/components/data/data-profiler", () => ({
  __esModule: true,
  default: ({ columns, rowCount }: { columns: Array<{ name: string }>; rowCount: number }) => (
    <div>
      Data profiler placeholder ({columns.length}) {rowCount}
    </div>
  ),
}));

jest.mock("@/components/data/column-stats", () => ({
  __esModule: true,
  default: () => <div>Column stats placeholder</div>,
}));

jest.mock("@/components/data/correlation-matrix", () => ({
  __esModule: true,
  default: () => <div>Correlation matrix placeholder</div>,
}));

jest.mock("@/stores/dataset-store", () => {
  const createState = () => ({
    datasets: [] as Array<{ id: string } & Record<string, unknown>>,
    activeDatasetId: null,
    addDataset: jest.fn(),
    removeDataset: jest.fn(),
    setActiveDataset: jest.fn(),
  });

  let state = createState();

  return {
    useDatasetStore: jest.fn((selector) => {
      const resolvedState = {
        ...state,
        getActiveDataset: () =>
          state.datasets.find((dataset) => dataset.id === state.activeDatasetId) ?? null,
      };

      return typeof selector === "function" ? selector(resolvedState) : resolvedState;
    }),
    __resetMockState: () => {
      state = createState();
    },
    __setMockState: (nextState: Record<string, unknown>) => {
      state = { ...createState(), ...nextState };
    },
  };
});

jest.mock("@/stores/query-store", () => ({
  useQueryStore: jest.fn((selector) => {
    const state = {
      history: [],
      lastResult: null,
      isQuerying: false,
      addToHistory: jest.fn(),
      setLastResult: jest.fn(),
      setIsQuerying: jest.fn(),
      clearHistory: jest.fn(),
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

jest.mock("@/stores/workspace-store", () => {
  const createState = () => ({
    isLoading: false,
    profileData: [] as Array<Record<string, unknown>>,
    loadError: null,
    showUploader: false,
    showSettings: false,
    showCommandPalette: false,
    showKeyboardShortcuts: false,
    showExportWizard: false,
    showSharePanel: false,
    previewRows: [] as Array<Record<string, unknown>>,
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
  });

  let state = createState();

  return {
    useWorkspaceStore: jest.fn((selector) => {
      return typeof selector === "function" ? selector(state) : state;
    }),
    __resetMockState: () => {
      state = createState();
    },
    __setMockState: (nextState: Record<string, unknown>) => {
      state = { ...createState(), ...nextState };
    },
  };
});

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

const datasetStoreModule = jest.requireMock("@/stores/dataset-store") as {
  __resetMockState: () => void;
  __setMockState: (nextState: Record<string, unknown>) => void;
};

const workspaceStoreModule = jest.requireMock("@/stores/workspace-store") as {
  __resetMockState: () => void;
  __setMockState: (nextState: Record<string, unknown>) => void;
};

const profileColumns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
];

const activeDataset: DatasetMeta = {
  id: "dataset-1",
  name: "Orders",
  fileName: "orders.csv",
  rowCount: 420,
  columnCount: profileColumns.length,
  columns: profileColumns,
  uploadedAt: Date.now() - 10_000,
  sizeBytes: 8192,
};

describe("ProfilePage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    datasetStoreModule.__resetMockState();
    workspaceStoreModule.__resetMockState();
    datasetStoreModule.__setMockState({
      datasets: [activeDataset],
      activeDatasetId: activeDataset.id,
    });
    workspaceStoreModule.__setMockState({
      profileData: profileColumns,
      previewRows: [{ region: "East" }],
      selectedAdvancedColumn: null,
    });
  });

  it("renders the heading and dataset info when a dataset is active", () => {
    render(<ProfilePage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Data Profile" }),
    ).toBeInTheDocument();
    expect(screen.getByText("orders.csv • 420 rows")).toBeInTheDocument();
    expect(screen.getByText(/data profiler placeholder/i)).toBeInTheDocument();
  });

  it("shows the no-dataset fallback when there is no active dataset", () => {
    datasetStoreModule.__setMockState({
      datasets: [],
      activeDatasetId: null,
    });
    workspaceStoreModule.__setMockState({
      profileData: [],
      previewRows: [],
      selectedAdvancedColumn: null,
    });

    render(<ProfilePage />);

    expect(
      screen.getByText("Select a dataset from the sidebar to view profiling results."),
    ).toBeInTheDocument();
  });
});
