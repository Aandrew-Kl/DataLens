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
const originalLocalStorage = window.localStorage;

describe("useLocalStorage", () => {
  let storageState: Record<string, string>;
  let getItemMock: jest.Mock<string | null, [string]>;
  let setItemMock: jest.Mock<void, [string, string]>;

  beforeEach(() => {
    storageState = {};
    getItemMock = jest.fn((key: string) => storageState[key] ?? null);
    setItemMock = jest.fn((key: string, value: string) => {
      storageState[key] = value;
    });

    const localStorageMock = {
      clear: jest.fn(() => {
        storageState = {};
      }),
      getItem: getItemMock,
      key: jest.fn((index: number) => Object.keys(storageState)[index] ?? null),
      get length() {
        return Object.keys(storageState).length;
      },
      removeItem: jest.fn((key: string) => {
        delete storageState[key];
      }),
      setItem: setItemMock,
    } as unknown as Storage;

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageMock,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
  });

  it("hydrates state from localStorage when valid JSON is present", () => {
    const stored: Preferences = {
      theme: "dark",
      dense: true,
    };
    storageState[STORAGE_KEY] = JSON.stringify(stored);

    const { result } = renderHook(() =>
      useLocalStorage(STORAGE_KEY, INITIAL_VALUE),
    );

    expect(getItemMock).toHaveBeenCalledWith(STORAGE_KEY);
    expect(result.current[0]).toEqual(stored);
  });

  it("falls back to the initial value when stored JSON cannot be parsed", () => {
    storageState[STORAGE_KEY] = "{invalid-json";

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
    expect(setItemMock).toHaveBeenCalledWith(
      STORAGE_KEY,
      JSON.stringify({
        theme: "light",
        dense: true,
      }),
    );
  });

  it("updates state from storage events for the same key and ignores unrelated keys", () => {
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

  it("resets to the latest initial value when the active key is removed or corrupted", () => {
    const nextInitialValue: Preferences = {
      theme: "dark",
      dense: true,
    };
    const { result, rerender } = renderHook(
      ({ storageKey, initialValue }) =>
        useLocalStorage(storageKey, initialValue),
      {
        initialProps: {
          storageKey: STORAGE_KEY,
          initialValue: INITIAL_VALUE,
        },
      },
    );

    rerender({
      storageKey: "dashboard-preferences",
      initialValue: nextInitialValue,
    });

    act(() => {
      result.current[1]({
        theme: "light",
        dense: true,
      });
    });

    expect(setItemMock).toHaveBeenLastCalledWith(
      "dashboard-preferences",
      JSON.stringify({
        theme: "light",
        dense: true,
      }),
    );

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "dashboard-preferences",
          newValue: null,
        }),
      );
    });

    expect(result.current[0]).toEqual(nextInitialValue);

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "dashboard-preferences",
          newValue: "{broken-json",
        }),
      );
    });

    expect(result.current[0]).toEqual(nextInitialValue);
  });

  it("keeps React state in sync even when localStorage writes fail", () => {
    setItemMock.mockImplementation(() => {
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
