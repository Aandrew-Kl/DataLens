import { render, screen, waitFor } from "@testing-library/react";

import PivotPage from "@/app/(workspace)/pivot/page";
import type { DatasetMeta, ColumnProfile } from "@/types/dataset";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
  usePathname: jest.fn(() => "/pivot"),
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
    uniqueCount: 3,
    sampleValues: ["East", "West", "North"],
  },
  {
    name: "segment",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["Retail", "Enterprise"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 5,
    sampleValues: [120, 240, 360],
  },
];

const activeDataset: DatasetMeta = {
  id: "dataset-1",
  name: "Sales",
  fileName: "sales.csv",
  rowCount: 12,
  columnCount: columns.length,
  columns,
  uploadedAt: Date.now() - 100_000,
  sizeBytes: 2048,
};

describe("PivotPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    datasetStoreModule.__resetMockState();
    datasetStoreModule.__setMockState({
      datasets: [activeDataset],
      activeDatasetId: activeDataset.id,
    });
  });

  it('renders the heading and shows "Load a dataset" when there is no active dataset', () => {
    datasetStoreModule.__setMockState({
      datasets: [],
      activeDatasetId: null,
    });

    render(<PivotPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Pivot Table Builder" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/load a dataset first to access columns/i)).toBeInTheDocument();
  });

  it("shows field zones with an active dataset and renders aggregation buttons", async () => {
    render(<PivotPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Pivot Table Builder" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Rows" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Columns" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Values" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sum/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /count/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /average/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /minimum/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /maximum/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("region")).toBeInTheDocument();
      expect(screen.getByText("segment")).toBeInTheDocument();
      expect(screen.getByText("revenue")).toBeInTheDocument();
    });
  });
});
