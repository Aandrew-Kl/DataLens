import {
  act,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense, type ReactNode } from "react";

import DataOpsPage from "@/app/(workspace)/data-ops/page";
import {
  DataLensSocket,
  type ConnectionStateHandler,
  type ProgressHandler,
  type ProgressUpdate,
  type SocketMessage,
  type SocketMessageHandler,
} from "@/lib/api/websocket";
import { useDatasetStore } from "@/stores/dataset-store";
import type { DatasetMeta } from "@/types/dataset";

jest.mock("framer-motion", () => {
  const React = jest.requireActual<typeof import("react")>("react");

  return {
    __esModule: true,
    motion: new Proxy(
      {},
      {
        get: (_target, tagName: string) =>
          React.forwardRef(function MotionComponent(
            props: { children?: React.ReactNode } & Record<string, unknown>,
            ref: React.ForwardedRef<Element>,
          ) {
            return React.createElement(tagName, { ...props, ref }, props.children);
          }),
      },
    ),
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
  };
});

jest.mock("@/lib/api/websocket", () => {
  const actual = jest.requireActual("@/lib/api/websocket");

  return {
    ...actual,
    DataLensSocket: jest.fn(),
  };
});

interface MockSocket {
  connect: jest.Mock<void, [token?: string, datasetId?: string]>;
  disconnect: jest.Mock<void, []>;
  send: jest.Mock<void, [payload: unknown]>;
  onMessage: jest.Mock<void, [SocketMessageHandler]>;
  onProgress: jest.Mock<void, [ProgressHandler]>;
  onConnectionStateChange: jest.Mock<void, [ConnectionStateHandler]>;
  emitMessage: (message: SocketMessage) => void;
  emitProgress: (update: ProgressUpdate) => void;
  emitConnection: (connected: boolean) => void;
}

function createMockSocket(): MockSocket {
  let messageHandler: SocketMessageHandler | undefined;
  let progressHandler: ProgressHandler | undefined;
  let connectionHandler: ConnectionStateHandler | undefined;

  return {
    connect: jest.fn(),
    disconnect: jest.fn(),
    send: jest.fn(),
    onMessage: jest.fn((callback: SocketMessageHandler) => {
      messageHandler = callback;
    }),
    onProgress: jest.fn((callback: ProgressHandler) => {
      progressHandler = callback;
    }),
    onConnectionStateChange: jest.fn((callback: ConnectionStateHandler) => {
      connectionHandler = callback;
    }),
    emitMessage: (message: SocketMessage) => {
      messageHandler?.(message);
    },
    emitProgress: (update: ProgressUpdate) => {
      progressHandler?.(update);
    },
    emitConnection: (connected: boolean) => {
      connectionHandler?.(connected);
    },
  };
}

function makeDataset(
  id: string,
  name: string,
  overrides: Partial<DatasetMeta> = {},
): DatasetMeta {
  return {
    id,
    name,
    fileName: `${id}.csv`,
    rowCount: 100,
    columnCount: 2,
    columns: [
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
        nullCount: 1,
        uniqueCount: 4,
        sampleValues: [100, 200, null, 400],
      },
    ],
    uploadedAt: 1_700_000_000_000,
    sizeBytes: 2_048,
    ...overrides,
  };
}

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div role="status">Loading data ops page</div>}>
      {children}
    </Suspense>
  );
}

function renderPage({
  datasets = [salesDataset],
  activeDatasetId = salesDataset.id,
}: {
  datasets?: DatasetMeta[];
  activeDatasetId?: string | null;
} = {}) {
  act(() => {
    useDatasetStore.setState({ datasets, activeDatasetId });
  });

  return render(<DataOpsPage />, {
    wrapper: TestProviders,
  });
}

const salesDataset = makeDataset("sales", "Sales", {
  fileName: "sales.csv",
  rowCount: 420,
});

const inventoryDataset = makeDataset("inventory", "Inventory", {
  fileName: "inventory.csv",
  rowCount: 64,
  columns: [
    {
      name: "sku",
      type: "string",
      nullCount: 0,
      uniqueCount: 64,
      sampleValues: ["A-100", "B-200", "C-300"],
    },
    {
      name: "in_stock",
      type: "boolean",
      nullCount: 0,
      uniqueCount: 2,
      sampleValues: [true, false, true],
    },
  ],
});

function resetDatasetStore() {
  act(() => {
    useDatasetStore.setState(useDatasetStore.getInitialState());
  });
}

