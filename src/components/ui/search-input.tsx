"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, X } from "lucide-react";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onClear?: () => void;
  debounceMs?: number;
}

export default function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  onClear,
  debounceMs,
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value);

  // Sync external value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Debounced onChange
  useEffect(() => {
    if (debounceMs == null || debounceMs <= 0) return;

    const timer = setTimeout(() => {
      if (localValue !== value) {
        onChange(localValue);
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [localValue, debounceMs, onChange, value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setLocalValue(next);

      // If no debounce, fire immediately
      if (debounceMs == null || debounceMs <= 0) {
        onChange(next);
      }
    },
    [onChange, debounceMs],
  );

  const handleClear = useCallback(() => {
    setLocalValue("");
    onChange("");
    onClear?.();
  }, [onChange, onClear]);

  return (
    <div className="relative">
      {/* Search icon */}
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />

      {/* Input */}
      <input
        type="text"
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder}
        className="
          w-full pl-9 pr-9 py-2 text-sm
          rounded-lg
          bg-white/70 dark:bg-gray-900/70
          border border-gray-200/60 dark:border-gray-700/60
          text-gray-900 dark:text-gray-100
          placeholder:text-gray-400 dark:placeholder:text-gray-500
          focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:focus:ring-indigo-400/40
          focus:border-indigo-300 dark:focus:border-indigo-600
          transition-[border-color,box-shadow] duration-150
        "
      />

      {/* Clear button */}
      {localValue && (
        <button
          onClick={handleClear}
          className="
            absolute right-2 top-1/2 -translate-y-1/2
            p-1 rounded-md
            text-gray-400 hover:text-gray-600
            dark:text-gray-500 dark:hover:text-gray-300
            hover:bg-gray-100 dark:hover:bg-gray-800
            transition-colors duration-100
          "
          aria-label="Clear search"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
