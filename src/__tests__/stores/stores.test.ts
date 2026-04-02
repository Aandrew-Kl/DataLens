import { useDatasetStore } from "@/stores/dataset-store";
import { useQueryStore } from "@/stores/query-store";
import { useUIStore } from "@/stores/ui-store";
import type { DatasetMeta } from "@/types/dataset";
import type { SavedQuery } from "@/types/query";

// Reset stores before each test
beforeEach(() => {
  useDatasetStore.setState({ datasets: [], activeDatasetId: null });
  useQueryStore.setState({ history: [], lastResult: null, isQuerying: false });
  useUIStore.setState({ sidebarOpen: true, theme: "light" });
});

describe("DatasetStore", () => {
  const mockDataset: DatasetMeta = {
    id: "test-1",
    name: "test_data",
    fileName: "test_data.csv",
    rowCount: 100,
    columnCount: 3,
    columns: [
      { name: "id", type: "number", nullCount: 0, uniqueCount: 100, sampleValues: [1, 2, 3] },
      { name: "name", type: "string", nullCount: 5, uniqueCount: 80, sampleValues: ["a", "b"] },
      { name: "date", type: "date", nullCount: 0, uniqueCount: 30, sampleValues: ["2024-01-01"] },
    ],
    uploadedAt: Date.now(),
    sizeBytes: 5000,
  };

  it("starts with empty datasets", () => {
    const state = useDatasetStore.getState();
    expect(state.datasets).toEqual([]);
    expect(state.activeDatasetId).toBeNull();
  });

  it("adds a dataset and sets it as active", () => {
    useDatasetStore.getState().addDataset(mockDataset);
    const state = useDatasetStore.getState();
    expect(state.datasets.length).toBe(1);
    expect(state.activeDatasetId).toBe("test-1");
  });

  it("supports multiple datasets", () => {
    useDatasetStore.getState().addDataset(mockDataset);
    useDatasetStore.getState().addDataset({
      ...mockDataset,
      id: "test-2",
      name: "other_data",
    });
    expect(useDatasetStore.getState().datasets.length).toBe(2);
    // Latest added is active
    expect(useDatasetStore.getState().activeDatasetId).toBe("test-2");
  });

  it("removes a dataset", () => {
    useDatasetStore.getState().addDataset(mockDataset);
    useDatasetStore.getState().removeDataset("test-1");
    expect(useDatasetStore.getState().datasets.length).toBe(0);
    expect(useDatasetStore.getState().activeDatasetId).toBeNull();
  });

  it("switches active dataset", () => {
    useDatasetStore.getState().addDataset(mockDataset);
    useDatasetStore.getState().addDataset({
      ...mockDataset,
      id: "test-2",
    });
    useDatasetStore.getState().setActiveDataset("test-1");
    expect(useDatasetStore.getState().activeDatasetId).toBe("test-1");
  });

  it("getActiveDataset returns the active dataset", () => {
    useDatasetStore.getState().addDataset(mockDataset);
    const active = useDatasetStore.getState().getActiveDataset();
    expect(active).toEqual(mockDataset);
  });

  it("getActiveDataset returns undefined when no active dataset", () => {
    const active = useDatasetStore.getState().getActiveDataset();
    expect(active).toBeUndefined();
  });
});

describe("QueryStore", () => {
  const mockQuery: SavedQuery = {
    id: "q-1",
    question: "How many rows?",
    sql: 'SELECT COUNT(*) FROM "test"',
    datasetId: "test-1",
    createdAt: Date.now(),
  };

  it("starts with empty history", () => {
    expect(useQueryStore.getState().history).toEqual([]);
  });

  it("adds to history", () => {
    useQueryStore.getState().addToHistory(mockQuery);
    expect(useQueryStore.getState().history.length).toBe(1);
    expect(useQueryStore.getState().history[0].question).toBe("How many rows?");
  });

  it("limits history to 50 items", () => {
    for (let i = 0; i < 60; i++) {
      useQueryStore.getState().addToHistory({
        ...mockQuery,
        id: `q-${i}`,
        question: `Query ${i}`,
      });
    }
    expect(useQueryStore.getState().history.length).toBe(50);
  });

  it("newest queries are first", () => {
    useQueryStore.getState().addToHistory({ ...mockQuery, id: "q-1", question: "First" });
    useQueryStore.getState().addToHistory({ ...mockQuery, id: "q-2", question: "Second" });
    expect(useQueryStore.getState().history[0].question).toBe("Second");
  });

  it("clears history", () => {
    useQueryStore.getState().addToHistory(mockQuery);
    useQueryStore.getState().clearHistory();
    expect(useQueryStore.getState().history).toEqual([]);
  });

  it("tracks querying state", () => {
    expect(useQueryStore.getState().isQuerying).toBe(false);
    useQueryStore.getState().setIsQuerying(true);
    expect(useQueryStore.getState().isQuerying).toBe(true);
  });
});

describe("UIStore", () => {
  it("starts with sidebar open", () => {
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it("toggles sidebar", () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(false);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it("sets theme", () => {
    // Mock document for theme setting
    document.documentElement.classList.remove("dark");
    useUIStore.getState().setTheme("dark");
    expect(useUIStore.getState().theme).toBe("dark");
  });

  it("toggles theme", () => {
    useUIStore.getState().setTheme("light");
    useUIStore.getState().toggleTheme();
    expect(useUIStore.getState().theme).toBe("dark");
    useUIStore.getState().toggleTheme();
    expect(useUIStore.getState().theme).toBe("light");
  });
});
