import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Sidebar from "@/components/layout/sidebar";
import { useDatasetStore } from "@/stores/dataset-store";
import { useUIStore } from "@/stores/ui-store";
import type { DatasetMeta } from "@/types/dataset";

const datasets: DatasetMeta[] = [
  {
    id: "orders-id",
    name: "orders",
    fileName: "orders.csv",
    rowCount: 1200,
    columnCount: 4,
    uploadedAt: 1,
    sizeBytes: 2048,
    columns: [],
  },
  {
    id: "customers-id",
    name: "customers",
    fileName: "customers.csv",
    rowCount: 300,
    columnCount: 3,
    uploadedAt: 2,
    sizeBytes: 1024,
    columns: [],
  },
];

describe("Sidebar", () => {
  let originalFetch: typeof globalThis.fetch | undefined;
  let fetchMock: jest.MockedFunction<typeof fetch>;
  let writeTextMock: jest.MockedFunction<(text: string) => Promise<void>>;

  beforeEach(() => {
    window.localStorage.clear();
    useDatasetStore.setState({ datasets: [], activeDatasetId: null });
    useUIStore.setState({ sidebarOpen: true, theme: "light" });

    originalFetch = globalThis.fetch;
    const onlineResponse = {
      ok: true,
      json: async () => ({ ollama: true }),
    } as Response;
    fetchMock = jest.fn().mockResolvedValue(
      onlineResponse,
    ) as jest.MockedFunction<typeof fetch>;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  });

  it("renders the empty state and triggers dataset creation", async () => {
    const user = userEvent.setup();
    const onNewDataset = jest.fn();

    render(
      <Sidebar
        isOpen
        onToggle={jest.fn()}
        onNewDataset={onNewDataset}
        onSettingsOpen={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("No datasets yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Upload your first file" }));

    expect(onNewDataset).toHaveBeenCalledTimes(1);
  });

  it("renders seeded datasets, recent files, and the AI online indicator", async () => {
    useDatasetStore.setState({
      datasets,
      activeDatasetId: "orders-id",
    });
    window.localStorage.setItem(
      "datalens-recent",
      JSON.stringify([{ name: "sales.parquet", openedAt: Date.now() }]),
    );

    render(
      <Sidebar
        isOpen
        onToggle={jest.fn()}
        onNewDataset={jest.fn()}
        onSettingsOpen={jest.fn()}
      />,
    );

    expect(screen.getByText("orders.csv")).toBeInTheDocument();
    expect(screen.getByText("customers.csv")).toBeInTheDocument();
    expect(screen.getByText("sales.parquet")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTitle("Ollama connected")).toBeInTheDocument();
    });
  });

  it("selects datasets and removes datasets from the context menu", async () => {
    const user = userEvent.setup();

    useDatasetStore.setState({
      datasets,
      activeDatasetId: "orders-id",
    });

    render(
      <Sidebar
        isOpen
        onToggle={jest.fn()}
        onNewDataset={jest.fn()}
        onSettingsOpen={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const customersButton = screen.getByText("customers.csv").closest("button");

    if (!(customersButton instanceof HTMLButtonElement)) {
      throw new Error("Customers dataset button was not rendered.");
    }

    fireEvent.click(customersButton);
    expect(useDatasetStore.getState().activeDatasetId).toBe("customers-id");

    fireEvent.click(screen.getAllByRole("button", { name: "Dataset options" })[0]);
    await waitFor(() => {
      expect(screen.getByText("Copy table name")).toBeInTheDocument();
      expect(screen.getByText("Remove dataset")).toBeInTheDocument();
    });
    const removeButton = screen.getByText("Remove dataset").closest("button");

    if (!(removeButton instanceof HTMLButtonElement)) {
      throw new Error("Remove dataset action was not rendered.");
    }

    await user.click(removeButton);

    await waitFor(() => {
      expect(useDatasetStore.getState().datasets).toHaveLength(1);
    });
  });

  it("handles the collapse toggle, settings button, and theme toggle", async () => {
    const user = userEvent.setup();
    const onToggle = jest.fn();
    const onSettingsOpen = jest.fn();

    render(
      <Sidebar
        isOpen
        onToggle={onToggle}
        onNewDataset={jest.fn()}
        onSettingsOpen={onSettingsOpen}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onSettingsOpen).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().theme).toBe("dark");
  });
});
