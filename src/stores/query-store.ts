import { create } from "zustand";
import type { QueryResult, SavedQuery } from "@/types/query";

interface QueryStore {
  history: SavedQuery[];
  lastResult: QueryResult | null;
  isQuerying: boolean;
  addToHistory: (query: SavedQuery) => void;
  setLastResult: (result: QueryResult | null) => void;
  setIsQuerying: (v: boolean) => void;
  clearHistory: () => void;
}

export const useQueryStore = create<QueryStore>((set) => ({
  history: [],
  lastResult: null,
  isQuerying: false,

  addToHistory: (query) =>
    set((state) => ({
      history: [query, ...state.history].slice(0, 50),
    })),

  setLastResult: (result) => set({ lastResult: result }),
  setIsQuerying: (v) => set({ isQuerying: v }),
  clearHistory: () => set({ history: [] }),
}));
