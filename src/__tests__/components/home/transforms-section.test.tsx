import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import TransformsSection from "@/components/home/TransformsSection";
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
  return {
    __esModule: true,
    default: () => <div>{label}</div>,
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
jest.mock("@/components/data/anomaly-detector", () =>
  mockComponent("Anomaly Detector"),
);
jest.mock("@/components/data/column-grouper", () =>
  mockComponent("Column Grouper"),
);
jest.mock("@/components/data/column-renamer", () =>
  mockComponent("Column Renamer"),
);
jest.mock("@/components/data/column-transformer", () =>
  mockComponent("Column Transformer"),
);
jest.mock("@/components/data/data-changelog", () =>
  mockComponent("Data Changelog"),
);
jest.mock("@/components/data/data-cleaner", () =>
  mockComponent("Data Cleaner"),
);
jest.mock("@/components/data/data-enrichment", () =>
  mockComponent("Data Enrichment"),
);
jest.mock("@/components/data/data-pipeline", () => ({
  __esModule: true,
  default: () => (
    <ol aria-label="transform step list">
      <li>Filter rows</li>
      <li>Compute revenue</li>
    </ol>
  ),
}));
jest.mock("@/components/data/data-quality-rules", () =>
  mockComponent("Data Quality Rules"),
);
jest.mock("@/components/data/data-sampler", () =>
  mockComponent("Data Sampler"),
);
jest.mock("@/components/data/duplicate-finder", () =>
  mockComponent("Duplicate Finder"),
);
jest.mock("@/components/data/formula-editor", () =>
  mockComponent("Formula Editor"),
);
jest.mock("@/components/data/join-builder", () =>
  mockComponent("Join Builder"),
);
jest.mock("@/components/data/null-handler", () =>
  mockComponent("Null Handler"),
);
jest.mock("@/components/data/regex-tester", () =>
  mockComponent("Regex Tester"),
);
jest.mock("@/components/data/smart-filter", () =>
  mockComponent("Smart Filter"),
);
jest.mock("@/components/data/transform-panel", () =>
  mockComponent("Transform Panel"),
);
jest.mock("@/components/data/type-converter", () =>
  mockComponent("Type Converter"),
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

const datasets: DatasetMeta[] = [
  {
    id: "dataset-1",
    name: "Sales",
    fileName: "sales.csv",
    rowCount: 42,
    columnCount: columns.length,
    columns,
    uploadedAt: 1,
    sizeBytes: 128,
  },
  {
    id: "dataset-2",
    name: "Costs",
    fileName: "costs.csv",
    rowCount: 21,
    columnCount: columns.length,
    columns,
    uploadedAt: 2,
    sizeBytes: 96,
  },
];

const defaultProps = {
  tableName: "sales",
  columns,
  datasets,
  onRefreshDataset: jest.fn(),
  onFormulaSave: jest.fn(),
};

describe("TransformsSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the transform step list", () => {
    render(<TransformsSection {...defaultProps} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Data Transforms" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("transform step list")).toBeInTheDocument();
    expect(screen.getByText("Filter rows")).toBeInTheDocument();
  });

  it("renders the join builder when multiple datasets are available", () => {
    render(<TransformsSection {...defaultProps} />);

    expect(screen.getByText("Join Builder")).toBeInTheDocument();
  });

  it("reveals additional transform tools when expanded", () => {
    render(
      <TransformsSection
        {...defaultProps}
        datasets={[datasets[0]]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /More Transform Tools/i }),
    );

    expect(screen.getAllByTestId("dynamic-component").length).toBeGreaterThan(0);
  });
});
