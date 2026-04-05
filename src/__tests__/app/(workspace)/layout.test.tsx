import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockPathname = "/profile";

jest.mock("next/navigation", () => ({
  usePathname: jest.fn(() => mockPathname),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockToggleTheme = jest.fn();
const mockToggleSidebar = jest.fn();

jest.mock("@/stores/ui-store", () => ({
  useUIStore: jest.fn((selector) => {
    const state = {
      theme: "light",
      sidebarOpen: true,
      toggleTheme: mockToggleTheme,
      toggleSidebar: mockToggleSidebar,
      setTheme: jest.fn(),
    };

    return typeof selector === "function" ? selector(state) : state;
  }),
}));

const mockSetActiveDataset = jest.fn();

jest.mock("@/stores/dataset-store", () => ({
  useDatasetStore: jest.fn((selector) => {
    const state = {
      datasets: [],
      activeDatasetId: null,
      setActiveDataset: mockSetActiveDataset,
      addDataset: jest.fn(),
      removeDataset: jest.fn(),
      getActiveDataset: jest.fn(),
    };

    return typeof selector === "function" ? selector(state) : state;
  }),
}));

const mockSetShowUploader = jest.fn();
const mockSetShowSettings = jest.fn();
const mockSetShowCommandPalette = jest.fn();

jest.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: jest.fn((selector) => {
    const state = {
      isLoading: false,
      showUploader: false,
      showSettings: false,
      showCommandPalette: false,
      setShowUploader: mockSetShowUploader,
      setShowSettings: mockSetShowSettings,
      setShowCommandPalette: mockSetShowCommandPalette,
    };

    return typeof selector === "function" ? selector(state) : state;
  }),
}));

jest.mock("@/components/layout/command-palette", () => ({
  __esModule: true,
  default: () => <div>Command Palette</div>,
}));

jest.mock("@/components/settings/settings-panel", () => ({
  __esModule: true,
  default: () => <div>Settings Panel</div>,
}));

jest.mock("@/components/data/file-dropzone", () => ({
  __esModule: true,
  default: () => <div>File Dropzone</div>,
}));

jest.mock("@/lib/duckdb/client", () => ({
  getTableRowCount: jest.fn().mockResolvedValue(0),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/duckdb/profiler", () => ({
  profileTable: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/utils/formatters", () => ({
  generateId: jest.fn(() => "test-id"),
  sanitizeTableName: jest.fn(() => "test_table"),
}));

import WorkspaceLayout from "@/app/(workspace)/layout";

describe("WorkspaceLayout", () => {
  it("renders the DataLens header", () => {
    render(
      <WorkspaceLayout>
        <div>Test Content</div>
      </WorkspaceLayout>,
    );

    expect(screen.getByText("DataLens")).toBeInTheDocument();
  });

  it("renders tab navigation links", () => {
    render(
      <WorkspaceLayout>
        <div>Test Content</div>
      </WorkspaceLayout>,
    );

    expect(screen.getByText("Profile")).toBeInTheDocument();
    expect(screen.getByText("Charts")).toBeInTheDocument();
    expect(screen.getByText("ML")).toBeInTheDocument();
    expect(screen.getByText("Analytics")).toBeInTheDocument();
  });

  it("renders children in the main area", () => {
    render(
      <WorkspaceLayout>
        <div>Page Content Here</div>
      </WorkspaceLayout>,
    );

    expect(screen.getByText("Page Content Here")).toBeInTheDocument();
  });

  it("shows empty datasets message when no datasets loaded", () => {
    render(
      <WorkspaceLayout>
        <div>content</div>
      </WorkspaceLayout>,
    );

    expect(screen.getByText("No datasets loaded")).toBeInTheDocument();
  });

  it("supports clicking the sidebar toggle and upload controls", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceLayout>
        <div>content</div>
      </WorkspaceLayout>,
    );

    await user.click(screen.getByLabelText("Toggle sidebar"));
    expect(mockToggleSidebar).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTitle("Upload dataset"));
    expect(mockSetShowUploader).toHaveBeenCalled();
    expect(mockSetShowUploader).toHaveBeenLastCalledWith(true);
  });
});
