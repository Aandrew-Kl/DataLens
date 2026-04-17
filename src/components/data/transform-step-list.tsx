"use client";

import { AnimatePresence, motion } from "framer-motion";
import { History, Table2 } from "lucide-react";
import type { ColumnProfile } from "@/types/dataset";
import { formatCount, type HistoryEntry } from "./transform-preview";

interface TransformStepListProps {
  currentSourceName: string;
  currentColumns: ColumnProfile[];
  history: HistoryEntry[];
  isBootstrapping: boolean;
}

export function TransformStepList({
  currentSourceName,
  currentColumns,
  history,
  isBootstrapping,
}: TransformStepListProps) {
  return (
    <aside className="space-y-5">
      <div className="rounded-2xl border border-gray-200/60 bg-white/45 p-4 dark:border-gray-700/60 dark:bg-gray-950/35">
        <div className="flex items-start gap-3">
          <Table2 className="mt-0.5 h-4 w-4 text-blue-500 dark:text-blue-300" />
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">Active relation</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              New transforms read from <span className="font-mono">{currentSourceName}</span>.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {currentColumns.map((column) => (
            <div key={column.name} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200/60 bg-white/60 px-3 py-2 text-sm dark:border-gray-700/60 dark:bg-gray-950/35">
              <span className="truncate text-gray-800 dark:text-gray-200">{column.name}</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                {column.type}
              </span>
            </div>
          ))}

          {currentColumns.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200/70 bg-white/40 px-3 py-4 text-sm text-gray-500 dark:border-gray-700/70 dark:bg-gray-950/25 dark:text-gray-400">
              {isBootstrapping ? "Loading relation schema..." : "No columns are currently available in this relation."}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200/60 bg-white/45 p-4 dark:border-gray-700/60 dark:bg-gray-950/35">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <History className="mt-0.5 h-4 w-4 text-violet-500 dark:text-violet-300" />
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">Transformation history</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Undo only removes the latest generated view.</p>
            </div>
          </div>
          <span className="rounded-full border border-gray-200/70 bg-white/70 px-3 py-1 text-xs font-semibold text-gray-600 dark:border-gray-700/70 dark:bg-gray-950/40 dark:text-gray-300">
            {history.length} step{history.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {history.map((entry) => (
              <motion.div key={entry.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="rounded-2xl border border-gray-200/60 bg-white/60 p-3 dark:border-gray-700/60 dark:bg-gray-950/35">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">{entry.label}</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{entry.viewName} from {entry.sourceName}</p>
                  </div>
                  <span className="text-[11px] text-gray-400 dark:text-gray-500">
                    {new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-gray-200/60 bg-white/50 px-3 py-2 text-xs dark:border-gray-700/60 dark:bg-gray-950/25">
                    <span className="font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">Rows</span>
                    <p className="mt-1 font-medium text-gray-800 dark:text-gray-200">{formatCount(entry.rowCount)}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200/60 bg-white/50 px-3 py-2 text-xs dark:border-gray-700/60 dark:bg-gray-950/25">
                    <span className="font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">Columns</span>
                    <p className="mt-1 font-medium text-gray-800 dark:text-gray-200">{formatCount(entry.columnCount)}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {history.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-200/70 bg-white/40 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700/70 dark:bg-gray-950/25 dark:text-gray-400">
              No transformations have been materialized yet.
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
