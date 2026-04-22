import { create } from "zustand";
import { historyApi } from "@/lib/api/history";
import { useAuthStore } from "@/stores/auth-store";
import type { QueryResult, SavedQuery } from "@/types/query";

const STORAGE_KEY = "datalens-query-history";

interface QueryStore {
  history: SavedQuery[];
  lastResult: QueryResult | null;
  isQuerying: boolean;
  hydrate: () => Promise<void>;
  addToHistory: (query: SavedQuery) => Promise<void>;
  removeFromHistory: (id: string) => Promise<void>;
  setLastResult: (result: QueryResult | null) => void;
  setIsQuerying: (v: boolean) => void;
  clearHistory: (datasetId?: string) => Promise<void>;
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
        typeof candidate.createdAt === "number"
      );
    });
  } catch {
    return [];
  }
}

function persistHistory(history: SavedQuery[]): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Preserve in-memory behavior when storage is unavailable.
  }
}

function hasAuthToken(): boolean {
  return Boolean(useAuthStore.getState().token);
}

export const useQueryStore = create<QueryStore>((set) => ({
  history: readHistory(),
  lastResult: null,
  isQuerying: false,

  hydrate: async () => {
    const localHistory = readHistory();

    if (!hasAuthToken()) {
      set({ history: localHistory });
      return;
    }

    try {
      const remoteHistory = (await historyApi.list()).map((entry) => ({
        id: entry.id,
        question: entry.question,
        sql: entry.sql,
        datasetId: entry.datasetId,
        createdAt: entry.createdAt,
      }));
      persistHistory(remoteHistory);
      set({ history: remoteHistory });
    } catch {
      set({ history: localHistory });
    }
  },

  addToHistory: async (query) => {
    set((state) => {
      const next = [query, ...state.history].slice(0, 50);
      persistHistory(next);
      return { history: next };
    });

    if (!hasAuthToken()) {
      return;
    }

    try {
      const remoteEntry = await historyApi.create({
        datasetId: query.datasetId,
        question: query.question,
        sql: query.sql,
      });
      set((state) => {
        const next = state.history.map((entry) =>
          entry.id === query.id
            ? {
                ...entry,
                id: remoteEntry.id,
                question: remoteEntry.question,
                sql: remoteEntry.sql,
                datasetId: remoteEntry.datasetId,
                createdAt: remoteEntry.createdAt,
              }
            : entry,
        );
        persistHistory(next);
        return { history: next };
      });
    } catch {
      // Preserve local-only behavior when remote persistence is unavailable.
    }
  },

  removeFromHistory: async (id) => {
    set((state) => {
      const next = state.history.filter((entry) => entry.id !== id);
      persistHistory(next);
      return { history: next };
    });

    if (!hasAuthToken()) {
      return;
    }

    try {
      await historyApi.delete(id);
    } catch {
      // Preserve the local removal if the backend is unavailable.
    }
  },

  setLastResult: (result) => set({ lastResult: result }),
  setIsQuerying: (v) => set({ isQuerying: v }),
  clearHistory: async (datasetId) => {
    let removedIds: string[] = [];
    set((state) => {
      removedIds = state.history
        .filter((entry) => (datasetId ? entry.datasetId === datasetId : true))
        .map((entry) => entry.id);
      const next = state.history.filter((entry) => (datasetId ? entry.datasetId !== datasetId : false));
      persistHistory(next);
      return { history: next };
    });

    if (!hasAuthToken()) {
      return;
    }

    await Promise.all(
      removedIds.map((id) =>
        historyApi.delete(id).catch(() => {
          // Preserve local-only behavior when remote persistence is unavailable.
        }),
      ),
    );
  },
}));
