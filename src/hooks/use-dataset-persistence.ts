"use client";

import { useCallback } from "react";
import { useLocalStorage } from "./use-local-storage";

/** Maximum number of recent datasets to keep. */
const MAX_RECENT = 10;

/** Storage key used for the recent-datasets list. */
const STORAGE_KEY = "datalens:recent-datasets";

/** Metadata stored for each recently opened dataset. */
export interface RecentDatasetEntry {
  id: string;
  fileName: string;
  tableName: string;
  rowCount: number;
  columnCount: number;
  uploadedAt: number;
  sizeBytes: number;
}

/**
 * A hook that persists dataset metadata in `localStorage` so the user can
 * quickly access recently opened files.
 *
 * Stores at most the 10 most-recent entries. If the same `id` is saved again
 * the existing entry is moved to the front and its metadata is updated.
 */
export function useDatasetPersistence() {
  const [entries, setEntries] = useLocalStorage<RecentDatasetEntry[]>(
    STORAGE_KEY,
    [],
  );

  /**
   * Add or update a dataset in the recent list.
   * If the dataset already exists (by `id`) it is moved to the front.
   */
  const saveRecentDataset = useCallback(
    (entry: RecentDatasetEntry) => {
      setEntries((prev) => {
        const filtered = prev.filter((e) => e.id !== entry.id);
        return [entry, ...filtered].slice(0, MAX_RECENT);
      });
    },
    [setEntries],
  );

  /**
   * Return the list of recently opened datasets, newest first.
   */
  const getRecentDatasets = useCallback((): RecentDatasetEntry[] => {
    return entries;
  }, [entries]);

  /**
   * Remove a single dataset from the recent list by its `id`.
   */
  const removeRecentDataset = useCallback(
    (id: string) => {
      setEntries((prev) => prev.filter((e) => e.id !== id));
    },
    [setEntries],
  );

  /**
   * Clear the entire recent-datasets list.
   */
  const clearRecentDatasets = useCallback(() => {
    setEntries([]);
  }, [setEntries]);

  return {
    recentDatasets: entries,
    saveRecentDataset,
    getRecentDatasets,
    removeRecentDataset,
    clearRecentDatasets,
  } as const;
}
