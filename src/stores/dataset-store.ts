import { create } from "zustand";
import type { DatasetMeta } from "@/types/dataset";

interface DatasetStore {
  datasets: DatasetMeta[];
  activeDatasetId: string | null;
  addDataset: (meta: DatasetMeta) => void;
  removeDataset: (id: string) => void;
  setActiveDataset: (id: string | null) => void;
  getActiveDataset: () => DatasetMeta | undefined;
}

export const useDatasetStore = create<DatasetStore>((set, get) => ({
  datasets: [],
  activeDatasetId: null,

  addDataset: (meta) =>
    set((state) => ({
      datasets: [...state.datasets, meta],
      activeDatasetId: meta.id,
    })),

  removeDataset: (id) =>
    set((state) => ({
      datasets: state.datasets.filter((d) => d.id !== id),
      activeDatasetId: state.activeDatasetId === id ? null : state.activeDatasetId,
    })),

  setActiveDataset: (id) => set({ activeDatasetId: id }),

  getActiveDataset: () => {
    const state = get();
    return state.datasets.find((d) => d.id === state.activeDatasetId);
  },
}));
