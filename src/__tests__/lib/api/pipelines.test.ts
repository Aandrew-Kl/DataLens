import { pipelinesApi } from "@/lib/api/pipelines";
import { request } from "@/lib/api/client";
import type { PipelineStep } from "@/lib/utils/pipeline-builder";

jest.mock("@/lib/api/client", () => ({
  request: jest.fn(),
}));

const mockedRequest = jest.mocked(request);

describe("pipelines API", () => {
  beforeEach(() => {
    mockedRequest.mockReset();
  });

  test("lists pipelines and maps timestamps to savedAt", async () => {
    mockedRequest.mockResolvedValue([
      {
        id: "pipeline-1",
        user_id: "user-1",
        name: "Regional filter",
        steps: [{ id: "step-1", type: "filter", column: "region" }],
        created_at: "2026-04-18T12:00:00Z",
        updated_at: "2026-04-18T13:00:00Z",
      },
    ]);

    await expect(pipelinesApi.list()).resolves.toEqual([
      {
        id: "pipeline-1",
        name: "Regional filter",
        steps: [{ id: "step-1", type: "filter", column: "region" }],
        createdAt: new Date("2026-04-18T12:00:00Z").getTime(),
        savedAt: new Date("2026-04-18T13:00:00Z").getTime(),
      },
    ]);

    expect(mockedRequest).toHaveBeenCalledWith("GET", "/api/pipelines");
  });

  test("creates a pipeline with backend field names", async () => {
    mockedRequest.mockResolvedValue({
      id: "pipeline-1",
      user_id: "user-1",
      name: "Regional filter",
      steps: [],
      created_at: "2026-04-18T12:00:00Z",
      updated_at: "2026-04-18T12:00:00Z",
    });

    await pipelinesApi.create({
      id: "pipeline-1",
      name: "Regional filter",
      steps: [],
    });

    expect(mockedRequest).toHaveBeenCalledWith("POST", "/api/pipelines", {
      id: "pipeline-1",
      name: "Regional filter",
      steps: [],
    });
  });

  test("updates a pipeline with backend field names", async () => {
    mockedRequest.mockResolvedValue({
      id: "pipeline-1",
      user_id: "user-1",
      name: "Regional filter v2",
      steps: [{ id: "step-1", type: "sort", column: "sales" }],
      created_at: "2026-04-18T12:00:00Z",
      updated_at: "2026-04-18T13:00:00Z",
    });

    await pipelinesApi.update("pipeline-1", {
      name: "Regional filter v2",
      steps: [{ id: "step-1", type: "sort", column: "sales" } as unknown as PipelineStep],
    });

    expect(mockedRequest).toHaveBeenCalledWith("PATCH", "/api/pipelines/pipeline-1", {
      name: "Regional filter v2",
      steps: [{ id: "step-1", type: "sort", column: "sales" }],
    });
  });
});
