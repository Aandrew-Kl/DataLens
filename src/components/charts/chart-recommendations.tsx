"use client";

import { startTransition, useEffect, useEffectEvent, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import type { LucideIcon } from "lucide-react";
import { BarChart3, Database, LineChart, Loader2, PieChart, Play, ScatterChart, Sigma, Sparkles } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";
interface ChartRecommendationsProps { tableName: string; columns: ColumnProfile[]; rowCount: number; }
type RecommendationType = "bar" | "line" | "pie" | "scatter" | "histogram";
type DetectedKind = "number" | "date" | "boolean" | "category" | "unknown";
interface Recommendation { id: RecommendationType; type: RecommendationType; title: string; reason: string; sql: string; }
const CHART_META: Record<RecommendationType, { label: string; icon: LucideIcon; accent: string }> = {
  bar: { label: "Bar", icon: BarChart3, accent: "border-blue-400/30 bg-blue-500/12 text-blue-700 dark:text-blue-300" },
  line: { label: "Line", icon: LineChart, accent: "border-emerald-400/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  pie: { label: "Pie", icon: PieChart, accent: "border-fuchsia-400/30 bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-300" },
  scatter: { label: "Scatter", icon: ScatterChart, accent: "border-amber-400/30 bg-amber-500/12 text-amber-700 dark:text-amber-300" },
  histogram: { label: "Histogram", icon: Sigma, accent: "border-rose-400/30 bg-rose-500/12 text-rose-700 dark:text-rose-300" },
};
const PALETTE = ["#38bdf8", "#14b8a6", "#34d399", "#f59e0b", "#f97316", "#f43f5e"];
function quoteId(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
function looksNumeric(value: string | number | boolean | null): boolean {
  return typeof value === "number"
    ? Number.isFinite(value)
    : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim());
}
function looksDate(value: string | number | boolean | null): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return !!text && /[-/T:]/.test(text) && !Number.isNaN(Date.parse(text));
}
function detectKind(column: ColumnProfile): DetectedKind {
  if (column.type === "number" || column.type === "date" || column.type === "boolean") return column.type;
  if (column.type === "string") return "category";
  const samples = column.sampleValues.filter((value) => value !== null);
  if (samples.length > 0 && samples.every((value) => looksNumeric(value))) return "number";
  if (samples.length > 0 && samples.every((value) => looksDate(value))) return "date";
  return samples.length > 0 ? "category" : "unknown";
}
function scoreColumn(column: ColumnProfile, rowCount: number): number {
  const completeness = rowCount > 0 ? 1 - column.nullCount / rowCount : 1;
  const uniqueness = rowCount > 0 ? column.uniqueCount / rowCount : 0;
  return completeness * 10 + Math.min(uniqueness, 1) * 4;
}
function isCategorical(column: ColumnProfile, rowCount: number): boolean {
  const kind = detectKind(column);
  const ratio = rowCount > 0 ? column.uniqueCount / rowCount : 0;
  return kind === "boolean" || kind === "category" || (kind === "number" && column.uniqueCount > 1 && column.uniqueCount <= 12 && ratio <= 0.25);
}
function pickColumns(columns: ColumnProfile[], rowCount: number) {
  const numeric = columns
    .filter((column) => detectKind(column) === "number" && column.uniqueCount > 1)
    .sort((left, right) => scoreColumn(right, rowCount) - scoreColumn(left, rowCount));
  const dates = columns
    .filter((column) => detectKind(column) === "date")
    .sort((left, right) => scoreColumn(right, rowCount) - scoreColumn(left, rowCount));
  const categorical = columns
    .filter((column) => isCategorical(column, rowCount) && column.uniqueCount > 1)
    .sort((left, right) => scoreColumn(right, rowCount) - scoreColumn(left, rowCount));
  return { numeric, dates, categorical, lowCardinality: categorical.filter((column) => column.uniqueCount <= 8) };
}
function buildRecommendations(tableName: string, columns: ColumnProfile[], rowCount: number): Recommendation[] {
  const { numeric, dates, categorical, lowCardinality } = pickColumns(columns, rowCount);
  const table = quoteId(tableName);
  const metric = numeric[0];
  const category = categorical[0];
  const pieCategory = lowCardinality[0];
  const time = dates[0];
  const recommendations: Recommendation[] = [];
  if (category) {
    const categoryId = quoteId(category.name);
    recommendations.push(metric
      ? {
          id: "bar",
          type: "bar",
          title: `${metric.name} by ${category.name}`,
          reason: `${category.name} behaves like a category and ${metric.name} is numeric, so a ranked bar chart is the strongest comparison view.`,
          sql: `SELECT ${categoryId} AS label, AVG(${quoteId(metric.name)}) AS value FROM ${table} WHERE ${categoryId} IS NOT NULL AND ${quoteId(metric.name)} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
        }
      : {
          id: "bar",
          type: "bar",
          title: `Row count by ${category.name}`,
          reason: `${category.name} has manageable cardinality, which makes category counts a good first diagnostic chart.`,
          sql: `SELECT ${categoryId} AS label, COUNT(*) AS value FROM ${table} WHERE ${categoryId} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
        });
  }
  if (time && metric) {
    recommendations.push({
      id: "line",
      type: "line",
      title: `${metric.name} over ${time.name}`,
      reason: `${time.name} is temporal and ${metric.name} is numeric, so a line chart is the clearest trend recommendation.`,
      sql: `SELECT ${quoteId(time.name)} AS label, AVG(${quoteId(metric.name)}) AS value FROM ${table} WHERE ${quoteId(time.name)} IS NOT NULL AND ${quoteId(metric.name)} IS NOT NULL GROUP BY 1 ORDER BY 1 ASC LIMIT 120`,
    });
  }
  if (pieCategory) {
    recommendations.push(metric
      ? {
          id: "pie",
          type: "pie",
          title: `${pieCategory.name} share`,
          reason: `${pieCategory.name} only has ${pieCategory.uniqueCount} distinct values, which fits a share-of-whole chart.`,
          sql: `SELECT ${quoteId(pieCategory.name)} AS label, AVG(${quoteId(metric.name)}) AS value FROM ${table} WHERE ${quoteId(pieCategory.name)} IS NOT NULL AND ${quoteId(metric.name)} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        }
      : {
          id: "pie",
          type: "pie",
          title: `${pieCategory.name} composition`,
          reason: `${pieCategory.name} is low-cardinality, so its composition can be read without slicing into dozens of segments.`,
          sql: `SELECT ${quoteId(pieCategory.name)} AS label, COUNT(*) AS value FROM ${table} WHERE ${quoteId(pieCategory.name)} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        });
  }
  if (numeric.length >= 2 && rowCount >= 12) {
    recommendations.push({
      id: "scatter",
      type: "scatter",
      title: `${numeric[1].name} vs ${numeric[0].name}`,
      reason: `${numeric[0].name} and ${numeric[1].name} are both numeric, so a scatter plot can reveal clusters, gaps, and correlation.`,
      sql: `SELECT ${quoteId(numeric[0].name)} AS x, ${quoteId(numeric[1].name)} AS y FROM ${table} WHERE ${quoteId(numeric[0].name)} IS NOT NULL AND ${quoteId(numeric[1].name)} IS NOT NULL LIMIT 400`,
    });
  }
  if (metric) {
    recommendations.push({
      id: "histogram",
      type: "histogram",
      title: `${metric.name} distribution`,
      reason: `${metric.name} is numeric, which makes a histogram the fastest way to inspect spread, skew, and potential outliers.`,
      sql: `SELECT ${quoteId(metric.name)} AS value FROM ${table} WHERE ${quoteId(metric.name)} IS NOT NULL LIMIT 5000`,
    });
  }
  return recommendations;
}
function buildOption(recommendation: Recommendation, rows: Record<string, unknown>[], dark: boolean): EChartsOption {
  const text = dark ? "#cbd5e1" : "#334155";
  const border = dark ? "#1e293b" : "#e2e8f0";
  const tooltip = { backgroundColor: dark ? "#0f172acc" : "#ffffffee", textStyle: { color: text } };
  const labels = rows.map((row) => String(row.label ?? ""));
  const values = rows.map((row) => Number(row.value ?? 0));
  if (recommendation.type === "pie") {
    return {
      tooltip: { ...tooltip, trigger: "item" },
      legend: { bottom: 0, textStyle: { color: text } },
      series: [{
        type: "pie",
        radius: ["38%", "72%"],
        center: ["50%", "45%"],
        color: PALETTE,
        data: rows.map((row) => ({ name: String(row.label ?? ""), value: Number(row.value ?? 0) })),
        label: { color: text, formatter: "{b}: {d}%" },
        itemStyle: { borderColor: dark ? "#020617" : "#ffffff", borderWidth: 2 },
      }],
    };
  }
  if (recommendation.type === "scatter") {
    return {
      tooltip: { ...tooltip, trigger: "item" },
      grid: { top: 30, right: 18, bottom: 28, left: 50 },
      xAxis: { type: "value", axisLabel: { color: text }, splitLine: { lineStyle: { color: border, type: "dashed" } } },
      yAxis: { type: "value", axisLabel: { color: text }, splitLine: { lineStyle: { color: border, type: "dashed" } } },
      series: [{
        type: "scatter",
        symbolSize: 9,
        itemStyle: { color: PALETTE[3], opacity: 0.72 },
        data: rows.map((row) => [Number(row.x ?? 0), Number(row.y ?? 0)]),
      }],
    };
  }
  if (recommendation.type === "histogram") {
    const histogramValues = rows.map((row) => Number(row.value ?? 0)).filter((value) => Number.isFinite(value));
    const min = Math.min(...histogramValues);
    const max = Math.max(...histogramValues);
    const binCount = Math.max(6, Math.min(18, Math.round(Math.sqrt(histogramValues.length))));
    const step = (max - min) / binCount || 1;
    const counts = new Array<number>(binCount).fill(0);
    const bins = counts.map((_, index) => {
      const start = min + index * step;
      return `${start.toFixed(1)}-${(start + step).toFixed(1)}`;
    });
    histogramValues.forEach((value) => {
      const rawIndex = Math.floor((value - min) / step);
      const index = Math.min(Math.max(rawIndex, 0), binCount - 1);
      counts[index] += 1;
    });
    return {
      tooltip: { ...tooltip, trigger: "axis" },
      grid: { top: 30, right: 18, bottom: 60, left: 50 },
      xAxis: { type: "category", data: bins, axisLabel: { color: text, rotate: 24 }, axisLine: { lineStyle: { color: border } } },
      yAxis: { type: "value", axisLabel: { color: text }, splitLine: { lineStyle: { color: border, type: "dashed" } } },
      series: [{ type: "bar", data: counts, itemStyle: { color: PALETTE[4], borderRadius: [4, 4, 0, 0] }, barWidth: "92%" }],
    };
  }
  return {
    tooltip: { ...tooltip, trigger: "axis" },
    grid: { top: 30, right: 18, bottom: 54, left: 50 },
    xAxis: { type: "category", data: labels, axisLabel: { color: text, rotate: labels.length > 8 ? 22 : 0 }, axisLine: { lineStyle: { color: border } } },
    yAxis: { type: "value", axisLabel: { color: text }, splitLine: { lineStyle: { color: border, type: "dashed" } } },
    series: [{
      type: recommendation.type === "line" ? "line" : "bar",
      data: values,
      smooth: recommendation.type === "line",
      color: recommendation.type === "line" ? PALETTE[1] : PALETTE[0],
      itemStyle: recommendation.type === "bar" ? { borderRadius: [4, 4, 0, 0] } : undefined,
      areaStyle: recommendation.type === "line" ? { opacity: 0.08 } : undefined,
    }],
  };
}
export default function ChartRecommendations({ tableName, columns, rowCount }: ChartRecommendationsProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cachedResults, setCachedResults] = useState<Record<string, Record<string, unknown>[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const recommendations = buildRecommendations(tableName, columns, rowCount);
  const signature = `${tableName}:${rowCount}:${columns.map((column) => `${column.name}:${column.type}:${column.uniqueCount}:${column.nullCount}`).join("|")}`;
  const activeRecommendation = recommendations.find((item) => item.id === activeId) ?? null;
  const activeRows = activeId ? cachedResults[activeId] ?? [] : [];
  const syncDarkMode = useEffectEvent(() => setDark(document.documentElement.classList.contains("dark")));
  useEffect(() => {
    syncDarkMode();
    const observer = new MutationObserver(() => syncDarkMode());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setActiveId(null);
    setCachedResults({});
    setLoadingId(null);
    setError(null);
  }, [signature]);
  async function handleRun(recommendation: Recommendation) {
    setActiveId(recommendation.id);
    setError(null);
    if (cachedResults[recommendation.id]) return;
    setLoadingId(recommendation.id);
    try {
      const rows = await runQuery(recommendation.sql);
      startTransition(() => setCachedResults((current) => ({ ...current, [recommendation.id]: rows })));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to generate chart preview.");
    } finally {
      setLoadingId(null);
    }
  }
  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200/70 bg-linear-to-br from-slate-50 via-white to-slate-100/70 shadow-[0_28px_90px_-44px_rgba(15,23,42,0.45)] dark:border-slate-800/80 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900/90">
      <div className="border-b border-slate-200/80 px-6 py-5 dark:border-slate-800/80">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700 dark:text-cyan-300"><Sparkles className="h-3.5 w-3.5" />Chart Recommendations</div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Schema-aware chart ideas for {tableName}</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{formatNumber(rowCount)} rows across {columns.length} columns. Click any card to run its preview query.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-2 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300"><Database className="h-4 w-4" />DuckDB + ECharts preview</div>
        </div>
      </div>

      {recommendations.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/80 text-slate-400 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-500"><BarChart3 className="h-7 w-7" /></div>
          <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">No confident recommendations yet</h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Add at least one usable numeric, date, or categorical profile to unlock chart suggestions.</p>
        </div>
      ) : (
        <div className="grid gap-6 p-6 xl:grid-cols-[1.08fr_1fr]">
          <div className="space-y-4">
            {recommendations.map((recommendation, index) => {
              const meta = CHART_META[recommendation.type];
              const Icon = meta.icon;
              const isActive = recommendation.id === activeId;
              const isLoading = recommendation.id === loadingId;
              return (
                <motion.button key={recommendation.id} type="button" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05, duration: 0.3 }} onClick={() => void handleRun(recommendation)} className={`w-full rounded-[24px] border p-5 text-left transition ${isActive ? "border-cyan-400/40 bg-cyan-500/8 shadow-[0_18px_50px_-34px_rgba(6,182,212,0.8)]" : "border-slate-200/80 bg-white/75 hover:border-cyan-300/50 hover:bg-white dark:border-slate-800 dark:bg-slate-950/55 dark:hover:border-cyan-500/30 dark:hover:bg-slate-950/75"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${meta.accent}`}><Icon className="h-3.5 w-3.5" />{meta.label}</div>
                      <h3 className="mt-3 text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">{recommendation.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{recommendation.reason}</p>
                    </div>
                    <span className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-slate-100/80 px-3 py-2 text-xs font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      {cachedResults[recommendation.id] ? "Cached" : isLoading ? "Running" : "Run"}
                    </span>
                  </div>
                  <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200/70 bg-slate-950 px-4 py-3 dark:border-slate-800">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Preview Query</p>
                    <code className="block whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-cyan-200">{recommendation.sql}</code>
                  </div>
                </motion.button>
              );
            })}
          </div>

          <motion.div layout className="rounded-[28px] border border-slate-200/80 bg-white/75 p-5 shadow-inner dark:border-slate-800 dark:bg-slate-950/60">
            <AnimatePresence mode="wait">
              {!activeRecommendation ? (
                <motion.div key="idle" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex min-h-[420px] flex-col items-center justify-center gap-4 text-center">
                  <div className="rounded-2xl border border-slate-200/80 bg-slate-100/80 p-4 dark:border-slate-800 dark:bg-slate-900"><Sparkles className="h-8 w-8 text-cyan-600 dark:text-cyan-300" /></div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Pick a recommendation</h3>
                    <p className="mt-2 max-w-sm text-sm text-slate-600 dark:text-slate-400">The engine inferred chart types from column kinds, null rates, and cardinality. Click any card to execute its SQL.</p>
                  </div>
                </motion.div>
              ) : loadingId === activeRecommendation.id ? (
                <motion.div key="loading" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex min-h-[420px] flex-col items-center justify-center gap-4 text-center">
                  <Loader2 className="h-10 w-10 animate-spin text-cyan-600 dark:text-cyan-300" />
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Running preview query</h3>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Fetching result rows for {activeRecommendation.title}</p>
                  </div>
                </motion.div>
              ) : error ? (
                <motion.div key="error" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex min-h-[420px] flex-col items-center justify-center gap-4 text-center">
                  <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-rose-600 dark:text-rose-300"><Sigma className="h-8 w-8" /></div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Preview failed</h3>
                    <p className="mt-2 max-w-sm text-sm text-slate-600 dark:text-slate-400">{error}</p>
                  </div>
                </motion.div>
              ) : (
                <motion.div key={activeRecommendation.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Live Preview</p>
                      <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{activeRecommendation.title}</h3>
                    </div>
                    <span className="rounded-full border border-slate-200/70 bg-slate-100/80 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">{formatNumber(activeRows.length)} preview rows</span>
                  </div>
                  <div className="rounded-[24px] border border-slate-200/80 bg-linear-to-br from-white via-slate-50 to-slate-100/70 p-4 dark:border-slate-800 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
                    {activeRows.length > 0 ? <ReactECharts option={buildOption(activeRecommendation, activeRows, dark)} style={{ height: 360, width: "100%" }} opts={{ renderer: "svg" }} notMerge lazyUpdate /> : <div className="flex h-[360px] items-center justify-center text-sm text-slate-500 dark:text-slate-400">Query returned no rows for this preview.</div>}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      )}
    </section>
  );
}
