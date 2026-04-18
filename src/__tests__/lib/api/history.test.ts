import { historyApi } from "@/lib/api/history";
import { request } from "@/lib/api/client";

jest.mock("@/lib/api/client", () => ({
  request: jest.fn(),
}));

const mockedRequest = jest.mocked(request);

describe("history API", () => {
  beforeEach(() => {
    mockedRequest.mockReset();
  });

  test("lists history entries and maps backend fields", async () => {
    mockedRequest.mockResolvedValue([
      {
        id: 7,
        user_id: "user-1",
        dataset_id: "dataset-1",
        question: null,
        sql_text: "SELECT * FROM orders",
        duration_ms: 25,
        created_at: "2026-04-18T12:00:00Z",
      },
    ]);

    await expect(historyApi.list()).resolves.toEqual([
      {
        id: "7",
        datasetId: "dataset-1",
        question: "SELECT * FROM orders",
        sql: "SELECT * FROM orders",
        durationMs: 25,
        createdAt: new Date("2026-04-18T12:00:00Z").getTime(),
      },
    ]);

    expect(mockedRequest).toHaveBeenCalledWith("GET", "/api/history");
  });

  test("creates a history entry with backend field names", async () => {
    mockedRequest.mockResolvedValue({
      id: 7,
      user_id: "user-1",
      dataset_id: "dataset-1",
      question: "Revenue by region",
      sql_text: "SELECT * FROM orders",
      duration_ms: 12,
      created_at: "2026-04-18T12:00:00Z",
    });

    await historyApi.create({
      datasetId: "dataset-1",
      question: "Revenue by region",
      sql: "SELECT * FROM orders",
      durationMs: 12,
    });

    expect(mockedRequest).toHaveBeenCalledWith("POST", "/api/history", {
      dataset_id: "dataset-1",
      question: "Revenue by region",
      sql_text: "SELECT * FROM orders",
      duration_ms: 12,
    });
  });

  test("ignores non-numeric delete ids", async () => {
    await expect(historyApi.delete("local-only-id")).resolves.toBeUndefined();
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});
