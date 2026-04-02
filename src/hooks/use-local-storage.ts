"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Reads a value from localStorage, parsing it as JSON.
 * Returns `initialValue` if the key does not exist, parsing fails,
 * or the code is running in an SSR environment.
 */
function readFromStorage<T>(key: string, initialValue: T): T {
  if (typeof window === "undefined") return initialValue;

  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return initialValue;
    return JSON.parse(raw) as T;
  } catch {
    return initialValue;
  }
}

/**
 * A custom React hook that synchronizes state with `localStorage`.
 *
 * - SSR-safe: returns `initialValue` on the server.
 * - Values are JSON-serialized on write and deserialized on read.
 * - Parse errors are handled gracefully by falling back to `initialValue`.
 * - Changes in other tabs/windows are picked up via the `storage` event.
 *
 * @param key - The localStorage key.
 * @param initialValue - The value used when the key is absent or unreadable.
 * @returns A stateful value and a setter (accepts a value or an updater function).
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(() =>
    readFromStorage(key, initialValue),
  );

  // Keep refs so the storage-event handler always sees the latest values
  // without needing to re-register the listener on every render.
  const keyRef = useRef(key);
  const initialValueRef = useRef(initialValue);
  keyRef.current = key;
  initialValueRef.current = initialValue;

  /**
   * Persist `value` (or the result of an updater function) to localStorage
   * and update the React state.
   */
  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev) => {
        const nextValue =
          value instanceof Function ? value(prev) : value;

        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(key, JSON.stringify(nextValue));
          } catch {
            // Storage full or blocked — state is still updated in memory.
          }
        }

        return nextValue;
      });
    },
    [key],
  );

  // Sync state when the same key is changed in another tab / window.
  useEffect(() => {
    function handleStorageChange(e: StorageEvent) {
      if (e.key !== keyRef.current) return;

      if (e.newValue === null) {
        setStoredValue(initialValueRef.current);
      } else {
        try {
          setStoredValue(JSON.parse(e.newValue) as T);
        } catch {
          setStoredValue(initialValueRef.current);
        }
      }
    }

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  return [storedValue, setValue];
}
