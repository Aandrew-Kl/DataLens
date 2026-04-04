import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SettingsPage from "@/app/(workspace)/settings/page";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
  usePathname: jest.fn(() => "/settings"),
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

jest.mock("@/stores/dataset-store", () => ({
  useDatasetStore: jest.fn((selector) => {
    const state = {
      datasets: [],
      activeDatasetId: null,
      addDataset: jest.fn(),
      removeDataset: jest.fn(),
      setActiveDataset: jest.fn(),
      getActiveDataset: jest.fn(() => null),
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

jest.mock("@/stores/ui-store", () => {
  const createState = () => ({
    sidebarOpen: true,
    theme: "light",
    toggleSidebar: jest.fn(),
    setTheme: jest.fn(),
    toggleTheme: jest.fn(),
  });

  let state = createState();

  return {
    useUIStore: jest.fn((selector) => {
      return typeof selector === "function" ? selector(state) : state;
    }),
    __resetMockState: () => {
      state = createState();
    },
    __setMockState: (nextState: Record<string, unknown>) => {
      state = { ...createState(), ...nextState };
    },
    __getMockState: () => state,
  };
});

const uiStoreModule = jest.requireMock("@/stores/ui-store") as {
  __resetMockState: () => void;
  __setMockState: (nextState: Record<string, unknown>) => void;
  __getMockState: () => { setTheme: jest.Mock };
};

describe("SettingsPage", () => {
  let getItemSpy: jest.SpyInstance;
  let setItemSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    uiStoreModule.__resetMockState();
    uiStoreModule.__setMockState({ theme: "light" });
    getItemSpy = jest.spyOn(Storage.prototype, "getItem");
    setItemSpy = jest.spyOn(Storage.prototype, "setItem");
  });

  afterEach(() => {
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it("renders headings, theme controls, and settings sections", async () => {
    render(<SettingsPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Workspace Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /light mode/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dark mode/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Display Preferences" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Export Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset defaults/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(getItemSpy).toHaveBeenCalledWith("datalens-workspace-settings-v1");
      expect(setItemSpy).toHaveBeenCalledWith(
        "datalens-workspace-settings-v1",
        expect.any(String),
      );
    });
  });

  it("calls setTheme when a theme toggle is clicked", async () => {
    const user = userEvent.setup();

    render(<SettingsPage />);
    await user.click(screen.getByRole("button", { name: /dark mode/i }));

    expect(uiStoreModule.__getMockState().setTheme).toHaveBeenCalledWith("dark");
  });
});
