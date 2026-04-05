import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import type { DatasetMeta } from "@/types/dataset";

function createMockStore<T extends object>(state: T) {
  const currentState = { ...state };
  const store = jest.fn((selector?: (value: T) => unknown) =>
    selector ? selector(currentState as T) : currentState,
  );

  return Object.assign(store, {
    getState: jest.fn(() => currentState),
    setState: jest.fn((updater: unknown) => {
      if (typeof updater === "function") {
        Object.assign(
          currentState,
          (updater as (s: T) => Partial<T>)(currentState as T),
        );
      } else {
        Object.assign(currentState, updater);
      }
    }),
    subscribe: jest.fn(() => jest.fn()),
    getInitialState: jest.fn(() => state),
  });
}

const mockDatasetStoreState = {
  datasets: [] as DatasetMeta[],
  activeDatasetId: null as string | null,
  addDataset: jest.fn(),
  removeDataset: jest.fn(),
  setActiveDataset: jest.fn(),
  getActiveDataset: jest.fn(),
};

const mockQueryStoreState = {
  history: [],
  lastResult: null,
  isQuerying: false,
  addToHistory: jest.fn(),
  setLastResult: jest.fn(),
  setIsQuerying: jest.fn(),
  clearHistory: jest.fn(),
};

const mockSetTheme = jest.fn();
const mockUiStoreState = {
  sidebarOpen: true,
  theme: "light" as const,
  toggleSidebar: jest.fn(),
  setTheme: mockSetTheme,
  toggleTheme: jest.fn(),
};

const mockDatasetStore = createMockStore(mockDatasetStoreState);
const mockQueryStore = createMockStore(mockQueryStoreState);
const mockUiStore = createMockStore(mockUiStoreState);

const mockNotifications = {
  notifications: [],
  addNotification: jest.fn(),
  removeNotification: jest.fn(),
  clearAll: jest.fn(),
};

const testDataset: DatasetMeta = {
  id: "ds-1",
  name: "sales",
  fileName: "sales.csv",
  rowCount: 100,
  columnCount: 3,
  columns: [
    {
      name: "id",
      type: "number",
      nullCount: 0,
      uniqueCount: 100,
      sampleValues: [1],
    },
    {
      name: "region",
      type: "string",
      nullCount: 0,
      uniqueCount: 5,
      sampleValues: ["East"],
    },
    {
      name: "revenue",
      type: "number",
      nullCount: 2,
      uniqueCount: 50,
      sampleValues: [100],
      min: 0,
      max: 1000,
      mean: 500,
      median: 450,
    },
  ],
  uploadedAt: Date.now(),
  sizeBytes: 4096,
};

