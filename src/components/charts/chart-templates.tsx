"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import {
  BarChart3,
  Beaker,
  Briefcase,
  Clock3,
  Gauge,
  Layers3,
  Loader2,
  Save,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

interface ChartTemplatesProps {
  tableName: string;
  columns: ColumnProfile[];
}

type TemplateCategory = "Business" | "Scientific" | "Statistical" | "Comparison" | "Distribution" | "Time Series" | "Saved";
type TemplateMode = "bar" | "line" | "pie" | "scatter" | "histogram" | "heatmap" | "pareto" | "waterfall" | "funnel";

interface TemplateDefinition {
  id: string;
  category: TemplateCategory;
  name: string;
  description: string;
  thumbnail: string;
  required: Array<ColumnProfile["type"] | "category">;
  mode: TemplateMode;
}

interface SavedTemplate {
  id: string;
  name: string;
  baseTemplateId: string;
  title: string;
  xAxis: string;
  yAxis: string;
  palette: string[];
}

const EASE = [0.16, 1, 0.3, 1] as const;
const STORAGE_KEY = "datalens:chart-templates";
const PALETTES = [
  ["#0ea5e9", "#06b6d4", "#22c55e", "#f59e0b", "#f97316"],
  ["#2563eb", "#7c3aed", "#db2777", "#f97316", "#eab308"],
  ["#14b8a6", "#0f766e", "#84cc16", "#f97316", "#ef4444"],
];
const TEMPLATES: TemplateDefinition[] = [
  { id: "revenue-dashboard", category: "Business", name: "Revenue Dashboard", description: "Time-based KPI trend.", thumbnail: "RD", required: ["date", "number"], mode: "line" },
  { id: "customer-funnel", category: "Business", name: "Customer Funnel", description: "Step counts in descending order.", thumbnail: "CF", required: ["category"], mode: "funnel" },
  { id: "ab-test", category: "Scientific", name: "AB Test Results", description: "Compare variants on one metric.", thumbnail: "AB", required: ["category", "number"], mode: "bar" },
  { id: "correlation-heatmap", category: "Scientific", name: "Correlation Heatmap", description: "Correlations between numeric fields.", thumbnail: "CH", required: ["number", "number"], mode: "heatmap" },
  { id: "distribution-overview", category: "Statistical", name: "Distribution Overview", description: "Histogram for spread and skew.", thumbnail: "DO", required: ["number"], mode: "histogram" },
  { id: "time-trend", category: "Time Series", name: "Time Trend", description: "Continuous time trend of a metric.", thumbnail: "TT", required: ["date", "number"], mode: "line" },
  { id: "pareto-chart", category: "Comparison", name: "Pareto Chart", description: "Category contribution with cumulative line.", thumbnail: "PC", required: ["category"], mode: "pareto" },
  { id: "waterfall-chart", category: "Business", name: "Waterfall Chart", description: "Period-over-period change view.", thumbnail: "WF", required: ["date", "number"], mode: "waterfall" },
  { id: "segment-comparison", category: "Comparison", name: "Segment Comparison", description: "Rank categories by value.", thumbnail: "SC", required: ["category", "number"], mode: "bar" },
  { id: "category-share", category: "Business", name: "Category Share", description: "Low-cardinality composition chart.", thumbnail: "CS", required: ["category"], mode: "pie" },
  { id: "retention-curve", category: "Time Series", name: "Retention Curve", description: "Cohort-like trend view.", thumbnail: "RC", required: ["date", "number"], mode: "line" },
  { id: "outlier-scan", category: "Scientific", name: "Outlier Scan", description: "Spot clusters and extremes.", thumbnail: "OS", required: ["number", "number"], mode: "scatter" },
  { id: "seasonal-pattern", category: "Time Series", name: "Seasonal Pattern", description: "Ordered daily or monthly trend.", thumbnail: "SP", required: ["date", "number"], mode: "line" },
  { id: "variance-review", category: "Statistical", name: "Variance Review", description: "Compare category spread proxy.", thumbnail: "VR", required: ["category", "number"], mode: "bar" },
  { id: "quality-mix", category: "Distribution", name: "Quality Mix", description: "Composition of status-like columns.", thumbnail: "QM", required: ["category"], mode: "pie" },
];

