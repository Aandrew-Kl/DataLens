import type { EChartsOption } from "echarts";

import { getGaugeColor } from "./lib";
import type { ChartDatum } from "./types";

export function buildGaugeOption(score: number, dark: boolean): EChartsOption {
  return {
    animationDuration: 900,
    series: [
      {
        type: "gauge",
        startAngle: 215,
        endAngle: -35,
        min: 0,
        max: 100,
        splitNumber: 5,
        progress: {
          show: true,
          width: 18,
          roundCap: true,
          itemStyle: { color: getGaugeColor(score) },
        },
        axisLine: {
          lineStyle: {
            width: 18,
            color: [[1, dark ? "rgba(51,65,85,0.48)" : "rgba(148,163,184,0.26)"]],
          },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        anchor: { show: false },
        title: {
          show: true,
          offsetCenter: [0, "48%"],
          color: dark ? "#94a3b8" : "#64748b",
          fontSize: 14,
        },
        detail: {
          valueAnimation: true,
          formatter: "{value}%",
          offsetCenter: [0, "-6%"],
          color: dark ? "#f8fafc" : "#0f172a",
          fontSize: 44,
          fontWeight: 700,
        },
        data: [{ value: Number(score.toFixed(1)), name: "overall quality" }],
      },
    ],
  };
}

export function buildDimensionOption(
  data: ChartDatum[],
  color: string,
  dark: boolean,
): EChartsOption {
  return {
    animationDuration: 500,
    grid: {
      left: 10,
      right: 14,
      top: 12,
      bottom: 4,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: dark ? "#0f172ae8" : "#ffffffea",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
      formatter: "{b}<br/>{c}%",
    },
    xAxis: {
      type: "value",
      max: 100,
      axisLabel: {
        color: dark ? "#94a3b8" : "#64748b",
        fontSize: 10,
        formatter: "{value}%",
      },
      splitLine: {
        lineStyle: {
          color: dark ? "rgba(51,65,85,0.45)" : "rgba(203,213,225,0.6)",
          type: "dashed",
        },
      },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: data.map((item) => item.label),
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: {
        color: dark ? "#cbd5e1" : "#334155",
        fontSize: 11,
        width: 88,
        overflow: "truncate",
      },
    },
    series: [
      {
        type: "bar",
        data: data.map((item) => Number(item.value.toFixed(1))),
        barMaxWidth: 14,
        showBackground: true,
        backgroundStyle: {
          color: dark ? "rgba(30,41,59,0.55)" : "rgba(226,232,240,0.75)",
          borderRadius: 999,
        },
        itemStyle: {
          color,
          borderRadius: [0, 999, 999, 0],
        },
      },
    ],
  };
}