jest.mock("framer-motion");
jest.mock("@/components/home/HeroSection", () => ({
  __esModule: true,
  default: () => <div data-testid="hero-section">HeroSection</div>,
}));
jest.mock("@/components/home/FeatureShowcase", () => ({
  __esModule: true,
  default: () => <div data-testid="feature-showcase">FeatureShowcase</div>,
}));
jest.mock("@/components/home/DataUploadSection", () => ({
  __esModule: true,
  default: () => <div data-testid="data-upload">DataUploadSection</div>,
}));
jest.mock("@/components/home/QuickStartGuide", () => ({
  __esModule: true,
  default: () => <div data-testid="quick-start">QuickStartGuide</div>,
}));
jest.mock("@/components/home/HomeTabPanels", () => ({
  __esModule: true,
  default: () => <div data-testid="tab-panels">HomeTabPanels</div>,
}));
jest.mock("@/components/ai/ai-assistant", () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock("@/components/data/data-bookmarks", () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock("@/components/data/file-dropzone", () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock("@/components/data/export-wizard", () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock("@/components/data/share-panel", () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock("@/components/layout/breadcrumb", () => ({
  __esModule: true,
  default: ({ items }: { items?: Array<{ label: string }> }) => (
    <div data-testid="breadcrumb">
      {items?.map((item) => item.label).join(" / ")}
    </div>
  ),
}));
jest.mock("@/components/layout/command-palette", () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock("@/components/layout/theme-customizer", () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock("@/components/ui/keyboard-shortcuts-dialog", () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock("@/components/ui/loading-overlay", () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock("@/components/ui/notification-center", () => ({
  __esModule: true,
  default: () => <div />,
  useNotifications: () => mockNotifications,
}));
jest.mock("@/components/ui/shortcut-overlay", () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock("@/components/ui/error-boundary", () => ({
  __esModule: true,
  ErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock("@/components/ui/toast", () => ({
  __esModule: true,
  ToastProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock("@/components/ui/onboarding-tour", () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock("@/components/ui/accessibility-panel", () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock("@/components/settings/settings-panel", () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock("@/components/charts/chart-builder", () => ({
  __esModule: true,
  CHART_SAVED_EVENT: "datalens:chart-saved",
  SAVED_CHARTS_STORAGE_KEY: "datalens-saved-charts",
  default: () => <div />,
}));
jest.mock("@/components/ui/command-bar", () => ({ __esModule: true }));
jest.mock("@/lib/duckdb/client", () => ({
  __esModule: true,
  loadCSVIntoDB: jest.fn(),
  runQuery: jest.fn().mockResolvedValue([]),
  getTableRowCount: jest.fn().mockResolvedValue(0),
}));
jest.mock("@/lib/duckdb/profiler", () => ({
  __esModule: true,
  profileTable: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/stores/dataset-store", () => ({
  useDatasetStore: mockDatasetStore,
}));
jest.mock("@/stores/query-store", () => ({
  useQueryStore: mockQueryStore,
}));
jest.mock("@/stores/ui-store", () => ({
  useUIStore: mockUiStore,
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const HomePageClient =
  require("@/components/home/home-page-client").default as typeof import("@/components/home/home-page-client").default;
/* eslint-enable @typescript-eslint/no-require-imports */

describe("HomePageClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });

    mockDatasetStore.setState({
      datasets: [],
      activeDatasetId: null,
      addDataset: mockDatasetStoreState.addDataset,
      removeDataset: mockDatasetStoreState.removeDataset,
      setActiveDataset: mockDatasetStoreState.setActiveDataset,
      getActiveDataset: mockDatasetStoreState.getActiveDataset,
    });
    mockQueryStore.setState({
      history: [],
      lastResult: null,
      isQuerying: false,
      addToHistory: mockQueryStoreState.addToHistory,
      setLastResult: mockQueryStoreState.setLastResult,
      setIsQuerying: mockQueryStoreState.setIsQuerying,
      clearHistory: mockQueryStoreState.clearHistory,
    });
    mockUiStore.setState({
      sidebarOpen: true,
      theme: "light",
      toggleSidebar: mockUiStoreState.toggleSidebar,
      setTheme: mockSetTheme,
      toggleTheme: mockUiStoreState.toggleTheme,
    });
  });

  it("renders the landing page when no dataset is active", () => {
    render(<HomePageClient />);

    expect(screen.getByTestId("hero-section")).toBeInTheDocument();
    expect(screen.getByTestId("data-upload")).toBeInTheDocument();
    expect(screen.getByTestId("quick-start")).toBeInTheDocument();
    expect(screen.getByTestId("feature-showcase")).toBeInTheDocument();
    expect(screen.getByText("DataLens")).toBeInTheDocument();
  });

  it("shows the theme toggle button on landing", () => {
    render(<HomePageClient />);

    expect(
      screen.getByRole("button", { name: "Toggle dark mode" }),
    ).toBeInTheDocument();
  });

  it("shows the GitHub link on landing", () => {
    render(<HomePageClient />);

    expect(
      screen.getByRole("link", { name: "View on GitHub" }),
    ).toBeInTheDocument();
  });

  it("renders workspace view when dataset is active", () => {
    mockDatasetStore.setState({
      datasets: [testDataset],
      activeDatasetId: "ds-1",
      getActiveDataset: jest.fn(() => testDataset),
    });

    render(<HomePageClient />);

    expect(screen.getAllByText("sales.csv")[0]).toBeInTheDocument();
    expect(screen.getByTestId("breadcrumb")).toBeInTheDocument();
    expect(screen.getByTestId("breadcrumb")).toHaveTextContent("sales.csv");
    expect(screen.getByTestId("tab-panels")).toBeInTheDocument();
  });

  it("renders workspace tabs when dataset is active", () => {
    mockDatasetStore.setState({
      datasets: [testDataset],
      activeDatasetId: "ds-1",
      getActiveDataset: jest.fn(() => testDataset),
    });

    render(<HomePageClient />);

    expect(screen.getByRole("button", { name: "Profile" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "SQL Editor" }),
    ).toBeInTheDocument();
  });

  it("renders DatasetSidebar when datasets exist", () => {
    mockDatasetStore.setState({
      datasets: [testDataset],
      activeDatasetId: "ds-1",
      getActiveDataset: jest.fn(() => testDataset),
    });

    render(<HomePageClient />);

    expect(screen.getByText("DataLens")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Upload Dataset" }),
    ).toBeInTheDocument();

    const brand = screen.getByText("DataLens");
    const sidebarHeader = brand.parentElement?.parentElement;
    const collapseButton = sidebarHeader?.querySelector("button");

    if (!(collapseButton instanceof HTMLButtonElement)) {
      throw new Error("Sidebar collapse button was not rendered.");
    }

    fireEvent.click(collapseButton);

    expect(screen.queryByText("DataLens")).not.toBeInTheDocument();
    expect(screen.getByTitle("Expand sidebar")).toBeInTheDocument();
    expect(screen.getByTitle("Upload new dataset")).toBeInTheDocument();
  });
});
