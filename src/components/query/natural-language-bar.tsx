"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, Search, Send, Sparkles } from "lucide-react";
import type { ColumnProfile } from "@/types/dataset";

interface NaturalLanguageBarProps {
  tableName: string;
  columns: ColumnProfile[];
  onSubmit: (question: string) => void;
}

const RECENT_QUERY_LIMIT = 6;
const STORAGE_PREFIX = "datalens:nlq-recent:";
const RECENT_QUERY_EVENT = "datalens:nlq-recent-sync";
const recentQueryCache = new Map<string, { raw: string | null; parsed: string[] }>();

function formatColumnName(name: string): string {
  return name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function readRecentQueries(storageKey: string): string[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(storageKey);
  const cached = recentQueryCache.get(storageKey);
  if (cached && cached.raw === raw) {
    return cached.parsed;
  }
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
    recentQueryCache.set(storageKey, { raw, parsed: next });
    return next;
  } catch {
    recentQueryCache.set(storageKey, { raw, parsed: [] });
    return [];
  }
}

function subscribeToRecentQueries(storageKey: string, onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === storageKey) {
      onChange();
    }
  };
  const handleLocalUpdate = (event: Event) => {
    const detail = (event as CustomEvent<string>).detail;
    if (detail === storageKey) {
      onChange();
    }
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(RECENT_QUERY_EVENT, handleLocalUpdate);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(RECENT_QUERY_EVENT, handleLocalUpdate);
  };
}

function buildSuggestions(tableName: string, columns: ColumnProfile[]): string[] {
  const numeric = columns.filter((column) => column.type === "number");
  const dates = columns.filter((column) => column.type === "date");
  const strings = columns.filter((column) => column.type === "string");
  const booleans = columns.filter((column) => column.type === "boolean");

  const primaryNumeric = numeric[0];
  const secondaryNumeric = numeric[1];
  const primaryDate = dates[0];
  const primaryString = strings[0];
  const secondaryString = strings[1];
  const primaryBoolean = booleans[0];
  const suggestions = [
    primaryNumeric && `What is the average ${formatColumnName(primaryNumeric.name)} in ${tableName}?`,
    primaryNumeric &&
      primaryString &&
      `Which ${formatColumnName(primaryString.name)} has the highest ${formatColumnName(primaryNumeric.name)}?`,
    primaryNumeric &&
      primaryDate &&
      `Show the monthly trend of ${formatColumnName(primaryNumeric.name)} by ${formatColumnName(primaryDate.name)}.`,
    primaryDate &&
      `How many records are there each month in ${tableName} based on ${formatColumnName(primaryDate.name)}?`,
    primaryString && `What are the top ${formatColumnName(primaryString.name)} values in ${tableName}?`,
    primaryString &&
      secondaryNumeric &&
      `Compare ${formatColumnName(secondaryNumeric.name)} across ${formatColumnName(primaryString.name)}.`,
    primaryBoolean &&
      `Break down ${tableName} records by ${formatColumnName(primaryBoolean.name)}.`,
    secondaryString &&
      `How many unique ${formatColumnName(secondaryString.name)} values are in ${tableName}?`,
    `Give me a quick overview of ${tableName}.`,
    `Summarize the key patterns in ${tableName}.`,
    `Which columns in ${tableName} look most important to investigate first?`,
    `Which fields in ${tableName} have the most missing values?`,
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(suggestions)).slice(0, 6);
}

