"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Expand,
  LineChart,
  Maximize2,
  Minimize2,
  PieChart,
  ScatterChart,
  Settings2,
  Trash2,
} from "lucide-react";
import type { ChartConfig, ChartType } from "@/types/chart";
import ChartRenderer from "@/components/charts/chart-renderer";

export interface ChartGalleryProps {
  charts: ChartConfig[];
  chartData: Record<string, Record<string, unknown>[]>;
  onRemove: (id: string) => void;
  onEdit: (chart: ChartConfig) => void;
}

type GalleryChartType = Exclude<ChartType, "heatmap">;

const CHART_TYPE_META: Record<
  GalleryChartType,
  {
    label: string;
    icon: LucideIcon;
    badge: string;
  }
> = {
  bar: {
    label: "Bar",
    icon: BarChart3,
    badge: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  },
  line: {
    label: "Line",
    icon: LineChart,
    badge: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  },
  pie: {
    label: "Pie",
    icon: PieChart,
    badge: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  },
  scatter: {
    label: "Scatter",
    icon: ScatterChart,
    badge: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  },
  area: {
    label: "Area",
    icon: Activity,
    badge: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
  },
  histogram: {
    label: "Histogram",
    icon: BarChart3,
    badge: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  },
};

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 18, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.3, ease: "easeOut" as const },
  },
};

export default function ChartGallery({
  charts,
  chartData,
  onRemove,
  onEdit,
}: ChartGalleryProps) {
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);

  const fullscreenChart = useMemo(
    () => charts.find((chart) => chart.id === fullscreenId) ?? null,
    [charts, fullscreenId],
  );

  useEffect(() => {
    if (!fullscreenId) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setFullscreenId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [fullscreenId]);

  if (charts.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl border border-white/30 bg-white/60 p-10 text-center shadow-[0_24px_80px_-36px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45"
      >
        <div className="mx-auto mb-4 inline-flex rounded-2xl border border-white/60 bg-white/70 p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
          <Expand className="h-7 w-7 text-slate-400 dark:text-slate-500" />
        </div>
        <h3 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          No saved charts yet
        </h3>
        <p className="mx-auto mt-2 max-w-lg text-sm text-slate-600 dark:text-slate-400">
          Save a chart from the builder to populate this gallery with live previews you can edit, remove, or inspect fullscreen.
        </p>
      </motion.div>
    );
  }

  return (
    <>
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3"
      >
        {charts.map((chart) => {
          const type = (chart.type === "heatmap" ? "bar" : chart.type) as GalleryChartType;
          const meta = CHART_TYPE_META[type];
          const Icon = meta.icon;
          const data = chartData[chart.id] ?? chart.data ?? [];

          return (
            <motion.article
              key={chart.id}
              variants={itemVariants}
              layout
              className="group overflow-hidden rounded-3xl border border-white/30 bg-white/60 shadow-[0_24px_80px_-36px_rgba(15,23,42,0.55)] backdrop-blur-2xl transition-shadow hover:shadow-[0_28px_90px_-32px_rgba(15,23,42,0.62)] dark:border-white/10 dark:bg-slate-950/45"
            >
              <div className="border-b border-slate-200/70 bg-linear-to-br from-white/70 to-slate-100/40 p-5 dark:border-slate-800/80 dark:from-slate-900/70 dark:to-slate-950/40">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                      {chart.title || "Untitled chart"}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                      {data.length.toLocaleString()} preview rows
                    </p>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.badge}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {meta.label}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onEdit(chart)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-slate-700 dark:hover:bg-slate-900"
                  >
                    <Settings2 className="h-4 w-4" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setFullscreenId(chart.id)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-slate-700 dark:hover:bg-slate-900"
                  >
                    <Maximize2 className="h-4 w-4" />
                    Fullscreen
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(chart.id)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-red-200/80 bg-red-50/80 px-3 py-2 text-sm font-medium text-red-700 shadow-sm transition hover:bg-red-100 dark:border-red-500/20 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/40"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>

              <div className="p-5">
                <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-linear-to-br from-white/90 via-white/70 to-slate-100/60 p-4 shadow-inner dark:border-slate-800/80 dark:from-slate-900/95 dark:via-slate-950/80 dark:to-slate-900/70">
                  {data.length > 0 ? (
                    <ChartRenderer config={chart} data={data} />
                  ) : (
                    <div className="flex min-h-[380px] flex-col items-center justify-center gap-3 text-center text-slate-500 dark:text-slate-400">
                      <BarChart3 className="h-8 w-8 text-slate-400 dark:text-slate-500" />
                      <div>
                        <p className="text-base font-semibold text-slate-900 dark:text-slate-100">
                          No preview data
                        </p>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Attach query results for this chart to render its preview.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.article>
          );
        })}
      </motion.div>

      <AnimatePresence>
        {fullscreenChart && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
          >
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setFullscreenId(null)}
              className="absolute inset-0 bg-slate-950/65 backdrop-blur-sm"
              aria-label="Close fullscreen chart"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 18 }}
              transition={{ duration: 0.24, ease: "easeOut" }}
              className="relative z-10 flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[32px] border border-white/30 bg-white/90 shadow-2xl backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/90"
            >
              <div className="flex items-center justify-between border-b border-slate-200/70 px-6 py-5 dark:border-slate-800/80">
                <div className="min-w-0">
                  <h3 className="truncate text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                    {fullscreenChart.title || "Untitled chart"}
                  </h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    {(chartData[fullscreenChart.id] ?? fullscreenChart.data ?? []).length.toLocaleString()} preview rows
                  </p>
                </div>

                <div className="ml-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onEdit(fullscreenChart)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-slate-700 dark:hover:bg-slate-900"
                  >
                    <Settings2 className="h-4 w-4" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setFullscreenId(null)}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                  >
                    <Minimize2 className="h-4 w-4" />
                    Close
                  </button>
                </div>
              </div>

              <div className="overflow-auto p-6">
                <div className="overflow-hidden rounded-[30px] border border-slate-200/80 bg-linear-to-br from-white/90 via-white/70 to-slate-100/60 p-5 shadow-inner dark:border-slate-800/80 dark:from-slate-900/95 dark:via-slate-950/80 dark:to-slate-900/70">
                  <ChartRenderer
                    config={fullscreenChart}
                    data={chartData[fullscreenChart.id] ?? fullscreenChart.data ?? []}
                  />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
