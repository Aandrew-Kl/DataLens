"use client";

import { motion } from "framer-motion";
import { Table2 } from "lucide-react";

import { formatNumber } from "@/lib/utils/formatters";

import { getGaugeColor } from "../lib";
import {
  DIMENSION_META,
  TYPE_BADGE,
  itemVariants,
  type DashboardMetrics,
} from "../types";
import { ScoreBar } from "./primitives";

export function ColumnTable({
  metrics,
  healthiestColumns,
}: {
  metrics: DashboardMetrics;
  healthiestColumns: number;
}) {
  return (
    <motion.div
      variants={itemVariants}
      className="overflow-hidden rounded-[30px] border border-white/30 bg-white/68 shadow-[0_26px_90px_-44px_rgba(15,23,42,0.58)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/48"
    >
      <div className="flex flex-col gap-4 border-b border-slate-200/80 px-6 py-5 dark:border-slate-800/80 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">
            <Table2 className="h-3.5 w-3.5" />
            Column-level Detail
          </div>
          <h3 className="mt-3 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Individual column quality scores
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
            Each column gets its own completeness, uniqueness, validity,
            consistency, and timeliness score so remediation can focus on
            the weakest dimensions first.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Healthy columns
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
              {healthiestColumns}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Flagged columns
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
              {metrics.columnRows.filter((column) => column.overall < 80).length}
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1120px] w-full">
          <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur-xl dark:bg-slate-950/90">
            <tr className="border-b border-slate-200/80 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:border-slate-800/80 dark:text-slate-400">
              {[
                "Column",
                "Type",
                "Overall",
                "Completeness",
                "Uniqueness",
                "Validity",
                "Consistency",
                "Timeliness",
                "Flag",
              ].map((label) => (
                <th key={label} className="px-4 py-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
            {metrics.columnRows.map((column) => (
              <tr
                key={column.name}
                className="bg-white/55 transition-colors hover:bg-white/78 dark:bg-slate-950/34 dark:hover:bg-slate-950/52"
              >
                <td className="px-4 py-4 align-top">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {column.name}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {formatNumber(column.nonNullCount)} populated / {formatNumber(metrics.rowCount)} rows
                    </p>
                  </div>
                </td>
                <td className="px-4 py-4 align-top">
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${TYPE_BADGE[column.type].className}`}>
                    {TYPE_BADGE[column.type].label}
                  </span>
                </td>
                <td className="px-4 py-4 align-top">
                  <ScoreBar value={column.overall} color={getGaugeColor(column.overall)} />
                </td>
                <td className="px-4 py-4 align-top">
                  <ScoreBar value={column.completeness} color={DIMENSION_META.completeness.color} />
                </td>
                <td className="px-4 py-4 align-top">
                  <ScoreBar value={column.uniqueness} color={DIMENSION_META.uniqueness.color} />
                </td>
                <td className="px-4 py-4 align-top">
                  <ScoreBar value={column.validity} color={DIMENSION_META.validity.color} />
                </td>
                <td className="px-4 py-4 align-top">
                  <ScoreBar value={column.consistency} color={DIMENSION_META.consistency.color} />
                </td>
                <td className="px-4 py-4 align-top">
                  <ScoreBar value={column.timeliness} color={DIMENSION_META.timeliness.color} />
                </td>
                <td className="px-4 py-4 align-top">
                  <div className="max-w-[220px] rounded-2xl border border-slate-200/80 bg-white/72 px-3 py-2 text-xs leading-5 text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
                    {column.flag}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
