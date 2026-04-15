"use client";

import { History, RotateCcw } from "lucide-react";
import { formatNumber } from "@/lib/utils/formatters";

export interface HistoryEntry {
  id: string;
  issueId: string;
  label: string;
  affectedRows: number;
  backupTable: string;
  createdAt: number;
}

interface CleanerHistoryProps {
  busy: boolean;
  history: HistoryEntry[];
  onUndoLatest: () => void;
}

export function CleanerHistory({ busy, history, onUndoLatest }: CleanerHistoryProps) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-50">
            <History className="h-4 w-4 text-cyan-500" />
            History and Undo
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Latest change can be reverted in place.</p>
        </div>
        <button
          type="button"
          onClick={onUndoLatest}
          disabled={busy || !history.length}
          className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200"
        >
          <RotateCcw className="h-4 w-4" />
          Undo
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {history.length ? (
          history.map((entry, index) => (
            <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{entry.label}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {formatNumber(entry.affectedRows)} rows • {new Date(entry.createdAt).toLocaleTimeString()}
                  </p>
                </div>
                {index === 0 ? (
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
                    latest
                  </span>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-sm text-slate-500 dark:text-slate-400">
            Applied fixes will appear here with undo support.
          </div>
        )}
      </div>
    </div>
  );
}
