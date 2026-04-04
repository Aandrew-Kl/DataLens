import { render, screen } from "@testing-library/react";
import type React from "react";

import AnalyticsPage from "@/app/(workspace)/analytics/page";
import type { DatasetMeta, ColumnProfile } from "@/types/dataset";

type MockedStoreHook = jest.Mock & {
  resetMockState: () => void;
  setMockState: (patch: Record<string, unknown>) => void;
  getMockState: () => Record<string, unknown>;
  setState?: jest.Mock;
};

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/analytics",
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

jest.mock("@/components/ui/error-boundary", () => ({
  __esModule: true,
  ErrorBoundary: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@/components/data/time-series-forecast", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/analytics/trend-analyzer", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/analytics/segment-comparison", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/analytics/data-storyteller", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/analytics/ab-test-analyzer", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/analytics/churn-predictor", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/analytics/cohort-retention", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/analytics/customer-lifetime-value", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/analytics/engagement-metrics", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/analytics/funnel-analysis", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/analytics/geographic-analysis", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/analytics/market-basket-analysis", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/analytics/revenue-analysis", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/analytics/rfm-analysis", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/analytics/seasonal-decomposition", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/analytics/sentiment-analyzer", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/stores/dataset-store", () => {
  const createState = () => ({
    datasets: [] as DatasetMeta[],
    activeDatasetId: null as string | null,
    addDataset: jest.fn(),
    removeDataset: jest.fn(),
    setActiveDataset: jest.fn(),
  });
  const state = createState();

  const useDatasetStore = Object.assign(
    jest.fn((selector) => {
      const snapshot = {
        ...state,
        getActiveDataset: () =>
          state.datasets.find((dataset) => dataset.id === state.activeDatasetId) ?? null,
      };

      return typeof selector === "function" ? selector(snapshot) : snapshot;
    }),
    {
      resetMockState: () => {
        Object.assign(state, createState());
      },
      setMockState: (patch: Record<string, unknown>) => {
        Object.assign(state, patch);
      },
      getMockState: () => state,
      setState: jest.fn((patch) => {
        const snapshot = {
          ...state,
          getActiveDataset: () =>
            state.datasets.find((dataset) => dataset.id === state.activeDatasetId) ?? null,
        };
        const nextState = typeof patch === "function" ? patch(snapshot) : patch;
        Object.assign(state, nextState);
      }),
    },
  );

  return { useDatasetStore };
});

jest.mock("@/stores/query-store", () => {
  const createState = () => ({
    history: [],
    lastResult: null,
    isQuerying: false,
    addToHistory: jest.fn(),
    setLastResult: jest.fn(),
    setIsQuerying: jest.fn(),
  });
  const state = createState();

  const useQueryStore = Object.assign(
    jest.fn((selector) => (typeof selector === "function" ? selector(state) : state)),
    {
      resetMockState: () => {
        Object.assign(state, createState());
      },
      setMockState: (patch: Record<string, unknown>) => {
        Object.assign(state, patch);
      },
      getMockState: () => state,
    },
  );

  return { useQueryStore };
});

jest.mock("@/stores/chart-store", () => {
  const createState = () => ({
    savedCharts: [] as never[],
    activeChartId: null as string | null,
    chartHistory: [] as never[],
    addChart: jest.fn(),
    removeChart: jest.fn(),
    updateChart: jest.fn(),
    duplicateChart: jest.fn(),
    reorderCharts: jest.fn(),
    clearAll: jest.fn(),
  });
  const state = createState();

  const useChartStore = Object.assign(
    jest.fn((selector) => (typeof selector === "function" ? selector(state) : state)),
    {
      resetMockState: () => {
        Object.assign(state, createState());
      },
      setMockState: (patch: Record<string, unknown>) => {
        Object.assign(state, patch);
      },
      getMockState: () => state,
      setState: jest.fn((patch) => {
        const nextState = typeof patch === "function" ? patch(state) : patch;
        Object.assign(state, nextState);
      }),
    },
  );

  return { useChartStore };
});

jest.mock("@/stores/workspace-store", () => {
  const createState = () => ({
    isLoading: false,
    profileData: [] as ColumnProfile[],
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
  });
  const state = createState();

  const useWorkspaceStore = Object.assign(
    jest.fn((selector) => (typeof selector === "function" ? selector(state) : state)),
    {
      resetMockState: () => {
        Object.assign(state, createState());
      },
      setMockState: (patch: Record<string, unknown>) => {
        Object.assign(state, patch);
      },
      getMockState: () => state,
    },
  );

  return { useWorkspaceStore };
});

jest.mock("@/stores/pipeline-store", () => {
  const createState = () => ({
    pipelines: [] as never[],
    activePipelineId: null as string | null,
    executionHistory: [] as never[],
    addPipeline: jest.fn(),
    removePipeline: jest.fn(),
    updatePipeline: jest.fn(),
    executePipeline: jest.fn(async () => null),
    clearHistory: jest.fn(),
  });
  const state = createState();

  const usePipelineStore = Object.assign(
    jest.fn((selector) => (typeof selector === "function" ? selector(state) : state)),
    {
      resetMockState: () => {
        Object.assign(state, createState());
      },
      setMockState: (patch: Record<string, unknown>) => {
        Object.assign(state, patch);
      },
      getMockState: () => state,
    },
  );

  return { usePipelineStore };
});

jest.mock("@/stores/ui-store", () => {
  const createState = () => ({
    sidebarOpen: true,
    theme: "light",
    toggleSidebar: jest.fn(),
    setTheme: jest.fn(),
    toggleTheme: jest.fn(),
  });
  const state = createState();

  const useUIStore = Object.assign(jest.fn(() => state), {
    resetMockState: () => {
      Object.assign(state, createState());
    },
    setMockState: (patch: Record<string, unknown>) => {
      Object.assign(state, patch);
    },
    getMockState: () => state,
  });

  return { useUIStore };
});

const activeDataset: DatasetMeta = {
  id: "dataset-1",
  name: "Sales",
  fileName: "sales.csv",
  rowCount: 420,
  columnCount: 2,
  columns: [
    {
      name: "region",
      type: "string",
      nullCount: 0,
      uniqueCount: 4,
      sampleValues: ["East", "West", "North"],
    },
    {
      name: "revenue",
      type: "number",
      nullCount: 0,
      uniqueCount: 5,
      sampleValues: [100, 200, 300],
    },
  ],
  uploadedAt: Date.now() - 60_000,
  sizeBytes: 2048,
};

const mockedDatasetStoreModule = jest.requireMock("@/stores/dataset-store") as {
  useDatasetStore: MockedStoreHook;
};
const mockedQueryStoreModule = jest.requireMock("@/stores/query-store") as {
  useQueryStore: MockedStoreHook;
};
const mockedChartStoreModule = jest.requireMock("@/stores/chart-store") as {
  useChartStore: MockedStoreHook;
};
const mockedWorkspaceStoreModule = jest.requireMock("@/stores/workspace-store") as {
  useWorkspaceStore: MockedStoreHook;
};
const mockedPipelineStoreModule = jest.requireMock("@/stores/pipeline-store") as {
  usePipelineStore: MockedStoreHook;
};
const mockedUIStoreModule = jest.requireMock("@/stores/ui-store") as {
  useUIStore: MockedStoreHook;
};

function resetStoreMocks() {
  mockedDatasetStoreModule.useDatasetStore.resetMockState();
  mockedQueryStoreModule.useQueryStore.resetMockState();
  mockedChartStoreModule.useChartStore.resetMockState();
  mockedWorkspaceStoreModule.useWorkspaceStore.resetMockState();
  mockedPipelineStoreModule.usePipelineStore.resetMockState();
  mockedUIStoreModule.useUIStore.resetMockState();
}

describe("AnalyticsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStoreMocks();
    mockedDatasetStoreModule.useDatasetStore.setMockState({
      datasets: [activeDataset],
      activeDatasetId: activeDataset.id,
    });
  });

  it("renders the analytics heading and active dataset details", () => {
    render(<AnalyticsPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Analytics" })).toBeInTheDocument();
    expect(screen.getByText(/dataset:\s*sales\.csv/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Forecast" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Advanced Analytics" }),
    ).toBeInTheDocument();
  });

  it("shows the no-dataset fallback when nothing is active", () => {
    mockedDatasetStoreModule.useDatasetStore.setMockState({
      datasets: [],
      activeDatasetId: null,
    });

    render(<AnalyticsPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Analytics" })).toBeInTheDocument();
    expect(
      screen.getByText("Select a dataset from the sidebar to unlock the analytics workspace."),
    ).toBeInTheDocument();
  });
});