describe("DataOpsPage", () => {
  let socket: MockSocket;

  beforeEach(() => {
    socket = createMockSocket();
    jest.clearAllMocks();
    resetDatasetStore();
    window.localStorage.clear();

    const mockedConstructor = DataLensSocket as unknown as jest.Mock;
    mockedConstructor.mockReset();
    mockedConstructor.mockImplementation(() => socket);
  });

  afterEach(() => {
    resetDatasetStore();
    window.localStorage.clear();
  });

  it("renders the page sections and dataset actions with accessible controls", () => {
    renderPage({
      datasets: [salesDataset, inventoryDataset],
      activeDatasetId: salesDataset.id,
    });

    expect(
      screen.getByRole("heading", { level: 1, name: "Data Operations" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Dataset upload" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Dataset management" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Active dataset profile" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Server-side data streaming" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Streaming Data Viewer" }),
    ).toBeInTheDocument();

    expect(screen.getByLabelText("Select files")).toHaveAttribute("type", "file");
    expect(screen.getByLabelText("WebSocket disconnected")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "SQL query" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stream" })).toBeDisabled();

    const managementSection = screen
      .getByRole("heading", { level: 2, name: "Dataset management" })
      .closest("section");

    expect(managementSection).not.toBeNull();
    expect(within(managementSection as HTMLElement).getByRole("button", { name: "Active" })).toBeInTheDocument();
    expect(within(managementSection as HTMLElement).getByRole("button", { name: "Activate" })).toBeInTheDocument();
    expect(within(managementSection as HTMLElement).getAllByRole("button", { name: "Rename" })).toHaveLength(2);
    expect(within(managementSection as HTMLElement).getAllByRole("button", { name: "Duplicate" })).toHaveLength(2);
    expect(within(managementSection as HTMLElement).getAllByRole("button", { name: "Delete" })).toHaveLength(2);
    expect(DataLensSocket).toHaveBeenCalledWith("ws://localhost:8000/ws/data-stream");
    expect(socket.connect).toHaveBeenCalledWith(undefined, salesDataset.id);
  });

  it("renders empty dataset states when no datasets are loaded", () => {
    renderPage({
      datasets: [],
      activeDatasetId: null,
    });

    const managementSection = screen
      .getByRole("heading", { level: 2, name: "Dataset management" })
      .closest("section");
    const profileSection = screen
      .getByRole("heading", { level: 2, name: "Active dataset profile" })
      .closest("section");

    expect(managementSection).not.toBeNull();
    expect(profileSection).not.toBeNull();
    expect(
      within(managementSection as HTMLElement).getByText("No datasets available yet."),
    ).toBeInTheDocument();
    expect(
      within(profileSection as HTMLElement).getByText("No active dataset selected."),
    ).toBeInTheDocument();
    expect(within(managementSection as HTMLElement).queryByRole("button", { name: "Activate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add URL dataset" })).toBeInTheDocument();
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it("shows streaming progress while a query is in flight", async () => {
    const user = userEvent.setup();

    renderPage();

    act(() => {
      socket.emitConnection(true);
    });

    await user.type(
      screen.getByRole("textbox", { name: "SQL query" }),
      "SELECT * FROM sales",
    );
    await user.click(screen.getByRole("button", { name: "Stream" }));

    act(() => {
      socket.emitProgress({
        percent: 42,
        label: "Fetching batches",
      });
    });

    expect(screen.getByLabelText("WebSocket connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Streaming..." })).toBeDisabled();
    expect(screen.getByRole("progressbar", { name: "Streaming progress" })).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
  });

  it("surfaces streaming errors as alerts", async () => {
    const user = userEvent.setup();

    renderPage();

    act(() => {
      socket.emitConnection(true);
    });

    await user.type(
      screen.getByRole("textbox", { name: "SQL query" }),
      "SELECT * FROM broken_table",
    );
    await user.click(screen.getByRole("button", { name: "Stream" }));

    act(() => {
      socket.emitMessage({
        type: "error",
        message: "Failed to fetch streamed rows.",
      });
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to fetch streamed rows.",
    );
    expect(screen.getByRole("button", { name: "Stream" })).toBeEnabled();
  });

  it("submits a query and renders streamed rows in the results table", async () => {
    const user = userEvent.setup();

    renderPage();

    act(() => {
      socket.emitConnection(true);
    });

    await user.type(
      screen.getByRole("textbox", { name: "SQL query" }),
      "SELECT id, region FROM sales LIMIT 2",
    );
    await user.click(screen.getByRole("button", { name: "Stream" }));

    act(() => {
      socket.emitMessage({
        type: "rows",
        rows: [
          { id: 1, region: "East" },
          { id: 2, region: "West" },
        ],
      });
      socket.emitMessage({ status: "done" });
    });

    const resultsTable = await screen.findByRole("table");

    expect(within(resultsTable).getByRole("columnheader", { name: "id" })).toBeInTheDocument();
    expect(within(resultsTable).getByRole("columnheader", { name: "region" })).toBeInTheDocument();
    expect(within(resultsTable).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Stream" })).toBeEnabled();
  });
});
