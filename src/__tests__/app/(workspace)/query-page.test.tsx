import { render, screen } from "@testing-library/react";

import QueryPage from "@/app/(workspace)/query/page";
import type { DatasetMeta, ColumnProfile } from "@/types/dataset";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
  usePathname: jest.fn(() => "/query"),
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

jest.mock("@/components/query/chat-interface", () => ({
  __esModule: true,
  default: () => <div>Chat interface placeholder</div>,
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

jest.mock("@/stores/query-store", () => {
  const createState = () => ({
    history: [],
    lastResult: null,
    isQuerying: false,
    addToHistory: jest.fn(),
    setLastResult: jest.fn(),
    setIsQuerying: jest.fn(),
    clearHistory: jest.fn(),
  });

  let state = createState();

  return {
    useQueryStore: jest.fn((selector) => {
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

const queryStoreModule = jest.requireMock("@/stores/query-store") as {
  __resetMockState: () => void;
  __setMockState: (nextState: Record<string, unknown>) => void;
};

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: ["East", "West", "North"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: [100, 200, 300],
  },
];

const activeDataset: DatasetMeta = {
  id: "dataset-1",
  name: "Sales",
  fileName: "sales.csv",
  rowCount: 32,
  columnCount: columns.length,
  columns,
  uploadedAt: Date.now() - 25_000,
  sizeBytes: 4096,
};

describe("QueryPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    datasetStoreModule.__resetMockState();
    queryStoreModule.__resetMockState();
    datasetStoreModule.__setMockState({
      datasets: [activeDataset],
      activeDatasetId: activeDataset.id,
    });
    queryStoreModule.__setMockState({
      history: [],
      lastResult: null,
      isQuerying: false,
    });
  });

  it("renders the heading and query input when a dataset is active", () => {
    render(<QueryPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Ask AI" })).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/ask about trends, averages, or segments in/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Chat interface placeholder")).toBeInTheDocument();
  });

  it("shows the no-dataset fallback when there is no active dataset", () => {
    datasetStoreModule.__setMockState({
      datasets: [],
      activeDatasetId: null,
    });

    render(<QueryPage />);

    expect(
      screen.getByText("No active dataset. Open a CSV from the workspace sidebar to run AI-powered queries."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Query output will appear here after you run a question."),
    ).toBeInTheDocument();
  });
});
