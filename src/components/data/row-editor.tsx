"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useState } from "react";
import { motion } from "framer-motion";
import { History, PencilLine, RotateCcw, Save, Search } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile, ColumnType } from "@/types/dataset";

interface RowEditorProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface LoadedRow {
  rowId: number;
  index: number;
  values: Record<string, unknown>;
}

interface AuditEntry {
  id: string;
  rowId: number;
  rowIndex: number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  changedColumns: string[];
  timestamp: number;
  undone: boolean;
}

interface ParsedCell {
  sql: string;
  value: unknown;
  error?: string;
}

const GLASS_PANEL =
  "bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 border border-white/20";
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function escapeLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function toDraftValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function parseCellValue(value: string, type: ColumnType): ParsedCell {
  if (type === "number") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return { sql: "NULL", value, error: "Must be a valid number." };
    }
    return { sql: String(numeric), value: numeric };
  }

  if (type === "boolean") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) {
      return { sql: "TRUE", value: true };
    }
    if (["false", "0", "no"].includes(normalized)) {
      return { sql: "FALSE", value: false };
    }
    return { sql: "NULL", value, error: "Must be true or false." };
  }

  if (type === "date") {
    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) {
      return { sql: "NULL", value, error: "Must be a valid date." };
    }
    return { sql: escapeLiteral(value), value };
  }

  if (type === "unknown") {
    return { sql: value ? escapeLiteral(value) : "NULL", value };
  }

  return { sql: escapeLiteral(value), value };
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function RowEditor({ tableName, columns }: RowEditorProps) {
  const [rowIndexInput, setRowIndexInput] = useState("0");
  const [loadedRow, setLoadedRow] = useState<LoadedRow | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function loadRow() {
    const rowIndex = Number(rowIndexInput);
    if (!Number.isInteger(rowIndex) || rowIndex < 0) {
      setStatus("Row index must be zero or greater.");
      return;
    }

    setIsBusy(true);
    setStatus(null);

    try {
      const rows = await runQuery(
        `SELECT rowid AS "__datalens_rowid", * FROM ${quoteIdentifier(tableName)} LIMIT 1 OFFSET ${rowIndex}`,
      );
      const firstRow = rows[0];
      if (!firstRow) {
        setStatus("No row found at that index.");
        return;
      }

      const rowId = Number(firstRow.__datalens_rowid);
      const values = Object.fromEntries(
        Object.entries(firstRow).filter(([key]) => key !== "__datalens_rowid"),
      );

      setLoadedRow({ rowId, index: rowIndex, values });
      setDraftValues(
        Object.fromEntries(
          columns.map((column) => [column.name, toDraftValue(values[column.name])]),
        ),
      );
      setStatus(`Loaded row ${rowIndex}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Row load failed.";
      setStatus(message);
    } finally {
      setIsBusy(false);
    }
  }

  function updateDraft(columnName: string, value: string) {
    setDraftValues((current) => ({ ...current, [columnName]: value }));
  }

  async function saveRow() {
    if (!loadedRow) {
      setStatus("Load a row before saving changes.");
      return;
    }

    const assignments: string[] = [];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const changedColumns: string[] = [];

    for (const column of columns) {
      const draftValue = draftValues[column.name] ?? "";
      const originalValue = loadedRow.values[column.name];
      const parsed = parseCellValue(draftValue, column.type);

      if (parsed.error) {
        setStatus(`${column.name}: ${parsed.error}`);
        return;
      }

      const originalText = toDraftValue(originalValue);
      if (draftValue !== originalText) {
        assignments.push(`${quoteIdentifier(column.name)} = ${parsed.sql}`);
        before[column.name] = originalValue;
        after[column.name] = parsed.value;
        changedColumns.push(column.name);
      }
    }

    if (assignments.length === 0) {
      setStatus("No cell changes to save.");
      return;
    }

    setIsBusy(true);
    setStatus(null);

    try {
      await runQuery(
        `UPDATE ${quoteIdentifier(tableName)} SET ${assignments.join(", ")} WHERE rowid = ${loadedRow.rowId}`,
      );

      const nextLoadedRow: LoadedRow = {
        ...loadedRow,
        values: { ...loadedRow.values, ...after },
      };

      setLoadedRow(nextLoadedRow);
      setAuditLog((current) => [
        {
          id: createId(),
          rowId: loadedRow.rowId,
          rowIndex: loadedRow.index,
          before,
          after,
          changedColumns,
          timestamp: Date.now(),
          undone: false,
        },
        ...current,
      ]);
      setStatus(`Saved ${changedColumns.length} edited field(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Row update failed.";
      setStatus(message);
    } finally {
      setIsBusy(false);
    }
  }

  async function undoLastEdit() {
    const lastEdit = auditLog.find((entry) => !entry.undone);
    if (!lastEdit) {
      setStatus("No row edit available to undo.");
      return;
    }

    const assignments = Object.entries(lastEdit.before).map(([columnName, value]) => {
      const columnType = columns.find((column) => column.name === columnName)?.type ?? "string";
      const parsed = parseCellValue(toDraftValue(value), columnType);
      return `${quoteIdentifier(columnName)} = ${parsed.sql}`;
    });

    setIsBusy(true);
    setStatus(null);

    try {
      await runQuery(
        `UPDATE ${quoteIdentifier(tableName)} SET ${assignments.join(", ")} WHERE rowid = ${lastEdit.rowId}`,
      );

      setAuditLog((current) =>
        current.map((entry) =>
          entry.id === lastEdit.id ? { ...entry, undone: true } : entry,
        ),
      );

      if (loadedRow && loadedRow.rowId === lastEdit.rowId) {
        const revertedValues = { ...loadedRow.values, ...lastEdit.before };
        setLoadedRow({ ...loadedRow, values: revertedValues });
        setDraftValues(
          Object.fromEntries(
            columns.map((column) => [
              column.name,
              toDraftValue(revertedValues[column.name]),
            ]),
          ),
        );
      }

      setStatus("Undid the last row edit.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Undo failed.";
      setStatus(message);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: PANEL_EASE }}
      className={`overflow-hidden rounded-[2rem] ${GLASS_PANEL}`}
    >
      <div className="border-b border-white/15 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700 dark:text-sky-300">
            <PencilLine className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
              Row editor
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">
              Edit individual rows in {tableName}
            </h2>
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-5 py-5 xl:grid-cols-[1fr_0.95fr]">
        <div className="space-y-4">
          <div className="rounded-[1.75rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/35">
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[180px] flex-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Row index
                </span>
                <input
                  value={rowIndexInput}
                  onChange={(event) => setRowIndexInput(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/15 bg-white/75 px-4 py-3 text-sm text-slate-950 outline-none focus:border-sky-400 dark:bg-slate-950/55 dark:text-slate-50"
                />
              </label>

              <button
                type="button"
                onClick={() => void loadRow()}
                disabled={isBusy}
                className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                <Search className="h-4 w-4" />
                Load row
              </button>

              <button
                type="button"
                onClick={() => void saveRow()}
                disabled={!loadedRow || isBusy}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/70 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-950/40 dark:text-slate-200"
              >
                <Save className="h-4 w-4" />
                Save changes
              </button>

              <button
                type="button"
                onClick={() => void undoLastEdit()}
                disabled={!auditLog.some((entry) => !entry.undone) || isBusy}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/70 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-950/40 dark:text-slate-200"
              >
                <RotateCcw className="h-4 w-4" />
                Undo last edit
              </button>
            </div>

            {status ? (
              <p className="mt-4 rounded-2xl bg-sky-500/10 px-4 py-3 text-sm text-sky-700 dark:text-sky-300">
                {status}
              </p>
            ) : null}
          </div>

          <div className="rounded-[1.75rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/35">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Editable fields
            </h3>

            {loadedRow ? (
              <div className="mt-4 space-y-3">
                {columns.map((column) => (
                  <label
                    key={column.name}
                    className="grid gap-3 rounded-2xl border border-white/15 bg-white/55 p-3 dark:bg-slate-950/30 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                  >
                    <div>
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {column.name}
                      </span>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        {column.type}
                      </p>
                    </div>
                    <input
                      value={draftValues[column.name] ?? ""}
                      onChange={(event) =>
                        updateDraft(column.name, event.target.value)
                      }
                      aria-label={`Edit ${column.name}`}
                      className="rounded-2xl border border-white/15 bg-white/80 px-4 py-3 text-sm text-slate-950 outline-none focus:border-sky-400 dark:bg-slate-950/55 dark:text-slate-50"
                    />
                  </label>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-white/20 px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                Load a row index to start inline editing.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/35">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <History className="h-4 w-4 text-sky-600" />
            Audit log
          </div>

          <div className="mt-4 space-y-3">
            {auditLog.length > 0 ? (
              auditLog.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-2xl border border-white/15 bg-white/55 p-4 dark:bg-slate-950/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Row {entry.rowIndex}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        {formatTimestamp(entry.timestamp)}
                      </p>
                    </div>
                    <div
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        entry.undone
                          ? "bg-slate-500/10 text-slate-600 dark:text-slate-300"
                          : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      }`}
                    >
                      {entry.undone ? "undone" : "saved"}
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                    Changed columns: {entry.changedColumns.join(", ")}
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/20 px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                Saved edits will appear here with undo status.
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
