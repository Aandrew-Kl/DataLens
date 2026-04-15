"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import { Suspense, use, useMemo } from "react";
import { motion } from "framer-motion";
import { Columns2, History, RotateCcw, ScissorsLineDashed } from "lucide-react";
import type { OperationType } from "./wrangler-toolbar";
import type { PreviewRequest } from "./wrangler-filters";

export interface PreviewResult {
  beforeRows: Record<string, unknown>[];
  afterRows: Record<string, unknown>[];
  beforeCount: number;
  afterCount: number;
}

export interface HistoryEntry {
  id: string;
  operation: OperationType;
  label: string;
  sql: string;
  backupTable: string;
  beforeCount: number;
  afterCount: number;
  timestamp: number;
  status: "applied" | "undone";
}

const EASE = [0.22, 1, 0.36, 1] as const;

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadPreview(tableName: string, request: PreviewRequest): Promise<PreviewResult> {
  const [beforeRows, afterRows, beforeCountRows, afterCountRows] = await Promise.all([
    runQuery(`SELECT * FROM ${quoteIdentifier(tableName)} LIMIT 10`),
    runQuery(`SELECT * FROM (${request.selectSql}) AS preview LIMIT 10`),
    runQuery(`SELECT COUNT(*) AS cnt FROM ${quoteIdentifier(tableName)}`),
    runQuery(`SELECT COUNT(*) AS cnt FROM (${request.selectSql}) AS preview_count`),
  ]);
  return {
    beforeRows,
    afterRows,
    beforeCount: Number(beforeCountRows[0]?.cnt ?? 0),
    afterCount: Number(afterCountRows[0]?.cnt ?? 0),
  };
}

function PreviewTable({ title, rows }: { title: string; rows: Record<string, unknown>[] }) {
  const visibleColumns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );

  return (
    <div className="overflow-hidden rounded-[1.2rem] border border-white/10 bg-white/40 dark:bg-slate-950/35">
      <div className="border-b border-white/10 px-4 py-3 text-sm font-semibold text-slate-950 dark:text-white">{title}</div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-white/70 dark:bg-slate-950/65">
            <tr>
              {visibleColumns.map((column) => (
                <th key={column} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${title}:${index}`} className={index % 2 === 0 ? "bg-white/10" : "bg-slate-100/20 dark:bg-slate-900/18"}>
                {visibleColumns.map((column) => (
                  <td key={`${title}:${index}:${column}`} className="max-w-[16rem] px-4 py-3 text-slate-700 dark:text-slate-200">
                    {row[column] == null ? (
                      <span className="rounded-full border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:text-rose-300">null</span>
                    ) : (
                      <span className="line-clamp-2 break-words">{String(row[column])}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PreviewContent({ tableName, request }: { tableName: string; request: PreviewRequest }) {
  const previewPromise = useMemo(() => loadPreview(tableName, request), [request, tableName]);
  const preview = use(previewPromise);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/40 px-4 py-3 dark:bg-slate-950/35">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Before</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">{formatNumber(preview.beforeCount)}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/40 px-4 py-3 dark:bg-slate-950/35">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">After</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">{formatNumber(preview.afterCount)}</div>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <PreviewTable title="Before preview" rows={preview.beforeRows} />
        <PreviewTable title="After preview" rows={preview.afterRows} />
      </div>
    </div>
  );
}

function PreviewFallback() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-20 animate-pulse rounded-2xl bg-white/35 dark:bg-slate-800/55" />
        <div className="h-20 animate-pulse rounded-2xl bg-white/35 dark:bg-slate-800/55" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="h-64 animate-pulse rounded-[1.2rem] bg-white/30 dark:bg-slate-800/50" />
        <div className="h-64 animate-pulse rounded-[1.2rem] bg-white/30 dark:bg-slate-800/50" />
      </div>
    </div>
  );
}

interface WranglerGridProps {
  tableName: string;
  previewRequest: PreviewRequest | null;
  history: HistoryEntry[];
  latestUndoableEntry: HistoryEntry | null;
  busy: boolean;
  onUndoLatest: () => void;
  showHistory?: boolean;
  showPreview?: boolean;
}

export function WranglerGrid({
  tableName,
  previewRequest,
  history,
  latestUndoableEntry,
  busy,
  onUndoLatest,
  showHistory = true,
  showPreview = true,
}: WranglerGridProps) {
  return (
    <>
      {showPreview ? <div className="rounded-[1.35rem] border border-white/12 bg-white/45 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/35">
        <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          <Columns2 className="h-3.5 w-3.5" />
          Before / after preview
        </div>
        {previewRequest ? (
          <Suspense fallback={<PreviewFallback />}>
            <PreviewContent tableName={tableName} request={previewRequest} />
          </Suspense>
        ) : (
          <div className="flex min-h-[22rem] flex-col items-center justify-center gap-4 text-center">
            <ScissorsLineDashed className="h-8 w-8 text-slate-400" />
            <div className="space-y-2">
              <p className="text-base font-semibold text-slate-950 dark:text-white">Build an operation and preview it</p>
              <p className="max-w-lg text-sm text-slate-500 dark:text-slate-400">The wrangler runs the transform as DuckDB SQL and renders the first ten rows before and after the change.</p>
            </div>
          </div>
        )}
      </div> : null}

      {showHistory ? <div className="rounded-[1.35rem] border border-white/12 bg-white/45 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/35">
        <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          <History className="h-3.5 w-3.5" />
          Operation history
        </div>

        {history.length === 0 ? (
          <div className="flex min-h-[22rem] flex-col items-center justify-center gap-4 text-center">
            <RotateCcw className="h-8 w-8 text-slate-400" />
            <div className="space-y-2">
              <p className="text-base font-semibold text-slate-950 dark:text-white">No operations applied yet</p>
              <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">Applied SQL transforms will appear here with row count deltas and undo support.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((entry) => {
              const undoable = latestUndoableEntry?.id === entry.id && entry.status === "applied";
              return (
                <motion.article key={entry.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE }} className="overflow-hidden rounded-[1.2rem] border border-white/12 bg-white/40 dark:border-white/10 dark:bg-slate-950/34">
                  <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-950 dark:text-white">{entry.label}</div>
                      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{formatTimestamp(entry.timestamp)}</div>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${entry.status === "applied" ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-slate-500/12 text-slate-600 dark:text-slate-300"}`}>{entry.status}</span>
                  </div>

                  <div className="grid gap-3 border-t border-white/10 px-4 py-4 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-white/35 px-4 py-3 text-sm dark:bg-slate-950/30">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Row delta</div>
                      <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">{formatNumber(entry.beforeCount)} → {formatNumber(entry.afterCount)}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/35 px-4 py-3 text-sm dark:bg-slate-950/30">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Backup table</div>
                      <div className="mt-1 truncate font-mono text-xs text-slate-600 dark:text-slate-300">{entry.backupTable}</div>
                    </div>
                  </div>

                  <pre className="overflow-x-auto border-t border-white/10 bg-slate-950/90 px-4 py-4 text-xs leading-6 text-slate-200">{entry.sql}</pre>

                  {undoable ? (
                    <div className="border-t border-white/10 px-4 py-4">
                      <button type="button" onClick={onUndoLatest} disabled={busy} className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-100">
                        <RotateCcw className="h-4 w-4" />
                        Undo this step
                      </button>
                    </div>
                  ) : null}
                </motion.article>
              );
            })}
          </div>
        )}
      </div> : null}
    </>
  );
}
