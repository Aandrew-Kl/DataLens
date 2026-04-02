"use client";

import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Upload,
  Play,
  GitBranch,
  Merge,
  Download,
  Clock,
  Trash2,
  ChevronDown,
  ChevronRight,
  Activity,
} from "lucide-react";

export interface LineageEntry {
  id: string;
  type: "upload" | "query" | "transform" | "join" | "export";
  description: string;
  sql?: string;
  timestamp: number;
  rowsBefore?: number;
  rowsAfter?: number;
}

interface DataLineageProps {
  tableName: string;
}

// Shared lineage store keyed by table name
const lineageStore: Record<string, LineageEntry[]> = {};
const listeners: Set<() => void> = new Set();
function notify() {
  listeners.forEach((fn) => fn());
}

export function addLineageEntry(tableName: string, entry: LineageEntry) {
  if (!lineageStore[tableName]) lineageStore[tableName] = [];
  lineageStore[tableName].push(entry);
  notify();
}

const TYPE_META: Record<
  LineageEntry["type"],
  { icon: React.ElementType; bg: string; text: string; border: string; label: string }
> = {
  upload: {
    icon: Upload,
    bg: "bg-blue-100 dark:bg-blue-900/40",
    text: "text-blue-600 dark:text-blue-400",
    border: "border-blue-200 dark:border-blue-800/50",
    label: "Upload",
  },
  query: {
    icon: Play,
    bg: "bg-emerald-100 dark:bg-emerald-900/40",
    text: "text-emerald-600 dark:text-emerald-400",
    border: "border-emerald-200 dark:border-emerald-800/50",
    label: "Query",
  },
  transform: {
    icon: GitBranch,
    bg: "bg-amber-100 dark:bg-amber-900/40",
    text: "text-amber-600 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-800/50",
    label: "Transform",
  },
  join: {
    icon: Merge,
    bg: "bg-purple-100 dark:bg-purple-900/40",
    text: "text-purple-600 dark:text-purple-400",
    border: "border-purple-200 dark:border-purple-800/50",
    label: "Join",
  },
  export: {
    icon: Download,
    bg: "bg-rose-100 dark:bg-rose-900/40",
    text: "text-rose-600 dark:text-rose-400",
    border: "border-rose-200 dark:border-rose-800/50",
    label: "Export",
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { delay: i * 0.06, duration: 0.35, ease: "easeOut" as const },
  }),
  exit: { opacity: 0, y: -10, transition: { duration: 0.2 } },
};

function formatTs(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRows(n: number | undefined) {
  return n === undefined ? "--" : n.toLocaleString();
}

export default function DataLineage({ tableName }: DataLineageProps) {
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  // Subscribe to external mutations via addLineageEntry
  useState(() => {
    listeners.add(rerender);
    return () => { listeners.delete(rerender); };
  });

  const entries = lineageStore[tableName] ?? [];
  const [expandedSql, setExpandedSql] = useState<Set<string>>(new Set());

  const toggleSql = (id: string) => {
    setExpandedSql((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearHistory = () => {
    lineageStore[tableName] = [];
    setExpandedSql(new Set());
    notify();
  };

  const lastModified = entries.length > 0 ? entries[entries.length - 1].timestamp : null;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-gray-500 dark:text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Data Lineage
          </h2>
        </div>
        {entries.length > 0 && (
          <button
            onClick={clearHistory}
            className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        )}
      </div>

      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-2.5 text-sm dark:border-gray-800 dark:bg-gray-800/60">
        <span className="text-gray-500 dark:text-gray-400">
          <span className="font-medium text-gray-900 dark:text-white">{entries.length}</span>
          {" "}operation{entries.length !== 1 && "s"}
        </span>
        {lastModified && (
          <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
            <Clock className="h-3.5 w-3.5" />
            Last modified{" "}
            <span className="font-medium text-gray-900 dark:text-white">
              {formatTs(lastModified)}
            </span>
          </span>
        )}
      </div>

      {/* Timeline */}
      {entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
          No lineage recorded for <span className="font-mono font-medium">{tableName}</span>
        </p>
      ) : (
        <div className="relative ml-4 border-l-2 border-gray-200 pl-6 dark:border-gray-700">
          <AnimatePresence initial={false}>
            {entries.map((entry, idx) => {
              const meta = TYPE_META[entry.type];
              const Icon = meta.icon;
              const sqlOpen = expandedSql.has(entry.id);
              return (
                <motion.div
                  key={entry.id}
                  custom={idx}
                  variants={cardVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  layout
                  className="relative mb-5 last:mb-0"
                >
                  {/* Timeline dot */}
                  <span
                    className={`absolute -left-[33px] top-2 flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-white dark:ring-gray-900 ${meta.bg}`}
                  >
                    <Icon className={`h-3 w-3 ${meta.text}`} />
                  </span>
                  {/* Card */}
                  <div className={`rounded-lg border ${meta.border} bg-white p-4 shadow-sm dark:bg-gray-800`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${meta.bg} ${meta.text}`}>
                          {meta.label}
                        </span>
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {entry.description}
                        </span>
                      </div>
                      <span className="whitespace-nowrap text-xs text-gray-400 dark:text-gray-500">
                        {formatTs(entry.timestamp)}
                      </span>
                    </div>
                    {/* Row counts */}
                    {(entry.rowsBefore !== undefined || entry.rowsAfter !== undefined) && (
                      <div className="mt-2 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                        <span>
                          Rows before:{" "}
                          <span className="font-medium text-gray-700 dark:text-gray-300">
                            {formatRows(entry.rowsBefore)}
                          </span>
                        </span>
                        <span>&rarr;</span>
                        <span>
                          After:{" "}
                          <span className="font-medium text-gray-700 dark:text-gray-300">
                            {formatRows(entry.rowsAfter)}
                          </span>
                        </span>
                      </div>
                    )}
                    {/* Collapsible SQL */}
                    {entry.sql && (
                      <div className="mt-3">
                        <button
                          onClick={() => toggleSql(entry.id)}
                          className="flex items-center gap-1 text-xs font-medium text-gray-500 transition hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                        >
                          {sqlOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          SQL
                        </button>
                        <AnimatePresence>
                          {sqlOpen && (
                            <motion.pre
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="mt-1.5 overflow-x-auto rounded-md bg-gray-50 p-3 font-mono text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300"
                            >
                              {entry.sql}
                            </motion.pre>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
