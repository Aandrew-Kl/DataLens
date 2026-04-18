import { useBookmarkStore, type Bookmark } from "@/stores/bookmark-store";
import { addToast } from "@/lib/ui/toast-bus";

jest.mock("@/lib/ui/toast-bus", () => ({
  addToast: jest.fn(),
}));

const STORAGE_KEY = "datalens-bookmarks";
const mockAddToast = addToast as jest.MockedFunction<typeof addToast>;

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
    mockAddToast.mockReset();
    jest.restoreAllMocks();
    jest.useRealTimers();
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

  it("marks bookmarks as unsynced and emits a toast when localStorage writes fail", () => {
    jest.useFakeTimers();
    const setItemSpy = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("No storage");
      });

    const bookmark = makeBookmark("storage-fail");

    useBookmarkStore.getState().addBookmark(bookmark);

    expect(useBookmarkStore.getState().bookmarks).toEqual([
      { ...bookmark, synced: false },
    ]);

    jest.runAllTimers();
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
        message: "Failed to sync 1 bookmark. Retry manually.",
      }),
    );

    setItemSpy.mockRestore();
  });

  it("syncPending retries only bookmarks marked as unsynced", () => {
    const synced = makeBookmark("synced");
    const pending = makeBookmark("pending", { synced: false });

    useBookmarkStore.setState({ bookmarks: [pending, synced] });

    useBookmarkStore.getState().syncPending();

    expect(useBookmarkStore.getState().bookmarks).toEqual([
      makeBookmark("pending"),
      synced,
    ]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([
      makeBookmark("pending"),
      synced,
    ]);
  });
});
