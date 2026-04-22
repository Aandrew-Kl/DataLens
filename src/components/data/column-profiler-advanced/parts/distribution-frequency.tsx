"use client";

import ReactECharts from "echarts-for-react";
import { BarChart3, Clipboard } from "lucide-react";

import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

import { buildHistogramOption } from "../charts";
import { formatPercent } from "../lib";
import type { FrequencyRow, HistogramBin } from "../types";
import { Card } from "./primitives";

export function DistributionCard({
  histogram,
  columnType,
  dark,
  color,
}: {
  histogram: HistogramBin[];
  columnType: ColumnProfile["type"];
  dark: boolean;
  color: string;
}) {
  const subtitle =
    columnType === "number"
      ? "30-bin histogram"
      : columnType === "date"
        ? "Monthly temporal distribution"
        : "Top 20 values";
  return (
    <Card title="Distribution" icon={BarChart3} subtitle={subtitle}>
      <ReactECharts
        option={buildHistogramOption(histogram, dark, color)}
        style={{ height: 320, width: "100%" }}
      />
    </Card>
  );
}

export function FrequencyCard({ frequencyRows }: { frequencyRows: FrequencyRow[] }) {
  return (
    <Card
      title="Value Frequency"
      icon={Clipboard}
      subtitle="Top 50 most common values with relative share."
    >
      <div className="max-h-[320px] overflow-auto rounded-3xl border border-white/20 dark:border-white/10">
        <table className="min-w-full divide-y divide-slate-200/70 text-sm dark:divide-slate-800/70">
          <thead className="sticky top-0 bg-slate-50/90 backdrop-blur dark:bg-slate-950/90">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              <th className="px-4 py-3">Value</th>
              <th className="px-4 py-3">Count</th>
              <th className="px-4 py-3">Share</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/70 bg-white/50 dark:divide-slate-800/70 dark:bg-slate-950/30">
            {frequencyRows.map((row) => (
              <tr key={`${row.value}-${row.count}`}>
                <td
                  className="max-w-[26rem] px-4 py-3 text-slate-700 dark:text-slate-200"
                  title={row.value}
                >
                  {row.value}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                  {formatNumber(row.count)}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                  {formatPercent(row.percentage, row.percentage >= 10 ? 1 : 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
