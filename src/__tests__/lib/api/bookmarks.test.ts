import { bookmarksApi } from "@/lib/api/bookmarks";
import { request } from "@/lib/api/client";

jest.mock("@/lib/api/client", () => ({
  request: jest.fn(),
}));

const mockedRequest = jest.mocked(request);

describe("bookmarks API", () => {
  beforeEach(() => {
    mockedRequest.mockReset();
  });

  test("lists bookmarks and maps fields to the frontend shape", async () => {
    mockedRequest.mockResolvedValue([
      {
        id: "bookmark-1",
        user_id: "user-1",
        dataset_id: "dataset-1",
        table_name: "orders",
        label: "Revenue view",
        description: "Saved view",
        column_name: "sales",
        sql_text: "SELECT * FROM orders",
        view_state: { selectedTab: "charts" },
        created_at: "2026-04-18T12:00:00Z",
        updated_at: "2026-04-18T13:00:00Z",
      },
    ]);

    await expect(bookmarksApi.list()).resolves.toEqual([
      {
        id: "bookmark-1",
        datasetId: "dataset-1",
        tableName: "orders",
        label: "Revenue view",
        description: "Saved view",
        columnName: "sales",
        sql: "SELECT * FROM orders",
        viewState: { selectedTab: "charts" },
        createdAt: new Date("2026-04-18T12:00:00Z").getTime(),
        updatedAt: new Date("2026-04-18T13:00:00Z").getTime(),
      },
    ]);

    expect(mockedRequest).toHaveBeenCalledWith("GET", "/api/bookmarks");
  });

  test("creates a bookmark with backend field names", async () => {
    mockedRequest.mockResolvedValue({
      id: "bookmark-1",
      user_id: "user-1",
      dataset_id: "dataset-1",
      table_name: "orders",
      label: "Revenue view",
      description: null,
      column_name: null,
      sql_text: null,
      view_state: null,
      created_at: "2026-04-18T12:00:00Z",
      updated_at: "2026-04-18T12:00:00Z",
    });

    await bookmarksApi.create({
      id: "bookmark-1",
      datasetId: "dataset-1",
      tableName: "orders",
      label: "Revenue view",
      viewState: { selectedTab: "charts" },
    });

    expect(mockedRequest).toHaveBeenCalledWith("POST", "/api/bookmarks", {
      id: "bookmark-1",
      dataset_id: "dataset-1",
      table_name: "orders",
      label: "Revenue view",
      description: null,
      column_name: null,
      sql_text: null,
      view_state: { selectedTab: "charts" },
    });
  });

  test("deletes a bookmark", async () => {
    mockedRequest.mockResolvedValue(undefined);

    await expect(bookmarksApi.delete("bookmark-1")).resolves.toBeUndefined();

    expect(mockedRequest).toHaveBeenCalledWith("DELETE", "/api/bookmarks/bookmark-1");
  });
});
