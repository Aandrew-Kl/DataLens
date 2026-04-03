import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataVersioning from "@/components/data/data-versioning";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
  getTableRowCount: jest.fn().mockResolvedValue(100),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/",
}));

const mockRunQuery = jest.mocked(runQuery);

const columns: ColumnProfile[] = [
  {
    name: "id",
    type: "number",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: [1, 2],
  },
  {
    name: "revenue",
    type: "number",
    nullCount: 0,
    uniqueCount: 100,
    sampleValues: [100, 200],
  },
];

function seedVersionState() {
  window.localStorage.setItem(
    "datalens:data-versioning",
    JSON.stringify({
      versions: [
        {
          id: "v2",
          tableName: "orders",
          branch: "main",
          name: "snapshot-b",
          description: "Second snapshot",
          storageTable: "__version_orders_b",
          createdAt: 2,
          rowCount: 100,
          baseVersionId: "v1",
          primaryKeyCandidate: "id",
          columns: columns.map((column) => ({ name: column.name, type: column.type })),
          diffSummary: { added: 2, removed: 1, modified: 3 },
        },
        {
          id: "v1",
          tableName: "orders",
          branch: "main",
          name: "snapshot-a",
          description: "First snapshot",
          storageTable: "__version_orders_a",
          createdAt: 1,
          rowCount: 100,
          baseVersionId: null,
          primaryKeyCandidate: "id",
          columns: columns.map((column) => ({ name: column.name, type: column.type })),
          diffSummary: { added: 100, removed: 0, modified: 0 },
        },
      ],
      branches: [],
      activeBranchByTable: {},
    }),
  );
}

describe("DataVersioning", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockRunQuery.mockReset();
    mockRunQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("added_count")) {
        return [{ added_count: 4, removed_count: 1, modified_count: 2 }];
      }
      return [];
    });
  });

  it("renders the versioning dashboard header and stats", () => {
    const user = userEvent.setup();

    render(<DataVersioning tableName="orders" columns={columns} rowCount={100} />);

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Track snapshots and restore points for orders",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Active branch")).toBeInTheDocument();
    expect(screen.getByText("Rows now")).toBeInTheDocument();

    void user;
  });

  it("requires a snapshot name before creating a version", async () => {
    const user = userEvent.setup();

    render(<DataVersioning tableName="orders" columns={columns} rowCount={100} />);

    await user.click(screen.getByRole("button", { name: "Create snapshot" }));

    expect(screen.getByText("Enter a version name first.")).toBeInTheDocument();
  });

  it("creates a snapshot and lists it in version history", async () => {
    const user = userEvent.setup();

    render(<DataVersioning tableName="orders" columns={columns} rowCount={100} />);

    fireEvent.change(screen.getByPlaceholderText("pre-cleaning baseline"), {
      target: { value: "baseline" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("What changed or why this snapshot matters"),
      { target: { value: "Before cleanup" } },
    );
    await user.click(screen.getByRole("button", { name: "Create snapshot" }));

    await waitFor(() => {
      expect(screen.getByText("Snapshot created from the current DuckDB table state.")).toBeInTheDocument();
    });

    expect(
      screen.getByRole("heading", { level: 3, name: "baseline" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Before cleanup")).toBeInTheDocument();
  });

  it("creates a branch from a stored version", async () => {
    const user = userEvent.setup();

    seedVersionState();

    render(<DataVersioning tableName="orders" columns={columns} rowCount={100} />);

    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: "v1" },
    });
    fireEvent.change(screen.getByPlaceholderText("experiment_branch"), {
      target: { value: "qa_branch" },
    });
    await user.click(screen.getByRole("button", { name: "Save branch" }));

    expect(
      screen.getByText("Branch metadata saved. New snapshots will advance this branch."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("qa_branch")).toHaveLength(3);
  });

  it("compares two stored versions", async () => {
    const user = userEvent.setup();

    seedVersionState();

    render(<DataVersioning tableName="orders" columns={columns} rowCount={100} />);

    fireEvent.change(screen.getAllByRole("combobox")[1], {
      target: { value: "v1" },
    });
    fireEvent.change(screen.getAllByRole("combobox")[2], {
      target: { value: "v2" },
    });
    await user.click(screen.getByRole("button", { name: "Compare versions" }));

    await waitFor(() => {
      expect(screen.getByText(/Added:/)).toBeInTheDocument();
    });

    expect(screen.getByText(/removed:/)).toBeInTheDocument();
    expect(screen.getByText(/modified:/)).toBeInTheDocument();
  });

  it("restores a stored version after confirmation", async () => {
    const user = userEvent.setup();
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    seedVersionState();

    render(<DataVersioning tableName="orders" columns={columns} rowCount={100} />);

    await user.click(screen.getAllByRole("button", { name: "Restore" })[0]);

    await waitFor(() => {
      expect(screen.getByText("Restored snapshot-b into orders.")).toBeInTheDocument();
    });

    expect(mockRunQuery).toHaveBeenCalledWith(
      expect.stringContaining('CREATE OR REPLACE TABLE "orders" AS SELECT * FROM "__version_orders_b"'),
    );

    confirmSpy.mockRestore();
  });
});
