"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { motion, type Variants } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Blocks,
  Filter,
  LineChart,
  PieChart,
  ScatterChart,
  Search,
  Sparkles,
  SunMedium,
  Table2,
} from "lucide-react";
import ChartRenderer from "@/components/charts/chart-renderer";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ChartConfig } from "@/types/chart";
import type { ColumnProfile } from "@/types/dataset";

type ShowcaseChartType =
  | "bar"
  | "line"
  | "pie"
  | "scatter"
  | "area"
  | "heatmap"
  | "radar"
  | "funnel"
  | "treemap"
  | "sunburst";

interface ShowcaseChartGalleryProps {
  tableName: string;
  columns: ColumnProfile[];
  onSelect?: (type: string) => void;
}

interface LegacyChartGalleryProps {
  charts: ChartConfig[];
  chartData: Record<string, Record<string, unknown>[]>;
  onRemove: (id: string) => void;
  onEdit: (chart: ChartConfig) => void;
}

interface PreviewContext {
  sampleRows: Record<string, unknown>[];
  primaryCategory?: string;
  secondaryCategory?: string;
  primaryNumeric?: string;
  secondaryNumeric?: string;
  primaryDate?: string;
  lowCardinality?: string;
}

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.03 },
  },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.985 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] as const },
  },
};

const CHART_DEFINITIONS: Array<{
  id: ShowcaseChartType;
  name: string;
  description: string;
  icon: LucideIcon;
  accent: string;
}> = [
  {
    id: "bar",
    name: "Bar",
    description: "Compare values across categories with ranked bars.",
    icon: BarChart3,
    accent: "from-sky-500/20 to-cyan-500/8 text-sky-700 dark:text-sky-300",
  },
  {
    id: "line",
    name: "Line",
    description: "Track trends across time or ordered sequences.",
    icon: LineChart,
    accent: "from-emerald-500/20 to-teal-500/8 text-emerald-700 dark:text-emerald-300",
  },
  {
    id: "pie",
    name: "Pie",
    description: "Show share-of-whole composition for low-cardinality groups.",
    icon: PieChart,
    accent: "from-fuchsia-500/20 to-violet-500/8 text-fuchsia-700 dark:text-fuchsia-300",
  },
  {
    id: "scatter",
    name: "Scatter",
    description: "Reveal clusters, spread, and correlation between measures.",
    icon: ScatterChart,
    accent: "from-amber-500/20 to-orange-500/8 text-amber-700 dark:text-amber-300",
  },
  {
    id: "area",
    name: "Area",
    description: "Emphasize volume accumulation on top of trends.",
    icon: Activity,
    accent: "from-cyan-500/20 to-sky-500/8 text-cyan-700 dark:text-cyan-300",
  },
  {
    id: "heatmap",
    name: "Heatmap",
    description: "Spot dense intersections across two dimensions.",
    icon: Table2,
    accent: "from-rose-500/20 to-amber-500/8 text-rose-700 dark:text-rose-300",
  },
  {
    id: "radar",
    name: "Radar",
    description: "Compare multi-metric shapes across a few entities.",
    icon: Sparkles,
    accent: "from-violet-500/20 to-indigo-500/8 text-violet-700 dark:text-violet-300",
  },
  {
    id: "funnel",
    name: "Funnel",
    description: "Present descending stage volume or ranked drop-off.",
    icon: Filter,
    accent: "from-amber-500/20 to-yellow-500/8 text-amber-700 dark:text-amber-300",
  },
  {
    id: "treemap",
    name: "Treemap",
    description: "Visualize hierarchical share with nested blocks.",
    icon: Blocks,
    accent: "from-lime-500/20 to-emerald-500/8 text-lime-700 dark:text-lime-300",
  },
  {
    id: "sunburst",
    name: "Sunburst",
    description: "Show layered hierarchy as rings from center to edge.",
    icon: SunMedium,
    accent: "from-orange-500/20 to-rose-500/8 text-orange-700 dark:text-orange-300",
  },
];

