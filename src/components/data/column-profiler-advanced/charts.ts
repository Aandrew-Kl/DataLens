import type { EChartsOption } from "echarts";

import { formatMetric } from "./lib";
import type { HistogramBin, OutlierMetrics } from "./types";

export function buildHistogramOption(
  bins: HistogramBin[],
  dark: boolean,
  color: string,
): EChartsOption {
  return {
    animationDuration: 420,
    grid: { left: 18, right: 18, top: 24, bottom: 36, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#1e293b" : "#dbe4f0",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
    },
    xAxis: {
      type: "category",
      data: bins.map((bin) => bin.label),
      axisLabel: {
        color: dark ? "#94a3b8" : "#64748b",
        rotate: bins.length > 10 ? 28 : 0,
        fontSize: 11,
      },
      axisLine: { lineStyle: { color: dark ? "#1e293b" : "#dbe4f0" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: dark ? "#94a3b8" : "#64748b", fontSize: 11 },
      splitLine: {
        lineStyle: { color: dark ? "#1e293b" : "#dbe4f0", type: "dashed" },
      },
    },
    series: [
      {
        type: "bar",
        data: bins.map((bin) => bin.count),
        barMaxWidth: 26,
        itemStyle: { color, borderRadius: [8, 8, 0, 0] },
      },
    ],
  };
}

export function buildBoxPlotOption(outliers: OutlierMetrics, dark: boolean): EChartsOption {
  return {
    animationDuration: 420,
    grid: { left: 18, right: 18, top: 18, bottom: 30, containLabel: true },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#1e293b" : "#dbe4f0",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
      formatter: [
        `Whisker low: ${formatMetric(outliers.whiskerLow)}`,
        `Q1: ${formatMetric(outliers.q1)}`,
        `Median: ${formatMetric(outliers.median)}`,
        `Q3: ${formatMetric(outliers.q3)}`,
        `Whisker high: ${formatMetric(outliers.whiskerHigh)}`,
      ].join("<br/>"),
    },
    xAxis: {
      type: "category",
      data: ["IQR"],
      axisLabel: { color: dark ? "#94a3b8" : "#64748b" },
      axisLine: { lineStyle: { color: dark ? "#1e293b" : "#dbe4f0" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: dark ? "#94a3b8" : "#64748b", fontSize: 11 },
      splitLine: {
        lineStyle: { color: dark ? "#1e293b" : "#dbe4f0", type: "dashed" },
      },
    },
    series: [
      {
        type: "boxplot",
        itemStyle: {
          color: "rgba(14,165,233,0.18)",
          borderColor: "#38bdf8",
          borderWidth: 2,
        },
        data: [[
          outliers.whiskerLow ?? 0,
          outliers.q1 ?? 0,
          outliers.median ?? 0,
          outliers.q3 ?? 0,
          outliers.whiskerHigh ?? 0,
        ]],
      },
    ],
  };
}
