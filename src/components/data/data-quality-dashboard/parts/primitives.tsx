"use client";

import { clampScore, formatPercent, getScoreTone } from "../lib";

export function ScorePill({ score }: { score: number }) {
  return (
    <div
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-[0.16em] uppercase ${getScoreTone(score)} bg-white/65 dark:bg-slate-950/50`}
    >
      {formatPercent(score)}
    </div>
  );
}

export function ScoreBar({
  value,
  color,
}: {
  value: number | null;
  color: string;
}) {
  if (value == null) {
    return <span className="text-xs text-slate-400 dark:text-slate-500">n/a</span>;
  }

  return (
    <div className="min-w-[88px]">
      <div className="flex items-center justify-between gap-3 text-xs font-medium text-slate-600 dark:text-slate-300">
        <span>{formatPercent(value)}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800/80">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(4, clampScore(value))}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}
