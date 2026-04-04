import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";

import SqlPage from "@/app/(workspace)/sql/page";
import { runQuery } from "@/lib/duckdb/client";
import type { DatasetMeta, ColumnProfile } from "@/types/dataset";
import type { SavedQuery } from "@/types/query";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/sql",
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

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = jest.mocked(runQuery);

const mockColumns: ColumnProfile[] = [
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
    uniqueCount: 4,
    sampleValues: [100, 200, 300, 400],
  },
];

const activeDataset: DatasetMeta = {
  id: "dataset-1",
  name: "Sales",
  fileName: "sales.csv",
  rowCount: 3,
  columnCount: 2,
  columns: mockColumns,
  uploadedAt: 1_700_000_000,
  sizeBytes: 2048,
};

jest.mock("@/stores/dataset-store", () => ({
  useDatasetStore: jest.fn((selector) => {
    const state = {
      datasets: [activeDataset],
      activeDatasetId: activeDataset.id,
      addDataset: jest.fn(),
      removeDataset: jest.fn(),
      setActiveDataset: jest.fn(),
      getActiveDataset: jest.fn(),
    };

    return typeof selector === "function" ? selector(state) : state;
  }),
}));

const historyEntry: SavedQuery = {
  id: "query-1",
  question: "Get latest rows",
  sql: 'SELECT * FROM "sales" WHERE revenue > 120;',
  datasetId: activeDataset.id,
  createdAt: 1_700_000_000,
};

const addToHistory = jest.fn();
const setLastResult = jest.fn();
const setIsQuerying = jest.fn();

jest.mock("@/stores/query-store", () => ({
  useQueryStore: jest.fn((selector) => {
    const state = {
      history: [historyEntry],
      lastResult: null,
      isQuerying: false,
      addToHistory,
      setLastResult,
      setIsQuerying,
    };

    return typeof selector === "function" ? selector(state) : state;
  }),
}));

const mockRemoveChart = jest.fn();

jest.mock("@/stores/chart-store", () => ({
  useChartStore: jest.fn(() => ({
    savedCharts: [],
    activeChartId: null,
    chartHistory: [],
    addChart: jest.fn(),
    removeChart: mockRemoveChart,
    updateChart: jest.fn(),
    duplicateChart: jest.fn(),
    reorderCharts: jest.fn(),
    clearAll: jest.fn(),
  })),
}));

jest.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: jest.fn(() => ({
    isLoading: false,
    loadError: null,
    showUploader: false,
    showSettings: false,
    showCommandPalette: false,
    showKeyboardShortcuts: false,
    showExportWizard: false,
    showSharePanel: false,
    profileData: [],
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
  })),
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

describe("SqlPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders SQL page heading and active dataset label", () => {
    render(<SqlPage />);

    expect(screen.getByRole("heading", { level: 1, name: "SQL Editor" })).toBeInTheDocument();
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Run$/i })).toBeInTheDocument();
  });

  it("runs a query when clicking Run and forwards SQL to DuckDB", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([{ region: "East", revenue: 120 }]);

    render(<SqlPage />);

    await user.click(screen.getByRole("button", { name: /^Run$/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith('SELECT *\nFROM "sales"\nLIMIT 100;');
      expect(setIsQuerying).toHaveBeenCalledWith(true);
      expect(setIsQuerying).toHaveBeenLastCalledWith(false);
      expect(setLastResult).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: 'SELECT *\nFROM "sales"\nLIMIT 100;',
          rowCount: 1,
          executionTimeMs: expect.any(Number),
        }),
      );
      expect(addToHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: 'SELECT *\nFROM "sales"\nLIMIT 100;',
          datasetId: activeDataset.id,
        }),
      );
    });
  });

  it("loads a saved query and runs it via Ctrl + Enter", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([{ region: "East", revenue: 120 }]);

    render(<SqlPage />);

    await user.click(screen.getByRole("button", { name: /Get latest rows/ }));

    const editor = screen.getByRole("textbox", { name: /sql editor/i }) as HTMLTextAreaElement;
    expect(editor).toHaveValue(historyEntry.sql);

    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(historyEntry.sql);
    });
  });
});