function quoteId(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function readNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return Number(value ?? 0) || 0;
}

function pickColumns(columns: ColumnProfile[]) {
  const numeric = columns.filter((column) => column.type === "number");
  const dates = columns.filter((column) => column.type === "date");
  const categorical = columns.filter((column) => column.type === "string" && column.uniqueCount > 1 && column.uniqueCount <= 30);
  return { numeric, dates, categorical: categorical.length ? categorical : columns.filter((column) => column.type === "boolean") };
}

function buildSql(tableName: string, template: TemplateDefinition, xAxis: string, yAxis: string, columns: ColumnProfile[]): string {
  const table = quoteId(tableName);
  const x = xAxis ? quoteId(xAxis) : "";
  const y = yAxis ? quoteId(yAxis) : "";
  if (template.mode === "histogram") return `SELECT ${y || x} AS value FROM ${table} WHERE ${y || x} IS NOT NULL LIMIT 5000`;
  if (template.mode === "scatter") return `SELECT ${x} AS x, ${y} AS y FROM ${table} WHERE ${x} IS NOT NULL AND ${y} IS NOT NULL LIMIT 400`;
  if (template.mode === "pie" || template.mode === "funnel") return `SELECT ${x} AS label, COUNT(*) AS value FROM ${table} WHERE ${x} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12`;
  if (template.mode === "pareto") return `WITH ranked AS (SELECT ${x} AS label, COUNT(*) AS value FROM ${table} WHERE ${x} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12), totals AS (SELECT SUM(value) AS total FROM ranked) SELECT label, value, SUM(value) OVER (ORDER BY value DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) / NULLIF((SELECT total FROM totals), 0) AS cumulative FROM ranked`;
  if (template.mode === "waterfall") return `WITH base AS (SELECT ${x} AS label, AVG(${y}) AS value FROM ${table} WHERE ${x} IS NOT NULL AND ${y} IS NOT NULL GROUP BY 1 ORDER BY 1 ASC LIMIT 12) SELECT label, value, value - LAG(value, 1, 0) OVER (ORDER BY label) AS delta FROM base`;
  if (template.mode === "heatmap") {
    const numerics = columns.filter((column) => column.type === "number").slice(0, 4);
    return numerics.flatMap((left) => numerics.map((right) => `SELECT '${left.name}' AS x_label, '${right.name}' AS y_label, CORR(${quoteId(left.name)}, ${quoteId(right.name)}) AS value FROM ${table}`)).join(" UNION ALL ");
  }
  return `SELECT ${x} AS label, AVG(${y}) AS value FROM ${table} WHERE ${x} IS NOT NULL AND ${y} IS NOT NULL GROUP BY 1 ORDER BY ${template.mode === "line" ? "1 ASC" : "2 DESC"} LIMIT 24`;
}

