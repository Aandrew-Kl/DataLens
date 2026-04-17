"use client";

import { ArrowLeftRight, Columns2, Eraser, GitBranchPlus, Regex, RotateCcw, ScissorsLineDashed, Sparkles, WandSparkles } from "lucide-react";
import { formatNumber } from "@/lib/utils/formatters";

export type OperationType = "split" | "merge" | "fill" | "dates" | "regex" | "trim" | "dedupe";
export type StatusState = { tone: "success" | "error" | "info"; message: string } | null;

const TAB_META: Array<{ key: OperationType; label: string; Icon: typeof ScissorsLineDashed }> = [
  { key: "split", label: "Split column", Icon: ScissorsLineDashed },
  { key: "merge", label: "Merge columns", Icon: Columns2 },
  { key: "fill", label: "Fill nulls", Icon: WandSparkles },
  { key: "dates", label: "Parse dates", Icon: Sparkles },
  { key: "regex", label: "Regex extract", Icon: Regex },
  { key: "trim", label: "Trim whitespace", Icon: Eraser },
  { key: "dedupe", label: "Remove duplicates", Icon: GitBranchPlus },
] as const;

function OperationToggle({
  active,
  label,
  Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  Icon: typeof ScissorsLineDashed;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition ${
        active
          ? "border-cyan-400/45 bg-cyan-500/12 text-cyan-700 dark:text-cyan-200"
          : "border-white/12 bg-white/35 text-slate-600 hover:border-cyan-300/28 dark:border-white/10 dark:bg-slate-950/30 dark:text-slate-300"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

interface WranglerToolbarProps {
  activeTab: OperationType;
  busy: boolean;
  columnsLength: number;
  hasUndoableEntry: boolean;
  status: StatusState;
  onTabChange: (tab: OperationType) => void;
  onUndoLatest: () => void;
}

export function WranglerToolbar({
  activeTab,
  busy,
  columnsLength,
  hasUndoableEntry,
  status,
  onTabChange,
  onUndoLatest,
}: WranglerToolbarProps) {
  return (
    <>
      <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
            <ArrowLeftRight className="h-3.5 w-3.5" />
            SQL-backed cleaning
          </div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Data wrangler</h2>
          <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">
            Chain DuckDB-powered column transforms, preview the first ten rows before committing, and undo the latest applied step when needed.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-2xl border border-white/15 bg-white/45 px-4 py-3 dark:border-white/10 dark:bg-slate-950/35">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Columns</div>
            <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{formatNumber(columnsLength)}</div>
          </div>
          <button
            type="button"
            onClick={onUndoLatest}
            disabled={!hasUndoableEntry || busy}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/50 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-100"
          >
            <RotateCcw className="h-4 w-4" />
            Undo latest
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {TAB_META.map(({ key, label, Icon }) => (
          <OperationToggle key={key} active={activeTab === key} label={label} Icon={Icon} onClick={() => onTabChange(key)} />
        ))}
      </div>

      {status ? (
        <div
          className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${
            status.tone === "error"
              ? "border-rose-400/35 bg-rose-500/10 text-rose-700 dark:text-rose-300"
              : status.tone === "success"
                ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-cyan-400/35 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
          }`}
        >
          {status.message}
        </div>
      ) : null}
    </>
  );
}
