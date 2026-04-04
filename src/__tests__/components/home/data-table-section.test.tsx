import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import DataTableSection from "@/components/home/DataTableSection";
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
  TablePreview: ({
    onRowsLoaded,
    onRowClick,
  }: {
    onRowsLoaded?: (rows: Record<string, unknown>[]) => void;
    onRowClick?: (row: Record<string, unknown>) => void;
  }) => {
    const React = require("react") as typeof import("react");
    const rows = [{ region: "East", revenue: 100 }];

    React.useEffect(() => {
      onRowsLoaded?.(rows);
    }, [onRowsLoaded]);

    return (
      <table aria-label="data table">
        <tbody>
          <tr>
            <td>
              <button type="button" onClick={() => onRowClick?.(rows[0])}>
                East
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    );
  },
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
jest.mock("@/components/data/data-dictionary", () =>
  mockComponent("Data Dictionary"),
);
jest.mock("@/components/data/data-preview", () =>
  mockComponent("Data Preview"),
);
jest.mock("@/components/charts/gauge-chart", () =>
  mockComponent("Gauge Chart"),
);
jest.mock("@/components/data/metric-card", () => ({
  __esModule: true,
  default: ({ label, value }: { label: string; value: string | number }) => (
    <div>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
}));
jest.mock("@/components/data/row-detail-modal", () => ({
  __esModule: true,
  default: ({
    open,
    row,
  }: {
    open: boolean;
    row: Record<string, unknown>;
  }) =>
    open ? <div>Row Detail: {String(row.region)}</div> : null,
}));
jest.mock("@/components/data/schema-viewer", () =>
  mockComponent("Schema Viewer"),
);
jest.mock("@/components/data/snapshot-manager", () =>
  mockComponent("Snapshot Manager"),
);
jest.mock("@/components/data/virtual-data-grid", () =>
  mockComponent("Virtual Data Grid"),
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
  fileName: "sales.csv",
  rowCount: 42,
  sizeBytes: 2048,
  completenessPct: 96.4,
  onOpenExportWizard: jest.fn(),
};

describe("DataTableSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the data preview heading and table", () => {
    render(<DataTableSection {...defaultProps} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Data Preview" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("data table")).toBeInTheDocument();
  });

  it("calls the export handler when the export button is clicked", () => {
    const onOpenExportWizard = jest.fn();

    render(
      <DataTableSection
        {...defaultProps}
        onOpenExportWizard={onOpenExportWizard}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    expect(onOpenExportWizard).toHaveBeenCalledTimes(1);
  });

  it("opens the row detail modal when a preview row is selected", () => {
    render(<DataTableSection {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: "East" }));

    expect(screen.getByText("Row Detail: East")).toBeInTheDocument();
  });
});
