import { act, renderHook } from "@testing-library/react";
import type { UIEvent } from "react";

import { useVirtualScroll } from "@/hooks/use-virtual-scroll";

function getVisibleIndexes(
  items: { index: number; offsetTop: number }[],
): number[] {
  return items.map((item) => item.index);
}

function createScrollEvent(scrollTop: number): UIEvent<HTMLDivElement> {
  return {
    currentTarget: {
      scrollTop,
    } as HTMLDivElement,
  } as UIEvent<HTMLDivElement>;
}

describe("useVirtualScroll", () => {
  it("calculates the initial visible items, total height, and styles", () => {
    const { result } = renderHook(() =>
      useVirtualScroll({
        totalItems: 100,
        itemHeight: 20,
        containerHeight: 100,
      }),
    );

    expect(result.current.totalHeight).toBe(2000);
    expect(getVisibleIndexes(result.current.visibleItems)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(result.current.visibleItems[6]).toEqual({
      index: 6,
      offsetTop: 120,
    });
    expect(result.current.containerProps.style).toEqual({
      height: 100,
      overflowY: "auto",
      position: "relative",
    });
    expect(result.current.innerProps.style).toEqual({
      height: 2000,
      position: "relative",
    });
  });

  it("updates the visible window when onScroll receives a new scroll position", () => {
    const { result } = renderHook(() =>
      useVirtualScroll({
        totalItems: 100,
        itemHeight: 20,
        containerHeight: 100,
        overscan: 1,
      }),
    );

    act(() => {
      result.current.containerProps.onScroll(createScrollEvent(120));
    });

    expect(getVisibleIndexes(result.current.visibleItems)).toEqual([
      5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it("clamps scroll positions that exceed the maximum scroll range", () => {
    const { result } = renderHook(() =>
      useVirtualScroll({
        totalItems: 10,
        itemHeight: 20,
        containerHeight: 60,
        overscan: 0,
      }),
    );

    act(() => {
      result.current.containerProps.onScroll(createScrollEvent(999));
    });

    expect(getVisibleIndexes(result.current.visibleItems)).toEqual([7, 8, 9]);
  });

  it("scrolls to an index, updates the container ref, and recalculates visible items", () => {
    const { result } = renderHook(() =>
      useVirtualScroll({
        totalItems: 50,
        itemHeight: 10,
        containerHeight: 40,
        overscan: 1,
      }),
    );
    const container = { scrollTop: 0 } as HTMLDivElement;

    act(() => {
      (
        result.current.containerProps.ref as {
          current: HTMLDivElement | null;
        }
      ).current = container;
      result.current.scrollToIndex(10);
    });

    expect(container.scrollTop).toBe(100);
    expect(getVisibleIndexes(result.current.visibleItems)).toEqual([
      9, 10, 11, 12, 13, 14,
    ]);
  });

  it("clamps scrollToIndex for negative and out-of-range indexes", () => {
    const { result } = renderHook(() =>
      useVirtualScroll({
        totalItems: 5,
        itemHeight: 20,
        containerHeight: 40,
        overscan: 0,
      }),
    );
    const container = { scrollTop: 123 } as HTMLDivElement;

    act(() => {
      (
        result.current.containerProps.ref as {
          current: HTMLDivElement | null;
        }
      ).current = container;
      result.current.scrollToIndex(-3);
    });

    expect(container.scrollTop).toBe(0);
    expect(getVisibleIndexes(result.current.visibleItems)).toEqual([0, 1]);

    act(() => {
      result.current.scrollToIndex(99);
    });

    expect(container.scrollTop).toBe(60);
    expect(getVisibleIndexes(result.current.visibleItems)).toEqual([3, 4]);
  });

  it("handles empty or invalid input values safely", () => {
    const { result } = renderHook(() =>
      useVirtualScroll({
        totalItems: -5,
        itemHeight: 0,
        containerHeight: -20,
        overscan: -2,
      }),
    );

    act(() => {
      result.current.scrollToIndex(5);
      result.current.containerProps.onScroll(createScrollEvent(-50));
    });

    expect(result.current.totalHeight).toBe(0);
    expect(result.current.visibleItems).toEqual([]);
    expect(result.current.containerProps.style).toEqual({
      height: 0,
      overflowY: "auto",
      position: "relative",
    });
    expect(result.current.innerProps.style).toEqual({
      height: 0,
      position: "relative",
    });
  });
});
