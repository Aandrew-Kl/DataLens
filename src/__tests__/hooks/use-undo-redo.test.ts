import { renderHook, act, waitFor } from "@testing-library/react";

import { useUndoRedo } from "@/hooks/use-undo-redo";

describe("useUndoRedo", () => {
  it("clones the initial state so outside mutations do not leak into the hook", async () => {
    const initial = {
      items: ["north", "south"],
      meta: { selected: "north" },
    };

    const { result } = renderHook(() => useUndoRedo(initial));

    initial.items.push("east");
    initial.meta.selected = "south";

    await waitFor(() => {
      expect(result.current.state).toEqual({
        items: ["north", "south"],
        meta: { selected: "north" },
      });
    });
  });

  it("records history on state changes and enables undo", async () => {
    const { result } = renderHook(() => useUndoRedo({ count: 1 }));

    act(() => {
      result.current.setState({ count: 2 });
    });

    await waitFor(() => {
      expect(result.current.state).toEqual({ count: 2 });
      expect(result.current.canUndo).toBe(true);
      expect(result.current.canRedo).toBe(false);
    });
  });

  it("skips history updates when the next state is deeply equal", async () => {
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

    await waitFor(() => {
      expect(result.current.canUndo).toBe(false);
      expect(result.current.state).toEqual({
        filters: ["region"],
        nested: { limit: 100 },
      });
    });
  });

  it("undoes and redoes through cloned snapshots", async () => {
    const { result } = renderHook(() => useUndoRedo({ version: 0 }));

    act(() => {
      result.current.setState({ version: 1 });
      result.current.setState({ version: 2 });
    });

    act(() => {
      result.current.undo();
    });

    await waitFor(() => {
      expect(result.current.state).toEqual({ version: 1 });
      expect(result.current.canRedo).toBe(true);
    });

    act(() => {
      result.current.redo();
    });

    await waitFor(() => {
      expect(result.current.state).toEqual({ version: 2 });
      expect(result.current.canUndo).toBe(true);
    });
  });

  it("clears redo history after a new state is recorded following undo", async () => {
    const { result } = renderHook(() => useUndoRedo({ step: 0 }));

    act(() => {
      result.current.setState({ step: 1 });
      result.current.setState({ step: 2 });
      result.current.undo();
      result.current.setState({ step: 3 });
      result.current.redo();
    });

    await waitFor(() => {
      expect(result.current.state).toEqual({ step: 3 });
      expect(result.current.canRedo).toBe(false);
      expect(result.current.canUndo).toBe(true);
    });
  });

  it("caps undo history at fifty snapshots", async () => {
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

    await waitFor(() => {
      expect(result.current.state).toEqual({ value: 5 });
      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(true);
    });
  });
});
