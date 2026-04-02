import { create } from "zustand";

const STORAGE_KEY = "datalens-bookmarks";

export interface Bookmark {
  id: string;
  datasetId: string;
  tableName: string;
  columnName?: string;
  sql?: string;
  label: string;
  createdAt: number;
}

interface BookmarkStore {
  bookmarks: Bookmark[];
  addBookmark: (bookmark: Bookmark) => void;
  removeBookmark: (id: string) => void;
  getBookmarksByDataset: (datasetId: string) => Bookmark[];
  clearBookmarks: () => void;
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
        Number.isFinite(candidate.createdAt)
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

export const useBookmarkStore = create<BookmarkStore>((set, get) => ({
  bookmarks: readBookmarks(),

  addBookmark: (bookmark) =>
    set((state) => {
      const next = [
        bookmark,
        ...state.bookmarks.filter((existing) => existing.id !== bookmark.id),
      ];
      persistBookmarks(next);
      return { bookmarks: next };
    }),

  removeBookmark: (id) =>
    set((state) => {
      const next = state.bookmarks.filter((bookmark) => bookmark.id !== id);
      persistBookmarks(next);
      return { bookmarks: next };
    }),

  getBookmarksByDataset: (datasetId) =>
    get()
      .bookmarks.filter((bookmark) => bookmark.datasetId === datasetId)
      .sort((a, b) => b.createdAt - a.createdAt),

  clearBookmarks: () => {
    persistBookmarks([]);
    set({ bookmarks: [] });
  },
}));
