import type { ReactNode } from "react";
import { Database } from "lucide-react";
import { render, screen } from "@testing-library/react";

import HomeTabPanels from "@/components/home/HomeTabPanels";
import type { AppTab } from "@/components/home/types";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";

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

function mockComponent(label: string, testId = label.toLowerCase()) {
  return {
    __esModule: true,
    default: () => <div data-testid={testId}>{label}</div>,
  };
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
jest.mock("@/components/data/dashboard-view", () =>
  mockComponent("Dashboard View", "dashboard-view"),
);
jest.mock("@/components/data/data-catalog", () =>
  mockComponent("Data Catalog", "data-catalog"),
);
jest.mock("@/components/data/data-sampler", () =>
  mockComponent("Data Sampler", "data-sampler"),
);
jest.mock("@/components/data/bin-analyzer", () =>
  mockComponent("Bin Analyzer", "bin-analyzer"),
);
jest.mock("@/components/data/change-impact-analyzer", () =>
  mockComponent("Change Impact Analyzer", "change-impact-analyzer"),
);
jest.mock("@/components/data/column-dependency-finder", () =>
  mockComponent("Column Dependency Finder", "column-dependency-finder"),
);
jest.mock("@/components/data/cross-tabulation", () =>
  mockComponent("Cross Tabulation", "cross-tabulation"),
);
jest.mock("@/components/data/data-snapshot-compare", () =>
  mockComponent("Data Snapshot Compare", "data-snapshot-compare"),
);
jest.mock("@/components/data/date-explorer", () =>
  mockComponent("Date Explorer", "date-explorer"),
);
jest.mock("@/components/data/distribution-analyzer", () =>
  mockComponent("Distribution Analyzer", "distribution-analyzer"),
);
jest.mock("@/components/data/outlier-report", () =>
  mockComponent("Outlier Report", "outlier-report"),
);
jest.mock("@/components/data/percentile-explorer", () =>
  mockComponent("Percentile Explorer", "percentile-explorer"),
);
jest.mock("@/components/data/pivot-analysis", () =>
  mockComponent("Pivot Analysis", "pivot-analysis"),
);
jest.mock("@/components/data/text-column-analyzer", () =>
  mockComponent("Text Column Analyzer", "text-column-analyzer"),
);
jest.mock("@/components/data/time-series-decomposer", () =>
  mockComponent("Time Series Decomposer", "time-series-decomposer"),
);
jest.mock("@/components/analytics/segment-comparison", () =>
  mockComponent("Segment Comparison", "segment-comparison"),
);
jest.mock("@/components/home/AnalyticsSection", () =>
  mockComponent("Analytics Section", "analytics-section"),
);
jest.mock("@/components/home/BuilderSection", () =>
  mockComponent("Builder Section", "builder-section"),
);
jest.mock("@/components/home/ChartBuilderSection", () =>
  mockComponent("Chart Builder Section", "chart-builder-section"),
);
jest.mock("@/components/home/CleanSection", () =>
  mockComponent("Clean Section", "clean-section"),
);
jest.mock("@/components/home/CompareSection", () =>
  mockComponent("Compare Section", "compare-section"),
);
jest.mock("@/components/home/ConnectorsSection", () =>
  mockComponent("Connectors Section", "connectors-section"),
);
jest.mock("@/components/home/ExploreSection", () =>
  mockComponent("Explore Section", "explore-section"),
);
jest.mock("@/components/home/ForecastSection", () =>
  mockComponent("Forecast Section", "forecast-section"),
);
jest.mock("@/components/home/LineageSection", () =>
  mockComponent("Lineage Section", "lineage-section"),
);
jest.mock("@/components/home/MlSection", () =>
  mockComponent("ML Section", "ml-section"),
);
jest.mock("@/components/home/PivotSection", () =>
  mockComponent("Pivot Section", "pivot-section"),
);
jest.mock("@/components/home/ProfileSection", () =>
  mockComponent("Profile Section", "profile-section"),
);
jest.mock("@/components/home/QualitySection", () =>
  mockComponent("Quality Section", "quality-section"),
);
jest.mock("@/components/home/QuerySection", () =>
  mockComponent("Query Section", "query-section"),
);
jest.mock("@/components/home/ReportsSection", () =>
  mockComponent("Reports Section", "reports-section"),
);
jest.mock("@/components/home/SettingsPanelSection", () =>
  mockComponent("Settings Section", "settings-section"),
);
jest.mock("@/components/home/SqlEditorSection", () =>
  mockComponent("SQL Section", "sql-section"),
);
jest.mock("@/components/home/TransformsSection", () =>
  mockComponent("Transforms Section", "transforms-section"),
);
jest.mock("@/components/home/WranglerSection", () =>
  mockComponent("Wrangler Section", "wrangler-section"),
);

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
  name: "Sales",
  fileName: "sales.csv",
  rowCount: 42,
  columnCount: columns.length,
  columns,
  uploadedAt: 1,
  sizeBytes: 128,
};

const baseProps = {
  activeDataset,
  datasets: [activeDataset],
  tableName: "sales",
  profileData: columns,
  completenessPct: 96.4,
  savedCharts: [],
  workspaceTabItems: [{ id: "profile" as AppTab, label: "Profile", icon: Database }],
  commandBarCommands: [],
  onTabChange: jest.fn(),
  onExecuteCommand: jest.fn(),
  onAddNotification: jest.fn(() => "note-1"),
  onConnectorDataLoaded: jest.fn(),
  onRegisterMergedDataset: jest.fn(),
  onSqlJoinComplete: jest.fn(),
  onRefreshDataset: jest.fn(),
  onFormulaSave: jest.fn(),
  onSavedChartRemove: jest.fn(),
  onSavedChartEdit: jest.fn(),
  onOpenExportWizard: jest.fn(),
};

const tabExpectations: Array<[AppTab, string]> = [
  ["profile", "profile-section"],
  ["dashboard", "dashboard-view"],
  ["connectors", "connectors-section"],
  ["catalog", "data-catalog"],
  ["query", "query-section"],
  ["sql", "sql-section"],
  ["charts", "chart-builder-section"],
  ["forecast", "forecast-section"],
  ["ml", "ml-section"],
  ["explore", "explore-section"],
  ["builder", "builder-section"],
  ["transforms", "transforms-section"],
  ["wrangler", "wrangler-section"],
  ["lineage", "lineage-section"],
  ["quality", "quality-section"],
  ["clean", "clean-section"],
  ["advanced", "distribution-analyzer"],
  ["analytics", "analytics-section"],
  ["reports", "reports-section"],
  ["pivot", "pivot-section"],
  ["compare", "compare-section"],
  ["settings", "settings-section"],
];

describe("HomeTabPanels", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the correct panel for every tab", () => {
    const { rerender } = render(
      <HomeTabPanels
        {...baseProps}
        activeTab="profile"
      />,
    );

    tabExpectations.forEach(([tab, expectedTestId]) => {
      rerender(
        <HomeTabPanels
          {...baseProps}
          activeTab={tab}
        />,
      );

      expect(screen.getByTestId(expectedTestId)).toBeInTheDocument();
    });
  });

  it("replaces the previous panel when the active tab changes", () => {
    const { rerender } = render(
      <HomeTabPanels
        {...baseProps}
        activeTab="profile"
      />,
    );

    expect(screen.getByTestId("profile-section")).toBeInTheDocument();

    rerender(
      <HomeTabPanels
        {...baseProps}
        activeTab="charts"
      />,
    );

    expect(screen.getByTestId("chart-builder-section")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-section")).not.toBeInTheDocument();
  });
});
