import { useDatasetStore } from "@/stores/dataset-store";
import type { DatasetMeta } from "@/types/dataset";

function makeDataset(id: string, overrides: Partial<DatasetMeta> = {}): DatasetMeta {
  return {
    id,
    name: `Dataset ${id}`,
    fileName: `${id}.csv`,
    rowCount: 100,
    columnCount: 2,
    columns: [
      {
        name: "id",
        type: "number",
        nullCount: 0,
        uniqueCount: 100,
        sampleValues: [1, 2, 3],
      },
      {
        name: "name",
        type: "string",
        nullCount: 0,
        uniqueCount: 90,
        sampleValues: ["A", "B"],
      },
    ],
    uploadedAt: 1_700_000_000_000,
    sizeBytes: 4_096,
    ...overrides,
  };
}

describe("useDatasetStore", () => {
  beforeEach(() => {
    useDatasetStore.setState(useDatasetStore.getInitialState());
  });

  it("has correct initial state", () => {
    const state = useDatasetStore.getState();

    expect(state.datasets).toEqual([]);
    expect(state.activeDatasetId).toBeNull();
  });

  it("adds a dataset and makes it the active dataset", () => {
    const dataset = makeDataset("dataset-1");

    useDatasetStore.getState().addDataset(dataset);

    const state = useDatasetStore.getState();
    expect(state.datasets).toEqual([dataset]);
    expect(state.activeDatasetId).toBe("dataset-1");
    expect(state.getActiveDataset()).toEqual(dataset);
  });

  it("replaces active dataset whenever a new dataset is added", () => {
    const first = makeDataset("dataset-1");
    const second = makeDataset("dataset-2");

    useDatasetStore.getState().addDataset(first);
    useDatasetStore.getState().addDataset(second);

    expect(useDatasetStore.getState().activeDatasetId).toBe("dataset-2");
    expect(useDatasetStore.getState().datasets).toEqual([first, second]);
    expect(useDatasetStore.getState().getActiveDataset()).toEqual(second);
  });

  it("sets active dataset by id", () => {
    const first = makeDataset("dataset-1");
    const second = makeDataset("dataset-2");

    useDatasetStore.getState().addDataset(first);
    useDatasetStore.getState().addDataset(second);
    useDatasetStore.getState().setActiveDataset("dataset-1");

    const state = useDatasetStore.getState();
    expect(state.activeDatasetId).toBe("dataset-1");
    expect(state.getActiveDataset()).toEqual(first);
  });

  it("clears active dataset when null is set", () => {
    useDatasetStore.getState().addDataset(makeDataset("dataset-1"));
    useDatasetStore.getState().setActiveDataset(null);

    const state = useDatasetStore.getState();
    expect(state.activeDatasetId).toBeNull();
    expect(state.getActiveDataset()).toBeUndefined();
  });

  it("removes an inactive dataset without changing active dataset", () => {
    const first = makeDataset("dataset-1");
    const second = makeDataset("dataset-2");

    useDatasetStore.getState().addDataset(first);
    useDatasetStore.getState().addDataset(second);
    useDatasetStore.getState().removeDataset("dataset-1");

    const state = useDatasetStore.getState();
    expect(state.datasets).toEqual([second]);
    expect(state.activeDatasetId).toBe("dataset-2");
    expect(state.getActiveDataset()).toEqual(second);
  });

  it("clears active dataset when the active dataset is removed", () => {
    const first = makeDataset("dataset-1");
    const second = makeDataset("dataset-2");

    useDatasetStore.getState().addDataset(first);
    useDatasetStore.getState().addDataset(second);
    useDatasetStore.getState().setActiveDataset("dataset-1");
    useDatasetStore.getState().removeDataset("dataset-1");

    const state = useDatasetStore.getState();
    expect(state.datasets).toEqual([second]);
    expect(state.activeDatasetId).toBeNull();
    expect(state.getActiveDataset()).toBeUndefined();
  });

  it("returns undefined when active dataset id does not resolve", () => {
    useDatasetStore.getState().addDataset(makeDataset("dataset-1"));
    useDatasetStore.getState().setActiveDataset("missing");

    expect(useDatasetStore.getState().getActiveDataset()).toBeUndefined();
  });

  it("does not change state when removing a non-existing dataset", () => {
    const dataset = makeDataset("dataset-1");
    useDatasetStore.getState().addDataset(dataset);

    useDatasetStore.getState().removeDataset("non-existent");

    expect(useDatasetStore.getState().datasets).toEqual([dataset]);
    expect(useDatasetStore.getState().activeDatasetId).toBe("dataset-1");
  });
});
