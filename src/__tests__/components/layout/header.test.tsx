import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Header from "@/components/layout/header";
import { runQuery } from "@/lib/duckdb/client";
import {
  exportToCSV,
  exportToClipboard,
  exportToJSON,
} from "@/lib/utils/export";
import { useUIStore } from "@/stores/ui-store";
import type { DatasetMeta } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/utils/export", () => ({
  exportToCSV: jest.fn(),
  exportToJSON: jest.fn(),
  exportToClipboard: jest.fn().mockResolvedValue(undefined),
}));

const mockRunQuery = jest.mocked(runQuery);
const mockExportToCSV = jest.mocked(exportToCSV);
const mockExportToJSON = jest.mocked(exportToJSON);
const mockExportToClipboard = jest.mocked(exportToClipboard);

const dataset: DatasetMeta = {
  id: "sales-id",
  name: "sales",
  fileName: "sales.csv",
  rowCount: 1200,
  columnCount: 24,
  uploadedAt: 1,
  sizeBytes: 2048,
  columns: [],
};

describe("Header", () => {
  beforeEach(() => {
    useUIStore.setState({ sidebarOpen: true, theme: "light" });
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue([{ region: "East", revenue: 120 }]);
    mockExportToCSV.mockReset();
    mockExportToJSON.mockReset();
    mockExportToClipboard.mockReset();
    mockExportToClipboard.mockResolvedValue(undefined);
  });

  it("renders dataset metadata and stat badges", () => {
    render(
      <Header
        dataset={dataset}
        onToggleSidebar={jest.fn()}
        sidebarOpen
      />,
    );

    expect(screen.getByText("sales.csv")).toBeInTheDocument();
    expect(screen.getByText("1.2K")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  it("focuses the search input from Ctrl+K and clears the query", async () => {
    const user = userEvent.setup();

    render(
      <Header
        dataset={dataset}
        onToggleSidebar={jest.fn()}
        sidebarOpen
      />,
    );

    const input = screen.getByPlaceholderText("Search columns, query...");

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: "region" } });
    expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear search" }));

    expect(input).toHaveValue("");
  });

  it("exports CSV data through DuckDB and the export utility", async () => {
    const user = userEvent.setup();

    render(
      <Header
        dataset={dataset}
        onToggleSidebar={jest.fn()}
        sidebarOpen
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export data" }));
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith('SELECT * FROM "sales" LIMIT 10000');
      expect(mockExportToCSV).toHaveBeenCalledWith(
        [{ region: "East", revenue: 120 }],
        "sales",
      );
    });
  });

  it("toggles the sidebar and theme from the header controls", async () => {
    const user = userEvent.setup();
    const onToggleSidebar = jest.fn();

    render(
      <Header
        dataset={dataset}
        onToggleSidebar={onToggleSidebar}
        sidebarOpen
      />,
    );

    await user.click(screen.getByRole("button", { name: "Close sidebar" }));
    await user.click(screen.getByRole("button", { name: "Toggle theme" }));

    expect(onToggleSidebar).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().theme).toBe("dark");
  });
});
