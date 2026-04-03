import { act, renderHook } from "@testing-library/react";

import {
  useDatasetPersistence,
  type RecentDatasetEntry,
} from "@/hooks/use-dataset-persistence";

const STORAGE_KEY = "datalens:recent-datasets";

function makeEntry(
  index: number,
  overrides: Partial<RecentDatasetEntry> = {},
): RecentDatasetEntry {
  return {
    id: `dataset-${index}`,
    fileName: `dataset-${index}.csv`,
    tableName: `table_${index}`,
    rowCount: index * 100,
    columnCount: 5 + index,
    uploadedAt: 1_700_000_000_000 + index,
    sizeBytes: 1_024 * index,
    ...overrides,
  };
}

describe("useDatasetPersistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("hydrates recent datasets from localStorage", () => {
    const storedEntries = [makeEntry(2), makeEntry(1)];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedEntries));

    const { result } = renderHook(() => useDatasetPersistence());

    expect(result.current.recentDatasets).toEqual(storedEntries);
    expect(result.current.getRecentDatasets()).toEqual(storedEntries);
  });

  it("saves datasets and persists them newest-first", () => {
    const entry = makeEntry(1);

    const { result } = renderHook(() => useDatasetPersistence());

    act(() => {
      result.current.saveRecentDataset(entry);
    });

    expect(result.current.recentDatasets).toEqual([entry]);
    expect(result.current.getRecentDatasets()).toEqual([entry]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([
      entry,
    ]);
  });

  it("moves duplicate ids to the front and replaces their metadata", () => {
    const first = makeEntry(1);
    const second = makeEntry(2);
    const updatedFirst = makeEntry(1, {
      rowCount: 999,
      uploadedAt: 1_800_000_000_000,
    });

    const { result } = renderHook(() => useDatasetPersistence());

    act(() => {
      result.current.saveRecentDataset(first);
      result.current.saveRecentDataset(second);
      result.current.saveRecentDataset(updatedFirst);
    });

    expect(result.current.recentDatasets).toEqual([updatedFirst, second]);
  });

  it("keeps at most ten recent datasets", () => {
    const { result } = renderHook(() => useDatasetPersistence());

    act(() => {
      for (let index = 1; index <= 12; index += 1) {
        result.current.saveRecentDataset(makeEntry(index));
      }
    });

    expect(result.current.recentDatasets).toHaveLength(10);
    expect(result.current.recentDatasets[0]?.id).toBe("dataset-12");
    expect(result.current.recentDatasets[9]?.id).toBe("dataset-3");
  });

  it("removes individual datasets and can clear the full list", () => {
    const { result } = renderHook(() => useDatasetPersistence());

    act(() => {
      result.current.saveRecentDataset(makeEntry(1));
      result.current.saveRecentDataset(makeEntry(2));
      result.current.removeRecentDataset("dataset-1");
    });

    expect(result.current.recentDatasets.map((entry) => entry.id)).toEqual([
      "dataset-2",
    ]);

    act(() => {
      result.current.clearRecentDatasets();
    });

    expect(result.current.recentDatasets).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify([]));
  });
});
