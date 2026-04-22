"use client";

import { Check, Copy, Download, Loader2, X } from "lucide-react";

interface HeaderProps {
  tableName: string;
  columnName: string;
  copied: boolean;
  exporting: boolean;
  onCopy: () => void;
  onExport: () => void;
  onClose: () => void;
}

export function Header({
  tableName,
  columnName,
  copied,
  exporting,
  onCopy,
  onExport,
  onClose,
}: HeaderProps) {
  return (
    <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 px-5 py-4 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/80">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-600 dark:text-cyan-400">
            Column Deep Dive
          </p>
          <h2 className="mt-2 truncate text-2xl font-semibold text-slate-950 dark:text-white">
            {columnName}
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Full statistical profile for <span className="font-medium">{tableName}</span>, including distribution, quality signals, and type-specific analysis.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-cyan-500/40 dark:hover:text-cyan-300"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy Statistics"}
          </button>
          <button
            type="button"
            onClick={onExport}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-cyan-500/40 dark:hover:text-cyan-300"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export Column
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-rose-300 hover:text-rose-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-rose-500/40 dark:hover:text-rose-300"
          >
            <X className="h-4 w-4" />
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
