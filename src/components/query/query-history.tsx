"use client";

import { useDeferredValue, useMemo, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarClock,
  Clock3,
  Copy,
  DatabaseZap,
  History,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { formatRelativeTime, truncate } from "@/lib/utils/formatters";
import { useQueryStore } from "@/stores/query-store";
import type { SavedQuery } from "@/types/query";

interface QueryHistoryProps {
  datasetId: string;
  onSelectQuery: (sql: string) => void;
}

type HistoryBucket = "Today" | "Yesterday" | "This Week" | "Older";

const BUCKET_ORDER: HistoryBucket[] = ["Today", "Yesterday", "This Week", "Older"];

function startOfDay(value: Date): Date {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function getHistoryBucket(timestamp: number): HistoryBucket {
  const now = new Date();
  const today = startOfDay(now).getTime();
  const yesterday = today - 24 * 60 * 60 * 1000;
  const startOfWeekDate = startOfDay(now);
  const currentDay = startOfWeekDate.getDay();
  const distanceToMonday = currentDay === 0 ? 6 : currentDay - 1;
  startOfWeekDate.setDate(startOfWeekDate.getDate() - distanceToMonday);
  const startOfWeek = startOfWeekDate.getTime();

  if (timestamp >= today) return "Today";
  if (timestamp >= yesterday) return "Yesterday";
  if (timestamp >= startOfWeek) return "This Week";
  return "Older";
}

function buildGroups(entries: SavedQuery[]): Array<{ label: HistoryBucket; items: SavedQuery[] }> {
  const groups = new Map<HistoryBucket, SavedQuery[]>();

  for (const label of BUCKET_ORDER) {
    groups.set(label, []);
  }

  for (const entry of entries) {
    groups.get(getHistoryBucket(entry.createdAt))?.push(entry);
  }

  return BUCKET_ORDER.map((label) => ({
    label,
    items: groups.get(label) ?? [],
  })).filter((group) => group.items.length > 0);
}

function getSqlPreview(sql: string): string {
  const preview = sql
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("\n");

  return truncate(preview || sql.trim(), 180);
}

export default function QueryHistory({ datasetId, onSelectQuery }: QueryHistoryProps) {
  const history = useQueryStore((state) => state.history);
  const clearHistory = useQueryStore((state) => state.clearHistory);
  const removeFromHistory = useQueryStore((state) => state.removeFromHistory);
  const clearDatasetHistoryStore = useQueryStore((state) => state.clearDatasetHistory);
  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  const datasetHistory = useMemo(
    () =>
      history
        .filter((entry) => entry.datasetId === datasetId)
        .sort((a, b) => b.createdAt - a.createdAt),
    [datasetId, history]
  );

  const filteredHistory = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    if (!query) return datasetHistory;

    return datasetHistory.filter((entry) => {
      const haystack = `${entry.question}\n${entry.sql}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [datasetHistory, deferredSearch]);

  const groupedHistory = useMemo(() => buildGroups(filteredHistory), [filteredHistory]);

  const removeEntry = (id: string) => {
    removeFromHistory(id);
  };

  const clearDatasetHistory = () => {
    if (datasetHistory.length === 0) return;

    if (datasetHistory.length === history.length) {
      clearHistory();
      return;
    }

    clearDatasetHistoryStore(datasetId);
  };

  const handleCopy = async (id: string, sql: string) => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1600);
    } catch {
      setCopiedId(null);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, sql: string) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelectQuery(sql);
  };

  const hasHistory = datasetHistory.length > 0;

  return (
    <section className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-2xl border border-gray-200/60 bg-white/70 backdrop-blur-xl dark:border-gray-700/50 dark:bg-gray-900/70">
      <div className="border-b border-gray-200/60 px-4 py-4 dark:border-gray-700/50">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-gray-800 dark:text-gray-100">
              <div className="rounded-xl bg-gray-100 p-2 dark:bg-gray-800">
                <History className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Query history</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {datasetHistory.length} saved runs for this dataset
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={clearDatasetHistory}
            disabled={!hasHistory}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-500 transition-colors hover:border-red-200 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:border-red-900/60 dark:hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear all
          </button>
        </div>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search questions or SQL..."
            className="w-full rounded-xl border border-gray-200/80 bg-white/90 py-2.5 pl-10 pr-10 text-sm text-gray-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-400/20 dark:border-gray-700/70 dark:bg-gray-800/90 dark:text-gray-200 dark:focus:border-sky-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!hasHistory ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200/80 bg-gray-50/70 px-6 text-center dark:border-gray-700/60 dark:bg-gray-800/30"
          >
            <DatabaseZap className="h-10 w-10 text-gray-300 dark:text-gray-600" />
            <h3 className="mt-4 text-sm font-semibold text-gray-700 dark:text-gray-200">
              No query history yet
            </h3>
            <p className="mt-2 max-w-sm text-sm text-gray-500 dark:text-gray-400">
              Queries you run against this dataset will appear here for quick reuse.
            </p>
          </motion.div>
        ) : filteredHistory.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200/80 bg-gray-50/70 px-6 text-center dark:border-gray-700/60 dark:bg-gray-800/30"
          >
            <Search className="h-10 w-10 text-gray-300 dark:text-gray-600" />
            <h3 className="mt-4 text-sm font-semibold text-gray-700 dark:text-gray-200">
              No matching queries
            </h3>
            <p className="mt-2 max-w-sm text-sm text-gray-500 dark:text-gray-400">
              Adjust the search term to browse the stored question prompts and SQL text.
            </p>
          </motion.div>
        ) : (
          <motion.div layout className="space-y-6">
            <AnimatePresence initial={false}>
              {groupedHistory.map((group) => (
                <motion.div
                  key={group.label}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-3"
                >
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-400 dark:text-gray-500">
                    <CalendarClock className="h-3.5 w-3.5" />
                    <span>{group.label}</span>
                  </div>

                  <div className="space-y-3">
                    <AnimatePresence initial={false}>
                      {group.items.map((entry, index) => (
                        <motion.div
                          key={entry.id}
                          layout
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.98 }}
                          transition={{ duration: 0.2, delay: index * 0.03 }}
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelectQuery(entry.sql)}
                          onKeyDown={(event) => handleKeyDown(event, entry.sql)}
                          className="group rounded-2xl border border-gray-200/70 bg-white/85 p-4 text-left transition hover:border-sky-300/70 hover:shadow-sm dark:border-gray-700/60 dark:bg-gray-800/70 dark:hover:border-sky-700/70"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <h3 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">
                                {entry.question}
                              </h3>
                              <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                <Clock3 className="h-3.5 w-3.5" />
                                <span>{formatRelativeTime(entry.createdAt)}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleCopy(entry.id, entry.sql);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700/70 dark:hover:text-gray-200"
                              >
                                <Copy className="h-3.5 w-3.5" />
                                {copiedId === entry.id ? "Copied" : "Copy SQL"}
                              </button>

                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeEntry(entry.id);
                                }}
                                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-gray-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                                aria-label={`Delete ${entry.question}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>

                          <pre className="mt-3 overflow-hidden rounded-xl border border-gray-200/60 bg-gray-50/90 px-3 py-3 font-mono text-xs leading-5 text-gray-600 dark:border-gray-700/60 dark:bg-gray-900/80 dark:text-gray-300">
                            {getSqlPreview(entry.sql)}
                          </pre>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </section>
  );
}
