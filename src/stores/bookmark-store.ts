import { create } from "zustand";
import {
  clearSyncFlag,
  createSyncFailureNotifier,
  hasPendingSync,
  markPendingSync,
} from "@/lib/sync-feedback";

const STORAGE_KEY = "datalens-bookmarks";
const notifyBookmarkSyncFailure = createSyncFailureNotifier("bookmark");

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
  addBookmark: (bookmark: Bookmark) => void;
  removeBookmark: (id: string) => void;
  getBookmarksByDataset: (datasetId: string) => Bookmark[];
  clearBookmarks: () => void;
  syncPending: () => void;
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
        (typeof candidate.columnName === "undefined" ||
          typeof candidate.columnName === "string") &&
        (typeof candidate.sql === "undefined" || typeof candidate.sql === "string") &&
        typeof candidate.label === "string" &&
        typeof candidate.createdAt === "number" &&
        Number.isFinite(candidate.createdAt) &&
        (typeof candidate.synced === "undefined" ||
          typeof candidate.synced === "boolean")
      );
    });
  } catch {
    return [];
  }
}

function persistBookmarks(bookmarks: Bookmark[]): boolean {
  if (typeof window === "undefined") return true;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
    return true;
  } catch {
    return false;
  }
}

function clearBookmarkSyncState(bookmarks: Bookmark[]): Bookmark[] {
  return bookmarks.map((bookmark) => clearSyncFlag(bookmark));
}

function markBookmarksPending(bookmarks: Bookmark[], ids: string[]): Bookmark[] {
  const pendingIds = new Set(ids);
  return bookmarks.map((bookmark) =>
    pendingIds.has(bookmark.id) ? markPendingSync(bookmark) : bookmark,
  );
}

export const useBookmarkStore = create<BookmarkStore>((set, get) => ({
  bookmarks: readBookmarks(),

  addBookmark: (bookmark) =>
    set((state) => {
      const next = [
        bookmark,
        ...state.bookmarks.filter((existing) => existing.id !== bookmark.id),
      ];
      const syncedBookmarks = clearBookmarkSyncState(next);

      if (persistBookmarks(syncedBookmarks)) {
        return { bookmarks: syncedBookmarks };
      }

      notifyBookmarkSyncFailure();
      return { bookmarks: markBookmarksPending(next, [bookmark.id]) };
    }),

  removeBookmark: (id) =>
    set((state) => {
      const next = state.bookmarks.filter((bookmark) => bookmark.id !== id);
      const syncedBookmarks = clearBookmarkSyncState(next);

      if (persistBookmarks(syncedBookmarks)) {
        return { bookmarks: syncedBookmarks };
      }

      notifyBookmarkSyncFailure();
      return { bookmarks: markBookmarksPending(state.bookmarks, [id]) };
    }),

  getBookmarksByDataset: (datasetId) =>
    get()
      .bookmarks.filter((bookmark) => bookmark.datasetId === datasetId)
      .sort((a, b) => b.createdAt - a.createdAt),

  clearBookmarks: () => {
    const current = get().bookmarks;

    if (persistBookmarks([])) {
      set({ bookmarks: [] });
      return;
    }

    if (current.length > 0) {
      notifyBookmarkSyncFailure(current.length);
    }

    set({ bookmarks: current.map((bookmark) => markPendingSync(bookmark)) });
  },

  syncPending: () => {
    const pending = get().bookmarks.filter(hasPendingSync);
    if (pending.length === 0) {
      return;
    }

    const syncedBookmarks = clearBookmarkSyncState(get().bookmarks);
    if (persistBookmarks(syncedBookmarks)) {
      set({ bookmarks: syncedBookmarks });
      return;
    }

    notifyBookmarkSyncFailure(pending.length);
  },
}));
