"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useMemo, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Calculator,
  Check,
  FolderPlus,
  Layers3,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { generateId } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface ColumnGrouperProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface ColumnGroup {
  id: string;
  name: string;
  description: string;
  color: string;
  columnNames: string[];
}

interface ComputedColumn {
  id: string;
  name: string;
  expression: string;
  createdAt: number;
}

interface GrouperState {
  groups: ColumnGroup[];
  computedColumns: ComputedColumn[];
}

type Notice = {
  tone: "success" | "error" | "info";
  message: string;
} | null;

const EASE = [0.22, 1, 0.36, 1] as const;
const listeners = new Set<() => void>();
const colorOptions = ["#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange() {
  listeners.forEach((listener) => listener());
}

function storageKey(tableName: string) {
  return `datalens:column-grouper:${tableName}`;
}
function sanitizeAlias(value: string) {
  const trimmed = value.trim().replace(/[^a-zA-Z0-9_]/g, "_");
  const normalized = /^[a-zA-Z_]/.test(trimmed) ? trimmed : `calc_${trimmed}`;
  return normalized.replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
}

function readState(tableName: string): GrouperState {
  if (typeof window === "undefined") return { groups: [], computedColumns: [] };
  try {
    const raw = window.localStorage.getItem(storageKey(tableName));
    return raw ? (JSON.parse(raw) as GrouperState) : { groups: [], computedColumns: [] };
  } catch {
    return { groups: [], computedColumns: [] };
  }
}

function writeState(tableName: string, state: GrouperState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(tableName), JSON.stringify(state));
  emitChange();
}