function buildOption(template: TemplateDefinition, rows: Record<string, unknown>[], dark: boolean, title: string, palette: string[]): EChartsOption {
  const text = dark ? "#cbd5e1" : "#334155";
  const border = dark ? "#1e293b" : "#e2e8f0";
  if (template.mode === "pie") {
    return { title: { text: title, left: 16, textStyle: { color: text, fontSize: 15 } }, legend: { bottom: 0, textStyle: { color: text } }, series: [{ type: "pie", radius: ["38%", "70%"], color: palette, data: rows.map((row) => ({ name: String(row.label ?? ""), value: readNumber(row.value) })) }] };
  }
  if (template.mode === "funnel") {
    return { title: { text: title, left: 16, textStyle: { color: text, fontSize: 15 } }, tooltip: { trigger: "item" }, series: [{ type: "funnel", top: 40, bottom: 30, left: "8%", width: "84%", sort: "descending", color: palette, data: rows.map((row) => ({ name: String(row.label ?? ""), value: readNumber(row.value) })) }] };
  }
  if (template.mode === "scatter") {
    return { title: { text: title, left: 16, textStyle: { color: text, fontSize: 15 } }, grid: { top: 50, right: 18, bottom: 36, left: 52 }, xAxis: { type: "value", axisLabel: { color: text }, splitLine: { lineStyle: { color: border, type: "dashed" } } }, yAxis: { type: "value", axisLabel: { color: text }, splitLine: { lineStyle: { color: border, type: "dashed" } } }, series: [{ type: "scatter", symbolSize: 9, itemStyle: { color: palette[0], opacity: 0.72 }, data: rows.map((row) => [readNumber(row.x), readNumber(row.y)]) }] };
  }
  if (template.mode === "histogram") {
    const values = rows.map((row) => readNumber(row.value)).filter((value) => Number.isFinite(value));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const bins = Math.max(6, Math.min(16, Math.round(Math.sqrt(values.length || 1))));
    const step = (max - min) / bins || 1;
    const labels = new Array<string>(bins).fill("").map((_, index) => `${(min + index * step).toFixed(1)}-${(min + (index + 1) * step).toFixed(1)}`);
    const counts = new Array<number>(bins).fill(0);
    values.forEach((value) => { const index = Math.min(Math.max(Math.floor((value - min) / step), 0), bins - 1); counts[index] += 1; });
    return { title: { text: title, left: 16, textStyle: { color: text, fontSize: 15 } }, grid: { top: 50, right: 18, bottom: 54, left: 50 }, xAxis: { type: "category", data: labels, axisLabel: { color: text, rotate: 24 }, axisLine: { lineStyle: { color: border } } }, yAxis: { type: "value", axisLabel: { color: text }, splitLine: { lineStyle: { color: border, type: "dashed" } } }, series: [{ type: "bar", data: counts, itemStyle: { color: palette[1], borderRadius: [4, 4, 0, 0] } }] };
  }
  if (template.mode === "heatmap") {
    const xLabels = [...new Set(rows.map((row) => String(row.x_label ?? "")))];
    const yLabels = [...new Set(rows.map((row) => String(row.y_label ?? "")))];
    return { title: { text: title, left: 16, textStyle: { color: text, fontSize: 15 } }, visualMap: { min: -1, max: 1, orient: "horizontal", left: "center", bottom: 0, textStyle: { color: text } }, grid: { top: 50, right: 18, bottom: 72, left: 90 }, xAxis: { type: "category", data: xLabels, axisLabel: { color: text } }, yAxis: { type: "category", data: yLabels, axisLabel: { color: text } }, series: [{ type: "heatmap", data: rows.map((row) => [xLabels.indexOf(String(row.x_label ?? "")), yLabels.indexOf(String(row.y_label ?? "")), readNumber(row.value)]), emphasis: { itemStyle: { borderColor: "#fff" } } }] };
  }
  if (template.mode === "pareto") {
    return { title: { text: title, left: 16, textStyle: { color: text, fontSize: 15 } }, tooltip: { trigger: "axis" }, legend: { right: 16, textStyle: { color: text } }, grid: { top: 56, right: 54, bottom: 52, left: 50 }, xAxis: { type: "category", data: rows.map((row) => String(row.label ?? "")), axisLabel: { color: text, rotate: 20 }, axisLine: { lineStyle: { color: border } } }, yAxis: [{ type: "value", axisLabel: { color: text }, splitLine: { lineStyle: { color: border, type: "dashed" } } }, { type: "value", min: 0, max: 1, axisLabel: { color: text, formatter: (value: number) => `${Math.round(value * 100)}%` } }], series: [{ name: "Value", type: "bar", data: rows.map((row) => readNumber(row.value)), itemStyle: { color: palette[0], borderRadius: [4, 4, 0, 0] } }, { name: "Cumulative", type: "line", yAxisIndex: 1, data: rows.map((row) => readNumber(row.cumulative)), smooth: true, itemStyle: { color: palette[3] } }] };
  }
  if (template.mode === "waterfall") {
    return { title: { text: title, left: 16, textStyle: { color: text, fontSize: 15 } }, grid: { top: 50, right: 18, bottom: 50, left: 50 }, xAxis: { type: "category", data: rows.map((row) => String(row.label ?? "")), axisLabel: { color: text }, axisLine: { lineStyle: { color: border } } }, yAxis: { type: "value", axisLabel: { color: text }, splitLine: { lineStyle: { color: border, type: "dashed" } } }, series: [{ type: "bar", data: rows.map((row) => ({ value: readNumber(row.delta), itemStyle: { color: readNumber(row.delta) >= 0 ? palette[2] : palette[4] } })) }] };
  }
  return { title: { text: title, left: 16, textStyle: { color: text, fontSize: 15 } }, grid: { top: 50, right: 18, bottom: 54, left: 50 }, xAxis: { type: "category", data: rows.map((row) => String(row.label ?? "")), axisLabel: { color: text, rotate: rows.length > 8 ? 22 : 0 }, axisLine: { lineStyle: { color: border } } }, yAxis: { type: "value", axisLabel: { color: text }, splitLine: { lineStyle: { color: border, type: "dashed" } } }, series: [{ type: template.mode === "line" ? "line" : "bar", data: rows.map((row) => readNumber(row.value)), smooth: template.mode === "line", color: palette[0], areaStyle: template.mode === "line" ? { opacity: 0.08 } : undefined, itemStyle: template.mode === "bar" ? { borderRadius: [4, 4, 0, 0] } : undefined }] };
}

