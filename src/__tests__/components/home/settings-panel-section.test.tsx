import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";

import SettingsPanelSection from "@/components/home/SettingsPanelSection";
import type { ColumnProfile } from "@/types/dataset";

function createMockStore<T extends object>(state: T) {
  const store = jest.fn(
    (selector?: (value: T) => unknown) => (selector ? selector(state) : state),
  );

  return Object.assign(store, {
    getState: jest.fn(() => state),
    setState: jest.fn(),
    subscribe: jest.fn(() => jest.fn()),
    getInitialState: jest.fn(() => state),
  });
}

const mockDatasetStore = createMockStore({
  datasets: [],
  activeDatasetId: null,
  addDataset: jest.fn(),
  removeDataset: jest.fn(),
  setActiveDataset: jest.fn(),
  getActiveDataset: jest.fn(),
});
const mockChartStore = createMockStore({
  savedCharts: [],
  activeChartId: null,
  chartHistory: [],
  addChart: jest.fn(),
  removeChart: jest.fn(),
  updateChart: jest.fn(),
  duplicateChart: jest.fn(),
  reorderCharts: jest.fn(),
  clearAll: jest.fn(),
});
const mockQueryStore = createMockStore({
  history: [],
  lastResult: null,
  isQuerying: false,
  addToHistory: jest.fn(),
  setLastResult: jest.fn(),
  setIsQuerying: jest.fn(),
  clearHistory: jest.fn(),
});
const mockPipelineStore = createMockStore({
  pipelines: [],
  activePipelineId: null,
  executionHistory: [],
  addPipeline: jest.fn(),
  removePipeline: jest.fn(),
  updatePipeline: jest.fn(),
  executePipeline: jest.fn(),
  clearHistory: jest.fn(),
});
const mockUiStore = createMockStore({
  sidebarOpen: true,
  theme: "light" as const,
  toggleSidebar: jest.fn(),
  setTheme: jest.fn(),
  toggleTheme: jest.fn(),
});
const mockWorkspaceStore = createMockStore({
  profileData: [],
  isLoading: false,
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

jest.mock("framer-motion");
jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: () => {
    const MockDynamicComponent = () => <div data-testid="dynamic-component" />;
    MockDynamicComponent.displayName = "MockDynamicComponent";
    return MockDynamicComponent;
  },
}));
jest.mock("@/stores/dataset-store", () => ({ useDatasetStore: mockDatasetStore }));
jest.mock("@/stores/chart-store", () => ({ useChartStore: mockChartStore }));
jest.mock("@/stores/query-store", () => ({ useQueryStore: mockQueryStore }));
jest.mock("@/stores/pipeline-store", () => ({ usePipelineStore: mockPipelineStore }));
jest.mock("@/stores/ui-store", () => ({ useUIStore: mockUiStore }));
jest.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: mockWorkspaceStore,
}));
jest.mock("@/components/ui/error-boundary", () => ({
  __esModule: true,
  ErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock("@/components/home/workspace-shared", () => ({
  __esModule: true,
  AnimatedWorkspaceSection: ({ children }: { children: ReactNode }) => (
    <section data-testid="animated-workspace-section">{children}</section>
  ),
}));
jest.mock("@/components/settings/ollama-settings", () => ({
  __esModule: true,
  default: () => <div>Ollama Settings</div>,
}));
jest.mock("@/components/settings/workspace-settings", () => ({
  __esModule: true,
  default: () => <div>Workspace Settings Panel</div>,
}));

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
];

describe("SettingsPanelSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the workspace heading and base settings panels", () => {
    render(
      <SettingsPanelSection
        tableName="sales"
        columns={columns}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Workspace Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Workspace Settings Panel")).toBeInTheDocument();
    expect(screen.getByText("Ollama Settings")).toBeInTheDocument();
  });

  it("renders the settings categories", () => {
    render(
      <SettingsPanelSection
        tableName="sales"
        columns={columns}
      />,
    );

    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("Data & Export")).toBeInTheDocument();
    expect(screen.getByText("Notifications & Shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Performance")).toBeInTheDocument();
  });
});
