"use client";

import { useState, useEffect } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `delay`
 * milliseconds of inactivity.
 *
 * Useful for delaying expensive operations (e.g. search queries, filter
 * recalculations) until the user has stopped typing.
 *
 * @param value - The rapidly-changing source value.
 * @param delay - Debounce window in milliseconds.
 * @returns The debounced value.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
