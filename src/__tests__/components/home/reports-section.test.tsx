import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";

import ReportsSection from "@/components/home/ReportsSection";
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

function mockComponent(label: string) {
  return { __esModule: true, default: () => <div>{label}</div> };
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
    const MockDynamic = () => <div data-testid="dynamic-component" />;
    MockDynamic.displayName = "MockDynamic";
    return MockDynamic;
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
  ToolSection: ({
    title,
    description,
    children,
  }: {
    title: string;
    description: string;
    children: ReactNode;
  }) => (
    <section>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </section>
  ),
}));
jest.mock("@/components/data/data-narrator", () =>
  mockComponent("Data Narrator"),
);
jest.mock("@/components/data/data-story", () => mockComponent("Data Story"));
jest.mock("@/components/data/data-summarizer", () =>
  mockComponent("Data Summarizer"),
);
jest.mock("@/components/report/report-builder", () =>
  mockComponent("Report Builder"),
);
jest.mock("@/components/report/report-history", () =>
  mockComponent("Report History"),
);
jest.mock("@/components/report/report-scheduler", () =>
  mockComponent("Report Scheduler"),
);
jest.mock("@/components/report/report-templates", () =>
  mockComponent("Report Templates"),
);
jest.mock("@/components/report/report-annotations", () =>
  mockComponent("Report Annotations"),
);
jest.mock("@/components/report/report-chart-inserter", () =>
  mockComponent("Report Chart Inserter"),
);
jest.mock("@/components/report/report-designer", () =>
  mockComponent("Report Designer"),
);
jest.mock("@/components/report/report-export-panel", () =>
  mockComponent("Report Export Panel"),
);
jest.mock("@/components/report/report-narrative-builder", () =>
  mockComponent("Report Narrative Builder"),
);

const columns: ColumnProfile[] = [
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: [100, 200],
    min: 100,
    max: 400,
    mean: 250,
    median: 250,
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

const defaultProps = {
  activeDataset,
  tableName: "sales",
  columns,
};

describe("ReportsSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the section heading", () => {
    render(<ReportsSection {...defaultProps} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Reports" }),
    ).toBeInTheDocument();
  });

  it("renders the reporting workspace", () => {
    render(<ReportsSection {...defaultProps} />);

    expect(screen.getByText("Report Builder")).toBeInTheDocument();
    expect(screen.getByText("Data Story")).toBeInTheDocument();
  });
});
