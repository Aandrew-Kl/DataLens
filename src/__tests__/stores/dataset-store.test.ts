import { useDatasetStore } from "@/stores/dataset-store";
import type { DatasetMeta } from "@/types/dataset";

function makeDataset(
  id: string,
  overrides: Partial<DatasetMeta> = {},
): DatasetMeta {
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
    useDatasetStore.setState({
      datasets: [],
      activeDatasetId: null,
    });
  });

  it("adds datasets and makes the latest one active", () => {
    const first = makeDataset("one");
    const second = makeDataset("two");

    useDatasetStore.getState().addDataset(first);
    useDatasetStore.getState().addDataset(second);

    expect(useDatasetStore.getState().datasets).toEqual([first, second]);
    expect(useDatasetStore.getState().activeDatasetId).toBe("two");
    expect(useDatasetStore.getState().getActiveDataset()).toEqual(second);
  });

  it("switches the active dataset by id", () => {
    const first = makeDataset("one");
    const second = makeDataset("two");

    useDatasetStore.getState().addDataset(first);
    useDatasetStore.getState().addDataset(second);
    useDatasetStore.getState().setActiveDataset("one");

    expect(useDatasetStore.getState().activeDatasetId).toBe("one");
    expect(useDatasetStore.getState().getActiveDataset()).toEqual(first);
  });

  it("removes inactive datasets without changing the active selection", () => {
    const first = makeDataset("one");
    const second = makeDataset("two");

    useDatasetStore.getState().addDataset(first);
    useDatasetStore.getState().addDataset(second);
    useDatasetStore.getState().removeDataset("one");

    expect(useDatasetStore.getState().datasets).toEqual([second]);
    expect(useDatasetStore.getState().activeDatasetId).toBe("two");
    expect(useDatasetStore.getState().getActiveDataset()).toEqual(second);
  });

  it("clears the active id when removing the active dataset", () => {
    const first = makeDataset("one");
    const second = makeDataset("two");

    useDatasetStore.getState().addDataset(first);
    useDatasetStore.getState().addDataset(second);
    useDatasetStore.getState().removeDataset("two");

    expect(useDatasetStore.getState().datasets).toEqual([first]);
    expect(useDatasetStore.getState().activeDatasetId).toBeNull();
    expect(useDatasetStore.getState().getActiveDataset()).toBeUndefined();
  });

  it("returns undefined when the active id does not match a dataset", () => {
    useDatasetStore.getState().addDataset(makeDataset("one"));
    useDatasetStore.getState().setActiveDataset("missing");

    expect(useDatasetStore.getState().getActiveDataset()).toBeUndefined();
  });
});