export default function NaturalLanguageBar({
  tableName,
  columns,
  onSubmit,
}: NaturalLanguageBarProps) {
  const [value, setValue] = useState("");
  const [isRecentOpen, setIsRecentOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const storageKey = useMemo(() => `${STORAGE_PREFIX}${tableName.toLowerCase().replace(/\s+/g, "-")}`, [tableName]);
  const suggestions = useMemo(() => buildSuggestions(tableName, columns), [columns, tableName]);
  const recentQueries = useSyncExternalStore((onStoreChange) => subscribeToRecentQueries(storageKey, onStoreChange), () => readRecentQueries(storageKey), () => []);
  const hasRecentQueries = recentQueries.length > 0;

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsRecentOpen(false);
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const saveRecentQuery = (question: string) => {
    if (typeof window === "undefined") return;
    const nextQueries = [question, ...readRecentQueries(storageKey).filter((entry) => entry !== question)].slice(
      0,
      RECENT_QUERY_LIMIT,
    );
    const raw = JSON.stringify(nextQueries);
    recentQueryCache.set(storageKey, { raw, parsed: nextQueries });
    window.localStorage.setItem(storageKey, raw);
    window.dispatchEvent(new CustomEvent<string>(RECENT_QUERY_EVENT, { detail: storageKey }));
  };

  const submitQuestion = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;
    saveRecentQuery(trimmed);
    setValue("");
    setIsRecentOpen(false);
    onSubmit(trimmed);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitQuestion(value);
  };

  return (
    <div
      ref={containerRef}
      className="relative overflow-visible rounded-3xl border border-gray-200/70 bg-white/80 p-4 shadow-[0_18px_50px_-28px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-gray-700/60 dark:bg-gray-950/75"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200/70 pb-3 dark:border-gray-800/80">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
            <Sparkles className="h-4 w-4 text-sky-500 dark:text-sky-400" />
            <span>Natural language query</span>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Ask questions about <span className="font-medium text-gray-700 dark:text-gray-300">{tableName}</span> in
            plain English.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsRecentOpen((open) => !open)}
          className="inline-flex items-center gap-2 rounded-full border border-gray-200/80 bg-white/75 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-sky-300 hover:text-sky-600 dark:border-gray-700/70 dark:bg-gray-900/70 dark:text-gray-300 dark:hover:border-sky-600 dark:hover:text-sky-300"
        >
          <Clock className="h-3.5 w-3.5" />
          <span>Recent</span>
          {hasRecentQueries && <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] dark:bg-gray-800">{recentQueries.length}</span>}
        </button>
      </div>

      <div className="relative mt-4">
        <form onSubmit={handleSubmit}>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onFocus={() => hasRecentQueries && setIsRecentOpen(true)}
            placeholder={`Ask about trends, averages, or segments in ${tableName}...`}
            className="w-full rounded-2xl border border-gray-200/80 bg-gray-50/80 py-3.5 pl-11 pr-28 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-500/10 dark:border-gray-700/70 dark:bg-gray-900/80 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-sky-500"
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-2">
            <kbd className="hidden rounded-lg border border-gray-200 bg-white px-2 py-1 text-[10px] font-medium text-gray-400 shadow-sm sm:inline-flex dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500">
              Enter
            </kbd>
            <button
              type="submit"
              disabled={!value.trim()}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500 text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-gray-300 dark:bg-sky-500 dark:hover:bg-sky-400 dark:disabled:bg-gray-700"
              aria-label="Submit question"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
        <AnimatePresence>
          {isRecentOpen && hasRecentQueries && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-x-0 top-full z-20 mt-3 rounded-2xl border border-gray-200/80 bg-white/95 p-3 shadow-2xl backdrop-blur-xl dark:border-gray-700/70 dark:bg-gray-900/95"
            >
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
                <Clock className="h-3.5 w-3.5" />
                <span>Recent queries</span>
              </div>
              <div className="space-y-1">
                {recentQueries.map((query) => (
                  <button
                    key={query}
                    type="button"
                    onClick={() => submitQuestion(query)}
                    className="flex w-full items-start rounded-xl px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-sky-50 hover:text-sky-700 dark:text-gray-200 dark:hover:bg-sky-500/10 dark:hover:text-sky-300"
                  >
                    {query}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
          <Sparkles className="h-3.5 w-3.5" />
          <span>Try one of these</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {suggestions.slice(0, 6).map((suggestion, index) => (
            <motion.button
              key={suggestion}
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: index * 0.04 }}
              onClick={() => submitQuestion(suggestion)}
              className="rounded-full border border-gray-200/80 bg-gray-50/80 px-3 py-2 text-sm text-gray-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 dark:border-gray-700/70 dark:bg-gray-900/70 dark:text-gray-300 dark:hover:border-sky-600 dark:hover:bg-sky-500/10 dark:hover:text-sky-300"
            >
              {suggestion}
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}