export default function ColumnGrouper({ tableName, columns }: ColumnGrouperProps) {
  const store = useSyncExternalStore(
    subscribe,
    () => readState(tableName),
    () => ({ groups: [], computedColumns: [] }),
  );
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupColor, setGroupColor] = useState(colorOptions[0]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [computedName, setComputedName] = useState("");
  const [computedExpression, setComputedExpression] = useState("");
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const activeGroup = store.groups.find((group) => group.id === activeGroupId) ?? null;
  const decoratedColumns = useMemo(() => {
    return columns.map((column) => ({
      column,
      groups: store.groups.filter((group) => group.columnNames.includes(column.name)),
    }));
  }, [columns, store.groups]);

  function toggleColumn(columnName: string) {
    setSelectedColumns((current) =>
      current.includes(columnName)
        ? current.filter((entry) => entry !== columnName)
        : [...current, columnName],
    );
  }

  function createGroup() {
    const name = groupName.trim();
    if (!name) {
      setNotice({ tone: "error", message: "Group name is required." });
      return;
    }

    const group: ColumnGroup = {
      id: generateId(),
      name,
      description: groupDescription.trim(),
      color: groupColor,
      columnNames: [],
    };

    writeState(tableName, { ...store, groups: [group, ...store.groups] });
    setGroupName("");
    setGroupDescription("");
    setActiveGroupId(group.id);
    setNotice({ tone: "success", message: `Created "${group.name}".` });
  }

  function updateGroupColumns(mode: "add" | "remove") {
    if (!activeGroup) {
      setNotice({ tone: "info", message: "Select a group first." });
      return;
    }

    const nextGroups = store.groups.map((group) => {
      if (group.id !== activeGroup.id) return group;
      const current = new Set(group.columnNames);
      for (const columnName of selectedColumns) {
        if (mode === "add") current.add(columnName);
        else current.delete(columnName);
      }
      return { ...group, columnNames: Array.from(current).sort() };
    });

    writeState(tableName, { ...store, groups: nextGroups });
    setNotice({ tone: "success", message: `${mode === "add" ? "Added" : "Removed"} ${selectedColumns.length} column${selectedColumns.length === 1 ? "" : "s"}.` });
  }

  function deleteGroup(groupId: string) {
    writeState(tableName, { ...store, groups: store.groups.filter((group) => group.id !== groupId) });
    if (activeGroupId === groupId) setActiveGroupId(null);
    setNotice({ tone: "success", message: "Group deleted." });
  }

  async function previewComputedColumn() {
    const alias = sanitizeAlias(computedName) || "computed_value";
    const expression = computedExpression.trim();

    if (!expression) {
      setPreviewRows([]);
      setPreviewError("Enter a DuckDB expression to preview.");
      return;
    }

    setBusy("preview");
    setPreviewError(null);
    setNotice(null);
    try {
      const rows = await runQuery(
        `SELECT ${expression} AS ${quoteIdentifier(alias)} FROM ${quoteIdentifier(tableName)} LIMIT 8`,
      );
      setPreviewRows(rows);
      setNotice({ tone: "success", message: "Preview generated from DuckDB." });
    } catch (error) {
      setPreviewRows([]);
      setPreviewError(error instanceof Error ? error.message : "Preview failed.");
    } finally {
      setBusy(null);
    }
  }

  async function saveComputedColumn() {
    const name = sanitizeAlias(computedName);
    const expression = computedExpression.trim();

    if (!name || !expression) {
      setNotice({ tone: "error", message: "Computed columns need a name and expression." });
      return;
    }

    setBusy("save");
    setNotice(null);
    try {
      await runQuery(
        `CREATE OR REPLACE TABLE ${quoteIdentifier(tableName)} AS SELECT *, ${expression} AS ${quoteIdentifier(name)} FROM ${quoteIdentifier(tableName)}`,
      );

      const computedColumn: ComputedColumn = {
        id: generateId(),
        name,
        expression,
        createdAt: Date.now(),
      };

      writeState(tableName, {
        ...store,
        computedColumns: [computedColumn, ...store.computedColumns.filter((entry) => entry.name !== name)],
      });

      setComputedName("");
      setComputedExpression("");
      setPreviewRows([]);
      setNotice({ tone: "success", message: `Materialized computed column "${name}" in DuckDB.` });
      window.dispatchEvent(new CustomEvent("datalens:computed-column-created", { detail: { tableName, columnName: name, expression } }));
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Failed to save computed column." });
    } finally {
      setBusy(null);
    }
  }

  function removeComputedColumn(columnId: string) {
    writeState(tableName, {
      ...store,
      computedColumns: store.computedColumns.filter((column) => column.id !== columnId),
    });
    setNotice({ tone: "success", message: "Computed column definition removed from localStorage." });
  }

  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/20 bg-white/60 shadow-2xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45">
      <div className="border-b border-white/15 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-500/10 text-teal-700 dark:text-teal-300">
            <Layers3 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Column Grouper</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">Groups and computed columns for {tableName}</h2>
          </div>
        </div>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          Build reusable column bundles, assign columns with checkboxes, and create DuckDB-powered computed fields without drag interactions.
        </p>
      </div>

      <div className="space-y-5 px-5 py-5">
        {notice ? (
          <div className={`rounded-2xl border px-4 py-3 text-sm ${notice.tone === "error" ? "border-rose-400/40 bg-rose-500/10 text-rose-700 dark:text-rose-300" : notice.tone === "info" ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" : "border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>
            {notice.message}
          </div>
        ) : null}

        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }} className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4 rounded-[1.75rem] border border-white/15 bg-white/50 p-4 dark:bg-slate-900/40">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Create group</h3>
              <input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Financial Columns" className="w-full rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50" />
              <textarea value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} rows={3} placeholder="Metrics used in revenue and margin analysis" className="w-full rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50" />
              <div className="flex flex-wrap gap-2">
                {colorOptions.map((color) => (
                  <button key={color} type="button" onClick={() => setGroupColor(color)} className={`flex h-9 w-9 items-center justify-center rounded-full border ${groupColor === color ? "border-slate-950 dark:border-white" : "border-white/20"}`} style={{ backgroundColor: color }}>
                    {groupColor === color ? <Check className="h-4 w-4 text-white" /> : null}
                  </button>
                ))}
              </div>
              <button type="button" onClick={createGroup} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-500">
                <FolderPlus className="h-4 w-4" />
                Create group
              </button>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Existing groups</h3>
              <AnimatePresence initial={false}>
                {store.groups.length === 0 ? (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-[1.5rem] border border-dashed border-white/20 bg-white/35 px-5 py-8 text-center text-sm text-slate-500 dark:bg-slate-900/30 dark:text-slate-400">
                    No groups saved yet.
                  </motion.div>
                ) : (
                  store.groups.map((group) => (
                    <motion.button key={group.id} layout type="button" onClick={() => setActiveGroupId(group.id)} className={`w-full rounded-[1.5rem] border px-4 py-4 text-left transition ${activeGroupId === group.id ? "border-teal-400/50 bg-teal-500/10" : "border-white/15 bg-white/35 dark:bg-slate-900/30"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: group.color }} />
                            <span className="font-semibold text-slate-950 dark:text-slate-50">{group.name}</span>
                          </div>
                          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{group.description || "No description."}</p>
                          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{group.columnNames.length} assigned column{group.columnNames.length === 1 ? "" : "s"}</p>
                        </div>
                        <button type="button" onClick={(event) => { event.stopPropagation(); deleteGroup(group.id); }} className="rounded-2xl border border-rose-300/40 bg-rose-500/10 p-2 text-rose-700 dark:text-rose-300">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </motion.button>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[1.75rem] border border-white/15 bg-white/50 p-4 dark:bg-slate-900/40">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Assign columns</h3>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{activeGroup ? `Selected group: ${activeGroup.name}` : "Choose a group, then add or remove selected columns."}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => updateGroupColumns("add")} className="inline-flex items-center gap-2 rounded-2xl border border-white/20 px-3 py-2 text-sm text-slate-700 transition hover:bg-white/40 dark:text-slate-200">
                    <Plus className="h-4 w-4" />
                    Add selected
                  </button>
                  <button type="button" onClick={() => updateGroupColumns("remove")} className="inline-flex items-center gap-2 rounded-2xl border border-white/20 px-3 py-2 text-sm text-slate-700 transition hover:bg-white/40 dark:text-slate-200">
                    <Trash2 className="h-4 w-4" />
                    Remove selected
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {decoratedColumns.map(({ column, groups }) => (
                  <label key={column.name} className="rounded-[1.25rem] border border-white/15 bg-white/35 p-3 dark:bg-slate-900/30">
                    <div className="flex items-start gap-3">
                      <input type="checkbox" checked={selectedColumns.includes(column.name)} onChange={() => toggleColumn(column.name)} className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium text-slate-950 dark:text-slate-50">{column.name}</span>
                          <span className="rounded-full bg-white/50 px-2 py-0.5 text-[11px] uppercase tracking-[0.16em] text-slate-500 dark:bg-slate-950/60 dark:text-slate-400">{column.type}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {groups.length === 0 ? <span className="text-xs text-slate-400">Ungrouped</span> : null}
                          {groups.map((group) => (
                            <span key={group.id} className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: group.color }}>
                              {group.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/15 bg-white/50 p-4 dark:bg-slate-900/40">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <Calculator className="h-4 w-4" />
                Computed columns
              </div>
              <div className="mt-4 grid gap-3">
                <input value={computedName} onChange={(event) => setComputedName(event.target.value)} placeholder="gross_margin_pct" className="w-full rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50" />
                <textarea value={computedExpression} onChange={(event) => setComputedExpression(event.target.value)} rows={4} placeholder='("revenue" - "cost") / NULLIF("revenue", 0)' className="w-full rounded-2xl border border-white/20 bg-white/70 px-4 py-3 font-mono text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50" />
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => void previewComputedColumn()} disabled={busy !== null} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/20 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-white/40 disabled:opacity-60 dark:text-slate-200">
                    <Sparkles className={`h-4 w-4 ${busy === "preview" ? "animate-spin" : ""}`} />
                    Preview in DuckDB
                  </button>
                  <button type="button" onClick={() => void saveComputedColumn()} disabled={busy !== null} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60">
                    <Plus className={`h-4 w-4 ${busy === "save" ? "animate-spin" : ""}`} />
                    Save computed column
                  </button>
                </div>
                {previewError ? <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">{previewError}</div> : null}
                {previewRows.length > 0 ? (
                  <div className="overflow-hidden rounded-[1.25rem] border border-white/15">
                    <table className="min-w-full divide-y divide-white/10 text-sm">
                      <thead className="bg-white/35 dark:bg-slate-900/50">
                        <tr>{Object.keys(previewRows[0]).map((key) => <th key={key} className="px-3 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">{key}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y divide-white/10 bg-white/20 dark:bg-slate-950/30">
                        {previewRows.map((row, rowIndex) => (
                          <tr key={`${rowIndex}-${Object.values(row).join("|")}`}>{Object.entries(row).map(([key, value]) => <td key={key} className="px-3 py-2 text-slate-700 dark:text-slate-200">{String(value ?? "null")}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>

              <div className="mt-5 space-y-2">
                {store.computedColumns.map((column) => (
                  <div key={column.id} className="flex flex-col gap-3 rounded-[1.25rem] border border-white/15 bg-white/35 px-4 py-3 dark:bg-slate-900/30 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="font-semibold text-slate-950 dark:text-slate-50">{column.name}</p>
                      <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">{column.expression}</p>
                    </div>
                    <button type="button" onClick={() => removeComputedColumn(column.id)} className="inline-flex items-center gap-2 rounded-2xl border border-rose-300/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 transition hover:bg-rose-500/15 dark:text-rose-300">
                      <Trash2 className="h-4 w-4" />
                      Remove definition
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
