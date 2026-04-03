"use client";

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { ArrowDownRight, ArrowRight, ArrowUpRight, RefreshCw } from "lucide-react";

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

export interface MetricDashboardCard {
  id: string;
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: {
    direction: "up" | "down" | "flat";
    value: string;
  };
  sparkline?: number[];
  footer?: ReactNode;
}

export interface MetricDashboardProps {
  title?: string;
  metrics: MetricDashboardCard[];
  columns?: 1 | 2 | 3 | 4;
  autoRefreshMs?: number;
  onRefresh?: () => void | Promise<void>;
}

interface TooltipPoint {
  axisValueLabel?: string;
  value?: number | string | null;
}

const GLASS_PANEL =
  "bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 border border-white/20";
const DASHBOARD_EASE = [0.22, 1, 0.36, 1] as const;

function isTooltipPoint(value: unknown): value is TooltipPoint {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const point = value as Record<string, unknown>;
  return "axisValueLabel" in point || "value" in point;
}

function formatTooltip(params: unknown): string {
  const points = Array.isArray(params) ? params : [params];
  const firstPoint = points[0];

  if (!isTooltipPoint(firstPoint)) {
    return "";
  }

  return `${firstPoint.axisValueLabel ?? "Point"}: ${String(firstPoint.value ?? "—")}`;
}

function TrendIcon({
  direction,
}: {
  direction: NonNullable<MetricDashboardCard["trend"]>["direction"];
}) {
  if (direction === "up") {
    return <ArrowUpRight className="h-4 w-4" />;
  }

  if (direction === "down") {
    return <ArrowDownRight className="h-4 w-4" />;
  }

  return <ArrowRight className="h-4 w-4" />;
}

function sparklineOption(values: number[]) {
  return {
    animation: false,
    grid: { top: 6, right: 0, bottom: 6, left: 0 },
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => formatTooltip(params),
      backgroundColor: "rgba(15, 23, 42, 0.92)",
      borderWidth: 0,
      textStyle: { color: "#f8fafc" },
    },
    xAxis: {
      type: "category",
      data: values.map((_, index) => `#${index + 1}`),
      show: false,
    },
    yAxis: {
      type: "value",
      show: false,
    },
    series: [
      {
        type: "line",
        data: values,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color: "#0ea5e9" },
        areaStyle: { color: "rgba(14, 165, 233, 0.16)" },
      },
    ],
  };
}

function getGridClass(columns: NonNullable<MetricDashboardProps["columns"]>): string {
  if (columns === 1) {
    return "grid-cols-1";
  }

  if (columns === 2) {
    return "grid-cols-1 md:grid-cols-2";
  }

  if (columns === 3) {
    return "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";
  }

  return "grid-cols-1 md:grid-cols-2 xl:grid-cols-4";
}

export default function MetricDashboard({
  title = "Metric dashboard",
  metrics,
  columns = 4,
  autoRefreshMs,
  onRefresh,
}: MetricDashboardProps) {
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(
    autoRefreshMs !== undefined,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshText, setLastRefreshText] = useState<string | null>(null);
  const gridClass = useMemo(() => getGridClass(columns), [columns]);

  const triggerRefresh = useEffectEvent(async () => {
    if (!onRefresh) {
      return;
    }

    setIsRefreshing(true);
    try {
      await onRefresh();
      setLastRefreshText(new Date().toLocaleTimeString());
    } finally {
      setIsRefreshing(false);
    }
  });

  useEffect(() => {
    if (!autoRefreshEnabled || !autoRefreshMs || !onRefresh) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void triggerRefresh();
    }, autoRefreshMs);

    return () => window.clearInterval(intervalId);
  }, [autoRefreshEnabled, autoRefreshMs, onRefresh, triggerRefresh]);

  return (
    <section className={`overflow-hidden rounded-[2rem] ${GLASS_PANEL}`}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/15 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
            {title}
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Responsive cards with trend indicators and sparkline previews.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {autoRefreshMs ? (
            <label className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-2 text-xs font-medium text-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
              <input
                type="checkbox"
                checked={autoRefreshEnabled}
                onChange={(event) => setAutoRefreshEnabled(event.target.checked)}
                className="rounded border-white/20"
              />
              Auto refresh
            </label>
          ) : null}

          <button
            type="button"
            onClick={() => void triggerRefresh()}
            disabled={!onRefresh || isRefreshing}
            className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="px-5 py-4">
        {lastRefreshText ? (
          <p className="mb-4 text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            Last refreshed {lastRefreshText}
          </p>
        ) : null}

        <div className={`grid gap-4 ${gridClass}`}>
          {metrics.map((metric) => (
            <article
              key={metric.id}
              className="overflow-hidden rounded-[1.75rem] border border-white/15 bg-white/45 p-4 shadow-lg shadow-slate-950/8 dark:bg-slate-900/35"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {metric.title}
                  </p>
                  {metric.subtitle ? (
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      {metric.subtitle}
                    </p>
                  ) : null}
                </div>

                {metric.trend ? (
                  <div
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      metric.trend.direction === "up"
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : metric.trend.direction === "down"
                          ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
                          : "bg-slate-500/10 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <TrendIcon direction={metric.trend.direction} />
                    {metric.trend.value}
                  </div>
                ) : null}
              </div>

              <p className="mt-5 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                {metric.value}
              </p>

              {metric.sparkline && metric.sparkline.length > 0 ? (
                <div className="mt-4 overflow-hidden rounded-2xl bg-white/70 dark:bg-slate-950/45">
                  <ReactEChartsCore
                    echarts={echarts}
                    option={sparklineOption(metric.sparkline)}
                    notMerge
                    lazyUpdate
                    style={{ height: 92 }}
                  />
                </div>
              ) : null}

              {metric.footer ? (
                <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">
                  {metric.footer}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
