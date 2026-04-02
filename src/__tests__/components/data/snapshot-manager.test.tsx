import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SnapshotManager from "@/components/data/snapshot-manager";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;
const STORAGE_KEY = "datalens:snapshot-metadata";

const snapshotColumns: ColumnProfile[] = [
  {
    name: "id",
    type: "number",
    nullCount: 0,
    uniqueCount: 3,
    sampleValues: [1, 2, 3],
  },
  {
    name: "status",
    type: "string",
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ["active", "paused"],
  },
];

describe("SnapshotManager", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    window.localStorage.clear();
  });

  it("creates a new snapshot and persists its metadata", async () => {
    const user = userEvent.setup();

    mockRunQuery.mockResolvedValue([]);

    render(
      <SnapshotManager
        tableName="orders"
        columns={snapshotColumns}
        rowCount={120}
      />,
    );

    await user.type(
      screen.getByPlaceholderText("pre-cleaning audit"),
      "Pre-cleaning audit",
    );
    await user.click(screen.getByRole("button", { name: /create snapshot/i }));

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        'CREATE TABLE "__snapshot_pre_cleaning_audit" AS SELECT * FROM "orders"',
      );
    });

    expect(
      await screen.findByText("Created __snapshot_pre_cleaning_audit from orders."),
    ).toBeInTheDocument();
    expect(screen.getByText("Pre-cleaning audit")).toBeInTheDocument();
    expect(screen.getByText("__snapshot_pre_cleaning_audit")).toBeInTheDocument();
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain(
      "__snapshot_pre_cleaning_audit",
    );
  });

  it("restores an existing snapshot after confirmation", async () => {
    const user = userEvent.setup();
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "snap-1",
          sourceTable: "orders",
          name: "Baseline",
          storageTable: "__snapshot_baseline",
          createdAt: Date.now() - 60_000,
          rowCount: 200,
          columns: [
            { name: "id", type: "number" },
            { name: "status", type: "string" },
          ],
        },
      ]),
    );
    mockRunQuery.mockResolvedValue([]);

    render(
      <SnapshotManager
        tableName="orders"
        columns={[snapshotColumns[0]]}
        rowCount={10}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Restore" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('Restore "Baseline" into "orders"'),
    );

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        'CREATE OR REPLACE TABLE "orders" AS SELECT * FROM "__snapshot_baseline"',
      );
    });

    expect(
      await screen.findByText("Restored Baseline into orders."),
    ).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("deletes a snapshot and removes it from local storage", async () => {
    const user = userEvent.setup();
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "snap-1",
          sourceTable: "orders",
          name: "Baseline",
          storageTable: "__snapshot_baseline",
          createdAt: Date.now() - 60_000,
          rowCount: 200,
          columns: [
            { name: "id", type: "number" },
            { name: "status", type: "string" },
          ],
        },
      ]),
    );
    mockRunQuery.mockResolvedValue([]);

    render(
      <SnapshotManager
        tableName="orders"
        columns={snapshotColumns}
        rowCount={120}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('Delete "Baseline" and drop __snapshot_baseline?'),
    );

    await waitFor(() => {
      expect(mockRunQuery).toHaveBeenCalledWith(
        'DROP TABLE IF EXISTS "__snapshot_baseline"',
      );
    });

    expect(await screen.findByText("Deleted Baseline.")).toBeInTheDocument();
    expect(screen.queryByText("Baseline")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("[]");

    confirmSpy.mockRestore();
  });
});
