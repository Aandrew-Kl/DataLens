import { act, renderHook } from "@testing-library/react";

import {
  useDatasetPersistence,
  type RecentDatasetEntry,
} from "@/hooks/use-dataset-persistence";

const STORAGE_KEY = "datalens:recent-datasets";
const originalLocalStorage = window.localStorage;

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
  let storageState: Record<string, string>;

  beforeEach(() => {
    storageState = {};

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: jest.fn(() => {
          storageState = {};
        }),
        getItem: jest.fn((key: string) => storageState[key] ?? null),
        key: jest.fn((index: number) => Object.keys(storageState)[index] ?? null),
        get length() {
          return Object.keys(storageState).length;
        },
        removeItem: jest.fn((key: string) => {
          delete storageState[key];
        }),
        setItem: jest.fn((key: string, value: string) => {
          storageState[key] = value;
        }),
      } as unknown as Storage,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
  });

  function readStoredEntries(): RecentDatasetEntry[] {
    return JSON.parse(storageState[STORAGE_KEY] ?? "[]") as RecentDatasetEntry[];
  }

  it("hydrates recent datasets from localStorage", () => {
    const storedEntries = [makeEntry(2), makeEntry(1)];
    storageState[STORAGE_KEY] = JSON.stringify(storedEntries);

    const { result } = renderHook(() => useDatasetPersistence());

    expect(result.current.recentDatasets).toEqual(storedEntries);
    expect(result.current.getRecentDatasets()).toEqual(storedEntries);
  });

  it("saves datasets newest-first and persists them to localStorage", () => {
    const first = makeEntry(1);
    const second = makeEntry(2);
    const { result } = renderHook(() => useDatasetPersistence());

    act(() => {
      result.current.saveRecentDataset(first);
      result.current.saveRecentDataset(second);
    });

    expect(result.current.recentDatasets).toEqual([second, first]);
    expect(result.current.getRecentDatasets()).toEqual([second, first]);
    expect(readStoredEntries()).toEqual([second, first]);
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
    expect(readStoredEntries()).toEqual([updatedFirst, second]);
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
    expect(readStoredEntries()).toHaveLength(10);
  });

  it("removes a single recent dataset by id", () => {
    const { result } = renderHook(() => useDatasetPersistence());

    act(() => {
      result.current.saveRecentDataset(makeEntry(1));
      result.current.saveRecentDataset(makeEntry(2));
      result.current.removeRecentDataset("dataset-1");
    });

    expect(result.current.recentDatasets.map((entry) => entry.id)).toEqual([
      "dataset-2",
    ]);
    expect(readStoredEntries().map((entry) => entry.id)).toEqual(["dataset-2"]);
  });

  it("clears all recent datasets", () => {
    const { result } = renderHook(() => useDatasetPersistence());

    act(() => {
      result.current.saveRecentDataset(makeEntry(1));
      result.current.saveRecentDataset(makeEntry(2));
      result.current.clearRecentDatasets();
    });

    expect(result.current.recentDatasets).toEqual([]);
    expect(readStoredEntries()).toEqual([]);
  });
});
