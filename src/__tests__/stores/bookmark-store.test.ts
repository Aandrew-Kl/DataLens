import type { Bookmark } from "@/stores/bookmark-store";

const STORAGE_KEY = "datalens-bookmarks";

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

async function loadBookmarkStore() {
  jest.resetModules();
  return import("@/stores/bookmark-store");
}

describe("useBookmarkStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  it("hydrates valid bookmarks from localStorage and filters invalid records", async () => {
    const valid = makeBookmark("valid");
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        valid,
        { id: 123, label: "broken" },
        { ...makeBookmark("bad-date"), createdAt: "later" },
      ]),
    );

    const { useBookmarkStore } = await loadBookmarkStore();

    expect(useBookmarkStore.getState().bookmarks).toEqual([valid]);
  });

  it("falls back to an empty list when localStorage contains malformed JSON", async () => {
    window.localStorage.setItem(STORAGE_KEY, "{broken-json");

    const { useBookmarkStore } = await loadBookmarkStore();

    expect(useBookmarkStore.getState().bookmarks).toEqual([]);
  });

  it("adds bookmarks, de-duplicates ids, and persists the latest value", async () => {
    const { useBookmarkStore } = await loadBookmarkStore();
    const original = makeBookmark("same-id", {
      label: "Original",
      createdAt: 1_700_000_000_000,
    });
    const replacement = makeBookmark("same-id", {
      label: "Replacement",
      createdAt: 1_800_000_000_000,
    });

    useBookmarkStore.getState().addBookmark(original);
    useBookmarkStore.getState().addBookmark(replacement);

    expect(useBookmarkStore.getState().bookmarks).toEqual([replacement]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([
      replacement,
    ]);
  });

  it("removes bookmarks from both the store and localStorage", async () => {
    const { useBookmarkStore } = await loadBookmarkStore();
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

  it("filters bookmarks by dataset and sorts them newest-first", async () => {
    const { useBookmarkStore } = await loadBookmarkStore();
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

  it("clears bookmarks and persists the empty state", async () => {
    const { useBookmarkStore } = await loadBookmarkStore();

    useBookmarkStore.getState().addBookmark(makeBookmark("first"));
    useBookmarkStore.getState().clearBookmarks();

    expect(useBookmarkStore.getState().bookmarks).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify([]));
  });
});
