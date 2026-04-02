"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, CheckCircle2, Eye, Loader2, RefreshCw, Sparkles, Type, Wand2 } from "lucide-react";
import type { ColumnProfile } from "@/types/dataset";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";

interface ColumnRenamerProps { tableName: string; columns: ColumnProfile[]; onComplete: () => void; }
type StatusState = { kind: "success" | "error"; message: string } | null;
type Strategy = "alter" | "ctas";
type PlanItem = { current: string; next: string; type: ColumnProfile["type"] };

const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
const errorMessage = (error: unknown) => error instanceof Error && error.message ? error.message : "DuckDB could not rename the selected columns.";
const splitWords = (value: string) => value.trim().replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
const snakeCase = (value: string) => splitWords(value).map((word) => word.toLowerCase()).join("_");
const camelCase = (value: string) => {
  const words = splitWords(value);
  return !words.length ? "" : words[0].toLowerCase() + words.slice(1).map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join("");
};
const PRESETS = [
  { label: "lowercase", icon: Type, run: (value: string) => value.toLowerCase() },
  { label: "UPPERCASE", icon: Sparkles, run: (value: string) => value.toUpperCase() },
  { label: "snake_case", icon: ArrowRight, run: snakeCase },
  { label: "camelCase", icon: Wand2, run: camelCase },
  { label: "trim whitespace", icon: RefreshCw, run: (value: string) => value.trim() },
] as const;

function buildProjection(items: PlanItem[]) {
  return items.map((item) => `${quote(item.current)} AS ${quote(item.next)}`).join(", ");
}

function buildPlan(tableName: string, columns: ColumnProfile[], drafts: Record<string, string>) {
  const items = columns.map((column) => ({ current: column.name, next: (drafts[column.name] ?? column.name).trim(), type: column.type }));
  const errors: string[] = [];
  const seen = new Map<string, string>();
  for (const item of items) {
    if (!item.next) { errors.push(`"${item.current}" cannot be blank.`); continue; }
    const key = item.next.toLowerCase();
    const clash = seen.get(key);
    if (clash) errors.push(`"${item.next}" would duplicate "${clash}".`);
    else seen.set(key, item.current);
  }
  const changes = items.filter((item) => item.current !== item.next);
  const originalKeys = new Set(columns.map((column) => column.name.toLowerCase()));
  const strategy: Strategy = changes.length > 0 && changes.every((item) => item.next.toLowerCase() !== item.current.toLowerCase() && !originalKeys.has(item.next.toLowerCase())) ? "alter" : "ctas";
  const sqlPreview = strategy === "alter"
    ? changes.map((item) => `ALTER TABLE ${quote(tableName)} RENAME COLUMN ${quote(item.current)} TO ${quote(item.next)};`).join("\n")
    : [
        `CREATE TABLE <temp_renamed_table> AS SELECT ${buildProjection(items)} FROM ${quote(tableName)};`,
        `ALTER TABLE ${quote(tableName)} RENAME TO <backup_table>;`,
        `ALTER TABLE <temp_renamed_table> RENAME TO ${quote(tableName)};`,
        `DROP TABLE <backup_table>;`,
      ].join("\n");
  return { items, changes, errors, valid: errors.length === 0, strategy, sqlPreview };
}

