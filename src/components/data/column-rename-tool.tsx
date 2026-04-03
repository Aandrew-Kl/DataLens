"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, RotateCcw, Save, Wand2 } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import type { ColumnProfile } from "@/types/dataset";

interface ColumnRenameToolProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface RenameItem {
  from: string;
  to: string;
}

const GLASS_PANEL =
  "bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 border border-white/20";
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function buildInitialDrafts(columns: ColumnProfile[]): Record<string, string> {
  return Object.fromEntries(columns.map((column) => [column.name, column.name]));
}

function buildPlan(
  columns: ColumnProfile[],
  drafts: Record<string, string>,
): { items: RenameItem[]; errors: string[] } {
  const items = columns.map((column) => ({
    from: column.name,
    to: (drafts[column.name] ?? column.name).trim(),
  }));
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (!item.to) {
      errors.push(`"${item.from}" cannot be blank.`);
      continue;
    }

    const normalized = item.to.toLowerCase();
    if (seen.has(normalized)) {
      errors.push(`"${item.to}" is duplicated.`);
      continue;
    }

    seen.add(normalized);
  }

  return {
    items: items.filter((item) => item.from !== item.to),
    errors,
  };
}

export default function ColumnRenameTool({
  tableName,
  columns,
}: ColumnRenameToolProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    buildInitialDrafts(columns),
  );
  const [lastApplied, setLastApplied] = useState<RenameItem[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const plan = useMemo(() => buildPlan(columns, drafts), [columns, drafts]);

  function updateDraft(columnName: string, value: string) {
    setDrafts((current) => ({ ...current, [columnName]: value }));
    setStatus(null);
  }

  function resetDrafts() {
    setDrafts(buildInitialDrafts(columns));
    setStatus("Draft mapping reset.");
  }

  async function applyRenamePlan() {
    if (plan.errors.length > 0 || plan.items.length === 0) {
      return;
    }

    setIsSubmitting(true);
    setStatus(null);

    try {
      for (const item of plan.items) {
        await runQuery(
          `ALTER TABLE ${quoteIdentifier(tableName)} RENAME COLUMN ${quoteIdentifier(item.from)} TO ${quoteIdentifier(item.to)}`,
        );
      }

      setLastApplied(plan.items);
      setStatus(`Applied ${plan.items.length} column rename(s).`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Column rename failed.";
      setStatus(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function undoLastRename() {
    if (lastApplied.length === 0) {
      return;
    }

    setIsSubmitting(true);
    setStatus(null);

    try {
      for (const item of [...lastApplied].reverse()) {
        await runQuery(
          `ALTER TABLE ${quoteIdentifier(tableName)} RENAME COLUMN ${quoteIdentifier(item.to)} TO ${quoteIdentifier(item.from)}`,
        );
      }

      setDrafts(buildInitialDrafts(columns));
      setLastApplied([]);
      setStatus("Undid the last rename batch.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Undo rename failed.";
      setStatus(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function exportMapping() {
    downloadFile(
      JSON.stringify(plan.items, null, 2),
      `${tableName}-rename-map.json`,
      "application/json;charset=utf-8;",
    );
    setStatus("Exported rename mapping.");
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: PANEL_EASE }}
      className={`overflow-hidden rounded-[2rem] ${GLASS_PANEL}`}
    >
      <div className="border-b border-white/15 px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
              Column rename tool
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">
              Batch rename columns in {tableName}
            </h2>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={resetDrafts}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/70 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-white/90 dark:bg-slate-950/40 dark:text-slate-200"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
            <button
              type="button"
              onClick={exportMapping}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/70 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-white/90 dark:bg-slate-950/40 dark:text-slate-200"
            >
              <Download className="h-4 w-4" />
              Export JSON
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-5 py-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-3">
          {columns.map((column) => (
            <div
              key={column.name}
              className="grid gap-3 rounded-[1.5rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/35 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  Current name
                </p>
                <p className="mt-2 rounded-2xl bg-white/70 px-4 py-3 font-mono text-sm text-slate-900 dark:bg-slate-950/45 dark:text-slate-100">
                  {column.name}
                </p>
              </div>

              <label>
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  New name
                </span>
                <input
                  value={drafts[column.name] ?? column.name}
                  onChange={(event) =>
                    updateDraft(column.name, event.target.value)
                  }
                  className="mt-2 w-full rounded-2xl border border-white/15 bg-white/75 px-4 py-3 font-mono text-sm text-slate-950 outline-none focus:border-sky-400 dark:bg-slate-950/55 dark:text-slate-50"
                />
              </label>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <div className="rounded-[1.75rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/35">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Wand2 className="h-4 w-4 text-sky-600" />
              Preview mapping
            </div>

            {plan.errors.length > 0 ? (
              <div className="mt-4 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                {plan.errors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            ) : null}

            <div className="mt-4 space-y-3">
              {plan.items.length > 0 ? (
                plan.items.map((item) => (
                  <div
                    key={item.from}
                    className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-white/15 bg-white/60 px-4 py-3 dark:bg-slate-950/35"
                  >
                    <span className="truncate font-mono text-sm text-slate-700 dark:text-slate-200">
                      {item.from}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                      to
                    </span>
                    <span className="truncate font-mono text-sm text-sky-700 dark:text-sky-300">
                      {item.to}
                    </span>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/20 px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  Edit one or more names to preview the rename map.
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 rounded-[1.75rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/35">
            <button
              type="button"
              onClick={() => void applyRenamePlan()}
              disabled={plan.items.length === 0 || plan.errors.length > 0 || isSubmitting}
              className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              <Save className="h-4 w-4" />
              Apply rename
            </button>

            <button
              type="button"
              onClick={() => void undoLastRename()}
              disabled={lastApplied.length === 0 || isSubmitting}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/70 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-950/40 dark:text-slate-200"
            >
              <RotateCcw className="h-4 w-4" />
              Undo last batch
            </button>
          </div>

          {status ? (
            <p className="rounded-2xl bg-sky-500/10 px-4 py-3 text-sm text-sky-700 dark:text-sky-300">
              {status}
            </p>
          ) : null}
        </div>
      </div>
    </motion.section>
  );
}
