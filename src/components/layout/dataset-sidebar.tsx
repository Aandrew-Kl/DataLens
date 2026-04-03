"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Binary,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Database,
  Hash,
  Search,
  Type,
} from "lucide-react";
import {
  ANALYTICS_EASE,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
} from "@/lib/utils/advanced-analytics";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile, ColumnType } from "@/types/dataset";

interface DatasetSidebarProps {
  tableName: string;
  columns: ColumnProfile[];
}

const TYPE_META: Record<ColumnType, { label: string; icon: typeof Type }> = {
  string: { label: "String", icon: Type },
  number: { label: "Number", icon: Hash },
  date: { label: "Date", icon: CalendarDays },
  boolean: { label: "Boolean", icon: Binary },
  unknown: { label: "Unknown", icon: Type },
};

function ColumnRow({
  column,
  selected,
  onSelect,
}: {
  column: ColumnProfile;
  selected: boolean;
  onSelect: (columnName: string) => void;
}) {
  const Icon = TYPE_META[column.type].icon;

  return (
    <button
      type="button"
      onClick={() => onSelect(column.name)}
      className={`flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left transition ${
        selected
          ? "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
          : "hover:bg-slate-900/5 dark:hover:bg-white/5"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-cyan-500/10 p-2 text-cyan-700 dark:text-cyan-300">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-950 dark:text-white">
            {column.name}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {TYPE_META[column.type].label}
          </p>
        </div>
      </div>
      <span className="text-xs text-slate-500 dark:text-slate-400">
        {formatNumber(column.uniqueCount)}
      </span>
    </button>
  );
}

export default function DatasetSidebar({
  tableName,
  columns,
}: DatasetSidebarProps) {
  const [search, setSearch] = useState("");
  const [collapsedTables, setCollapsedTables] = useState<string[]>([]);
  const [selectedColumnName, setSelectedColumnName] = useState("");
  const deferredSearch = useDeferredValue(search);

  const filteredColumns = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    if (!query) return columns;
    return columns.filter((column) => {
      const haystack = `${column.name} ${column.type}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [columns, deferredSearch]);

  const isCollapsed = collapsedTables.includes(tableName);
  const activeColumn =
    filteredColumns.find((column) => column.name === selectedColumnName) ??
    filteredColumns[0] ??
    null;

  function toggleTable(table: string) {
    setCollapsedTables((current) =>
      current.includes(table)
        ? current.filter((entry) => entry !== table)
        : [...current, table],
    );
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} p-5`}>
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-cyan-500/10 p-2.5 text-cyan-700 dark:text-cyan-300">
          <Database className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
            Dataset sidebar
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Browse the active table schema and drill into column details.
          </p>
        </div>
      </div>

      <label className="mt-5 block">
        <span className="sr-only">Search columns</span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            aria-label="Search columns"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={`${FIELD_CLASS} pl-11`}
            placeholder="Filter by name or type"
          />
        </div>
      </label>

      <div className={`${GLASS_CARD_CLASS} mt-5 p-4`}>
        <button
          type="button"
          onClick={() => toggleTable(tableName)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div>
            <p className="text-base font-semibold text-slate-950 dark:text-white">
              {tableName}
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {formatNumber(columns.length)} columns
            </p>
          </div>
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          )}
        </button>

        {!isCollapsed ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: ANALYTICS_EASE }}
            className="mt-4 space-y-2"
          >
            {filteredColumns.length === 0 ? (
              <p className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-600 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-300">
                No columns match the current filter.
              </p>
            ) : (
              filteredColumns.map((column) => (
                <ColumnRow
                  key={column.name}
                  column={column}
                  selected={activeColumn?.name === column.name}
                  onSelect={setSelectedColumnName}
                />
              ))
            )}
          </motion.div>
        ) : null}
      </div>

      <div className={`${GLASS_CARD_CLASS} mt-5 p-4`}>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          Selected column
        </p>
        {activeColumn ? (
          <div className="mt-3">
            <p className="text-lg font-semibold text-slate-950 dark:text-white">
              {activeColumn.name}
            </p>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {TYPE_META[activeColumn.type].label} · {formatNumber(activeColumn.nullCount)} nulls
              · {formatNumber(activeColumn.uniqueCount)} unique
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Samples:{" "}
              {activeColumn.sampleValues.length > 0
                ? activeColumn.sampleValues
                    .slice(0, 4)
                    .map((value) => String(value ?? "null"))
                    .join(", ")
                : "No sample values available."}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            Select a column to inspect its basic profile.
          </p>
        )}
      </div>
    </section>
  );
}