export default function ColumnRenamer({ tableName, columns, onComplete }: ColumnRenamerProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<StatusState>(null);
  useEffect(() => { setDrafts(Object.fromEntries(columns.map((column) => [column.name, column.name]))); }, [columns]);
  const plan = useMemo(() => buildPlan(tableName, columns, drafts), [tableName, columns, drafts]);

  function updateDraft(columnName: string, value: string) {
    setDrafts((current) => ({ ...current, [columnName]: value }));
    setStatus(null);
  }

  function resetDrafts() {
    setDrafts(Object.fromEntries(columns.map((column) => [column.name, column.name])));
    setStatus(null);
  }

  function applyPreset(transform: (value: string) => string) {
    setDrafts((current) => Object.fromEntries(columns.map((column) => [column.name, transform(current[column.name] ?? column.name)])));
    setStatus(null);
  }

  async function handleApply() {
    if (!plan.valid || !plan.changes.length) return;
    setSubmitting(true);
    setStatus(null);
    try {
      if (plan.strategy === "alter") {
        for (const item of plan.changes) await runQuery(`ALTER TABLE ${quote(tableName)} RENAME COLUMN ${quote(item.current)} TO ${quote(item.next)}`);
      } else {
        const stamp = Date.now();
        const originalSql = quote(tableName);
        const tempSql = quote(`${tableName}__renamed_${stamp}`);
        const backupSql = quote(`${tableName}__rename_backup_${stamp}`);
        await runQuery(`DROP TABLE IF EXISTS ${tempSql}`);
        await runQuery(`DROP TABLE IF EXISTS ${backupSql}`);
        await runQuery(`CREATE TABLE ${tempSql} AS SELECT ${buildProjection(plan.items)} FROM ${originalSql}`);
        await runQuery(`ALTER TABLE ${originalSql} RENAME TO ${backupSql}`);
        try {
          await runQuery(`ALTER TABLE ${tempSql} RENAME TO ${originalSql}`);
          await runQuery(`DROP TABLE ${backupSql}`);
        } catch (swapError) {
          await runQuery(`ALTER TABLE ${backupSql} RENAME TO ${originalSql}`).catch(() => undefined);
          await runQuery(`DROP TABLE IF EXISTS ${tempSql}`).catch(() => undefined);
          throw swapError;
        }
      }
      setStatus({ kind: "success", message: `Renamed ${plan.changes.length} column${plan.changes.length === 1 ? "" : "s"} in ${tableName}.` });
      onComplete();
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
      className="overflow-hidden rounded-3xl border border-gray-200/70 bg-white/85 shadow-sm backdrop-blur-sm dark:border-gray-800/80 dark:bg-gray-950/45"
    >
      <div className="border-b border-gray-200/70 px-5 py-5 dark:border-gray-800/80">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-700 dark:text-sky-300">
              <Wand2 className="h-3.5 w-3.5" />
              Batch Column Renamer
            </div>
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
              Edit output names for <span className="font-mono text-gray-900 dark:text-gray-100">{tableName}</span>, preview the rename batch, then apply it with {plan.strategy === "alter" ? "direct ALTER statements" : "a CTAS table swap"}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(({ label, icon: Icon, run }) => (
              <button
                key={label}
                onClick={() => applyPreset(run)}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition hover:border-sky-300 hover:text-sky-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-sky-700 dark:hover:text-sky-300"
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
            <button
              onClick={resetDrafts}
              className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[1.08fr_0.92fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
            <span>{formatNumber(columns.length)} columns</span>
            <span>{plan.changes.length} pending changes</span>
          </div>
          <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
            {plan.items.map((item, index) => (
              <motion.div
                key={item.current}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.02, duration: 0.18 }}
                className={`rounded-2xl border p-4 ${item.current === item.next ? "border-gray-200/70 bg-gray-50/60 dark:border-gray-800/80 dark:bg-gray-950/20" : "border-sky-300/60 bg-sky-500/10 dark:border-sky-700/60 dark:bg-sky-500/10"}`}
              >
                <div className="flex items-center justify-between gap-3 text-xs font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                  <span className="inline-flex items-center gap-2"><Type className="h-3.5 w-3.5" />{item.type}</span>
                  {item.current !== item.next && <span className="rounded-full bg-sky-500/15 px-2 py-1 text-sky-700 dark:text-sky-300">changed</span>}
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
                  <div className="rounded-xl border border-gray-200/70 bg-white px-3 py-2 font-mono text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">{item.current}</div>
                  <ArrowRight className="h-4 w-4 text-sky-500" />
                  <input
                    value={drafts[item.current] ?? item.current}
                    onChange={(event) => updateDraft(item.current, event.target.value)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-gray-900 outline-none transition focus:border-sky-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200/70 bg-gray-50/70 p-4 dark:border-gray-800/80 dark:bg-gray-950/25">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100"><Eye className="h-4 w-4 text-sky-500" />Preview Before Apply</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Final output names are trimmed before validation and execution.</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${plan.strategy === "alter" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
                {plan.strategy === "alter" ? "ALTER TABLE" : "CTAS swap"}
              </span>
            </div>

            {plan.errors.length > 0 && (
              <div className="mt-4 rounded-2xl border border-red-300/60 bg-red-500/10 p-3 text-sm text-red-800 dark:border-red-500/30 dark:text-red-300">
                {plan.errors.map((message) => (
                  <div key={message} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{message}</span></div>
                ))}
              </div>
            )}

            <div className="mt-4 rounded-2xl border border-gray-200/70 bg-white/70 p-3 dark:border-gray-800/80 dark:bg-gray-950/30">
              <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                <span>Rename map</span>
                <span>{plan.changes.length ? `${plan.changes.length} updates` : "No-op"}</span>
              </div>
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {plan.changes.length ? (
                  plan.changes.map((item) => (
                    <div key={item.current} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-gray-200/70 px-3 py-2 dark:border-gray-800/80">
                      <span className="truncate font-mono text-xs text-gray-700 dark:text-gray-200">{item.current}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-sky-500" />
                      <span className="truncate font-mono text-xs text-sky-700 dark:text-sky-300">{item.next}</span>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-300/70 px-3 py-4 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    Edit one or more target names to build the batch preview.
                  </div>
                )}
              </div>
            </div>

            <pre className="mt-4 overflow-x-auto rounded-2xl bg-gray-950 px-4 py-3 text-xs text-gray-100">{plan.changes.length ? plan.sqlPreview : "-- No column names changed yet --"}</pre>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200/70 bg-white/70 p-4 dark:border-gray-800/80 dark:bg-gray-950/25">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Apply rename batch</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">This updates the underlying DuckDB table in place.</p>
            </div>
            <button
              onClick={handleApply}
              disabled={!plan.valid || !plan.changes.length || submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-gray-400 dark:disabled:bg-gray-700"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Apply {plan.changes.length ? `(${plan.changes.length})` : ""}
            </button>
          </div>
        </div>
      </div>

      {status && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`border-t px-5 py-4 text-sm ${status.kind === "success" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : "border-red-500/20 bg-red-500/10 text-red-800 dark:text-red-300"}`}
        >
          {status.message}
        </motion.div>
      )}
    </motion.section>
  );
}
