import { useQueryStore } from "@/stores/query-store";
import { historyApi } from "@/lib/api/history";
import { useAuthStore } from "@/stores/auth-store";
import type { QueryResult, SavedQuery } from "@/types/query";

jest.mock("@/lib/api/history", () => ({
  historyApi: {
    list: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedHistoryApi = historyApi as jest.Mocked<typeof historyApi>;

function makeSavedQuery(
  index: number,
  overrides: Partial<SavedQuery> = {},
): SavedQuery {
  return {
    id: `query-${index}`,
    question: `Question ${index}`,
    sql: `SELECT ${index}`,
    datasetId: "dataset-1",
    createdAt: 1_700_000_000_000 + index,
    ...overrides,
  };
}

function makeResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    sql: 'SELECT * FROM "orders"',
    data: [{ id: 1 }],
    columns: ["id"],
    rowCount: 1,
    executionTimeMs: 12,
    ...overrides,
  };
}

describe("useQueryStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedHistoryApi.list.mockReset().mockResolvedValue([]);
    mockedHistoryApi.create.mockReset();
    mockedHistoryApi.delete.mockReset().mockResolvedValue(undefined);
    useAuthStore.setState({ token: null, isAuthenticated: false });
    useQueryStore.setState(useQueryStore.getInitialState());
  });

  it("has correct initial state", () => {
    const state = useQueryStore.getState();

    expect(state.history).toEqual([]);
    expect(state.lastResult).toBeNull();
    expect(state.isQuerying).toBe(false);
  });

  it("prepends history entries and keeps newest first", () => {
    useQueryStore.getState().addToHistory(makeSavedQuery(1));
    useQueryStore.getState().addToHistory(makeSavedQuery(2));

    expect(useQueryStore.getState().history.map((query) => query.id)).toEqual([
      "query-2",
      "query-1",
    ]);
  });

  it("keeps at most fifty history entries", () => {
    for (let index = 0; index < 60; index += 1) {
      useQueryStore.getState().addToHistory(makeSavedQuery(index));
    }

    const history = useQueryStore.getState().history;

    expect(history).toHaveLength(50);
    expect(history[0]?.id).toBe("query-59");
    expect(history[49]?.id).toBe("query-10");
  });

  it("stores and clears the last query result", () => {
    const result = makeResult({ rowCount: 2 });

    useQueryStore.getState().setLastResult(result);
    expect(useQueryStore.getState().lastResult).toEqual(result);

    useQueryStore.getState().setLastResult(null);
    expect(useQueryStore.getState().lastResult).toBeNull();
  });

  it("tracks query running state", () => {
    useQueryStore.getState().setIsQuerying(true);
    expect(useQueryStore.getState().isQuerying).toBe(true);

    useQueryStore.getState().setIsQuerying(false);
    expect(useQueryStore.getState().isQuerying).toBe(false);
  });

  it("clears only history when requested", () => {
    const lastResult = makeResult({
      sql: "SELECT COUNT(*)",
      rowCount: 42,
    });

    useQueryStore.setState({
      history: [makeSavedQuery(1), makeSavedQuery(2)],
      lastResult,
      isQuerying: true,
    });

    useQueryStore.getState().clearHistory();

    expect(useQueryStore.getState().history).toEqual([]);
    expect(useQueryStore.getState().lastResult).toEqual(lastResult);
    expect(useQueryStore.getState().isQuerying).toBe(true);
  });

  it("does not modify history when clearing an empty history", () => {
    useQueryStore.getState().clearHistory();

    expect(useQueryStore.getState()).toMatchObject({
      history: [],
      lastResult: null,
      isQuerying: false,
    });
  });

  it("hydrates query history from the backend when authenticated", async () => {
    useAuthStore.setState({ token: "auth-token", isAuthenticated: true });
    mockedHistoryApi.list.mockResolvedValue([
      {
        id: "101",
        datasetId: "dataset-1",
        question: "Remote query",
        sql: "SELECT 101",
        durationMs: 12,
        createdAt: 1_800_000_000_000,
      },
    ]);

    await useQueryStore.getState().hydrate();

    expect(mockedHistoryApi.list).toHaveBeenCalledTimes(1);
    expect(useQueryStore.getState().history).toEqual([
      makeSavedQuery(0, {
        id: "101",
        question: "Remote query",
        sql: "SELECT 101",
        createdAt: 1_800_000_000_000,
      }),
    ]);
  });

  it("syncs history writes to the backend when authenticated", async () => {
    useAuthStore.setState({ token: "auth-token", isAuthenticated: true });
    const query = makeSavedQuery(1);
    mockedHistoryApi.create.mockResolvedValue({
      id: "501",
      datasetId: query.datasetId,
      question: query.question,
      sql: query.sql,
      durationMs: 0,
      createdAt: 1_900_000_000_000,
    });

    await useQueryStore.getState().addToHistory(query);

    expect(mockedHistoryApi.create).toHaveBeenCalledWith({
      datasetId: query.datasetId,
      question: query.question,
      sql: query.sql,
    });
    expect(useQueryStore.getState().history[0]).toMatchObject({
      id: "501",
      createdAt: 1_900_000_000_000,
    });
  });

  it("deletes dataset-scoped history remotely when clearing a dataset", async () => {
    useAuthStore.setState({ token: "auth-token", isAuthenticated: true });
    useQueryStore.setState({
      history: [
        makeSavedQuery(1, { id: "10", datasetId: "dataset-1" }),
        makeSavedQuery(2, { id: "11", datasetId: "dataset-2" }),
      ],
    });

    await useQueryStore.getState().clearHistory("dataset-1");

    expect(mockedHistoryApi.delete).toHaveBeenCalledWith("10");
    expect(useQueryStore.getState().history).toEqual([
      expect.objectContaining({ id: "11", datasetId: "dataset-2" }),
    ]);
  });
});
