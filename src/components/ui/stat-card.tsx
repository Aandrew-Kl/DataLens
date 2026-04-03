"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { use as registerECharts } from "echarts/core";
import type { EChartsOption } from "echarts";
import { SVGRenderer } from "echarts/renderers";

import { formatNumber, formatPercent } from "@/lib/utils/formatters";

const GLASS_PANEL_CLASS =
  "bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 border border-white/20";

registerECharts([LineChart, GridComponent, TooltipComponent, SVGRenderer]);

interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  accentColor?: string;
  sparklineData?: number[];
}

function buildSparklineOption(values: number[], accentColor: string): EChartsOption {
  return {
    animation: false,
    grid: {
      left: 0,
      right: 0,
      top: 2,
      bottom: 2,
    },
    tooltip: {
      trigger: "axis",
      padding: 6,
      backgroundColor: "#0f172ae6",
      borderWidth: 0,
      textStyle: {
        color: "#f8fafc",
      },
    },
    xAxis: {
      type: "category",
      show: false,
      data: values.map((_, index) => index),
    },
    yAxis: {
      type: "value",
      show: false,
      scale: true,
    },
    series: [
      {
        type: "line",
        data: values,
        smooth: true,
        symbol: "none",
        lineStyle: {
          color: accentColor,
          width: 2,
        },
        areaStyle: {
          color: `${accentColor}20`,
        },
      },
    ],
  };
}

function formatValue(value: string | number) {
  return typeof value === "number" ? formatNumber(value) : value;
}

function getTrend(change: number | undefined) {
  if (typeof change !== "number" || change === 0) {
    return {
      Icon: Minus,
      label: typeof change === "number" ? formatPercent(Math.abs(change)) : "No change",
      className: "text-slate-500 dark:text-slate-400",
    };
  }

  if (change > 0) {
    return {
      Icon: ArrowUpRight,
      label: `+${formatPercent(change)}`,
      className: "text-emerald-600 dark:text-emerald-300",
    };
  }

  return {
    Icon: ArrowDownRight,
    label: `-${formatPercent(Math.abs(change))}`,
    className: "text-rose-500 dark:text-rose-300",
  };
}

export default function StatCard({
  title,
  value,
  change,
  accentColor = "#0EA5E9",
  sparklineData,
}: StatCardProps) {
  const trend = getTrend(change);
  const chartOption = sparklineData?.length ? buildSparklineOption(sparklineData, accentColor) : null;

  return (
    <article
      className={`rounded-3xl p-5 shadow-sm ${GLASS_PANEL_CLASS}`}
      style={{ boxShadow: `inset 0 1px 0 rgba(255,255,255,0.2), 0 10px 30px -24px ${accentColor}` }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
          <p className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {formatValue(value)}
          </p>
          <div className={`inline-flex items-center gap-1 text-sm font-semibold ${trend.className}`}>
            <trend.Icon className="h-4 w-4" />
            <span>{trend.label}</span>
          </div>
        </div>

        <span
          className="h-10 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: accentColor }}
          aria-hidden="true"
        />
      </div>

      {chartOption ? (
        <div className="mt-4 rounded-2xl border border-white/15 bg-white/40 p-2 dark:bg-slate-900/35">
          <ReactEChartsCore
            option={chartOption}
            notMerge
            lazyUpdate
            opts={{ renderer: "svg" }}
            style={{ width: "100%", height: 56 }}
          />
        </div>
      ) : null}
    </article>
  );
}
