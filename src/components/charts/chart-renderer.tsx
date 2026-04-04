"use client";

import { memo, useEffect, useId, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { motion } from "framer-motion";
import { BarChart3 } from "lucide-react";
import type { ChartConfig } from "@/types/chart";

interface ChartRendererProps {
  config: ChartConfig;
  data: Record<string, unknown>[];
}

const DEFAULT_PALETTE = [
  "#8b5cf6", "#6366f1", "#3b82f6", "#06b6d4",
  "#10b981", "#84cc16", "#eab308", "#f97316",
  "#ef4444", "#ec4899", "#a78bfa", "#67e8f9",
];

function isDarkMode(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

function buildOption(
  config: ChartConfig,
  data: Record<string, unknown>[],
  dark: boolean
): Record<string, unknown> {
  const palette = config.colorPalette ?? DEFAULT_PALETTE;
  const textColor = dark ? "#a1a1aa" : "#71717a";
  const borderColor = dark ? "#27272a" : "#e5e7eb";

  const baseTooltip = {
    trigger: config.type === "pie" ? "item" : "axis",
    backgroundColor: dark ? "#18181bee" : "#ffffffee",
    borderColor: dark ? "#3f3f46" : "#e5e7eb",
    textStyle: { color: dark ? "#e4e4e7" : "#27272a", fontSize: 12 },
    borderWidth: 1,
  };

  const baseLegend = {
    show: true,
    bottom: 0,
    textStyle: { color: textColor, fontSize: 11 },
    pageTextStyle: { color: textColor },
  };

  const baseGrid = {
    left: 48,
    right: 24,
    top: config.title ? 48 : 24,
    bottom: 48,
    containLabel: true,
  };

  const xAxisData = config.xAxis
    ? data.map((row) => row[config.xAxis!] as string)
    : [];

  const yAxisValues = config.yAxis
    ? data.map((row) => Number(row[config.yAxis!]) || 0)
    : [];

  // Helper: group data by a column
  function groupedSeries() {
    if (!config.groupBy || !config.xAxis || !config.yAxis) {
      return [{ name: config.yAxis ?? "Value", data: yAxisValues }];
    }

    const groups = new Map<string, number[]>();
    const xLabels = [...new Set(xAxisData)];

    data.forEach((row) => {
      const group = String(row[config.groupBy!] ?? "Other");
      if (!groups.has(group)) {
        groups.set(group, new Array(xLabels.length).fill(0));
      }
      const xIdx = xLabels.indexOf(String(row[config.xAxis!]));
      if (xIdx >= 0) {
        groups.get(group)![xIdx] = Number(row[config.yAxis!]) || 0;
      }
    });

    return Array.from(groups.entries()).map(([name, values]) => ({
      name,
      data: values,
    }));
  }

  switch (config.type) {
    case "bar": {
      const series = groupedSeries();
      return {
        tooltip: baseTooltip,
        legend: series.length > 1 ? baseLegend : { show: false },
        grid: baseGrid,
        xAxis: {
          type: "category",
          data: config.groupBy ? [...new Set(xAxisData)] : xAxisData,
          axisLabel: { color: textColor, fontSize: 11, rotate: xAxisData.length > 10 ? 30 : 0 },
          axisLine: { lineStyle: { color: borderColor } },
        },
        yAxis: {
          type: "value",
          axisLabel: { color: textColor, fontSize: 11 },
          splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
        },
        series: series.map((s, i) => ({
          name: s.name,
          type: "bar",
          data: s.data,
          itemStyle: { color: palette[i % palette.length], borderRadius: [4, 4, 0, 0] },
          animationDelay: (idx: number) => idx * 30,
        })),
        animationEasing: "elasticOut",
      };
    }

    case "line":
    case "area": {
      const series = groupedSeries();
      return {
        tooltip: baseTooltip,
        legend: series.length > 1 ? baseLegend : { show: false },
        grid: baseGrid,
        xAxis: {
          type: "category",
          data: config.groupBy ? [...new Set(xAxisData)] : xAxisData,
          axisLabel: { color: textColor, fontSize: 11 },
          axisLine: { lineStyle: { color: borderColor } },
          boundaryGap: false,
        },
        yAxis: {
          type: "value",
          axisLabel: { color: textColor, fontSize: 11 },
          splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
        },
        series: series.map((s, i) => ({
          name: s.name,
          type: "line",
          data: s.data,
          smooth: true,
          lineStyle: { width: 2.5, color: palette[i % palette.length] },
          itemStyle: { color: palette[i % palette.length] },
          areaStyle: config.type === "area"
            ? { color: palette[i % palette.length], opacity: 0.12 }
            : undefined,
          symbol: "circle",
          symbolSize: 4,
        })),
        animationDuration: 800,
      };
    }

    case "pie": {
      const pieData = config.xAxis && config.yAxis
        ? data.map((row) => ({
            name: String(row[config.xAxis!] ?? ""),
            value: Number(row[config.yAxis!]) || 0,
          }))
        : [];

      return {
        tooltip: baseTooltip,
        legend: { ...baseLegend, type: "scroll" },
        series: [
          {
            type: "pie",
            radius: ["40%", "70%"],
            center: ["50%", "45%"],
            data: pieData,
            label: {
              show: true,
              color: textColor,
              fontSize: 11,
              formatter: "{b}: {d}%",
            },
            itemStyle: {
              borderRadius: 6,
              borderColor: dark ? "#18181b" : "#ffffff",
              borderWidth: 2,
            },
            color: palette,
            animationType: "scale",
            animationEasing: "elasticOut",
          },
        ],
      };
    }

    case "scatter": {
      const scatterData = config.xAxis && config.yAxis
        ? data.map((row) => [
            Number(row[config.xAxis!]) || 0,
            Number(row[config.yAxis!]) || 0,
          ])
        : [];

      return {
        tooltip: {
          ...baseTooltip,
          trigger: "item",
          formatter: (params: { value: number[] }) =>
            `${config.xAxis}: ${params.value[0]}<br/>${config.yAxis}: ${params.value[1]}`,
        },
        grid: baseGrid,
        xAxis: {
          type: "value",
          name: config.xAxis,
          nameTextStyle: { color: textColor, fontSize: 11 },
          axisLabel: { color: textColor, fontSize: 11 },
          splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
        },
        yAxis: {
          type: "value",
          name: config.yAxis,
          nameTextStyle: { color: textColor, fontSize: 11 },
          axisLabel: { color: textColor, fontSize: 11 },
          splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
        },
        series: [
          {
            type: "scatter",
            data: scatterData,
            symbolSize: 8,
            itemStyle: { color: palette[0], opacity: 0.7 },
          },
        ],
      };
    }

    case "histogram": {
      // Build histogram bins from the y-axis values
      const values = config.yAxis
        ? data.map((row) => Number(row[config.yAxis!]) || 0)
        : config.xAxis
        ? data.map((row) => Number(row[config.xAxis!]) || 0)
        : [];

      if (!values.length) return {};

      const min = Math.min(...values);
      const max = Math.max(...values);
      const binCount = Math.min(20, Math.ceil(Math.sqrt(values.length)));
      const binWidth = (max - min) / binCount || 1;

      const bins = new Array(binCount).fill(0);
      const labels: string[] = [];

      for (let i = 0; i < binCount; i++) {
        const lo = min + i * binWidth;
        const hi = lo + binWidth;
        labels.push(`${lo.toFixed(1)}`);
        values.forEach((v) => {
          if (i === binCount - 1 ? v >= lo && v <= hi : v >= lo && v < hi) {
            bins[i]++;
          }
        });
      }

      return {
        tooltip: baseTooltip,
        grid: baseGrid,
        xAxis: {
          type: "category",
          data: labels,
          axisLabel: { color: textColor, fontSize: 11, rotate: 30 },
          axisLine: { lineStyle: { color: borderColor } },
        },
        yAxis: {
          type: "value",
          name: "Count",
          nameTextStyle: { color: textColor, fontSize: 11 },
          axisLabel: { color: textColor, fontSize: 11 },
          splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
        },
        series: [
          {
            type: "bar",
            data: bins,
            itemStyle: { color: palette[0], borderRadius: [3, 3, 0, 0] },
            barWidth: "90%",
          },
        ],
      };
    }

    default: {
      // Fallback: bar chart
      return {
        tooltip: baseTooltip,
        grid: baseGrid,
        xAxis: { type: "category", data: xAxisData, axisLabel: { color: textColor } },
        yAxis: { type: "value", axisLabel: { color: textColor } },
        series: [{ type: "bar", data: yAxisValues, itemStyle: { color: palette[0] } }],
      };
    }
  }
}

function formatChartType(type: ChartConfig["type"]): string {
  switch (type) {
    case "area":
      return "area";
    case "bar":
      return "bar";
    case "histogram":
      return "histogram";
    case "line":
      return "line";
    case "pie":
      return "pie";
    case "scatter":
      return "scatter";
    case "heatmap":
      return "heatmap";
    default:
      return "chart";
  }
}

function ChartRenderer({ config, data }: ChartRendererProps) {
  const [dark, setDark] = useState(() => isDarkMode());
  const chartDescriptionId = useId();

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(isDarkMode());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const option = useMemo(() => {
    if (!data.length) return null;

    const base = buildOption(config, data, dark);
    if (config.title) {
      return {
        ...base,
        title: {
          text: config.title,
          left: "center",
          top: 4,
          textStyle: {
            color: dark ? "#e4e4e7" : "#27272a",
            fontSize: 14,
            fontWeight: 600,
          },
        },
      };
    }
    return base;
  }, [config, data, dark]);

  const chartTypeLabel = useMemo(() => formatChartType(config.type), [config.type]);
  const chartAriaLabel = useMemo(() => {
    const chartName = config.title?.trim() || `${chartTypeLabel} chart`;
    return `${chartName} (${chartTypeLabel} chart)`;
  }, [config.title, chartTypeLabel]);
  const chartDescription = useMemo(() => {
    const details = [
      `Rendered as a ${chartTypeLabel} chart.`,
      config.xAxis ? `X-axis: ${config.xAxis}.` : null,
      config.yAxis ? `Y-axis: ${config.yAxis}.` : null,
      config.groupBy ? `Grouped by ${config.groupBy}.` : null,
      `Displaying ${data.length.toLocaleString()} rows.`,
    ].filter(Boolean);

    return details.join(" ");
  }, [chartTypeLabel, config.groupBy, config.xAxis, config.yAxis, data.length]);

  if (!data.length || !option) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400 dark:text-gray-500"
      >
        <BarChart3 className="w-10 h-10" />
        <p className="text-sm">No data available for chart</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      role="img"
      aria-label={chartAriaLabel}
      aria-describedby={chartDescriptionId}
      className="w-full"
    >
      <p id={chartDescriptionId} className="sr-only">
        {chartDescription}
      </p>
      <div aria-hidden="true">
        <ReactECharts
          option={option}
          style={{ height: 380, width: "100%" }}
          opts={{ renderer: "svg" }}
          notMerge
          lazyUpdate
        />
      </div>
    </motion.div>
  );
}

export default memo(ChartRenderer);
