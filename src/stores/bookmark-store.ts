import { create } from "zustand";
import { bookmarksApi } from "@/lib/api/bookmarks";
import { useAuthStore } from "@/stores/auth-store";

const STORAGE_KEY = "datalens-bookmarks";

export interface Bookmark {
  id: string;
  datasetId: string;
  tableName: string;
  columnName?: string;
  sql?: string;
  label: string;
  createdAt: number;
  synced?: boolean;
}

interface BookmarkStore {
  bookmarks: Bookmark[];
  hydrate: () => Promise<void>;
  addBookmark: (bookmark: Bookmark) => Promise<void>;
  removeBookmark: (id: string) => Promise<void>;
  getBookmarksByDataset: (datasetId: string) => Bookmark[];
  clearBookmarks: () => Promise<void>;
}

function readBookmarks(): Bookmark[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is Bookmark => {
      if (!item || typeof item !== "object") return false;

      const candidate = item as Partial<Bookmark>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.datasetId === "string" &&
        typeof candidate.tableName === "string" &&
        (typeof candidate.columnName === "undefined" || typeof candidate.columnName === "string") &&
        (typeof candidate.sql === "undefined" || typeof candidate.sql === "string") &&
        typeof candidate.label === "string" &&
        typeof candidate.createdAt === "number" &&
        Number.isFinite(candidate.createdAt) &&
        (typeof candidate.synced === "undefined" || typeof candidate.synced === "boolean")
      );
    });
  } catch {
    return [];
  }
}

function persistBookmarks(bookmarks: Bookmark[]): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
  } catch {
    // Ignore storage write failures.
  }
}

function hasAuthToken(): boolean {
  return Boolean(useAuthStore.getState().token);
}

function sortBookmarks(bookmarks: Bookmark[]): Bookmark[] {
  return [...bookmarks].sort((left, right) => right.createdAt - left.createdAt);
}

export const useBookmarkStore = create<BookmarkStore>((set, get) => ({
  bookmarks: readBookmarks(),

  hydrate: async () => {
    const localBookmarks = sortBookmarks(readBookmarks());

    if (!hasAuthToken()) {
      set({ bookmarks: localBookmarks });
      return;
    }

    try {
      const remoteRecords = await bookmarksApi.list();
      const remoteBookmarks: Bookmark[] = [];
      for (const record of remoteRecords) {
        if (typeof record.datasetId !== "string" || typeof record.tableName !== "string") {
          continue;
        }
        remoteBookmarks.push({
          id: record.id,
          datasetId: record.datasetId,
          tableName: record.tableName,
          columnName: record.columnName ?? undefined,
          sql: record.sql ?? undefined,
          label: record.label,
          createdAt: record.createdAt,
          synced: true,
        });
      }

      const next = sortBookmarks(remoteBookmarks);
      persistBookmarks(next);
      set({ bookmarks: next });
    } catch {
      set({ bookmarks: localBookmarks });
    }
  },

  addBookmark: async (bookmark) => {
    const existingBookmark = get().bookmarks.find((existing) => existing.id === bookmark.id);
    const optimisticBookmark: Bookmark = {
      ...bookmark,
      synced: existingBookmark?.synced ?? bookmark.synced ?? false,
    };
    const next = sortBookmarks([
      optimisticBookmark,
      ...get().bookmarks.filter((existing) => existing.id !== bookmark.id),
    ]);
    persistBookmarks(next);
    set({ bookmarks: next });

    if (!hasAuthToken()) {
      return;
    }

    try {
      const remoteBookmark = existingBookmark?.synced
        ? await bookmarksApi.update(optimisticBookmark.id, {
            datasetId: optimisticBookmark.datasetId,
            tableName: optimisticBookmark.tableName,
            label: optimisticBookmark.label,
            columnName: optimisticBookmark.columnName ?? null,
            sql: optimisticBookmark.sql ?? null,
          })
        : await bookmarksApi.create({
            id: optimisticBookmark.id,
            datasetId: optimisticBookmark.datasetId,
            tableName: optimisticBookmark.tableName,
            label: optimisticBookmark.label,
            columnName: optimisticBookmark.columnName ?? null,
            sql: optimisticBookmark.sql ?? null,
          });
      const syncedBookmark: Bookmark = {
        id: remoteBookmark.id,
        datasetId: remoteBookmark.datasetId ?? optimisticBookmark.datasetId,
        tableName: remoteBookmark.tableName ?? optimisticBookmark.tableName,
        columnName: remoteBookmark.columnName ?? undefined,
        sql: remoteBookmark.sql ?? undefined,
        label: remoteBookmark.label,
        createdAt: remoteBookmark.createdAt,
        synced: true,
      };
      const synced = sortBookmarks([
        syncedBookmark,
        ...get().bookmarks.filter((existing) => existing.id !== optimisticBookmark.id),
      ]);
      persistBookmarks(synced);
      set({ bookmarks: synced });
    } catch {
      // Preserve local-only behavior when remote persistence is unavailable.
    }
  },

  removeBookmark: async (id) => {
    const next = get().bookmarks.filter((bookmark) => bookmark.id !== id);
    persistBookmarks(next);
    set({ bookmarks: next });

    if (!hasAuthToken()) {
      return;
    }

    try {
      await bookmarksApi.delete(id);
    } catch {
      // Keep the local removal if the backend is unavailable.
    }
  },

  getBookmarksByDataset: (datasetId) =>
    get()
      .bookmarks.filter((bookmark) => bookmark.datasetId === datasetId)
      .sort((a, b) => b.createdAt - a.createdAt),

  clearBookmarks: async () => {
    const bookmarkIds = get().bookmarks.map((bookmark) => bookmark.id);
    persistBookmarks([]);
    set({ bookmarks: [] });

    if (!hasAuthToken()) {
      return;
    }

    await Promise.all(
      bookmarkIds.map((id) =>
        bookmarksApi.delete(id).catch(() => {
          // Preserve local-only behavior when remote persistence is unavailable.
        }),
      ),
    );
  },
}));
