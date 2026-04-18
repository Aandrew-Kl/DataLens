import { runQuery } from "@/lib/duckdb/client";
import { pipelinesApi } from "@/lib/api/pipelines";
import {
  createPipelineStep,
  type PipelineStep,
  type SavedPipeline,
} from "@/lib/utils/pipeline-builder";
import { useAuthStore } from "@/stores/auth-store";
import { usePipelineStore } from "@/stores/pipeline-store";
import type { ColumnProfile } from "@/types/dataset";

jest.mock("@/lib/duckdb/client", () => ({
  runQuery: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/api/pipelines", () => ({
  pipelinesApi: {
    list: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;
const mockedPipelinesApi = pipelinesApi as jest.Mocked<typeof pipelinesApi>;

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

type DraftPipeline = Omit<SavedPipeline, "savedAt">;

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
    window.localStorage.clear();
    usePipelineStore.setState(usePipelineStore.getInitialState());
    mockRunQuery.mockReset();
    mockRunQuery.mockResolvedValue([]);
    mockedPipelinesApi.list.mockReset();
    mockedPipelinesApi.create.mockReset();
    mockedPipelinesApi.delete.mockReset();
    useAuthStore.setState({ token: null, isAuthenticated: false });
    jest.restoreAllMocks();
  });

  it("has correct initial state", () => {
    const state = usePipelineStore.getState();

    expect(state.pipelines).toEqual([]);
    expect(state.activePipelineId).toBeNull();
    expect(state.executionHistory).toEqual([]);
  });

  it("hydrates pipelines from the backend when authenticated", async () => {
    useAuthStore.setState({ token: "auth-token", isAuthenticated: true });
    mockedPipelinesApi.list.mockResolvedValue([
      {
        id: "remote-pipeline",
        name: "Remote pipeline",
        steps: [makeStep({ id: "remote-step" })],
        createdAt: 1_800_000_000_000,
        savedAt: 1_900_000_000_000,
      },
    ]);

    await usePipelineStore.getState().hydrate();

    expect(mockedPipelinesApi.list).toHaveBeenCalledTimes(1);
    expect(usePipelineStore.getState().pipelines).toEqual([
      expect.objectContaining({
        id: "remote-pipeline",
        name: "Remote pipeline",
        savedAt: 1_900_000_000_000,
      }),
    ]);
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
    expect(state.pipelines[0]?.steps[0]).not.toBe(draftSteps[0]);
  });

  it("uses structuredClone when available while adding pipelines", () => {
    const originalStructuredClone = global.structuredClone;
    const structuredCloneSpy = jest.fn((value: unknown) =>
      JSON.parse(JSON.stringify(value)),
    ) as typeof structuredClone;

    global.structuredClone = structuredCloneSpy;

    usePipelineStore.getState().addPipeline(makePipeline());

    expect(structuredCloneSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pipeline-1" }),
    );

    global.structuredClone = originalStructuredClone;
  });

  it("syncs pipeline writes to the backend when authenticated", async () => {
    useAuthStore.setState({ token: "auth-token", isAuthenticated: true });
    mockedPipelinesApi.create.mockResolvedValue({
      id: "pipeline-1",
      name: "Regional Filter",
      steps: [makeStep()],
      createdAt: 1_800_000_000_000,
      savedAt: 1_900_000_000_000,
    });

    await usePipelineStore.getState().addPipeline(makePipeline());

    expect(mockedPipelinesApi.create).toHaveBeenCalledWith({
      id: "pipeline-1",
      name: "Regional Filter",
      steps: [expect.objectContaining({ id: "step-1" })],
    });
    expect(usePipelineStore.getState().pipelines[0]).toMatchObject({
      id: "pipeline-1",
      savedAt: 1_900_000_000_000,
    });
  });

  it("updates a pipeline and keeps a cloned step list", () => {
    // Build test data BEFORE mocking Date.now (createPipelineStep calls Date.now internally)
    const pipelineDraft = makePipeline({ id: "pipeline-1", name: "Original" });
    const replacement = [
      {
        ...makeStep({
          id: "step-2",
          type: "sort",
          direction: "DESC",
        }),
      },
    ];

    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1_700_000_000_000).mockReturnValueOnce(1_700_000_000_001);

    usePipelineStore.getState().addPipeline(pipelineDraft);
    const original = usePipelineStore.getState().pipelines[0];
    const originalSavedAt = original?.savedAt ?? 0;
    expect(originalSavedAt).toBe(1_700_000_000_000);

    usePipelineStore.getState().updatePipeline("pipeline-1", {
      name: "Sorted",
      steps: replacement,
    });

    replacement[0].direction = "ASC";

    const state = usePipelineStore.getState();
    const saved = state.pipelines[0];

    expect(state.activePipelineId).toBe("pipeline-1");
    expect(saved).toMatchObject({
      id: "pipeline-1",
      name: "Sorted",
      steps: [{ id: "step-2", type: "sort", direction: "DESC" }],
    });
    expect(saved?.savedAt).toBe(1_700_000_000_001);
    expect(saved?.steps[0]).not.toBe(replacement[0]);
    nowSpy.mockRestore();
  });

  it("does not update missing pipelines", () => {
    usePipelineStore.getState().addPipeline(makePipeline({ id: "pipeline-1" }));

    usePipelineStore.getState().updatePipeline("missing", { name: "Never" });

    const state = usePipelineStore.getState();
    expect(state.pipelines).toHaveLength(1);
    expect(state.pipelines[0]?.id).toBe("pipeline-1");
    expect(state.pipelines[0]?.name).toBe("Regional Filter");
    expect(state.activePipelineId).toBe("pipeline-1");
  });

  it("updates metadata without replacing the current steps when no new steps are provided", () => {
    usePipelineStore.getState().addPipeline(makePipeline({ id: "pipeline-1" }));

    const originalSteps = usePipelineStore.getState().pipelines[0]?.steps ?? [];

    usePipelineStore.getState().updatePipeline("pipeline-1", {
      name: "Renamed only",
    });

    const saved = usePipelineStore.getState().pipelines[0];

    expect(saved?.name).toBe("Renamed only");
    expect(saved?.steps).toEqual(originalSteps);
    expect(saved?.steps).not.toBe(originalSteps);
    expect(saved?.steps[0]).not.toBe(originalSteps[0]);
  });

  it("removes a pipeline and falls back to the next available one", () => {
    usePipelineStore.getState().addPipeline(makePipeline({ id: "pipeline-a", name: "A" }));
    usePipelineStore.getState().addPipeline(makePipeline({ id: "pipeline-b", name: "B" }));

    usePipelineStore.getState().removePipeline("pipeline-b");

    expect(usePipelineStore.getState().pipelines.map((pipeline) => pipeline.id)).toEqual([
      "pipeline-a",
    ]);
    expect(usePipelineStore.getState().activePipelineId).toBe("pipeline-a");
  });

  it("does not change active pipeline when removing a missing pipeline", () => {
    usePipelineStore.getState().addPipeline(makePipeline({ id: "pipeline-1" }));

    usePipelineStore.getState().removePipeline("missing-id");

    expect(usePipelineStore.getState().pipelines.map((pipeline) => pipeline.id)).toEqual([
      "pipeline-1",
    ]);
    expect(usePipelineStore.getState().activePipelineId).toBe("pipeline-1");
  });

  it("clears the active pipeline when removing the final pipeline", () => {
    usePipelineStore.getState().addPipeline(makePipeline({ id: "pipeline-1" }));

    usePipelineStore.getState().removePipeline("pipeline-1");

    expect(usePipelineStore.getState().pipelines).toEqual([]);
    expect(usePipelineStore.getState().activePipelineId).toBeNull();
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
    expect(mockRunQuery).toHaveBeenCalledTimes(1);
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
    expect(usePipelineStore.getState().activePipelineId).toBe("pipeline-1");
    expect(usePipelineStore.getState().executionHistory[0]).toEqual(record);
  });

  it("falls back to a generic error message for non-Error execution failures", async () => {
    mockRunQuery.mockRejectedValueOnce("boom");

    usePipelineStore.getState().addPipeline(makePipeline());

    const record = await usePipelineStore.getState().executePipeline({
      pipelineId: "pipeline-1",
      tableName: "orders",
      columns,
    });

    expect(record).toMatchObject({
      pipelineId: "pipeline-1",
      status: "error",
      errorMessage: "Pipeline execution failed.",
    });
  });

  it("keeps execution history bounded to the most recent 20 runs", async () => {
    const nowSpy = jest.spyOn(Date, "now");
    mockRunQuery.mockResolvedValue([]);

    usePipelineStore.getState().addPipeline(makePipeline());

    for (let index = 0; index < 22; index += 1) {
      nowSpy.mockReturnValueOnce(1_700_000_000_000 + index);
      await usePipelineStore.getState().executePipeline({
        pipelineId: "pipeline-1",
        tableName: "orders",
        columns,
      });
    }

    const state = usePipelineStore.getState();
    expect(state.executionHistory).toHaveLength(20);
    expect(state.executionHistory[0]?.pipelineId).toBe("pipeline-1");
    expect(state.executionHistory[0]?.sql).toContain('SELECT * FROM "orders" WHERE "region" = \'East\'');
    expect(mockRunQuery).toHaveBeenCalledTimes(22);
    nowSpy.mockRestore();
  });

  it("clears execution history without removing pipelines", () => {
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
    expect(usePipelineStore.getState().activePipelineId).toBe("pipeline-1");
    expect(usePipelineStore.getState().executionHistory).toEqual([]);
  });
});
