import { create } from "zustand";
import {
  clearSyncFlag,
  createSyncFailureNotifier,
  hasPendingSync,
  markPendingSync,
} from "@/lib/sync-feedback";
import type { QueryResult, SavedQuery } from "@/types/query";

const STORAGE_KEY = "datalens-query-history";
const MAX_HISTORY = 50;
const notifyQuerySyncFailure = createSyncFailureNotifier("query");

interface QueryStore {
  history: SavedQuery[];
  lastResult: QueryResult | null;
  isQuerying: boolean;
  addToHistory: (query: SavedQuery) => void;
  removeFromHistory: (id: string) => void;
  clearDatasetHistory: (datasetId: string) => void;
  setLastResult: (result: QueryResult | null) => void;
  setIsQuerying: (v: boolean) => void;
  clearHistory: () => void;
  syncPending: () => void;
}

function readHistory(): SavedQuery[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is SavedQuery => {
      if (!item || typeof item !== "object") return false;

      const candidate = item as Partial<SavedQuery>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.question === "string" &&
        typeof candidate.sql === "string" &&
        typeof candidate.datasetId === "string" &&
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

function persistHistory(history: SavedQuery[]): boolean {
  if (typeof window === "undefined") return true;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    return true;
  } catch {
    return false;
  }
}

function clearHistorySyncState(history: SavedQuery[]): SavedQuery[] {
  return history.map((query) => clearSyncFlag(query));
}

function markHistoryPending(history: SavedQuery[], ids: string[]): SavedQuery[] {
  const pendingIds = new Set(ids);
  return history.map((query) =>
    pendingIds.has(query.id) ? markPendingSync(query) : query,
  );
}

export const useQueryStore = create<QueryStore>((set, get) => ({
  history: readHistory(),
  lastResult: null,
  isQuerying: false,

  addToHistory: (query) =>
    set((state) => {
      const nextHistory = [query, ...state.history].slice(0, MAX_HISTORY);
      const syncedHistory = clearHistorySyncState(nextHistory);

      if (persistHistory(syncedHistory)) {
        return { history: syncedHistory };
      }

      notifyQuerySyncFailure();
      return { history: markHistoryPending(nextHistory, [query.id]) };
    }),

  removeFromHistory: (id) =>
    set((state) => {
      const nextHistory = state.history.filter((query) => query.id !== id);
      const syncedHistory = clearHistorySyncState(nextHistory);

      if (persistHistory(syncedHistory)) {
        return { history: syncedHistory };
      }

      notifyQuerySyncFailure();
      return { history: markHistoryPending(state.history, [id]) };
    }),

  clearDatasetHistory: (datasetId) =>
    set((state) => {
      const nextHistory = state.history.filter((query) => query.datasetId !== datasetId);
      const syncedHistory = clearHistorySyncState(nextHistory);

      if (persistHistory(syncedHistory)) {
        return { history: syncedHistory };
      }

      const affectedIds = state.history
        .filter((query) => query.datasetId === datasetId)
        .map((query) => query.id);

      if (affectedIds.length > 0) {
        notifyQuerySyncFailure(affectedIds.length);
      }

      return { history: markHistoryPending(state.history, affectedIds) };
    }),

  setLastResult: (result) => set({ lastResult: result }),
  setIsQuerying: (v) => set({ isQuerying: v }),

  clearHistory: () => {
    const current = get().history;

    if (persistHistory([])) {
      set({ history: [] });
      return;
    }

    if (current.length > 0) {
      notifyQuerySyncFailure(current.length);
    }

    set({ history: current.map((query) => markPendingSync(query)) });
  },

  syncPending: () => {
    const pending = get().history.filter(hasPendingSync);
    if (pending.length === 0) {
      return;
    }

    const syncedHistory = clearHistorySyncState(get().history);
    if (persistHistory(syncedHistory)) {
      set({ history: syncedHistory });
      return;
    }

    notifyQuerySyncFailure(pending.length);
  },
}));
