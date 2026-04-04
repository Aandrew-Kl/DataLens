import { useQueryStore } from "@/stores/query-store";
import type { QueryResult, SavedQuery } from "@/types/query";

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
});
