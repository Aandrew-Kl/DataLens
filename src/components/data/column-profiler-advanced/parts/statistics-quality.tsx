"use client";

import { ShieldCheck, Sigma } from "lucide-react";

import { formatNumber } from "@/lib/utils/formatters";

import { clamp, formatMetric, formatPercent, formatRangeValue } from "../lib";
import type { ColumnStatistics, QualityMetrics } from "../types";
import { Card, MetricCell } from "./primitives";

export function StatisticsCard({ statistics }: { statistics: ColumnStatistics }) {
  return (
    <Card
      title="Statistics"
      icon={Sigma}
      subtitle="Core descriptive metrics computed directly in DuckDB."
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCell label="Count" value={formatNumber(statistics.count)} />
        <MetricCell label="Nulls" value={formatNumber(statistics.nulls)} />
        <MetricCell label="Unique" value={formatNumber(statistics.unique)} />
        <MetricCell label="Min" value={formatRangeValue(statistics.min)} />
        <MetricCell label="Max" value={formatRangeValue(statistics.max)} />
        <MetricCell label="Mean" value={formatMetric(statistics.mean)} />
        <MetricCell label="Median" value={formatMetric(statistics.median)} />
        <MetricCell label="Stddev" value={formatMetric(statistics.stddev)} />
        <MetricCell label="Variance" value={formatMetric(statistics.variance)} />
        <MetricCell label="Skewness" value={formatMetric(statistics.skewness)} />
        <MetricCell label="Kurtosis" value={formatMetric(statistics.kurtosis)} />
      </div>
    </Card>
  );
}

export function QualityCard({ quality }: { quality: QualityMetrics }) {
  return (
    <Card
      title="Data Quality"
      icon={ShieldCheck}
      subtitle="Completeness, uniqueness, and conformity indicators for this field."
    >
      <div className="space-y-4">
        {[
          {
            label: "Completeness",
            value: quality.completeness,
            color: "from-emerald-400 to-green-500",
          },
          {
            label: "Uniqueness",
            value: quality.uniqueness,
            color: "from-cyan-400 to-sky-500",
          },
          {
            label: quality.conformityLabel,
            value: quality.patternConformity,
            color: "from-violet-400 to-fuchsia-500",
          },
        ].map((metric) => (
          <div key={metric.label}>
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span className="text-slate-600 dark:text-slate-300">{metric.label}</span>
              <span className="font-semibold text-slate-950 dark:text-white">
                {formatPercent(metric.value)}
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${metric.color}`}
                style={{ width: `${clamp(metric.value, 3, 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
