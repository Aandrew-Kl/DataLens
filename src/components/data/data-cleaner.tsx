"use client";

import { runQuery } from "@/lib/duckdb/client";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";
import { AnimatePresence, motion } from "framer-motion";
import { DatabaseZap, RotateCcw } from "lucide-react";
import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { CleanerHistory, type HistoryEntry } from "./cleaner-history";
import { CleanerPreview, type PreviewState } from "./cleaner-preview";
import { CleanerRules, actionLabelForIssue, buildNullStrategyMap, loadIssuePreview, quoteId, scanDataIssues, selectSqlForIssue, type DataIssue, type Notice, type NullStrategy, type Severity } from "./cleaner-rules";

export { CleanerHistory } from "./cleaner-history";
export type { HistoryEntry } from "./cleaner-history";
export { CleanerPreview } from "./cleaner-preview";
export type { PreviewSample, PreviewState } from "./cleaner-preview";
export { CleanerRules, actionLabelForIssue, buildNullStrategyMap, defaultNullStrategy, loadIssuePreview, quoteId, scanDataIssues, selectSqlForIssue } from "./cleaner-rules";
export type { DataIssue, InferredType, IssueType, Notice, NullStrategy, Severity, TypeCandidate } from "./cleaner-rules";

interface DataCleanerProps {
  tableName: string;
  columns: ColumnProfile[];
  onCleanComplete?: () => void;
}

const EASE = [0.16, 1, 0.3, 1] as const;

