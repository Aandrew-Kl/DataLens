"use client";

import { startTransition, useDeferredValue, useState } from "react";
import { motion } from "framer-motion";
import { Calendar, Database, FileSearch, Hash, Search, ToggleLeft, Type } from "lucide-react";
import DataPreview from "@/components/data/data-preview";
import { ANALYTICS_EASE } from "@/lib/utils/advanced-analytics";
import { formatBytes, formatNumber, formatRelativeTime, sanitizeTableName } from "@/lib/utils/formatters";
import { useDatasetStore } from "@/stores/dataset-store";
import type { ColumnProfile, ColumnType } from "@/types/dataset";

const EMPTY_PREVIEW_ROWS: Array<Record<string, unknown>> = [];
const GLASS = "rounded-2xl border border-white/20 bg-white/60 backdrop-blur-xl dark:bg-slate-900/60";
const FILTERS = ["all", "string", "number", "date", "boolean", "unknown"] as const;
const MOTION = { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease: ANALYTICS_EASE } };
const TYPE_META = {
  string: { icon: Type, label: "String", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  number: { icon: Hash, label: "Number", tone: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  date: { icon: Calendar, label: "Date", tone: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  boolean: { icon: ToggleLeft, label: "Boolean", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  unknown: { icon: Database, label: "Unknown", tone: "bg-slate-500/10 text-slate-700 dark:text-slate-300" },
} satisfies Record<ColumnType, { icon: typeof Type; label: string; tone: string }>;

function formatColumnDetail(column: ColumnProfile) {
  if (column.type === "number") {
    return [
      column.min != null ? `Min ${formatNumber(Number(column.min))}` : null,
      column.max != null ? `Max ${formatNumber(Number(column.max))}` : null,
      column.mean != null ? `Mean ${formatNumber(column.mean)}` : null,
    ].filter(Boolean).join(" • ") || "Numeric profile is not available yet.";
  }
  if (column.type === "date" && column.min && column.max) return `Range ${String(column.min)} → ${String(column.max)}`;
  return column.sampleValues.filter((value) => value !== null && value !== "").slice(0, 3).map(String).join(" • ") || "No sample values available.";
}

export default function ExplorePage() {
  const activeDataset = useDatasetStore((state) => state.getActiveDataset());
  const [columnQuery, setColumnQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]>("all");
  const deferredQuery = useDeferredValue(columnQuery);

  if (!activeDataset) {
    return (
      <div className="space-y-5">
        <motion.section {...MOTION} className={`${GLASS} p-6`}>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Explore</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Browse the active dataset with searchable column statistics and a preview table.
          </p>
        </motion.section>
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, delay: 0.06, ease: ANALYTICS_EASE }}
          className={`${GLASS} flex min-h-[22rem] flex-col items-center justify-center gap-4 p-8 text-center`}
        >
          <div className="rounded-2xl border border-white/20 bg-white/70 p-4 dark:bg-slate-950/50"><FileSearch className="h-8 w-8 text-cyan-600 dark:text-cyan-300" /></div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">No dataset loaded</h2>
            <p className="max-w-xl text-sm text-slate-600 dark:text-slate-300">Select a dataset from the workspace sidebar to load an explorable table.</p>
          </div>
        </motion.section>
      </div>
    );
  }

  const tableName = sanitizeTableName(activeDataset.fileName);
  const totalNulls = activeDataset.columns.reduce((sum, column) => sum + column.nullCount, 0);
  const query = deferredQuery.trim().toLowerCase();
  const typeCounts = activeDataset.columns.reduce<Record<(typeof FILTERS)[number], number>>(
    (counts, column) => ({ ...counts, [column.type]: counts[column.type] + 1 }),
    { all: activeDataset.columns.length, string: 0, number: 0, date: 0, boolean: 0, unknown: 0 },
  );
  const visibleColumns = activeDataset.columns.filter((column) => {
    if (activeFilter !== "all" && column.type !== activeFilter) return false;
    if (!query) return true;
    return [column.name, TYPE_META[column.type].label, ...column.sampleValues.map(String)].join(" ").toLowerCase().includes(query);
  });
  const completeness = activeDataset.rowCount > 0 && activeDataset.columnCount > 0
    ? `${(100 - (totalNulls / (activeDataset.rowCount * activeDataset.columnCount)) * 100).toFixed(1)}%`
    : "—";

  return (
    <div className="space-y-5">
      <motion.section {...MOTION} className={`${GLASS} p-6`}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Dataset exploration</p>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Explore</h1>
            <p className="text-2xl font-semibold text-slate-900 dark:text-white">{activeDataset.fileName}</p>
            <p className="text-sm text-slate-600 dark:text-slate-300">Browse the active dataset with searchable column statistics and a preview table.</p>
            <div className="flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
              <span className="rounded-full border border-white/20 bg-white/55 px-3 py-1.5 dark:bg-slate-950/45">{formatNumber(activeDataset.rowCount)} rows</span>
              <span className="rounded-full border border-white/20 bg-white/55 px-3 py-1.5 dark:bg-slate-950/45">{formatNumber(activeDataset.columnCount)} columns</span>
              <span className="rounded-full border border-white/20 bg-white/55 px-3 py-1.5 dark:bg-slate-950/45">Uploaded {formatRelativeTime(activeDataset.uploadedAt)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Rows", formatNumber(activeDataset.rowCount)],
              ["Columns", formatNumber(activeDataset.columnCount)],
              ["Null cells", formatNumber(totalNulls)],
              ["Size", formatBytes(activeDataset.sizeBytes)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-white/20 bg-white/50 px-4 py-3 dark:bg-slate-950/45">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.34, delay: 0.05, ease: ANALYTICS_EASE }}
        className={`${GLASS} p-5`}
      >
        <div className="flex flex-col gap-4 border-b border-white/15 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Column explorer</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Search the schema, filter by type, and inspect nulls, uniqueness, and profile stats.</p>
          </div>
          <label className="flex w-full items-center gap-3 rounded-2xl border border-white/20 bg-white/50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-950/45 dark:text-slate-300 lg:max-w-sm">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={columnQuery}
              onChange={(event) => startTransition(() => setColumnQuery(event.target.value))}
              placeholder="Search columns, types, or samples"
              className="w-full bg-transparent outline-none placeholder:text-slate-400"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => startTransition(() => setActiveFilter(filter))}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                activeFilter === filter ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" : "border-white/20 bg-white/45 text-slate-600 dark:bg-slate-950/40 dark:text-slate-300"
              }`}
            >
              {filter === "all" ? "All" : TYPE_META[filter].label} · {typeCounts[filter]}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            ["Showing", `${formatNumber(visibleColumns.length)} of ${formatNumber(activeDataset.columns.length)}`],
            ["Completeness", completeness],
            ["Active table", tableName],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/20 bg-white/45 px-4 py-3 dark:bg-slate-950/40">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
              <p className="mt-1 truncate text-lg font-semibold text-slate-900 dark:text-white">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {visibleColumns.length > 0 ? visibleColumns.map((column, index) => {
            const Icon = TYPE_META[column.type].icon;
            const nullRate = activeDataset.rowCount > 0 ? `${((column.nullCount / activeDataset.rowCount) * 100).toFixed(1)}%` : "—";
            return (
              <motion.div
                key={column.name}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: index * 0.02, ease: ANALYTICS_EASE }}
                className="rounded-2xl border border-white/20 bg-white/45 p-4 dark:bg-slate-950/40"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{column.name}</h3>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${TYPE_META[column.type].tone}`}>
                        <Icon className="h-3 w-3" />{TYPE_META[column.type].label}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{formatColumnDetail(column)}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-sm lg:min-w-[18rem]">
                    {[
                      ["Nulls", formatNumber(column.nullCount)],
                      ["Null rate", nullRate],
                      ["Unique", formatNumber(column.uniqueCount)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-white/15 bg-white/55 px-3 py-2 text-center dark:bg-slate-950/45">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
                        <p className="mt-1 font-semibold text-slate-900 dark:text-white">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            );
          }) : (
            <div className="rounded-2xl border border-dashed border-white/20 bg-white/35 px-4 py-8 text-center text-sm text-slate-600 dark:bg-slate-950/30 dark:text-slate-300">
              No columns matched the current search or filter.
            </div>
          )}
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.38, delay: 0.1, ease: ANALYTICS_EASE }}
        className={`${GLASS} p-3 md:p-4`}
      >
        {activeDataset.columns.length > 0 ? (
          <DataPreview tableName={tableName} columns={activeDataset.columns} previewRows={EMPTY_PREVIEW_ROWS} initialPageSize={100} />
        ) : (
          <div className="rounded-2xl border border-white/20 bg-white/45 p-5 text-sm text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
            This dataset has no columns to display.
          </div>
        )}
      </motion.section>
    </div>
  );
}
