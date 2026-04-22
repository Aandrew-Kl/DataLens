"use client";

import ReactECharts from "echarts-for-react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

import { formatNumber } from "@/lib/utils/formatters";

import { buildGaugeOption } from "../charts";
import {
  formatDateTime,
  formatPercent,
  getQualityLabel,
  getScoreTone,
} from "../lib";
import {
  DIMENSION_META,
  itemVariants,
  type ColumnQualityRow,
  type DashboardMetrics,
  type DimensionSummary,
} from "../types";

export function SummaryPanel({
  metrics,
  dimensionList,
  columnCount,
  healthiestColumns,
  weakestColumn,
  dark,
}: {
  metrics: DashboardMetrics;
  dimensionList: DimensionSummary[];
  columnCount: number;
  healthiestColumns: number;
  weakestColumn: ColumnQualityRow | null;
  dark: boolean;
}) {
  return (
    <motion.div
      variants={itemVariants}
      className="relative overflow-hidden rounded-[30px] border border-white/30 bg-white/68 p-6 shadow-[0_26px_90px_-44px_rgba(15,23,42,0.58)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/48"
    >
      <div className="absolute inset-y-0 left-0 w-40 bg-linear-to-br from-cyan-500/16 via-cyan-400/6 to-transparent" />
      <div className="relative flex h-full flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex justify-center">
          <div className="h-[300px] w-[300px]">
            <ReactECharts
              option={buildGaugeOption(metrics.overallScore, dark)}
              notMerge
              lazyUpdate
              opts={{ renderer: "svg" }}
              style={{ width: "100%", height: "100%" }}
            />
          </div>
        </div>

        <div className="max-w-xl space-y-5">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/65 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 shadow-sm dark:border-white/10 dark:bg-slate-950/55 dark:text-slate-300">
              <Sparkles className="h-3.5 w-3.5" />
              {getQualityLabel(metrics.overallScore)}
            </div>
            <h3 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {getQualityLabel(metrics.overallScore)} quality posture
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
              {metrics.rowCount > 0
                ? `${formatNumber(metrics.rowCount)} rows were evaluated across ${formatNumber(columnCount)} columns. ${healthiestColumns} columns already clear a 90% overall score threshold.`
                : "This table has no rows yet, so quality scoring remains unassessed."}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/35 bg-white/60 px-4 py-3 dark:border-white/10 dark:bg-slate-950/50">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Rows checked
              </p>
              <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
                {formatNumber(metrics.rowCount)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/35 bg-white/60 px-4 py-3 dark:border-white/10 dark:bg-slate-950/50">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Weakest column
              </p>
              <p className="mt-1 truncate text-xl font-semibold text-slate-900 dark:text-slate-100">
                {weakestColumn?.name ?? "—"}
              </p>
            </div>
            <div className="rounded-2xl border border-white/35 bg-white/60 px-4 py-3 dark:border-white/10 dark:bg-slate-950/50">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Evaluated
              </p>
              <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
                {formatDateTime(new Date(metrics.evaluatedAt).toISOString())}
              </p>
            </div>
            <div className="rounded-2xl border border-white/35 bg-white/60 px-4 py-3 dark:border-white/10 dark:bg-slate-950/50">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Quality tier
              </p>
              <p className={`mt-1 text-xl font-semibold ${getScoreTone(metrics.overallScore)}`}>
                {getQualityLabel(metrics.overallScore)}
              </p>
            </div>
          </div>

          <div className="space-y-3 rounded-[24px] border border-white/35 bg-white/60 p-4 dark:border-white/10 dark:bg-slate-950/50">
            {dimensionList.map((summary) => (
              <div key={summary.key} className="flex items-center gap-4">
                <div className="w-28 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  {summary.label}
                </div>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800/85">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(4, summary.score)}%`,
                      backgroundColor: DIMENSION_META[summary.key].color,
                    }}
                  />
                </div>
                <div className={`w-16 text-right text-sm font-semibold ${getScoreTone(summary.score)}`}>
                  {formatPercent(summary.score)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
