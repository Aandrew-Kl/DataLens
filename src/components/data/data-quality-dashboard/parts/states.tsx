"use client";

import { AlertTriangle, Database } from "lucide-react";

import {
  SkeletonCard,
  SkeletonChart,
  SkeletonTable,
} from "@/components/ui/skeleton";

export function LoadingState() {
  return (
    <div className="space-y-6 px-6 py-6">
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SkeletonChart className="min-h-[340px] rounded-[28px] border-white/20 bg-white/50 dark:bg-slate-950/45" />
        <SkeletonCard className="min-h-[340px] rounded-[28px] border-white/20 bg-white/50 dark:bg-slate-950/45" />
      </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <SkeletonChart
            key={index}
            className="min-h-[320px] rounded-[26px] border-white/20 bg-white/50 dark:bg-slate-950/45"
          />
        ))}
      </div>
      <SkeletonTable
        rows={6}
        columns={8}
        className="rounded-[28px] border-white/20 bg-white/50 dark:bg-slate-950/45"
      />
    </div>
  );
}

export function EmptyState({ tableName }: { tableName: string }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-slate-200/80 bg-white/80 text-slate-400 shadow-sm dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-500">
        <Database className="h-7 w-7" />
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          No profiled columns for {tableName}
        </h3>
        <p className="max-w-md text-sm leading-6 text-slate-600 dark:text-slate-400">
          Load or profile a dataset first so the dashboard can compute completeness,
          uniqueness, validity, consistency, and timeliness.
        </p>
      </div>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="px-6 py-6">
      <div className="flex items-start gap-3 rounded-[24px] border border-orange-300/40 bg-orange-500/10 p-4 text-sm text-orange-800 dark:border-orange-500/20 dark:bg-orange-500/10 dark:text-orange-300">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-semibold">Quality metrics failed to load</p>
          <p className="mt-1 leading-6">{message}</p>
        </div>
      </div>
    </div>
  );
}
