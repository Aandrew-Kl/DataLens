import { act, renderHook } from "@testing-library/react";

import { useDebounce } from "@/hooks/use-debounce";

describe("useDebounce", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("returns the current value immediately and updates after the delay", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: {
          value: "alpha",
          delay: 200,
        },
      },
    );

    expect(result.current).toBe("alpha");

    rerender({ value: "beta", delay: 200 });

    expect(result.current).toBe("alpha");

    act(() => {
      jest.advanceTimersByTime(199);
    });

    expect(result.current).toBe("alpha");

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(result.current).toBe("beta");
  });

  it("cancels stale timers when the value changes rapidly", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 100),
      {
        initialProps: { value: "a" },
      },
    );

    rerender({ value: "ab" });

    act(() => {
      jest.advanceTimersByTime(50);
    });

    rerender({ value: "abc" });

    act(() => {
      jest.advanceTimersByTime(99);
    });

    expect(result.current).toBe("a");

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(result.current).toBe("abc");
  });

  it("restarts the debounce window when the delay changes", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: {
          value: 1,
          delay: 200,
        },
      },
    );

    rerender({ value: 2, delay: 200 });

    act(() => {
      jest.advanceTimersByTime(100);
    });

    rerender({ value: 2, delay: 400 });

    act(() => {
      jest.advanceTimersByTime(199);
    });

    expect(result.current).toBe(1);

    act(() => {
      jest.advanceTimersByTime(201);
    });

    expect(result.current).toBe(2);
  });

  it("supports zero-delay debouncing on the next timer tick", () => {
    const initialObject = { id: "first" };
    const nextObject = { id: "second" };

    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 0),
      {
        initialProps: { value: initialObject },
      },
    );

    rerender({ value: nextObject });

    expect(result.current).toBe(initialObject);

    act(() => {
      jest.advanceTimersByTime(0);
    });

    expect(result.current).toBe(nextObject);
  });
});
