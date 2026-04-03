import { act, renderHook } from "@testing-library/react";

import { useLocalStorage } from "@/hooks/use-local-storage";

interface Preferences {
  theme: "light" | "dark";
  dense: boolean;
}

const STORAGE_KEY = "preferences";
const INITIAL_VALUE: Preferences = {
  theme: "light",
  dense: false,
};

describe("useLocalStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  it("hydrates state from localStorage when valid JSON is present", () => {
    const stored: Preferences = {
      theme: "dark",
      dense: true,
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { result } = renderHook(() =>
      useLocalStorage(STORAGE_KEY, INITIAL_VALUE),
    );

    expect(result.current[0]).toEqual(stored);
  });

  it("falls back to the initial value when the stored JSON cannot be parsed", () => {
    window.localStorage.setItem(STORAGE_KEY, "{invalid-json");

    const { result } = renderHook(() =>
      useLocalStorage(STORAGE_KEY, INITIAL_VALUE),
    );

    expect(result.current[0]).toEqual(INITIAL_VALUE);
  });

  it("writes serialized values and supports updater functions", () => {
    const { result } = renderHook(() =>
      useLocalStorage(STORAGE_KEY, INITIAL_VALUE),
    );

    act(() => {
      result.current[1]((prev) => ({
        ...prev,
        dense: !prev.dense,
      }));
    });

    expect(result.current[0]).toEqual({
      theme: "light",
      dense: true,
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        theme: "light",
        dense: true,
      }),
    );
  });

  it("responds to storage events for the same key and ignores unrelated keys", () => {
    const { result } = renderHook(() =>
      useLocalStorage(STORAGE_KEY, INITIAL_VALUE),
    );

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "other-key",
          newValue: JSON.stringify({
            theme: "dark",
            dense: true,
          }),
        }),
      );
    });

    expect(result.current[0]).toEqual(INITIAL_VALUE);

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: JSON.stringify({
            theme: "dark",
            dense: true,
          }),
        }),
      );
    });

    expect(result.current[0]).toEqual({
      theme: "dark",
      dense: true,
    });
  });

  it("resets to the initial value when the storage event removes or corrupts the value", () => {
    const { result } = renderHook(() =>
      useLocalStorage(STORAGE_KEY, INITIAL_VALUE),
    );

    act(() => {
      result.current[1]({
        theme: "dark",
        dense: true,
      });
    });

    expect(result.current[0]).toEqual({
      theme: "dark",
      dense: true,
    });

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: null,
        }),
      );
    });

    expect(result.current[0]).toEqual(INITIAL_VALUE);

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: "{broken-json",
        }),
      );
    });

    expect(result.current[0]).toEqual(INITIAL_VALUE);
  });

  it("keeps the React state in sync even when localStorage writes fail", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage blocked");
    });

    const { result } = renderHook(() =>
      useLocalStorage(STORAGE_KEY, INITIAL_VALUE),
    );

    act(() => {
      result.current[1]({
        theme: "dark",
        dense: false,
      });
    });

    expect(result.current[0]).toEqual({
      theme: "dark",
      dense: false,
    });
  });
});
