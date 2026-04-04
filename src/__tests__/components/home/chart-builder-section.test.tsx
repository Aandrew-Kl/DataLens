import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";

import ChartBuilderSection from "@/components/home/ChartBuilderSection";
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
jest.mock("echarts/core", () => ({
  getInstanceByDom: jest.fn(),
}));
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
jest.mock("@/components/charts/chart-annotator", () =>
  mockComponent("Chart Annotator"),
);
jest.mock("@/components/charts/chart-builder", () => ({
  __esModule: true,
  default: () => (
    <div>
      <label htmlFor="chart-type-selector">Chart type selector</label>
      <select id="chart-type-selector" defaultValue="bar">
        <option value="bar">Bar</option>
      </select>
    </div>
  ),
}));
jest.mock("@/components/charts/chart-export", () =>
  mockComponent("Chart Export"),
);
jest.mock("@/components/charts/chart-gallery", () =>
  mockComponent("Chart Gallery"),
);
jest.mock("@/components/charts/chart-recommendations", () =>
  mockComponent("Chart Recommendations"),
);
jest.mock("@/components/charts/chart-renderer", () => ({
  __esModule: true,
  default: () => (
    <div aria-label="chart preview area">Chart preview area</div>
  ),
}));
jest.mock("@/components/charts/chart-templates", () =>
  mockComponent("Chart Templates"),
);
jest.mock("@/components/charts/funnel-chart", () =>
  mockComponent("Funnel Chart"),
);
jest.mock("@/components/charts/geo-chart", () => mockComponent("Geo Chart"));
jest.mock("@/components/charts/area-chart", () => mockComponent("Area Chart"));
jest.mock("@/components/charts/boxplot-chart", () =>
  mockComponent("Boxplot Chart"),
);
jest.mock("@/components/charts/donut-chart", () =>
  mockComponent("Donut Chart"),
);
jest.mock("@/components/charts/gauge-chart", () =>
  mockComponent("Gauge Chart"),
);
jest.mock("@/components/charts/heatmap-chart", () =>
  mockComponent("Heatmap Chart"),
);
jest.mock("@/components/charts/parallel-coordinates", () =>
  mockComponent("Parallel Coordinates"),
);
jest.mock("@/components/charts/radar-chart", () =>
  mockComponent("Radar Chart"),
);
jest.mock("@/components/charts/sankey-chart", () =>
  mockComponent("Sankey Chart"),
);
jest.mock("@/components/charts/scatter-matrix", () =>
  mockComponent("Scatter Matrix"),
);
jest.mock("@/components/charts/sparkline-grid", () =>
  mockComponent("Sparkline Grid"),
);
jest.mock("@/components/charts/treemap-chart", () =>
  mockComponent("Treemap Chart"),
);
jest.mock("@/components/charts/waterfall-chart", () =>
  mockComponent("Waterfall Chart"),
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

const defaultProps = {
  tableName: "sales",
  columns,
  rowCount: 42,
  fileName: "sales.csv",
  savedCharts: [
    {
      config: { id: "chart-1", title: "Revenue by region", type: "bar" as const },
      data: [{ region: "East", revenue: 100 }],
      tableName: "sales",
      sql: "SELECT * FROM sales",
      savedAt: Date.now(),
    },
  ],
  completenessPct: 96.4,
  onRemove: jest.fn(),
  onEdit: jest.fn(),
};

describe("ChartBuilderSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the chart type selector", () => {
    render(<ChartBuilderSection {...defaultProps} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Chart Builder" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Chart type selector"),
    ).toBeInTheDocument();
  });

  it("renders the chart preview area when a saved chart is available", () => {
    render(<ChartBuilderSection {...defaultProps} />);

    expect(screen.getByText("Standalone Renderer")).toBeInTheDocument();
    expect(screen.getByLabelText("chart preview area")).toBeInTheDocument();
  });

  it("renders the empty preview state when no saved charts exist", () => {
    render(
      <ChartBuilderSection
        {...defaultProps}
        savedCharts={[]}
      />,
    );

    expect(
      screen.getByText(
        "Save a chart from the builder to preview it in the standalone renderer.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("chart preview area"),
    ).not.toBeInTheDocument();
  });
});
