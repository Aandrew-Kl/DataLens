"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpDown, Filter, Pencil, Plus, Sigma, Sparkles, Trash2, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { ColumnProfile } from "@/types/dataset";
import FormulaEditor from "./formula-editor";

export type TransformKind = "filter" | "sort" | "group" | "computed" | "rename" | "drop";
export type FilterOperator =
  | "="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "contains"
  | "starts_with"
  | "ends_with"
  | "is_null"
  | "is_not_null";
export type SortDirection = "ASC" | "DESC";
export type AggregateFunction = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";
export type TransformStatus = { type: "error" | "success"; message: string } | null;

export interface FilterDraft {
  column: string;
  operator: FilterOperator;
  value: string;
}

export interface SortDraft {
  column: string;
  direction: SortDirection;
}

export interface AggregationDraft {
  id: string;
  functionName: AggregateFunction;
  column: string;
  alias: string;
}

export interface GroupDraft {
  groupBy: string[];
  aggregates: AggregationDraft[];
}

export interface ComputedDraft {
  name: string;
  expression: string;
}

export interface RenameDraft {
  column: string;
  newName: string;
}

export interface DropDraft {
  column: string;
}

export const FILTER_OPERATORS: Array<{ value: FilterOperator; label: string; needsValue: boolean }> = [
  { value: "=", label: "Equals", needsValue: true },
  { value: "!=", label: "Does not equal", needsValue: true },
  { value: ">", label: "Greater than", needsValue: true },
  { value: ">=", label: "Greater or equal", needsValue: true },
  { value: "<", label: "Less than", needsValue: true },
  { value: "<=", label: "Less or equal", needsValue: true },
  { value: "contains", label: "Contains", needsValue: true },
  { value: "starts_with", label: "Starts with", needsValue: true },
  { value: "ends_with", label: "Ends with", needsValue: true },
  { value: "is_null", label: "Is null", needsValue: false },
  { value: "is_not_null", label: "Is not null", needsValue: false },
];

const TRANSFORM_TABS = [
  { key: "filter", label: "Filter rows", icon: Filter },
  { key: "sort", label: "Sort", icon: ArrowUpDown },
  { key: "group", label: "Group & aggregate", icon: Sigma },
  { key: "computed", label: "Add computed column", icon: Sparkles },
  { key: "rename", label: "Rename column", icon: Pencil },
  { key: "drop", label: "Drop column", icon: Trash2 },
] as const satisfies ReadonlyArray<{ key: TransformKind; label: string; icon: typeof Filter }>;

export function sanitizeForViewName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "dataset";
}

export function defaultAggregateAlias(aggregate: AggregationDraft): string {
  const suffix = aggregate.column ? sanitizeForViewName(aggregate.column) : "rows";
  if (aggregate.functionName === "COUNT" && !aggregate.column) return "row_count";
  return `${aggregate.functionName.toLowerCase()}_${suffix}`;
}

export function createAggregationDraft(): AggregationDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    functionName: "COUNT",
    column: "",
    alias: "row_count",
  };
}

export function getOperatorMeta(operator: FilterOperator) {
  return FILTER_OPERATORS.find((item) => item.value === operator) ?? FILTER_OPERATORS[0];
}

function TabButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Filter;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-2xl border px-3 py-3 text-left text-sm font-medium transition ${
        active
          ? "border-blue-500/30 bg-blue-500/15 text-blue-700 dark:text-blue-200"
          : "border-gray-200/60 bg-white/55 text-gray-700 hover:border-blue-400/40 hover:text-blue-600 dark:border-gray-700/60 dark:bg-gray-950/35 dark:text-gray-200 dark:hover:text-blue-300"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
}

interface TransformStepEditorProps {
  activeTab: TransformKind;
  setActiveTab: (tab: TransformKind) => void;
  currentSourceName: string;
  currentColumns: ColumnProfile[];
  filterDraft: FilterDraft;
  setFilterDraft: Dispatch<SetStateAction<FilterDraft>>;
  sortDraft: SortDraft;
  setSortDraft: Dispatch<SetStateAction<SortDraft>>;
  groupDraft: GroupDraft;
  setGroupDraft: Dispatch<SetStateAction<GroupDraft>>;
  computedDraft: ComputedDraft;
  setComputedDraft: Dispatch<SetStateAction<ComputedDraft>>;
  renameDraft: RenameDraft;
  setRenameDraft: Dispatch<SetStateAction<RenameDraft>>;
  dropDraft: DropDraft;
  setDropDraft: Dispatch<SetStateAction<DropDraft>>;
  setStatus: Dispatch<SetStateAction<TransformStatus>>;
}

