import { act, renderHook } from "@testing-library/react";

import { useUndoRedo } from "@/hooks/use-undo-redo";

describe("useUndoRedo", () => {
  it("clones the initial state so outside mutations do not leak into the hook", () => {
    const initial = {
      items: ["north", "south"],
      meta: { selected: "north" },
    };

    const { result } = renderHook(() => useUndoRedo(initial));

    initial.items.push("east");
    initial.meta.selected = "south";

    expect(result.current.state).toEqual({
      items: ["north", "south"],
      meta: { selected: "north" },
    });
  });

  it("records history and clones newly assigned state snapshots", () => {
    const nextState: { filters: string[]; nested: { limit: number } } = {
      filters: ["region"],
      nested: { limit: 100 },
    };
    const { result } = renderHook(() =>
      useUndoRedo<{ filters: string[]; nested: { limit: number } }>({
        filters: [],
        nested: { limit: 0 },
      }),
    );

    act(() => {
      result.current.setState(nextState);
    });

    nextState.filters.push("country");
    nextState.nested.limit = 50;

    expect(result.current.state).toEqual({
      filters: ["region"],
      nested: { limit: 100 },
    });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("skips history updates when the next state is deeply equal", () => {
    const { result } = renderHook(() =>
      useUndoRedo({
        filters: ["region"],
        nested: { limit: 100 },
      }),
    );

    act(() => {
      result.current.setState({
        filters: ["region"],
        nested: { limit: 100 },
      });
    });

    expect(result.current.state).toEqual({
      filters: ["region"],
      nested: { limit: 100 },
    });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("treats undo and redo as no-ops at the history boundaries", () => {
    const { result } = renderHook(() => useUndoRedo({ step: 0 }));

    act(() => {
      result.current.undo();
      result.current.redo();
    });

    expect(result.current.state).toEqual({ step: 0 });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("undoes and redoes through cloned snapshots", () => {
    const { result } = renderHook(() => useUndoRedo({ version: 0 }));

    act(() => {
      result.current.setState({ version: 1 });
      result.current.setState({ version: 2 });
    });

    act(() => {
      result.current.undo();
    });

    expect(result.current.state).toEqual({ version: 1 });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.redo();
    });

    expect(result.current.state).toEqual({ version: 2 });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("clears redo history after a new state is recorded following undo", () => {
    const { result } = renderHook(() => useUndoRedo({ step: 0 }));

    act(() => {
      result.current.setState({ step: 1 });
      result.current.setState({ step: 2 });
      result.current.undo();
      result.current.setState({ step: 3 });
      result.current.redo();
    });

    expect(result.current.state).toEqual({ step: 3 });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("caps undo history at fifty snapshots", () => {
    const { result } = renderHook(() => useUndoRedo({ value: 0 }));

    act(() => {
      for (let value = 1; value <= 55; value += 1) {
        result.current.setState({ value });
      }
    });

    act(() => {
      for (let count = 0; count < 50; count += 1) {
        result.current.undo();
      }
    });

    expect(result.current.state).toEqual({ value: 5 });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });
});
