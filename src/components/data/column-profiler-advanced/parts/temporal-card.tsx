"use client";

import ReactECharts from "echarts-for-react";
import { CalendarRange } from "lucide-react";

import { formatNumber } from "@/lib/utils/formatters";

import { buildHistogramOption } from "../charts";
import type { TemporalMetrics } from "../types";
import { Card, MetricCell } from "./primitives";

export function TemporalCard({
  temporal,
  dark,
}: {
  temporal: TemporalMetrics;
  dark: boolean;
}) {
  return (
    <Card
      title="Temporal Analysis"
      icon={CalendarRange}
      subtitle="Range, weekday activity, and date gaps extracted from parsed timestamps."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCell label="Min Date" value={temporal.minDate ?? "—"} />
            <MetricCell label="Max Date" value={temporal.maxDate ?? "—"} />
            <MetricCell label="Range" value={`${formatNumber(temporal.rangeDays)} days`} />
          </div>
          <div className="rounded-3xl border border-white/20 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-slate-900/45">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              Largest Gaps
            </p>
            <div className="mt-3 space-y-2">
              {temporal.gaps.length > 0 ? (
                temporal.gaps.map((gap) => (
                  <div
                    key={`${gap.start}-${gap.end}`}
                    className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm dark:border-white/10 dark:bg-slate-950/50"
                  >
                    <div className="font-medium text-slate-950 dark:text-white">
                      {gap.days} day gap
                    </div>
                    <div className="mt-1 text-slate-600 dark:text-slate-300">
                      {gap.start} → {gap.end}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  No multi-day gaps were detected between observed dates.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/20 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-slate-900/45">
          <ReactECharts
            option={buildHistogramOption(temporal.dayOfWeek, dark, "#34d399")}
            style={{ height: 320, width: "100%" }}
          />
        </div>
      </div>
    </Card>
  );
}
