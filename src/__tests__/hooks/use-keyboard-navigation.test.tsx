import { act, renderHook } from "@testing-library/react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { useKeyboardNavigation } from "@/hooks/use-keyboard-navigation";

function createKeyboardEvent(key: string): ReactKeyboardEvent {
  return {
    key,
    preventDefault: jest.fn(),
  } as unknown as ReactKeyboardEvent;
}

describe("useKeyboardNavigation", () => {
  it("starts at the first cell and exposes matching ARIA metadata", () => {
    const { result } = renderHook(() =>
      useKeyboardNavigation({
        rows: 3,
        cols: 4,
      }),
    );

    expect(result.current.activeRow).toBe(0);
    expect(result.current.activeCol).toBe(0);
    expect(result.current.containerProps.tabIndex).toBe(0);
    expect(result.current.containerProps.role).toBe("grid");
    expect(result.current.containerProps["aria-activedescendant"]).toMatch(
      /-cell-0-0$/,
    );
    expect(result.current.getCellProps(0, 0)).toMatchObject({
      role: "gridcell",
      "aria-selected": true,
      tabIndex: -1,
    });
    expect(result.current.getCellProps(0, 1)["aria-selected"]).toBe(false);
  });

  it("moves through the grid with arrow keys, Home/End, and clamped setActive calls", () => {
    const { result } = renderHook(() =>
      useKeyboardNavigation({
        rows: 3,
        cols: 4,
      }),
    );

    act(() => {
      result.current.containerProps.onKeyDown(createKeyboardEvent("ArrowRight"));
    });
    act(() => {
      result.current.containerProps.onKeyDown(createKeyboardEvent("ArrowDown"));
    });
    act(() => {
      result.current.containerProps.onKeyDown(createKeyboardEvent("End"));
    });
    act(() => {
      result.current.containerProps.onKeyDown(createKeyboardEvent("Home"));
    });

    expect(result.current.activeRow).toBe(1);
    expect(result.current.activeCol).toBe(0);

    act(() => {
      result.current.setActive(10, 10);
    });

    expect(result.current.activeRow).toBe(2);
    expect(result.current.activeCol).toBe(3);
  });

  it("wraps around row and column bounds when wrapping is enabled", () => {
    const { result } = renderHook(() =>
      useKeyboardNavigation({
        rows: 2,
        cols: 2,
        wrap: true,
      }),
    );

    act(() => {
      result.current.containerProps.onKeyDown(createKeyboardEvent("ArrowLeft"));
    });
    act(() => {
      result.current.containerProps.onKeyDown(createKeyboardEvent("ArrowUp"));
    });

    expect(result.current.activeRow).toBe(1);
    expect(result.current.activeCol).toBe(1);
  });

  it("invokes selection and escape callbacks from keyboard actions", () => {
    const onSelect = jest.fn();
    const onEscape = jest.fn();

    const { result } = renderHook(() =>
      useKeyboardNavigation({
        rows: 2,
        cols: 2,
        onSelect,
        onEscape,
      }),
    );

    act(() => {
      result.current.containerProps.onKeyDown(createKeyboardEvent("ArrowDown"));
    });
    act(() => {
      result.current.containerProps.onKeyDown(createKeyboardEvent("ArrowRight"));
    });
    act(() => {
      result.current.containerProps.onKeyDown(createKeyboardEvent("Enter"));
    });
    act(() => {
      result.current.containerProps.onKeyDown(createKeyboardEvent(" "));
    });
    act(() => {
      result.current.containerProps.onKeyDown(createKeyboardEvent("Escape"));
    });

    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenNthCalledWith(1, 1, 1);
    expect(onSelect).toHaveBeenNthCalledWith(2, 1, 1);
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("returns an inactive grid state when there are no cells", () => {
    const { result } = renderHook(() =>
      useKeyboardNavigation({
        rows: 0,
        cols: 0,
      }),
    );

    const event = createKeyboardEvent("ArrowRight");

    act(() => {
      result.current.containerProps.onKeyDown(event);
      result.current.setActive(3, 3);
    });

    expect(result.current.activeRow).toBe(-1);
    expect(result.current.activeCol).toBe(-1);
    expect(result.current.containerProps.tabIndex).toBe(-1);
    expect(result.current.containerProps["aria-activedescendant"]).toBe("");
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("normalizes the active position when the grid dimensions shrink", () => {
    const { result, rerender } = renderHook(
      ({ rows, cols }: { rows: number; cols: number }) =>
        useKeyboardNavigation({
          rows,
          cols,
        }),
      {
        initialProps: {
          rows: 4,
          cols: 5,
        },
      },
    );

    act(() => {
      result.current.setActive(3, 4);
    });

    rerender({ rows: 1, cols: 2 });

    expect(result.current.activeRow).toBe(0);
    expect(result.current.activeCol).toBe(1);
    expect(result.current.getCellProps(0, 1)["aria-selected"]).toBe(true);
  });
});