export function TransformStepEditor(props: TransformStepEditorProps) {
  const {
    activeTab,
    setActiveTab,
    currentSourceName,
    currentColumns,
    filterDraft,
    setFilterDraft,
    sortDraft,
    setSortDraft,
    groupDraft,
    setGroupDraft,
    computedDraft,
    setComputedDraft,
    renameDraft,
    setRenameDraft,
    dropDraft,
    setDropDraft,
    setStatus,
  } = props;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {TRANSFORM_TABS.map((tab) => (
          <TabButton key={tab.key} active={activeTab === tab.key} icon={tab.icon} label={tab.label} onClick={() => setActiveTab(tab.key)} />
        ))}
      </div>

      <div className="rounded-2xl border border-gray-200/60 bg-white/45 p-4 dark:border-gray-700/60 dark:bg-gray-950/35">
        {activeTab === "filter" && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Column</span>
              <select value={filterDraft.column} onChange={(event) => setFilterDraft((current) => ({ ...current, column: event.target.value }))} className="h-11 w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100">
                <option value="">Select column</option>
                {currentColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Operator</span>
              <select value={filterDraft.operator} onChange={(event) => setFilterDraft((current) => ({ ...current, operator: event.target.value as FilterOperator }))} className="h-11 w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100">
                {FILTER_OPERATORS.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
              </select>
            </label>
            {getOperatorMeta(filterDraft.operator).needsValue ? (
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Value</span>
                <input value={filterDraft.value} onChange={(event) => setFilterDraft((current) => ({ ...current, value: event.target.value }))} placeholder="42" className="h-11 w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100 dark:placeholder:text-gray-500" />
              </label>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200/70 bg-white/50 px-4 py-3 text-sm text-gray-500 dark:border-gray-700/70 dark:bg-gray-950/30 dark:text-gray-400">This operator does not require a comparison value.</div>
            )}
          </div>
        )}

        {activeTab === "sort" && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Sort column</span>
              <select value={sortDraft.column} onChange={(event) => setSortDraft((current) => ({ ...current, column: event.target.value }))} className="h-11 w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100">
                <option value="">Select column</option>
                {currentColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Direction</span>
              <select value={sortDraft.direction} onChange={(event) => setSortDraft((current) => ({ ...current, direction: event.target.value as SortDirection }))} className="h-11 w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100">
                <option value="ASC">Ascending</option>
                <option value="DESC">Descending</option>
              </select>
            </label>
          </div>
        )}

        {activeTab === "group" && (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Grouping columns</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Select zero or more columns. If you leave this empty, the panel will aggregate the full relation into one row.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {currentColumns.map((column) => {
                  const selected = groupDraft.groupBy.includes(column.name);
                  return (
                    <button key={column.name} type="button" onClick={() => setGroupDraft((current) => ({ ...current, groupBy: selected ? current.groupBy.filter((name) => name !== column.name) : [...current.groupBy, column.name] }))} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${selected ? "border-blue-500/30 bg-blue-500/15 text-blue-700 dark:text-blue-200" : "border-gray-200/70 bg-white/70 text-gray-700 hover:border-blue-400/50 hover:text-blue-600 dark:border-gray-700/70 dark:bg-gray-950/40 dark:text-gray-200 dark:hover:text-blue-300"}`}>
                      {column.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Aggregations</p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Each aggregation becomes one output column in the transformed view.</p>
                </div>
                <button type="button" onClick={() => setGroupDraft((current) => ({ ...current, aggregates: [...current.aggregates, createAggregationDraft()] }))} className="inline-flex items-center gap-2 rounded-xl border border-gray-200/70 bg-white/70 px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-blue-400/50 hover:text-blue-600 dark:border-gray-700/70 dark:bg-gray-950/40 dark:text-gray-200 dark:hover:text-blue-300">
                  <Plus className="h-4 w-4" />
                  Add aggregation
                </button>
              </div>
              <AnimatePresence initial={false}>
                {groupDraft.aggregates.map((aggregate) => (
                  <motion.div key={aggregate.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="grid gap-3 rounded-2xl border border-gray-200/60 bg-white/55 p-3 dark:border-gray-700/60 dark:bg-gray-950/35 lg:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)_48px]">
                    <select value={aggregate.functionName} onChange={(event) => setGroupDraft((current) => ({ ...current, aggregates: current.aggregates.map((item) => item.id === aggregate.id ? { ...item, functionName: event.target.value as AggregateFunction, alias: event.target.value === "COUNT" && item.alias === "" ? "row_count" : item.alias } : item) }))} className="h-11 rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100">
                      <option value="COUNT">COUNT</option>
                      <option value="SUM">SUM</option>
                      <option value="AVG">AVG</option>
                      <option value="MIN">MIN</option>
                      <option value="MAX">MAX</option>
                    </select>
                    <select value={aggregate.column} onChange={(event) => setGroupDraft((current) => ({ ...current, aggregates: current.aggregates.map((item) => item.id === aggregate.id ? { ...item, column: event.target.value } : item) }))} className="h-11 rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100">
                      <option value="">{aggregate.functionName === "COUNT" ? "All rows (*)" : "Select column"}</option>
                      {currentColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
                    </select>
                    <input value={aggregate.alias} onChange={(event) => setGroupDraft((current) => ({ ...current, aggregates: current.aggregates.map((item) => item.id === aggregate.id ? { ...item, alias: event.target.value } : item) }))} placeholder={defaultAggregateAlias(aggregate)} className="h-11 rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100 dark:placeholder:text-gray-500" />
                    <button type="button" onClick={() => setGroupDraft((current) => ({ ...current, aggregates: current.aggregates.length === 1 ? current.aggregates : current.aggregates.filter((item) => item.id !== aggregate.id) }))} disabled={groupDraft.aggregates.length === 1} className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200/70 bg-white/70 text-gray-500 transition hover:border-red-400/50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-400" aria-label="Remove aggregation">
                      <X className="h-4 w-4" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}

        {activeTab === "computed" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-dashed border-gray-200/70 bg-white/45 px-4 py-3 text-sm text-gray-600 dark:border-gray-700/70 dark:bg-gray-950/30 dark:text-gray-300">Save a formula from the embedded editor to stage it for the next transform. The SQL preview below updates only after the formula validates successfully.</div>
            <FormulaEditor key={`${currentSourceName}-${currentColumns.map((column) => column.name).join("|")}`} tableName={currentSourceName} columns={currentColumns} onSave={(name, expression) => {
              setComputedDraft({ name, expression });
              setStatus({ type: "success", message: `Staged computed column "${name}". Review the SQL preview and create the view when ready.` });
            }} />
            {computedDraft.name && (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200">
                <p className="font-semibold">Staged formula</p>
                <p className="mt-1 font-mono text-xs leading-6">{computedDraft.name} = {computedDraft.expression}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "rename" && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Existing column</span>
              <select value={renameDraft.column} onChange={(event) => setRenameDraft((current) => ({ ...current, column: event.target.value }))} className="h-11 w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100">
                <option value="">Select column</option>
                {currentColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">New name</span>
              <input value={renameDraft.newName} onChange={(event) => setRenameDraft((current) => ({ ...current, newName: event.target.value }))} placeholder="renamed_column" className="h-11 w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100 dark:placeholder:text-gray-500" />
            </label>
          </div>
        )}

        {activeTab === "drop" && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Column to remove</span>
              <select value={dropDraft.column} onChange={(event) => setDropDraft({ column: event.target.value })} className="h-11 w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700/70 dark:bg-gray-950/50 dark:text-gray-100">
                <option value="">Select column</option>
                {currentColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
              </select>
            </label>
            <div className="rounded-xl border border-dashed border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">Dropping a column removes it from the next view only. Use undo to revert the latest step.</div>
          </div>
        )}
      </div>
    </>
  );
}
