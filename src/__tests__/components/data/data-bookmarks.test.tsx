import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DataBookmarks from "@/components/data/data-bookmarks";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

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

const mockDownloadFile = downloadFile as jest.MockedFunction<typeof downloadFile>;

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [100, 200],
  },
];

describe("DataBookmarks", () => {
  beforeEach(() => {
    mockDownloadFile.mockReset();
    window.localStorage.clear();
  });

  it("saves the current view as a bookmark", async () => {
    const user = userEvent.setup();

    render(<DataBookmarks tableName="orders" columns={columns} />);

    await user.selectOptions(screen.getByRole("combobox", { name: /selected tab/i }), "charts");
    await user.click(screen.getByRole("button", { name: "Add filter" }));
    fireEvent.change(screen.getByPlaceholderText("Value"), {
      target: { value: "East" },
    });
    fireEvent.change(screen.getByPlaceholderText("Bookmark name"), {
      target: { value: "Charts view" },
    });
    fireEvent.change(screen.getByPlaceholderText("What makes this view useful?"), {
      target: { value: "Focus on chart review" },
    });

    await user.click(screen.getByRole("button", { name: "Save bookmark" }));

    await waitFor(() => {
      expect(screen.getByText("Bookmark saved.")).toBeInTheDocument();
    });

    const storedBookmarks = JSON.parse(
      window.localStorage.getItem("datalens:bookmarks:orders") ?? "[]",
    ) as Array<{ name: string; state: { selectedTab: string; filters: Array<{ value: string }> } }>;

    expect(storedBookmarks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Charts view",
          state: expect.objectContaining({
            selectedTab: "charts",
            filters: expect.arrayContaining([
              expect.objectContaining({ value: "East" }),
            ]),
          }),
        }),
      ]),
    );
  });

  it("restores a bookmark and dispatches a restore event", async () => {
    const user = userEvent.setup();
    const dispatchSpy = jest.spyOn(window, "dispatchEvent");

    window.localStorage.setItem(
      "datalens:bookmarks:orders",
      JSON.stringify([
        {
          id: "bookmark-1",
          name: "QA view",
          description: "For quality review",
          timestamp: 1,
          state: {
            selectedTab: "quality",
            filters: [],
            sortColumn: "sales",
            sortDirection: "desc",
            selectedColumns: ["region"],
          },
        },
      ]),
    );

    render(<DataBookmarks tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(screen.getByText('Restored "QA view".')).toBeInTheDocument();
    });

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "datalens:bookmark-restore",
      }),
    );

    const currentView = JSON.parse(
      window.localStorage.getItem("datalens:view-state:orders") ?? "{}",
    ) as { selectedTab: string; sortDirection: string };

    expect(currentView.selectedTab).toBe("quality");
    expect(currentView.sortDirection).toBe("desc");
  });

  it("edits an existing bookmark", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      "datalens:bookmarks:orders",
      JSON.stringify([
        {
          id: "bookmark-1",
          name: "QA view",
          description: "For quality review",
          timestamp: 1,
          state: {
            selectedTab: "quality",
            filters: [],
            sortColumn: "sales",
            sortDirection: "desc",
            selectedColumns: ["region"],
          },
        },
      ]),
    );

    render(<DataBookmarks tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(screen.getByText('Editing "QA view". Save to overwrite it.')).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Update bookmark" })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Bookmark name"), {
      target: { value: "Exec view" },
    });
    await user.click(screen.getByRole("button", { name: "Update bookmark" }));

    await waitFor(() => {
      expect(screen.getByText("Bookmark updated.")).toBeInTheDocument();
    });

    const storedBookmarks = JSON.parse(
      window.localStorage.getItem("datalens:bookmarks:orders") ?? "[]",
    ) as Array<{ name: string }>;

    expect(storedBookmarks[0]?.name).toBe("Exec view");
  });

  it("exports bookmarks as JSON", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem(
      "datalens:bookmarks:orders",
      JSON.stringify([
        {
          id: "bookmark-1",
          name: "QA view",
          description: "For quality review",
          timestamp: 1,
          state: {
            selectedTab: "quality",
            filters: [],
            sortColumn: "sales",
            sortDirection: "desc",
            selectedColumns: ["region"],
          },
        },
      ]),
    );

    render(<DataBookmarks tableName="orders" columns={columns} />);

    await user.click(screen.getByRole("button", { name: "Export JSON" }));

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.stringContaining('"name": "QA view"'),
      "orders-bookmarks.json",
      "application/json;charset=utf-8",
    );
  });

  it("marks failed bookmark writes as needing sync and retries them manually", async () => {
    const user = userEvent.setup();
    const setItemSpy = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("No storage");
      });

    render(<DataBookmarks tableName="orders" columns={columns} />);

    fireEvent.change(screen.getByPlaceholderText("Bookmark name"), {
      target: { value: "Needs sync" },
    });

    await user.click(screen.getByRole("button", { name: "Save bookmark" }));

    expect(await screen.findByText("Bookmark saved locally. Sync pending.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Needs sync" })).toBeInTheDocument();

    setItemSpy.mockRestore();

    await user.click(screen.getByRole("button", { name: "Sync now" }));

    await waitFor(() => {
      expect(screen.queryByRole("img", { name: "Needs sync" })).not.toBeInTheDocument();
    });

    expect(JSON.parse(window.localStorage.getItem("datalens:bookmarks:orders") ?? "[]")).toEqual([
      expect.objectContaining({
        name: "Needs sync",
      }),
    ]);
  });
});
