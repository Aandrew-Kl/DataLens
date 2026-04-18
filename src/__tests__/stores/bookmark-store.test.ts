import { useBookmarkStore, type Bookmark } from "@/stores/bookmark-store";
import { bookmarksApi } from "@/lib/api/bookmarks";
import { useAuthStore } from "@/stores/auth-store";

jest.mock("@/lib/api/bookmarks", () => ({
  bookmarksApi: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

const STORAGE_KEY = "datalens-bookmarks";
const mockedBookmarksApi = bookmarksApi as jest.Mocked<typeof bookmarksApi>;

function makeBookmark(
  id: string,
  overrides: Partial<Bookmark> = {},
): Bookmark {
  return {
    id,
    datasetId: "dataset-1",
    tableName: "orders",
    label: `Bookmark ${id}`,
    createdAt: 1_700_000_000_000,
    synced: false,
    ...overrides,
  };
}

async function loadFreshBookmarkStore() {
  jest.resetModules();
  return import("@/stores/bookmark-store");
}

describe("useBookmarkStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
    mockedBookmarksApi.list.mockReset();
    mockedBookmarksApi.create.mockReset();
    mockedBookmarksApi.update.mockReset();
    mockedBookmarksApi.delete.mockReset();
    useAuthStore.setState({ token: null, isAuthenticated: false });
    useBookmarkStore.setState(useBookmarkStore.getInitialState());
  });

  it("has correct initial state", () => {
    expect(useBookmarkStore.getState().bookmarks).toEqual([]);
  });

  it("hydrates bookmarks from localStorage and filters invalid records", async () => {
    const valid = makeBookmark("valid");
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        valid,
        { id: 123, label: "broken", datasetId: "bad", tableName: "x" },
        { ...makeBookmark("invalid"), createdAt: "later" },
      ]),
    );

    const { useBookmarkStore: fresh } = await loadFreshBookmarkStore();

    expect(fresh.getState().bookmarks).toEqual([valid]);
  });

  it("falls back to an empty list for malformed localStorage JSON", async () => {
    window.localStorage.setItem(STORAGE_KEY, "{broken-json");

    const { useBookmarkStore: fresh } = await loadFreshBookmarkStore();

    expect(fresh.getState().bookmarks).toEqual([]);
  });

  it("adds bookmarks, de-duplicates ids, and persists to localStorage", () => {
    const first = makeBookmark("same-id", {
      label: "Original",
      createdAt: 1_700_000_000_000,
    });
    const replacement = makeBookmark("same-id", {
      label: "Replacement",
      createdAt: 1_800_000_000_000,
    });

    useBookmarkStore.getState().addBookmark(first);
    useBookmarkStore.getState().addBookmark(replacement);

    expect(useBookmarkStore.getState().bookmarks).toEqual([replacement]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([
      replacement,
    ]);
  });

  it("removes bookmarks and keeps memory and storage consistent", () => {
    const first = makeBookmark("first");
    const second = makeBookmark("second");

    useBookmarkStore.getState().addBookmark(first);
    useBookmarkStore.getState().addBookmark(second);
    useBookmarkStore.getState().removeBookmark("first");

    expect(useBookmarkStore.getState().bookmarks).toEqual([second]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([
      second,
    ]);
  });

  it("does nothing when removing a missing bookmark", () => {
    const bookmark = makeBookmark("first");

    useBookmarkStore.getState().addBookmark(bookmark);
    useBookmarkStore.getState().removeBookmark("missing");

    expect(useBookmarkStore.getState().bookmarks).toEqual([bookmark]);
  });

  it("filters bookmarks by dataset and sorts newest-first", () => {
    const older = makeBookmark("older", {
      datasetId: "dataset-1",
      createdAt: 100,
    });
    const newer = makeBookmark("newer", {
      datasetId: "dataset-1",
      createdAt: 200,
    });
    const otherDataset = makeBookmark("other", {
      datasetId: "dataset-2",
      createdAt: 300,
    });

    useBookmarkStore.getState().addBookmark(older);
    useBookmarkStore.getState().addBookmark(newer);
    useBookmarkStore.getState().addBookmark(otherDataset);

    expect(useBookmarkStore.getState().getBookmarksByDataset("dataset-1")).toEqual([
      newer,
      older,
    ]);
  });

  it("clears bookmarks and persists empty storage", () => {
    useBookmarkStore.getState().addBookmark(makeBookmark("first"));
    useBookmarkStore.getState().clearBookmarks();

    expect(useBookmarkStore.getState().bookmarks).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify([]));
  });

  it("keeps in-memory state when localStorage writes fail", () => {
    const setItemSpy = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("No storage");
      });

    const bookmark = makeBookmark("storage-fail");

    useBookmarkStore.getState().addBookmark(bookmark);

    expect(useBookmarkStore.getState().bookmarks).toEqual([bookmark]);

    setItemSpy.mockRestore();
  });

  it("hydrates bookmarks from the backend when authenticated", async () => {
    useAuthStore.setState({ token: "auth-token", isAuthenticated: true });
    mockedBookmarksApi.list.mockResolvedValue([
      {
        id: "remote-1",
        datasetId: "dataset-1",
        tableName: "orders",
        label: "Remote bookmark",
        description: null,
        columnName: null,
        sql: "SELECT * FROM orders",
        viewState: null,
        createdAt: 1_800_000_000_000,
        updatedAt: 1_800_000_000_000,
      },
    ]);

    await useBookmarkStore.getState().hydrate();

    expect(mockedBookmarksApi.list).toHaveBeenCalledTimes(1);
    expect(useBookmarkStore.getState().bookmarks).toEqual([
      makeBookmark("remote-1", {
        label: "Remote bookmark",
        createdAt: 1_800_000_000_000,
        sql: "SELECT * FROM orders",
        synced: true,
      }),
    ]);
  });

  it("syncs bookmark writes to the backend when authenticated", async () => {
    useAuthStore.setState({ token: "auth-token", isAuthenticated: true });
    const bookmark = makeBookmark("remote-write");
    mockedBookmarksApi.create.mockResolvedValue({
      id: "remote-write",
      datasetId: "dataset-1",
      tableName: "orders",
      label: "Bookmark remote-write",
      description: null,
      columnName: null,
      sql: null,
      viewState: null,
      createdAt: 1_900_000_000_000,
      updatedAt: 1_900_000_000_000,
    });

    await useBookmarkStore.getState().addBookmark(bookmark);

    expect(mockedBookmarksApi.create).toHaveBeenCalledWith({
      id: "remote-write",
      datasetId: "dataset-1",
      tableName: "orders",
      label: "Bookmark remote-write",
      columnName: null,
      sql: null,
    });
    expect(mockedBookmarksApi.update).not.toHaveBeenCalled();
    expect(useBookmarkStore.getState().bookmarks[0]).toMatchObject({
      id: "remote-write",
      createdAt: 1_900_000_000_000,
      synced: true,
    });
  });

  it("updates synced bookmarks with PATCH when authenticated", async () => {
    useAuthStore.setState({ token: "auth-token", isAuthenticated: true });
    useBookmarkStore.setState({
      bookmarks: [
        makeBookmark("remote-write", {
          label: "Original",
          synced: true,
        }),
      ],
    });
    mockedBookmarksApi.update.mockResolvedValue({
      id: "remote-write",
      datasetId: "dataset-1",
      tableName: "orders",
      label: "Bookmark remote-write updated",
      description: null,
      columnName: null,
      sql: null,
      viewState: null,
      createdAt: 1_900_000_000_000,
      updatedAt: 1_900_000_000_100,
    });

    await useBookmarkStore.getState().addBookmark(
      makeBookmark("remote-write", {
        label: "Bookmark remote-write updated",
        synced: true,
      }),
    );

    expect(mockedBookmarksApi.update).toHaveBeenCalledWith("remote-write", {
      datasetId: "dataset-1",
      tableName: "orders",
      label: "Bookmark remote-write updated",
      columnName: null,
      sql: null,
    });
    expect(mockedBookmarksApi.create).not.toHaveBeenCalled();
    expect(useBookmarkStore.getState().bookmarks[0]).toMatchObject({
      id: "remote-write",
      label: "Bookmark remote-write updated",
      synced: true,
    });
  });

  it("keeps local bookmarks when backend sync fails", async () => {
    useAuthStore.setState({ token: "auth-token", isAuthenticated: true });
    const bookmark = makeBookmark("fallback");
    mockedBookmarksApi.create.mockRejectedValue(new Error("offline"));

    await useBookmarkStore.getState().addBookmark(bookmark);

    expect(useBookmarkStore.getState().bookmarks).toEqual([bookmark]);
  });
});