function isLegacyProps(
  props: ShowcaseChartGalleryProps | LegacyChartGalleryProps,
): props is LegacyChartGalleryProps {
  return "charts" in props;
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function useDarkMode() {
  const [dark, setDark] = useState(false);
  const syncDarkMode = useEffectEvent(() => {
    setDark(document.documentElement.classList.contains("dark"));
  });

  useEffect(() => {
    syncDarkMode();
    const observer = new MutationObserver(() => syncDarkMode());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return dark;
}

function asNumber(value: unknown) {
  const numeric = value == null ? Number.NaN : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function aggregateCounts(rows: Record<string, unknown>[], key?: string, limit = 6) {
  if (!key) return [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = String(row[key] ?? "").trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }));
}

function aggregateAverage(
  rows: Record<string, unknown>[],
  category?: string,
  numeric?: string,
  limit = 6,
) {
  if (!category || !numeric) return [];
  const aggregates = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    const label = String(row[category] ?? "").trim();
    const value = asNumber(row[numeric]);
    if (!label || !Number.isFinite(value)) continue;
    const current = aggregates.get(label) ?? { sum: 0, count: 0 };
    current.sum += value;
    current.count += 1;
    aggregates.set(label, current);
  }
  return [...aggregates.entries()]
    .map(([label, entry]) => ({ label, value: entry.sum / Math.max(entry.count, 1) }))
    .sort((left, right) => right.value - left.value)
    .slice(0, limit);
}

function aggregateTimeline(rows: Record<string, unknown>[], date?: string, numeric?: string) {
  if (!date) return [];
  const series = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    const raw = row[date];
    const label = raw == null ? "" : String(raw).slice(0, 10);
    if (!label) continue;
    const value = numeric ? asNumber(row[numeric]) : 1;
    const current = series.get(label) ?? { sum: 0, count: 0 };
    current.sum += value;
    current.count += 1;
    series.set(label, current);
  }
  return [...series.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .slice(0, 18)
    .map(([label, entry]) => ({
      label,
      value: numeric ? entry.sum / Math.max(entry.count, 1) : entry.count,
    }));
}

function buildPreviewOption(
  type: ShowcaseChartType,
  context: PreviewContext,
  dark: boolean,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#334155";
  const gridColor = dark ? "#1e293b" : "#e2e8f0";
  const background = dark ? "#0f172acc" : "#ffffffee";
  const topCategories =
    aggregateAverage(
      context.sampleRows,
      context.primaryCategory,
      context.primaryNumeric,
    );
  const counts = topCategories.length > 0
    ? topCategories
    : aggregateCounts(context.sampleRows, context.lowCardinality || context.primaryCategory);
  const timeline = aggregateTimeline(
    context.sampleRows,
    context.primaryDate,
    context.primaryNumeric,
  );

  if (type === "pie") {
    return {
      animationDuration: 420,
      tooltip: { trigger: "item", backgroundColor: background, textStyle: { color: textColor } },
      series: [{
        type: "pie",
        radius: ["44%", "70%"],
        center: ["50%", "50%"],
        label: { show: false },
        itemStyle: { borderColor: dark ? "#020617" : "#ffffff", borderWidth: 2 },
        data: counts.map((entry, index) => ({
          name: entry.label,
          value: entry.value,
          itemStyle: { color: ["#38bdf8", "#22c55e", "#a78bfa", "#f59e0b", "#fb7185", "#14b8a6"][index % 6] },
        })),
      }],
    };
  }

  if (type === "scatter") {
    const points = context.sampleRows
      .map((row) => [asNumber(row[context.primaryNumeric ?? ""]), asNumber(row[context.secondaryNumeric ?? ""])])
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    return {
      animationDuration: 420,
      grid: { top: 12, right: 12, bottom: 18, left: 24 },
      xAxis: { type: "value", axisLabel: { show: false }, splitLine: { lineStyle: { color: gridColor, type: "dashed" } } },
      yAxis: { type: "value", axisLabel: { show: false }, splitLine: { lineStyle: { color: gridColor, type: "dashed" } } },
      series: [{ type: "scatter", data: points.slice(0, 42), symbolSize: 8, itemStyle: { color: "#f59e0b", opacity: 0.75 } }],
    };
  }

  if (type === "line" || type === "area") {
    const rows = timeline.length > 0 ? timeline : counts;
    return {
      animationDuration: 420,
      grid: { top: 12, right: 12, bottom: 18, left: 24 },
      xAxis: { type: "category", data: rows.map((entry) => entry.label), axisLabel: { show: false }, axisLine: { lineStyle: { color: gridColor } } },
      yAxis: { type: "value", axisLabel: { show: false }, splitLine: { lineStyle: { color: gridColor, type: "dashed" } } },
      series: [{
        type: "line",
        data: rows.map((entry) => Number(entry.value.toFixed(2))),
        smooth: true,
        showSymbol: false,
        lineStyle: { color: type === "area" ? "#06b6d4" : "#10b981", width: 2.2 },
        areaStyle: type === "area" ? { color: "rgba(6,182,212,0.16)" } : undefined,
      }],
    };
  }

  if (type === "heatmap") {
    const rowKey = context.primaryCategory;
    const colKey = context.secondaryCategory || context.lowCardinality;
    const rows = aggregateCounts(context.sampleRows, rowKey, 5).map((entry) => entry.label);
    const columns = aggregateCounts(context.sampleRows, colKey, 5).map((entry) => entry.label);
    const matrix = new Map<string, number>();
    for (const row of context.sampleRows) {
      const left = String(row[rowKey ?? ""] ?? "").trim();
      const right = String(row[colKey ?? ""] ?? "").trim();
      if (!left || !right || !rows.includes(left) || !columns.includes(right)) continue;
      const key = `${left}::${right}`;
      matrix.set(key, (matrix.get(key) ?? 0) + 1);
    }
    return {
      animationDuration: 420,
      grid: { top: 12, right: 12, bottom: 26, left: 36 },
      xAxis: { type: "category", data: columns, axisLabel: { show: false } },
      yAxis: { type: "category", data: rows, axisLabel: { show: false } },
      visualMap: { show: false, min: 0, max: Math.max(...matrix.values(), 1), inRange: { color: ["#fef3c7", "#fb7185"] } },
      series: [{
        type: "heatmap",
        data: rows.flatMap((rowLabel, rowIndex) =>
          columns.map((colLabel, colIndex) => [colIndex, rowIndex, matrix.get(`${rowLabel}::${colLabel}`) ?? 0])),
      }],
    };
  }

  if (type === "radar") {
    const values = counts.slice(0, 5);
    return {
      animationDuration: 420,
      radar: {
        radius: "62%",
        indicator: values.map((entry) => ({ name: entry.label, max: Math.max(...values.map((item) => item.value), 1) })),
        axisName: { show: false },
        splitLine: { lineStyle: { color: gridColor } },
        splitArea: { areaStyle: { color: ["transparent"] } },
      },
      series: [{ type: "radar", data: [{ value: values.map((entry) => entry.value), areaStyle: { color: "rgba(168,85,247,0.16)" }, lineStyle: { color: "#8b5cf6" }, itemStyle: { color: "#8b5cf6" } }] }],
    };
  }

  if (type === "funnel") {
    return {
      animationDuration: 420,
      series: [{
        type: "funnel",
        width: "80%",
        height: "78%",
        left: "10%",
        top: "10%",
        label: { show: false },
        itemStyle: { borderWidth: 0 },
        data: counts.slice(0, 5).map((entry, index) => ({
          name: entry.label,
          value: entry.value,
          itemStyle: { color: ["#f59e0b", "#fb923c", "#f97316", "#ef4444", "#dc2626"][index % 5] },
        })),
      }],
    };
  }

  if (type === "treemap" || type === "sunburst") {
    const children = counts.slice(0, 6).map((entry, index) => ({
      name: entry.label,
      value: entry.value,
      itemStyle: { color: ["#84cc16", "#22c55e", "#14b8a6", "#38bdf8", "#a78bfa", "#f97316"][index % 6] },
    }));
    return {
      animationDuration: 420,
      series: [{
        type,
        radius: type === "sunburst" ? ["16%", "78%"] : undefined,
        roam: false,
        breadcrumb: { show: false },
        label: { show: false },
        data: type === "sunburst" ? [{ name: "root", children }] : children,
      }],
    };
  }

  return {
    animationDuration: 420,
    grid: { top: 12, right: 12, bottom: 18, left: 44 },
    xAxis: { type: "value", axisLabel: { show: false }, splitLine: { lineStyle: { color: gridColor, type: "dashed" } } },
    yAxis: { type: "category", inverse: true, data: counts.map((entry) => entry.label), axisLabel: { show: false } },
    series: [{ type: "bar", data: counts.map((entry) => entry.value), barWidth: 10, itemStyle: { color: "#38bdf8", borderRadius: [0, 999, 999, 0] } }],
  };
}

function LegacyChartGallery({
  charts,
  chartData,
  onRemove,
  onEdit,
}: LegacyChartGalleryProps) {
  if (charts.length === 0) {
    return (
      <div className="rounded-[28px] border border-white/15 bg-white/55 p-8 text-center shadow-[0_24px_80px_-40px_rgba(15,23,42,0.6)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/44">
        <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">No saved charts yet</p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Save a chart from the builder to keep a rendered copy here.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {charts.map((chart) => (
        <div key={chart.id} className="rounded-[28px] border border-white/15 bg-white/55 p-4 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.6)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/44">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-base font-semibold text-slate-900 dark:text-slate-50">{chart.title || "Untitled chart"}</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{chart.type} • {(chartData[chart.id] ?? []).length.toLocaleString()} preview rows</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => onEdit(chart)} className="rounded-xl border border-slate-200/80 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-800 dark:text-slate-200">Edit</button>
              <button type="button" onClick={() => onRemove(chart.id)} className="rounded-xl border border-rose-300/40 px-3 py-1.5 text-xs font-medium text-rose-700 dark:border-rose-500/30 dark:text-rose-300">Remove</button>
            </div>
          </div>
          <div className="mt-4 overflow-hidden rounded-[22px] border border-slate-200/80 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/60">
            <ChartRenderer config={chart} data={chartData[chart.id] ?? chart.data ?? []} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ShowcaseChartGallery({
  tableName,
  columns,
  onSelect,
}: ShowcaseChartGalleryProps) {
  const dark = useDarkMode();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [sampleRows, setSampleRows] = useState<Record<string, unknown>[]>([]);
  const [sampleKey, setSampleKey] = useState("");

  const context = useMemo<PreviewContext>(() => {
    const categorical = columns.filter((column) => column.type === "string");
    const lowCardinality = categorical.find((column) => column.uniqueCount > 1 && column.uniqueCount <= 10)?.name;
    const numeric = columns.filter((column) => column.type === "number");
    const dates = columns.filter((column) => column.type === "date");
    const previewColumns = [
      categorical[0]?.name,
      categorical[1]?.name,
      numeric[0]?.name,
      numeric[1]?.name,
      dates[0]?.name,
      lowCardinality,
    ].filter((value): value is string => Boolean(value));
    const expectedKey = `${tableName}:${previewColumns.join("|")}`;
    return {
      sampleRows: sampleKey === expectedKey ? sampleRows : [],
      primaryCategory: categorical[0]?.name,
      secondaryCategory: categorical[1]?.name,
      primaryNumeric: numeric[0]?.name,
      secondaryNumeric: numeric[1]?.name,
      primaryDate: dates[0]?.name,
      lowCardinality,
    };
  }, [columns, sampleKey, sampleRows, tableName]);

  useEffect(() => {
    let cancelled = false;
    const selectColumns = [
      context.primaryCategory,
      context.secondaryCategory,
      context.primaryNumeric,
      context.secondaryNumeric,
      context.primaryDate,
      context.lowCardinality,
    ].filter((value): value is string => Boolean(value));

    if (!tableName || selectColumns.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    const uniqueColumns = [...new Set(selectColumns)];
    const nextKey = `${tableName}:${uniqueColumns.join("|")}`;

    async function loadSampleRows() {
      try {
        const rows = await runQuery(
          `SELECT ${uniqueColumns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(tableName)} LIMIT 120`,
        );
        if (!cancelled) {
          startTransition(() => {
            setSampleRows(rows);
            setSampleKey(nextKey);
          });
        }
      } catch {
        if (!cancelled) {
          startTransition(() => {
            setSampleRows([]);
            setSampleKey(nextKey);
          });
        }
      }
    }

    void loadSampleRows();

    return () => {
      cancelled = true;
    };
  }, [
    context.lowCardinality,
    context.primaryCategory,
    context.primaryDate,
    context.primaryNumeric,
    context.secondaryCategory,
    context.secondaryNumeric,
    tableName,
  ]);

  const filteredCharts = useMemo(() => {
    const search = deferredQuery.trim().toLowerCase();
    const supportsCategory = Boolean(context.primaryCategory);
    const supportsHierarchy = Boolean(context.primaryCategory && (context.secondaryCategory || context.lowCardinality));
    const supportsTrend = Boolean(context.primaryDate && context.primaryNumeric);
    const supportsScatter = Boolean(context.primaryNumeric && context.secondaryNumeric);
    const supportsDistribution = Boolean(context.lowCardinality || context.primaryCategory);

    const matchesSearch = (name: string, description: string) =>
      !search ||
      name.toLowerCase().includes(search) ||
      description.toLowerCase().includes(search);

    return CHART_DEFINITIONS
      .filter((definition) => matchesSearch(definition.name, definition.description))
      .map((definition) => ({
        ...definition,
        recommended:
          (definition.id === "bar" && supportsCategory) ||
          ((definition.id === "line" || definition.id === "area") && supportsTrend) ||
          ((definition.id === "pie" || definition.id === "funnel") && supportsDistribution) ||
          (definition.id === "scatter" && supportsScatter) ||
          (definition.id === "heatmap" && Boolean(context.primaryCategory && (context.secondaryCategory || context.lowCardinality))) ||
          (definition.id === "radar" && Boolean(context.primaryCategory && context.primaryNumeric)) ||
          ((definition.id === "treemap" || definition.id === "sunburst") && supportsHierarchy),
      }))
      .sort((left, right) => Number(right.recommended) - Number(left.recommended) || left.name.localeCompare(right.name));
  }, [context.lowCardinality, context.primaryCategory, context.primaryDate, context.primaryNumeric, context.secondaryCategory, context.secondaryNumeric, deferredQuery]);

  return (
    <section className="overflow-hidden rounded-[30px] border border-white/15 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.72),rgba(248,250,252,0.66))] p-6 shadow-[0_28px_90px_-42px_rgba(15,23,42,0.7)] backdrop-blur-2xl dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.1),transparent_24%),linear-gradient(180deg,rgba(2,6,23,0.88),rgba(15,23,42,0.82))]">
      <div className="flex flex-col gap-4 border-b border-white/15 pb-5 dark:border-white/10 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700 dark:text-cyan-300">
            <Sparkles className="h-3.5 w-3.5" />
            Chart Gallery
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Preview every chart style before you commit</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
            {formatNumber(columns.length)} columns detected for <span className="font-medium text-slate-900 dark:text-slate-100">{tableName}</span>. Recommended cards float to the top based on the current schema.
          </p>
        </div>
        <label className="relative block w-full max-w-md">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find chart types"
            className="w-full rounded-2xl border border-white/20 bg-white/70 py-3 pl-11 pr-4 text-sm text-slate-900 shadow-sm outline-none ring-0 placeholder:text-slate-400 focus:border-cyan-400/40 dark:border-white/10 dark:bg-slate-900/70 dark:text-slate-100"
          />
        </label>
      </div>

      <motion.div variants={containerVariants} initial="hidden" animate="show" className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {filteredCharts.map((definition) => {
          const Icon = definition.icon;
          return (
            <motion.button
              key={definition.id}
              type="button"
              variants={cardVariants}
              onClick={() => onSelect?.(definition.id)}
              className="group overflow-hidden rounded-[28px] border border-white/15 bg-white/58 p-5 text-left shadow-[0_24px_84px_-44px_rgba(15,23,42,0.8)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-cyan-400/25 hover:bg-white/72 dark:border-white/10 dark:bg-slate-950/44 dark:hover:bg-slate-900/56"
            >
              <div className="flex items-start justify-between gap-3">
                <div className={`rounded-2xl bg-linear-to-br ${definition.accent} p-3`}>
                  <Icon className="h-5 w-5" />
                </div>
                {definition.recommended ? (
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                    Recommended
                  </span>
                ) : null}
              </div>

              <div className="mt-4">
                <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">{definition.name}</p>
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{definition.description}</p>
              </div>

              <div className="mt-4 h-44 overflow-hidden rounded-[24px] border border-white/15 bg-white/70 p-3 dark:border-white/10 dark:bg-slate-900/70">
                <ReactECharts
                  option={buildPreviewOption(definition.id, context, dark)}
                  notMerge
                  lazyUpdate
                  opts={{ renderer: "svg" }}
                  style={{ height: "100%", width: "100%" }}
                />
              </div>
            </motion.button>
          );
        })}
      </motion.div>
    </section>
  );
}

export default function ChartGallery(
  props: ShowcaseChartGalleryProps | LegacyChartGalleryProps,
) {
  return isLegacyProps(props) ? (
    <LegacyChartGallery {...props} />
  ) : (
    <ShowcaseChartGallery {...props} />
  );
}