function FieldChip({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 dark:bg-slate-950/30">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">{value}</div>
      <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{detail}</div>
    </div>
  );
}

export default function ChartTemplates({ tableName, columns }: ChartTemplatesProps) {
  const [savedTemplates, setSavedTemplates] = useLocalStorage<SavedTemplate[]>(STORAGE_KEY, []);
  const [activeCategory, setActiveCategory] = useState<TemplateCategory | "All">("All");
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [xAxis, setXAxis] = useState("");
  const [yAxis, setYAxis] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [dark, setDark] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { numeric, dates, categorical } = useMemo(() => pickColumns(columns), [columns]);
  const categoryOptions = useMemo(() => ["All", "Business", "Scientific", "Statistical", "Comparison", "Distribution", "Time Series", "Saved"] as const, []);
  const combinedTemplates = useMemo(() => [
    ...TEMPLATES,
    ...savedTemplates.map<TemplateDefinition>((entry) => ({ id: entry.id, category: "Saved", name: entry.name, description: `Saved from ${entry.baseTemplateId}`, thumbnail: "SV", required: [], mode: TEMPLATES.find((template) => template.id === entry.baseTemplateId)?.mode ?? "bar" })),
  ], [savedTemplates]);
  const visibleTemplates = useMemo(() => activeCategory === "All" ? combinedTemplates : combinedTemplates.filter((template) => template.category === activeCategory), [activeCategory, combinedTemplates]);
  const activeTemplate = useMemo(() => combinedTemplates.find((template) => template.id === activeTemplateId) ?? null, [activeTemplateId, combinedTemplates]);
  const option = useMemo(() => activeTemplate ? buildOption(activeTemplate, rows, dark, title || activeTemplate.name, PALETTES[paletteIndex]) : null, [activeTemplate, dark, paletteIndex, rows, title]);
  const fieldSummary = useMemo(() => ({
    numeric: numeric.map((column) => column.name),
    dates: dates.map((column) => column.name),
    categorical: categorical.map((column) => column.name),
  }), [categorical, dates, numeric]);

  useEffect(() => {
    const syncDark = () => setDark(document.documentElement.classList.contains("dark"));
    syncDark();
    const observer = new MutationObserver(syncDark);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  async function runTemplate(template: TemplateDefinition) {
    const saved = savedTemplates.find((entry) => entry.id === template.id);
    const nextX = saved?.xAxis ?? (template.mode === "scatter" ? numeric[0]?.name ?? "" : template.required.includes("date") ? dates[0]?.name ?? categorical[0]?.name ?? "" : categorical[0]?.name ?? dates[0]?.name ?? numeric[0]?.name ?? "");
    const nextY = saved?.yAxis ?? (template.mode === "scatter" ? numeric[1]?.name ?? numeric[0]?.name ?? "" : numeric[0]?.name ?? "");
    setBusy(true);
    setNotice(null);
    try {
      const sql = buildSql(tableName, template, nextX, nextY, columns);
      const result = await runQuery(sql);
      startTransition(() => {
        setActiveTemplateId(template.id);
        setXAxis(nextX);
        setYAxis(nextY);
        setTitle(saved?.title ?? template.name);
        setPaletteIndex(saved ? Math.max(0, PALETTES.findIndex((palette) => JSON.stringify(palette) === JSON.stringify(saved.palette))) : 0);
        setRows(result);
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to generate chart.");
    } finally {
      setBusy(false);
    }
  }

  async function rerunActive() {
    if (!activeTemplate) return;
    setBusy(true);
    try {
      setRows(await runQuery(buildSql(tableName, activeTemplate, xAxis, yAxis, columns)));
    } finally {
      setBusy(false);
    }
  }

  function handleSaveTemplate() {
    if (!activeTemplate) return;
    const nextName = window.prompt("Template name", `${title || activeTemplate.name} copy`);
    if (!nextName) return;
    setSavedTemplates((current) => [
      { id: `${Date.now()}`, name: nextName, baseTemplateId: activeTemplate.id, title: title || activeTemplate.name, xAxis, yAxis, palette: PALETTES[paletteIndex] },
      ...current,
    ]);
    setNotice(`Saved ${nextName} as a reusable template.`);
  }

  return (
    <section className="overflow-hidden rounded-[30px] border border-white/15 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_24%),linear-gradient(135deg,rgba(248,250,252,0.92),rgba(226,232,240,0.78))] shadow-[0_30px_120px_-50px_rgba(15,23,42,0.9)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_24%),linear-gradient(135deg,rgba(2,6,23,0.95),rgba(15,23,42,0.88))]">
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-300"><Sparkles className="h-3.5 w-3.5" />Chart Template Library</div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Preset chart layouts backed by DuckDB</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">Choose from business, scientific, statistical, and time-series templates. Each template auto-picks viable columns, then renders a live ECharts preview.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {categoryOptions.map((category) => (
              <button key={category} type="button" onClick={() => setActiveCategory(category)} className={`rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] ${activeCategory === category ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : "border-white/10 bg-white/5 text-slate-500 dark:text-slate-400"}`}>{category}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-6 py-6 xl:grid-cols-[0.92fr_1.08fr]">
        <div className="grid gap-4 md:grid-cols-2">
          {visibleTemplates.map((template) => (
            <motion.button key={template.id} type="button" whileHover={{ y: -4 }} transition={{ duration: 0.2, ease: EASE }} onClick={() => void runTemplate(template)} className={`rounded-3xl border p-4 text-left ${activeTemplateId === template.id ? "border-emerald-400/30 bg-emerald-500/10" : "border-white/10 bg-white/10 dark:bg-slate-950/40"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="rounded-2xl bg-gradient-to-br from-emerald-500/25 to-cyan-500/20 px-4 py-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{template.thumbnail}</div>
                <div className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{template.category}</div>
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-950 dark:text-slate-50">{template.name}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{template.description}</p>
              <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Needs: {template.required.join(", ") || "saved config"}</p>
            </motion.button>
          ))}
        </div>

        <div className="space-y-5">
          <div className="rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
            <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100"><Layers3 className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />Auto-detected field pools</div>
            <div className="grid gap-3 md:grid-cols-3">
              <FieldChip label="Numeric" value={String(fieldSummary.numeric.length)} detail={fieldSummary.numeric.slice(0, 3).join(", ") || "No numeric columns"} />
              <FieldChip label="Date" value={String(fieldSummary.dates.length)} detail={fieldSummary.dates.slice(0, 3).join(", ") || "No temporal columns"} />
              <FieldChip label="Category" value={String(fieldSummary.categorical.length)} detail={fieldSummary.categorical.slice(0, 3).join(", ") || "No low-cardinality fields"} />
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Templates are configured from this pool before each query runs. If a template needs different axes, override them in the customization panel and refresh the chart.
            </p>
          </div>

          <div className="rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
            <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100"><Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />Template fitting notes</div>
            <div className="grid gap-3 md:grid-cols-2">
              <FieldChip label="Saved templates" value={String(savedTemplates.length)} detail="Stored in localStorage with axes and palette choices." />
              <FieldChip label="Active axis pair" value={`${xAxis || "auto"} / ${yAxis || "auto"}`} detail="These fields drive the next query refresh." />
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Business templates bias toward ranked summaries and funnels. Scientific templates emphasize correlation, scatter, and comparison views. Distribution and time-series templates keep ordering intact so trend and spread remain readable.
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Saved templates reuse the original template mode but persist your chosen title, axes, and palette. That keeps the query logic stable while letting you standardize how recurring charts look.
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              When a template does not fit perfectly, the live data preview is still useful as a starting point: swap axes, rerun, then save the adjusted version as a house standard for this dataset shape.
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Heatmaps and waterfalls are the most schema-sensitive presets in the library. If they look sparse, it usually means the dataset wants a different x/y pair rather than a different charting engine.
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              The goal of the library is not to guess perfectly on the first click; it is to get you to a competent, live chart faster than building from scratch.
            </p>





          </div>

          <div className="rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100"><Gauge className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />Generated chart</div>
              {busy ? <div className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Querying live data</div> : null}
            </div>
            {option ? <ReactECharts option={option} style={{ height: 420, width: "100%" }} notMerge lazyUpdate opts={{ renderer: "svg" }} /> : <div className="flex h-[420px] items-center justify-center text-sm text-slate-500 dark:text-slate-400">Pick a template to generate its live chart.</div>}
          </div>

          <div className="rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
            <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100"><SlidersHorizontal className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />Customize generated chart</div>
            <div className="grid gap-3 md:grid-cols-2">
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Chart title" className="rounded-2xl border border-white/10 bg-white/40 px-4 py-3 dark:bg-slate-950/40" />
              <select value={paletteIndex} onChange={(event) => setPaletteIndex(Number(event.target.value))} className="rounded-2xl border border-white/10 bg-white/40 px-4 py-3 dark:bg-slate-950/40">
                {PALETTES.map((_, index) => <option key={index} value={index}>Palette {index + 1}</option>)}
              </select>
              <select value={xAxis} onChange={(event) => setXAxis(event.target.value)} className="rounded-2xl border border-white/10 bg-white/40 px-4 py-3 dark:bg-slate-950/40">
                <option value="">Auto x-axis</option>
                {columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
              </select>
              <select value={yAxis} onChange={(event) => setYAxis(event.target.value)} className="rounded-2xl border border-white/10 bg-white/40 px-4 py-3 dark:bg-slate-950/40">
                <option value="">Auto y-axis</option>
                {columns.filter((column) => column.type === "number").map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
              </select>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={() => void rerunActive()} disabled={!activeTemplate || busy} className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-800 disabled:opacity-60 dark:text-emerald-200"><Layers3 className="h-4 w-4" />Refresh chart</button>
              <button type="button" onClick={handleSaveTemplate} disabled={!activeTemplate} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-slate-700 disabled:opacity-60 dark:text-slate-200"><Save className="h-4 w-4" />Save as template</button>
              <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{activeTemplate?.category === "Business" ? <Briefcase className="h-4 w-4" /> : activeTemplate?.category === "Scientific" ? <Beaker className="h-4 w-4" /> : activeTemplate?.category === "Time Series" ? <Clock3 className="h-4 w-4" /> : <BarChart3 className="h-4 w-4" />}{activeTemplate?.name ?? "No template selected"}</div>
            </div>
            {activeTemplate ? (
              <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
                Active template mode: <span className="font-semibold text-slate-900 dark:text-slate-100">{activeTemplate.mode}</span>. Current axes: <span className="font-mono text-slate-900 dark:text-slate-100">{xAxis || "auto"}</span> / <span className="font-mono text-slate-900 dark:text-slate-100">{yAxis || "auto"}</span>.
              </p>
            ) : null}
            {notice ? <p className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">{notice}</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
