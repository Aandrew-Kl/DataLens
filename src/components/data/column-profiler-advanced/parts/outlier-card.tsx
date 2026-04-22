"use client";

import ReactECharts from "echarts-for-react";
import { Hash } from "lucide-react";

import { formatNumber } from "@/lib/utils/formatters";

import { buildBoxPlotOption } from "../charts";
import { formatMetric, formatPercent } from "../lib";
import type { OutlierMetrics } from "../types";
import { Card, MetricCell } from "./primitives";

export function OutlierCard({
  outliers,
  dark,
}: {
  outliers: OutlierMetrics;
  dark: boolean;
}) {
  return (
    <Card
      title="Outlier Detection"
      icon={Hash}
      subtitle="IQR-based outlier scan with whiskers and frequent extreme values."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCell label="Q1" value={formatMetric(outliers.q1)} />
            <MetricCell label="Median" value={formatMetric(outliers.median)} />
            <MetricCell label="Q3" value={formatMetric(outliers.q3)} />
            <MetricCell label="Lower Bound" value={formatMetric(outliers.lowerBound)} />
            <MetricCell label="Upper Bound" value={formatMetric(outliers.upperBound)} />
            <MetricCell label="Outliers" value={formatNumber(outliers.outlierCount)} />
          </div>
          <div className="rounded-3xl border border-white/20 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-slate-900/45">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              Most Frequent Outlier Values
            </p>
            <div className="mt-3 space-y-2">
              {outliers.topOutliers.length > 0 ? (
                outliers.topOutliers.map((row) => (
                  <div
                    key={`${row.value}-${row.count}`}
                    className="flex items-center justify-between rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm dark:border-white/10 dark:bg-slate-950/50"
                  >
                    <span className="truncate pr-3 text-slate-700 dark:text-slate-200">
                      {row.value}
                    </span>
                    <span className="font-semibold text-slate-950 dark:text-white">
                      {formatNumber(row.count)} · {formatPercent(row.percentage, 1)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  No outlier values exceeded the IQR thresholds.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/20 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-slate-900/45">
          <ReactECharts
            option={buildBoxPlotOption(outliers, dark)}
            style={{ height: 320, width: "100%" }}
          />
        </div>
      </div>
    </Card>
  );
}
