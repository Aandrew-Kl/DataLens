"use client";

import { motion } from "framer-motion";
import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react";

import { formatPercent, getScoreTone } from "../lib";
import {
  DIMENSION_META,
  itemVariants,
  type ColumnQualityRow,
  type DimensionSummary,
} from "../types";
import { ScorePill } from "./primitives";

export function ExecutivePanel({
  overallScore,
  dimensionList,
  weakestColumn,
}: {
  overallScore: number;
  dimensionList: DimensionSummary[];
  weakestColumn: ColumnQualityRow | null;
}) {
  return (
    <motion.div
      variants={itemVariants}
      className="overflow-hidden rounded-[30px] border border-white/30 bg-white/68 p-6 shadow-[0_26px_90px_-44px_rgba(15,23,42,0.58)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/48"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
            <Activity className="h-3.5 w-3.5" />
            Executive Readout
          </div>
          <h3 className="mt-4 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Dimension balance at a glance
          </h3>
        </div>
        <ScorePill score={overallScore} />
      </div>

      <div className="mt-5 space-y-4">
        {dimensionList.map((summary) => {
          const Icon = DIMENSION_META[summary.key].icon;
          return (
            <div
              key={summary.key}
              className="rounded-[22px] border border-white/35 bg-white/60 p-4 dark:border-white/10 dark:bg-slate-950/48"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className={`rounded-2xl border px-3 py-3 ${DIMENSION_META[summary.key].tone}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {summary.label}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
                      {summary.details[0]}
                    </p>
                  </div>
                </div>
                <div className={`text-sm font-semibold ${getScoreTone(summary.score)}`}>
                  {formatPercent(summary.score)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 rounded-[24px] border border-white/35 bg-white/60 p-4 dark:border-white/10 dark:bg-slate-950/48">
        <div className="flex items-center gap-2">
          {weakestColumn?.overall && weakestColumn.overall >= 75 ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          )}
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Lead remediation target
          </p>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
          {weakestColumn
            ? `${weakestColumn.name} is currently the lowest-scoring column at ${formatPercent(weakestColumn.overall)} overall. The main flag is ${weakestColumn.flag}.`
            : "No remediation target is available yet."}
        </p>
      </div>
    </motion.div>
  );
}
