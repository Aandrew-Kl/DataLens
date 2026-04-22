"use client";

import ReactECharts from "echarts-for-react";
import { motion } from "framer-motion";

import { buildDimensionOption } from "../charts";
import { formatPercent } from "../lib";
import {
  DIMENSION_META,
  itemVariants,
  type DimensionSummary,
} from "../types";

export function DimensionCard({
  dark,
  summary,
}: {
  dark: boolean;
  summary: DimensionSummary;
}) {
  const meta = DIMENSION_META[summary.key];
  const Icon = meta.icon;

  return (
    <motion.article
      variants={itemVariants}
      className="group relative overflow-hidden rounded-[28px] border border-white/30 bg-white/65 p-5 shadow-[0_24px_80px_-42px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/48"
    >
      <div className={`absolute inset-x-0 top-0 h-24 bg-linear-to-br ${meta.accent}`} />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${meta.tone}`}>
              <Icon className="h-3.5 w-3.5" />
              {summary.label}
            </div>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {formatPercent(summary.score)}
            </p>
          </div>
          <div className="rounded-2xl border border-white/40 bg-white/65 px-3 py-2 text-right shadow-sm dark:border-white/10 dark:bg-slate-950/55">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {summary.detailLabel}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
              {summary.detailValue}
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-400">
          {summary.helper}
        </p>

        <div className="mt-5 h-[170px] overflow-hidden rounded-[22px] border border-white/35 bg-white/55 p-2 shadow-inner dark:border-white/10 dark:bg-slate-950/52">
          {summary.chartData.length ? (
            <ReactECharts
              option={buildDimensionOption(summary.chartData, meta.color, dark)}
              notMerge
              lazyUpdate
              opts={{ renderer: "svg" }}
              style={{ width: "100%", height: "100%" }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              no columns to chart
            </div>
          )}
        </div>

        <div className="mt-5 space-y-3">
          {summary.details.map((detail) => (
            <div
              key={detail}
              className="flex items-start gap-2 rounded-2xl border border-white/35 bg-white/55 px-3 py-3 text-sm leading-6 text-slate-700 dark:border-white/10 dark:bg-slate-950/46 dark:text-slate-300"
            >
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: meta.color }}
              />
              <span>{detail}</span>
            </div>
          ))}
        </div>
      </div>
    </motion.article>
  );
}
