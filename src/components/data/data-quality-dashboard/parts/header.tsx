"use client";

import { Shield } from "lucide-react";

import { formatNumber } from "@/lib/utils/formatters";

export function DashboardHeader({
  tableName,
  columnCount,
}: {
  tableName: string;
  columnCount: number;
}) {
  return (
    <div className="border-b border-slate-200/80 px-6 py-5 dark:border-slate-800/80">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
            <Shield className="h-3.5 w-3.5" />
            Data Quality Dashboard
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Comprehensive quality overview for {tableName}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
              DuckDB computes completeness, uniqueness, validity, consistency,
              and freshness directly from the active table so the quality story
              is query-backed rather than inferred from static metadata.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/55">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Columns
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
              {formatNumber(columnCount)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/55">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Engine
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
              DuckDB
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/55">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              View
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
              Live
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
