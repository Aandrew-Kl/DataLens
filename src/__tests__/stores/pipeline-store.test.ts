import { runQuery } from "@/lib/duckdb/client";
import {
  createPipelineStep,
  type PipelineStep,
  type SavedPipeline,
} from "@/lib/utils/pipeline-builder";
import { usePipelineStore } from "@/stores/pipeline-store";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const columns: ColumnProfile[] = [
  {
    name: "region",
    type: "string",
    nullCount: 0,
    uniqueCount: 4,
    sampleValues: ["East", "West"],
  },
  {
    name: "sales",
    type: "number",
    nullCount: 0,
    uniqueCount: 20,
    sampleValues: [100, 200],
  },
];

function makeStep(overrides: Partial<PipelineStep> = {}): PipelineStep {
  return {
    ...createPipelineStep("filter", columns),
    id: "step-1",
    column: "region",
    operator: "=",
    value: "East",
    ...overrides,
  };
}

type DraftPipeline = Omit<SavedPipeline, "savedAt">;

function makePipeline(overrides: Partial<DraftPipeline> = {}): DraftPipeline {
  return {
    id: "pipeline-1",
    name: "Regional Filter",
    steps: [makeStep()],
    ...overrides,
  };
}

describe("usePipelineStore", () => {
  beforeEach(() => {
    usePipelineStore.setState({
      pipelines: [],
      activePipelineId: null,
      executionHistory: [],
    });
    mockRunQuery.mockReset();
    jest.restoreAllMocks();
  });

  it("adds a pipeline, clones its steps, and marks it active", () => {
    const draftSteps = [makeStep()];
    const pipeline = makePipeline({ steps: draftSteps });

    usePipelineStore.getState().addPipeline(pipeline);

    draftSteps[0].value = "West";

    const state = usePipelineStore.getState();

    expect(state.activePipelineId).toBe("pipeline-1");
    expect(state.pipelines).toHaveLength(1);
    expect(state.pipelines[0]).toMatchObject({
      id: "pipeline-1",
      name: "Regional Filter",
      steps: [{ value: "East" }],
    });
    expect(state.pipelines[0]?.steps).not.toBe(draftSteps);
  });

  it("removes the active pipeline and falls back to the next available one", () => {
    usePipelineStore.getState().addPipeline(makePipeline({ id: "pipeline-a", name: "A" }));
    usePipelineStore.getState().addPipeline(makePipeline({ id: "pipeline-b", name: "B" }));

    usePipelineStore.getState().removePipeline("pipeline-b");

    expect(usePipelineStore.getState().pipelines.map((pipeline) => pipeline.id)).toEqual([
      "pipeline-a",
    ]);
    expect(usePipelineStore.getState().activePipelineId).toBe("pipeline-a");
  });

  it("updates a pipeline, refreshes savedAt, and clones replacement steps", () => {
    usePipelineStore.getState().addPipeline(makePipeline({ id: "pipeline-1", name: "Original" }));
    const originalSavedAt = usePipelineStore.getState().pipelines[0]?.savedAt ?? 0;

    const replacementSteps = [makeStep({ id: "step-2", type: "sort", direction: "DESC" })];
    usePipelineStore.getState().updatePipeline("pipeline-1", {
      name: "Sorted",
      steps: replacementSteps,
    });

    replacementSteps[0].direction = "ASC";

    const saved = usePipelineStore.getState().pipelines[0];

    expect(saved).toMatchObject({
      id: "pipeline-1",
      name: "Sorted",
      steps: [{ id: "step-2", type: "sort", direction: "DESC" }],
    });
    expect(saved.savedAt).toBeGreaterThanOrEqual(originalSavedAt);
    expect(usePipelineStore.getState().activePipelineId).toBe("pipeline-1");
  });

  it("records a failed execution when the pipeline cannot be found", async () => {
    const record = await usePipelineStore.getState().executePipeline({
      pipelineId: "missing",
      tableName: "orders",
      columns,
    });

    expect(record).toMatchObject({
      pipelineId: "missing",
      status: "error",
      rowCount: 0,
      sql: "",
      errorMessage: "Pipeline not found.",
    });
    expect(mockRunQuery).not.toHaveBeenCalled();
    expect(usePipelineStore.getState().executionHistory[0]).toEqual(record);
  });

  it("executes a saved pipeline and stores a successful execution record", async () => {
    mockRunQuery.mockResolvedValueOnce([
      { region: "East", sales: 100 },
      { region: "East", sales: 120 },
    ]);
    usePipelineStore.getState().addPipeline(makePipeline());

    const record = await usePipelineStore.getState().executePipeline({
      pipelineId: "pipeline-1",
      tableName: "orders",
      columns,
    });

    expect(record).toMatchObject({
      pipelineId: "pipeline-1",
      status: "success",
      rowCount: 2,
      errorMessage: null,
    });
    expect(record?.sql).toContain('SELECT * FROM "orders" WHERE "region" = \'East\'');
    expect(mockRunQuery).toHaveBeenCalledWith(record?.sql ?? "");
    expect(usePipelineStore.getState().activePipelineId).toBe("pipeline-1");
    expect(usePipelineStore.getState().executionHistory[0]).toEqual(record);
  });

  it("records runQuery failures as execution errors", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("DuckDB exploded"));
    usePipelineStore.getState().addPipeline(makePipeline());

    const record = await usePipelineStore.getState().executePipeline({
      pipelineId: "pipeline-1",
      tableName: "orders",
      columns,
    });

    expect(record).toMatchObject({
      pipelineId: "pipeline-1",
      status: "error",
      rowCount: 0,
      errorMessage: "DuckDB exploded",
    });
    expect(record?.sql).toContain('SELECT * FROM "orders" WHERE "region" = \'East\'');
    expect(usePipelineStore.getState().executionHistory[0]).toEqual(record);
  });

  it("clears execution history without touching saved pipelines", () => {
    usePipelineStore.setState({
      pipelines: [{ ...makePipeline(), savedAt: 1 }],
      activePipelineId: "pipeline-1",
      executionHistory: [
        {
          id: "run-1",
          pipelineId: "pipeline-1",
          status: "success",
          durationMs: 10,
          startedAt: 1,
          finishedAt: 11,
          rowCount: 2,
          sql: 'SELECT * FROM "orders"',
          errorMessage: null,
        },
      ],
    });

    usePipelineStore.getState().clearHistory();

    expect(usePipelineStore.getState().pipelines).toHaveLength(1);
    expect(usePipelineStore.getState().executionHistory).toEqual([]);
    expect(usePipelineStore.getState().activePipelineId).toBe("pipeline-1");
  });
});
