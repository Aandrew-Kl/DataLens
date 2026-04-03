import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DataSnapshotManager from "@/components/data/data-snapshot-manager";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("framer-motion");
jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

const mockRunQuery = jest.mocked(runQuery);
const STORAGE_KEY = "datalens-data-snapshot-manager";

const columns: ColumnProfile[] = [
  {
    name: "customer_id",
    type: "string",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: ["c1", "c2"],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 12,
    sampleValues: [100, 120],
  },
];

async function renderAsync() {
  await act(async () => {
    render(<DataSnapshotManager tableName="orders" columns={columns} />);
  });
}

describe("DataSnapshotManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it("creates a snapshot and stores it in localStorage", async () => {
    const user = userEvent.setup();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_710_000_000_000);

    mockRunQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ row_count: 12 }]);

    await renderAsync();
    fireEvent.change(screen.getByPlaceholderText("Before cleaning"), {
      target: { value: "Baseline" },
    });
    await user.click(screen.getByRole("button", { name: "Create snapshot" }));

    expect(await screen.findByText("Created snapshot __snapshot_orders_1710000000000.")).toBeInTheDocument();
    expect(screen.getByText("__snapshot_orders_1710000000000")).toBeInTheDocument();

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as Array<{ name: string }>;
    expect(stored[0]?.name).toBe("Baseline");

    nowSpy.mockRestore();
  });

  it("compares a stored snapshot against the current table", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "snapshot-1",
          sourceTable: "orders",
          storageTable: "__snapshot_orders_1",
          name: "Baseline",
          createdAt: Date.now(),
          rowCount: 10,
          columnCount: 2,
        },
      ]),
    );

    mockRunQuery
      .mockResolvedValueOnce([{ row_count: 14 }])
      .mockResolvedValueOnce([{ row_count: 10 }]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Compare" }));

    expect(await screen.findByText("Snapshot comparison")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("restores and deletes snapshots", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "snapshot-1",
          sourceTable: "orders",
          storageTable: "__snapshot_orders_1",
          name: "Baseline",
          createdAt: Date.now(),
          rowCount: 10,
          columnCount: 2,
        },
      ]),
    );

    mockRunQuery.mockResolvedValue([]);

    await renderAsync();
    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("Restored Baseline into orders.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Deleted Baseline.")).toBeInTheDocument();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("[]");
  });
});