export default function DataCleaner({ tableName, columns, onCleanComplete }: DataCleanerProps) {
  const [issues, setIssues] = useState<DataIssue[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [taskProgress, setTaskProgress] = useState<{ total: number; done: number; label: string } | null>(null);
  const [nullStrategies, setNullStrategies] = useState<Record<string, NullStrategy>>({});
  const [nullValues, setNullValues] = useState<Record<string, string>>({});
  const columnMap = useMemo(() => new Map(columns.map((column) => [column.name, column])), [columns]);
  const summary = useMemo(
    () => ({ issuesFound: issues.length, issuesFixed: history.length, rowsAffected: history.reduce((sum, entry) => sum + entry.affectedRows, 0) }),
    [history, issues.length],
  );
  const progressPercent = useMemo(() => {
    if (taskProgress) return taskProgress.total ? (taskProgress.done / taskProgress.total) * 100 : 0;
    const total = summary.issuesFound + summary.issuesFixed;
    return total ? (summary.issuesFixed / total) * 100 : 100;
  }, [summary, taskProgress]);

  async function rewriteTable(selectSql: string, label: string, issueId: string, affectedRows: number) {
    const sourceSql = quoteId(tableName);
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const tempTable = quoteId(`${tableName}__clean_${stamp}`);
    const backupTableName = `${tableName}__backup_${stamp}`;
    const backupSql = quoteId(backupTableName);
    await runQuery(`DROP TABLE IF EXISTS ${tempTable}`);
    await runQuery(`DROP TABLE IF EXISTS ${backupSql}`);
    await runQuery(`CREATE TABLE ${tempTable} AS ${selectSql}`);
    await runQuery(`ALTER TABLE ${sourceSql} RENAME TO ${backupSql}`);
    try {
      await runQuery(`ALTER TABLE ${tempTable} RENAME TO ${sourceSql}`);
      const entry: HistoryEntry = { id: stamp, issueId, label, affectedRows, backupTable: backupTableName, createdAt: Date.now() };
      startTransition(() => setHistory((current) => [entry, ...current]));
      return entry;
    } catch (error) {
      await runQuery(`ALTER TABLE ${backupSql} RENAME TO ${sourceSql}`).catch(() => undefined);
      await runQuery(`DROP TABLE IF EXISTS ${tempTable}`).catch(() => undefined);
      throw error;
    }
  }

  async function restoreHistoryEntry(entry: HistoryEntry) {
    const sourceSql = quoteId(tableName);
    const backupSql = quoteId(entry.backupTable);
    const tempSql = quoteId(`${tableName}__restore_${Date.now()}`);
    await runQuery(`ALTER TABLE ${sourceSql} RENAME TO ${tempSql}`);
    try {
      await runQuery(`ALTER TABLE ${backupSql} RENAME TO ${sourceSql}`);
      await runQuery(`DROP TABLE ${tempSql}`);
    } catch (error) {
      await runQuery(`ALTER TABLE ${tempSql} RENAME TO ${sourceSql}`).catch(() => undefined);
      throw error;
    }
  }

  const scanIssues = useCallback(async () => {
    if (!tableName || !columns.length) {
      setIssues([]);
      setRowCount(0);
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const result = await scanDataIssues(tableName, columns);
      startTransition(() => {
        setIssues(result.issues);
        setRowCount(result.rowCount);
        setNullStrategies((current) => buildNullStrategyMap(columns, current));
      });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Failed to scan data quality issues." });
    } finally {
      setLoading(false);
    }
  }, [columns, tableName]);

  useEffect(() => void scanIssues(), [scanIssues]);

  async function handlePreview(issue: DataIssue) {
    setPreviewLoading(issue.id);
    setNotice(null);
    try {
      setPreview(await loadIssuePreview(tableName, columns, issue, nullStrategies, nullValues));
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Failed to build the preview." });
    } finally {
      setPreviewLoading(null);
    }
  }

  async function applyIssue(issue: DataIssue, refreshAfter = true) {
    const label = actionLabelForIssue(issue);
    const selectSql = selectSqlForIssue(tableName, columns, issue, nullStrategies, nullValues);
    await rewriteTable(selectSql, label, issue.id, issue.affectedRows);
    if (refreshAfter) await scanIssues();
  }

  async function handleApplyIssue(issue: DataIssue) {
    setBusy(true);
    setNotice(null);
    try {
      await applyIssue(issue);
      setNotice({ tone: "success", message: `${issue.suggestedFix} Applied to ${tableName}.` });
      onCleanComplete?.();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Failed to apply the cleaning fix." });
    } finally {
      setBusy(false);
    }
  }

  async function handleBulkApply(severity: Exclude<Severity, "info">) {
    const targets = issues.filter((issue) => issue.severity === severity);
    if (!targets.length) {
      setNotice({ tone: "info", message: `No ${severity} issues are available.` });
      return;
    }
    setBusy(true);
    setTaskProgress({ total: targets.length, done: 0, label: "Preparing" });
    try {
      for (const [index, issue] of targets.entries()) {
        setTaskProgress({ total: targets.length, done: index, label: issue.columnName });
        await applyIssue(issue, false);
      }
      setTaskProgress({ total: targets.length, done: targets.length, label: "Done" });
      await scanIssues();
      setNotice({ tone: "success", message: `Applied ${targets.length} ${severity} fixes.` });
      onCleanComplete?.();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : `Failed to apply ${severity} fixes.` });
    } finally {
      setBusy(false);
      setTimeout(() => setTaskProgress(null), 450);
    }
  }

  async function handleUndoLatest() {
    const latest = history[0];
    if (!latest) return;
    setBusy(true);
    setNotice(null);
    try {
      await restoreHistoryEntry(latest);
      startTransition(() => setHistory((current) => current.slice(1)));
      await scanIssues();
      setNotice({ tone: "success", message: `Reverted: ${latest.label}.` });
      onCleanComplete?.();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Failed to undo the latest fix." });
    } finally {
      setBusy(false);
    }
  }

  async function handleResetAll() {
    if (!history.length) return;
    setBusy(true);
    setTaskProgress({ total: history.length, done: 0, label: "Resetting" });
    try {
      for (const [index, entry] of history.entries()) {
        setTaskProgress({ total: history.length, done: index, label: entry.label });
        await restoreHistoryEntry(entry);
      }
      setHistory([]);
      setPreview(null);
      setTaskProgress({ total: history.length, done: history.length, label: "Done" });
      await scanIssues();
      setNotice({ tone: "success", message: "Reverted every applied cleaning step." });
      onCleanComplete?.();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Failed to reset the cleaning history." });
    } finally {
      setBusy(false);
      setTimeout(() => setTaskProgress(null), 450);
    }
  }

  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE }} className="overflow-hidden rounded-3xl border border-white/15 bg-white/10 shadow-2xl shadow-slate-950/15 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
              <DatabaseZap className="h-3.5 w-3.5" />
              Data Cleaner
            </div>
            <h2 className="mt-3 text-xl font-semibold text-slate-950 dark:text-slate-50">Interactive cleaning workbench for {tableName}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Scan the dataset for nulls, duplicates, outliers, whitespace drift, and type mismatches, preview the SQL fix, then rewrite the DuckDB table in place.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void handleBulkApply("critical")} disabled={busy || loading} className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300">Fix All Critical</button>
            <button type="button" onClick={() => void handleBulkApply("warning")} disabled={busy || loading} className="rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-300">Fix All Warnings</button>
            <button type="button" onClick={() => void handleResetAll()} disabled={busy || !history.length} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200">
              <RotateCcw className="h-4 w-4" />
              Reset All
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Rows", value: formatNumber(rowCount) },
            { label: "Issues found", value: formatNumber(summary.issuesFound) },
            { label: "Issues fixed", value: formatNumber(summary.issuesFixed) },
            { label: "Rows affected", value: formatNumber(summary.rowsAffected) },
          ].map((card) => (
            <div key={card.label} className="rounded-2xl border border-white/10 bg-white/10 p-4 dark:bg-slate-950/35">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{card.label}</p>
              <p className="mt-3 text-2xl font-semibold text-slate-950 dark:text-slate-50">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>{taskProgress ? taskProgress.label : "Cleaning progress"}</span>
            <span>{formatPercent(progressPercent, 0)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200/60 dark:bg-slate-800/80">
            <motion.div animate={{ width: `${progressPercent}%` }} transition={{ duration: 0.24, ease: EASE }} className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-sky-500 to-emerald-400" />
          </div>
        </div>
      </div>

      <div className="grid gap-6 p-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <AnimatePresence mode="wait">
            {notice && (
              <motion.div key={notice.message} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2, ease: EASE }} className={`rounded-2xl border px-4 py-3 text-sm ${notice.tone === "success" ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : notice.tone === "error" ? "border-red-400/25 bg-red-500/10 text-red-700 dark:text-red-300" : "border-sky-400/25 bg-sky-500/10 text-sky-700 dark:text-sky-300"}`}>
                {notice.message}
              </motion.div>
            )}
          </AnimatePresence>
          <CleanerRules
            busy={busy}
            columnMap={columnMap}
            issues={issues}
            loading={loading}
            nullStrategies={nullStrategies}
            nullValues={nullValues}
            previewLoading={previewLoading}
            setNullStrategies={setNullStrategies}
            setNullValues={setNullValues}
            onApplyIssue={(issue) => void handleApplyIssue(issue)}
            onPreview={(issue) => void handlePreview(issue)}
          />
        </div>

        <div className="space-y-4">
          <CleanerPreview preview={preview} setPreview={setPreview} />
          <CleanerHistory busy={busy} history={history} onUndoLatest={() => void handleUndoLatest()} />
        </div>
      </div>
    </motion.section>
  );
}
