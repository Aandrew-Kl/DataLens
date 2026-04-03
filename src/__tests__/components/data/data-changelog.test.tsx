import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataChangelog from "@/components/data/data-changelog";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";

jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useSyncExternalStore: (
      subscribe: (listener: () => void) => () => void,
      getSnapshot: () => unknown,
    ) => {
      const [value, setValue] = actual.useState(getSnapshot);
      actual.useEffect(() => subscribe(() => setValue(getSnapshot())), [subscribe, getSnapshot]);
      return value;
    },
  };
});

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
  loadCSVIntoDB: jest.fn().mockResolvedValue(undefined),
  getTableRowCount: jest.fn().mockResolvedValue(100),
  profileTable: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/lib/utils/export", () => ({
  downloadFile: jest.fn(),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;
const mockDownloadFile = downloadFile as jest.MockedFunction<typeof downloadFile>;

describe("DataChangelog", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockDownloadFile.mockReset();
    window.sessionStorage.clear();
  });

  it("requires a description before recording an entry", async () => {
    const user = userEvent.setup();

    render(<DataChangelog tableName="orders" />);

    await user.click(screen.getByRole("button", { name: "Save entry" }));

    expect(
      screen.getByText("Describe the data change before recording it."),
    ).toBeInTheDocument();
  });

  it("records a transformation entry in session storage", async () => {
    const user = userEvent.setup();

    render(<DataChangelog tableName="orders" />);

    fireEvent.change(
      screen.getByPlaceholderText("Removed test rows older than 2022"),
      { target: { value: "Filtered archived rows" } },
    );
    fireEvent.change(screen.getByPlaceholderText("Rows before"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByPlaceholderText("Rows after"), {
      target: { value: "85" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        'Optional undo SQL, e.g. CREATE OR REPLACE TABLE "sales" AS SELECT * FROM "__snapshot_before_clean"',
      ),
      { target: { value: 'CREATE OR REPLACE TABLE "orders" AS SELECT * FROM "__snapshot"' } },
    );

    await user.click(screen.getByRole("button", { name: "Save entry" }));

    await waitFor(() => {
      expect(
        screen.getByText("Change recorded in session storage for this table."),
      ).toBeInTheDocument();
      expect(screen.getByText("Filtered archived rows")).toBeInTheDocument();
    });

    const entries = JSON.parse(
      window.sessionStorage.getItem("datalens:changelog:orders") ?? "[]",
    ) as Array<{ description: string; rowsAffected: number }>;

    expect(entries[0]?.description).toBe("Filtered archived rows");
    expect(entries[0]?.rowsAffected).toBe(15);
  });

  it("runs undo SQL and appends a revert entry", async () => {
    const user = userEvent.setup();

    window.sessionStorage.setItem(
      "datalens:changelog:orders",
      JSON.stringify([
        {
          id: "entry-1",
          timestamp: 1,
          operation: "filter",
          description: "Filtered archived rows",
          rowsBefore: 100,
          rowsAfter: 85,
          rowsAffected: 15,
          undoSql: 'CREATE OR REPLACE TABLE "orders" AS SELECT * FROM "__snapshot"',
          status: "active",
        },
      ]),
    );

    mockRunQuery.mockImplementation(async (sql) => {
      if (sql.includes('SELECT COUNT(*) AS cnt FROM "orders"')) {
        return [{ cnt: 100 }];
      }
      return [];
    });

    render(<DataChangelog tableName="orders" />);

    await user.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => {
      expect(
        screen.getByText("Undo SQL executed and the timeline was updated."),
      ).toBeInTheDocument();
    });

    const entries = JSON.parse(
      window.sessionStorage.getItem("datalens:changelog:orders") ?? "[]",
    ) as Array<{ description: string; status: string }>;

    expect(entries[0]?.description).toBe("Undo: Filtered archived rows");
    expect(entries.find((entry) => entry.description === "Filtered archived rows")?.status).toBe(
      "undone",
    );
  });

  it("exports stored entries as text and JSON", async () => {
    const user = userEvent.setup();

    window.sessionStorage.setItem(
      "datalens:changelog:orders",
      JSON.stringify([
        {
          id: "entry-1",
          timestamp: 1,
          operation: "clean",
          description: "Trimmed whitespace",
          rowsBefore: 100,
          rowsAfter: 100,
          rowsAffected: 0,
          status: "active",
        },
      ]),
    );

    render(<DataChangelog tableName="orders" />);

    await user.click(screen.getByRole("button", { name: "Export text" }));
    await user.click(screen.getByRole("button", { name: "Export JSON" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining("Changelog for orders"),
      "orders-changelog.txt",
      "text/plain;charset=utf-8",
    );
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining('"description": "Trimmed whitespace"'),
      "orders-changelog.json",
      "application/json;charset=utf-8",
    );
  });

  it("clears the current session timeline", async () => {
    const user = userEvent.setup();

    window.sessionStorage.setItem(
      "datalens:changelog:orders",
      JSON.stringify([
        {
          id: "entry-1",
          timestamp: 1,
          operation: "clean",
          description: "Trimmed whitespace",
          rowsBefore: 100,
          rowsAfter: 100,
          rowsAffected: 0,
          status: "active",
        },
      ]),
    );

    render(<DataChangelog tableName="orders" />);

    await user.click(screen.getByRole("button", { name: "Clear session log" }));

    await waitFor(() => {
      expect(
        screen.getByText("Session changelog cleared for this table."),
      ).toBeInTheDocument();
      expect(screen.getByText("No changes yet")).toBeInTheDocument();
    });

    expect(window.sessionStorage.getItem("datalens:changelog:orders")).toBe("[]");
  });
});
