import { render, screen } from "@testing-library/react";

import ReportsPage from "@/app/(workspace)/reports/page";
import type { DatasetMeta, ColumnProfile } from "@/types/dataset";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
  usePathname: jest.fn(() => "/reports"),
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

const datasetStoreModule = jest.requireMock("@/stores/dataset-store") as {
  __resetMockState: () => void;
  __setMockState: (nextState: Record<string, unknown>) => void;
};

const columns: ColumnProfile[] = [
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
  name: "Quarterly Sales",
  fileName: "quarterly_sales.csv",
  rowCount: 24,
  columnCount: columns.length,
  columns,
  uploadedAt: Date.now() - 50_000,
  sizeBytes: 1024,
};

describe("ReportsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    datasetStoreModule.__resetMockState();
    datasetStoreModule.__setMockState({
      datasets: [activeDataset],
      activeDatasetId: activeDataset.id,
    });
  });

  it("renders the heading and report templates", () => {
    render(<ReportsPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Reports" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Report templates" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Executive Summary")).toBeInTheDocument();
    expect(screen.getByText("Drill-down Dataset Report")).toBeInTheDocument();
    expect(screen.getByText("Data Operations Audit")).toBeInTheDocument();
  });

  it("shows the no-dataset message when no dataset is active", () => {
    datasetStoreModule.__setMockState({
      datasets: [],
      activeDatasetId: null,
    });

    render(<ReportsPage />);

    expect(screen.getByText(/no dataset selected/i)).toBeInTheDocument();
  });
});
