"use client";

import { useMemo, useSyncExternalStore } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { GaugeChart as EChartsGaugeChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Gauge } from "lucide-react";
import { formatNumber } from "@/lib/utils/formatters";

echarts.use([EChartsGaugeChart, TooltipComponent, CanvasRenderer]);

interface GaugeThresholds {
  green: number;
  yellow: number;
  red: number;
}

interface GaugeChartProps {
  value: number;
  min: number;
  max: number;
  title: string;
  thresholds?: GaugeThresholds;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.8rem] border border-white/15 bg-white/60 p-5 shadow-[0_24px_90px_-46px_rgba(15,23,42,0.76)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";

function subscribeDarkMode(listener: () => void) {
  if (typeof document === "undefined") {
    return () => undefined;
  }

  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  return () => observer.disconnect();
}

function getDarkModeSnapshot() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

function useDarkMode() {
  return useSyncExternalStore(subscribeDarkMode, getDarkModeSnapshot, () => false);
}

function normalizeThresholds(min: number, max: number, thresholds?: GaugeThresholds) {
  const span = Math.max(max - min, 1);

  if (!thresholds) {
    return [
      [0.55, "#22c55e"],
      [0.8, "#f59e0b"],
      [1, "#ef4444"],
    ] as const;
  }

  const segments = [
    [Math.min(Math.max((thresholds.green - min) / span, 0), 1), "#22c55e"],
    [Math.min(Math.max((thresholds.yellow - min) / span, 0), 1), "#f59e0b"],
    [Math.min(Math.max((thresholds.red - min) / span, 0), 1), "#ef4444"],
  ] as const;

  return segments
    .slice()
    .sort((left, right) => left[0] - right[0])
    .map(([stop, color], index, array) => {
      if (index === array.length - 1) {
        return [1, color] as const;
      }

      return [stop, color] as const;
    });
}

function buildGaugeOption(
  dark: boolean,
  title: string,
  value: number,
  min: number,
  max: number,
  thresholds?: GaugeThresholds,
): EChartsOption {
  const clampedValue = Math.min(Math.max(value, min), max);
  const normalizedStops = normalizeThresholds(min, max, thresholds);
  const axisLabelColor = dark ? "#94a3b8" : "#64748b";
  const detailColor = dark ? "#f8fafc" : "#0f172a";
  const panelColor = dark ? "rgba(15,23,42,0.74)" : "rgba(255,255,255,0.9)";

  return {
    animationDuration: 640,
    animationDurationUpdate: 560,
    tooltip: {
      trigger: "item",
      backgroundColor: panelColor,
      borderWidth: 0,
      textStyle: { color: detailColor },
      formatter: () =>
        `${title}<br/>Value: ${formatNumber(clampedValue)}<br/>Range: ${formatNumber(min)} - ${formatNumber(max)}`,
    },
    series: [
      {
        type: "gauge",
        min,
        max,
        startAngle: 220,
        endAngle: -40,
        radius: "92%",
        progress: {
          show: true,
          width: 16,
          roundCap: true,
          itemStyle: {
            color: dark ? "#e2e8f0" : "#0f172a",
          },
        },
        axisLine: {
          roundCap: true,
          lineStyle: {
            width: 16,
            color: normalizedStops.map(([stop, color]) => [stop, color]),
          },
        },
        pointer: {
          show: true,
          length: "62%",
          width: 5,
          itemStyle: {
            color: dark ? "#f8fafc" : "#0f172a",
            shadowBlur: 10,
            shadowColor: dark ? "rgba(248,250,252,0.25)" : "rgba(15,23,42,0.16)",
          },
        },
        anchor: {
          show: true,
          size: 12,
          itemStyle: {
            color: dark ? "#f8fafc" : "#0f172a",
            borderColor: dark ? "#0f172a" : "#ffffff",
            borderWidth: 3,
          },
        },
        axisTick: {
          distance: -24,
          splitNumber: 5,
          lineStyle: {
            width: 1.5,
            color: axisLabelColor,
          },
        },
        splitLine: {
          distance: -24,
          length: 12,
          lineStyle: {
            width: 2,
            color: axisLabelColor,
          },
        },
        axisLabel: {
          color: axisLabelColor,
          distance: 28,
          fontSize: 11,
          formatter: (tick: number) => {
            if (tick === min || tick === max) {
              return formatNumber(tick);
            }

            return "";
          },
        },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, "18%"],
          color: detailColor,
          fontSize: 34,
          fontWeight: 700,
          formatter: (current: number) => formatNumber(current),
        },
        title: {
          offsetCenter: [0, "55%"],
          color: axisLabelColor,
          fontSize: 13,
          fontWeight: 600,
        },
        data: [{ value: clampedValue, name: title }],
      },
    ],
  };
}

export default function GaugeChart({
  value,
  min,
  max,
  title,
  thresholds,
}: GaugeChartProps) {
  const dark = useDarkMode();
  const option = useMemo(
    () => buildGaugeOption(dark, title, value, min, max, thresholds),
    [dark, max, min, thresholds, title, value],
  );
  const percentage = max === min ? 0 : ((Math.min(Math.max(value, min), max) - min) / (max - min)) * 100;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: EASE }}
      className={PANEL_CLASS}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
            <Gauge className="h-3.5 w-3.5" />
            Gauge meter
          </div>
          <h2 className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">{title}</h2>
        </div>
        <div className="rounded-2xl border border-white/15 bg-white/50 px-3 py-2 text-right dark:border-white/10 dark:bg-slate-950/35">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Utilization
          </div>
          <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
            {percentage.toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="mt-4">
        <ReactEChartsCore
          echarts={echarts}
          option={option}
          notMerge
          lazyUpdate
          style={{ height: 320, width: "100%" }}
        />
      </div>
    </motion.section>
  );
}
