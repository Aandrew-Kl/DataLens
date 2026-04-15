"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import {
  BarChart3,
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

type TemplateKind =
  | "line"
  | "bar"
  | "pie"
  | "map"
  | "dashboard"
  | "combo"
  | "horizontal-bar"
  | "histogram"
  | "box-plot"
  | "bubble"
  | "funnel"
  | "waterfall";

interface TemplateDefinition {
  id: string;
  name: string;
  kind: TemplateKind;
  description: string;
}

interface TemplateDraft {
  templateId: string;
  kind: TemplateKind;
  title: string;
  xAxis: string;
  yAxis: string;
  groupBy: string;
  sizeAxis: string;
  geoField: string;
}

interface SavedTemplate {
  id: string;
  name: string;
  kind: TemplateKind;
  title: string;
  xAxis: string;
  yAxis: string;
  groupBy: string;
  sizeAxis: string;
  geoField: string;
  sourceTemplateId: string;
  createdAt: number;
}

interface PreviewState {
  option: EChartsOption | null;
  sql: string | null;
  note: string;
}

const STORAGE_KEY = "datalens:chart-templates";
const EASE = [0.22, 1, 0.36, 1] as const;
const TEMPLATES: TemplateDefinition[] = [
  { id: "revenue-over-time", name: "Revenue over time", kind: "line", description: "Time-series line chart for a primary metric." },
  { id: "category-breakdown", name: "Category breakdown", kind: "bar", description: "Compare categories with a ranked bar view." },
  { id: "market-share", name: "Market share", kind: "pie", description: "Show proportional share for low-cardinality dimensions." },
  { id: "geographic-distribution", name: "Geographic distribution", kind: "map", description: "Map placeholder for country, region, or city fields." },
  { id: "performance-dashboard", name: "Performance dashboard", kind: "dashboard", description: "Hybrid KPI preview mixing line and bar views." },
  { id: "trend-analysis", name: "Trend analysis", kind: "combo", description: "Line plus area presentation for temporal trend review." },
  { id: "top-n-ranking", name: "Top N ranking", kind: "horizontal-bar", description: "Horizontal ranking for dominant categories." },
  { id: "distribution-histogram", name: "Distribution histogram", kind: "histogram", description: "Inspect the spread of a numeric field." },
  { id: "box-plot-comparison", name: "Box plot comparison", kind: "box-plot", description: "Compare spread and quartiles by category." },
  { id: "bubble-chart", name: "Bubble chart", kind: "bubble", description: "Three-measure comparison using x, y, and size." },
  { id: "funnel-chart", name: "Funnel chart", kind: "funnel", description: "Descending funnel for stage-based conversion or throughput." },
  { id: "waterfall-chart", name: "Waterfall chart", kind: "waterfall", description: "Show changes between sequential buckets or periods." },
];
function readNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function useDarkMode(): boolean {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const syncDarkMode = () => {
      setDark(document.documentElement.classList.contains("dark"));
    };

    syncDarkMode();
    const observer = new MutationObserver(syncDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  return dark;
}

function candidatePools(columns: ColumnProfile[]) {
  const numeric = columns.filter((column) => column.type === "number");
  const dates = columns.filter((column) => column.type === "date");
  const categorical = columns.filter(
    (column) =>
      (column.type === "string" || column.type === "boolean") &&
      column.uniqueCount > 1 &&
      column.uniqueCount <= 24,
  );
  const geographic = columns.filter((column) => /(country|region|state|city|market|geo|latitude|longitude)/i.test(column.name));

  return { numeric, dates, categorical, geographic };
}

function autoMapTemplate(template: TemplateDefinition, columns: ColumnProfile[]): TemplateDraft {
  const pools = candidatePools(columns);
  const primaryDate = pools.dates[0]?.name ?? "";
  const primaryNumeric = pools.numeric[0]?.name ?? "";
  const secondaryNumeric = pools.numeric[1]?.name ?? primaryNumeric;
  const tertiaryNumeric = pools.numeric[2]?.name ?? secondaryNumeric;
  const primaryCategory = pools.categorical[0]?.name ?? columns.find((column) => column.type === "string")?.name ?? "";
  const primaryGeo = pools.geographic[0]?.name ?? primaryCategory;

  switch (template.kind) {
    case "line":
    case "combo":
    case "dashboard":
    case "waterfall":
      return {
        templateId: template.id,
        kind: template.kind,
        title: template.name,
        xAxis: primaryDate || primaryCategory,
        yAxis: primaryNumeric,
        groupBy: primaryCategory,
        sizeAxis: "",
        geoField: primaryGeo,
      };
    case "bar":
    case "horizontal-bar":
    case "pie":
    case "funnel":
      return {
        templateId: template.id,
        kind: template.kind,
        title: template.name,
        xAxis: primaryCategory,
        yAxis: primaryNumeric || primaryCategory,
        groupBy: "",
        sizeAxis: "",
        geoField: primaryGeo,
      };
    case "histogram":
      return {
        templateId: template.id,
        kind: template.kind,
        title: template.name,
        xAxis: "",
        yAxis: primaryNumeric,
        groupBy: "",
        sizeAxis: "",
        geoField: primaryGeo,
      };
    case "box-plot":
      return {
        templateId: template.id,
        kind: template.kind,
        title: template.name,
        xAxis: primaryCategory,
        yAxis: primaryNumeric,
        groupBy: "",
        sizeAxis: "",
        geoField: primaryGeo,
      };
    case "bubble":
      return {
        templateId: template.id,
        kind: template.kind,
        title: template.name,
        xAxis: primaryNumeric,
        yAxis: secondaryNumeric,
        groupBy: primaryCategory,
        sizeAxis: tertiaryNumeric,
        geoField: primaryGeo,
      };
    case "map":
      return {
        templateId: template.id,
        kind: template.kind,
        title: template.name,
        xAxis: primaryGeo,
        yAxis: primaryNumeric,
        groupBy: "",
        sizeAxis: "",
        geoField: primaryGeo,
      };
  }
}

function buildSql(tableName: string, draft: TemplateDraft): string | null {
  const table = quoteIdentifier(tableName);
  const x = draft.xAxis ? quoteIdentifier(draft.xAxis) : "";
  const y = draft.yAxis ? quoteIdentifier(draft.yAxis) : "";
  const group = draft.groupBy ? quoteIdentifier(draft.groupBy) : "";
  const size = draft.sizeAxis ? quoteIdentifier(draft.sizeAxis) : "";

  switch (draft.kind) {
    case "line":
    case "combo":
    case "dashboard":
      if (!x || !y) return null;
      return `
        SELECT
          CAST(${x} AS VARCHAR) AS label,
          AVG(${y}) AS value
        FROM ${table}
        WHERE ${x} IS NOT NULL AND ${y} IS NOT NULL
        GROUP BY 1
        ORDER BY 1 ASC
        LIMIT 36
      `;
    case "bar":
    case "horizontal-bar":
      if (!x || !y) return null;
      return `
        SELECT
          CAST(${x} AS VARCHAR) AS label,
          SUM(${y}) AS value
        FROM ${table}
        WHERE ${x} IS NOT NULL AND ${y} IS NOT NULL
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 12
      `;
    case "pie":
    case "funnel":
      if (!x || !y) return null;
      return `
        SELECT
          CAST(${x} AS VARCHAR) AS label,
          SUM(${y}) AS value
        FROM ${table}
        WHERE ${x} IS NOT NULL AND ${y} IS NOT NULL
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 8
      `;
    case "histogram":
      if (!y) return null;
      return `
        SELECT
          TRY_CAST(${y} AS DOUBLE) AS value
        FROM ${table}
        WHERE ${y} IS NOT NULL
        LIMIT 6000
      `;
    case "box-plot":
      if (!x || !y) return null;
      return `
        SELECT
          CAST(${x} AS VARCHAR) AS label,
          MIN(TRY_CAST(${y} AS DOUBLE)) AS low,
          QUANTILE_CONT(TRY_CAST(${y} AS DOUBLE), 0.25) AS q1,
          QUANTILE_CONT(TRY_CAST(${y} AS DOUBLE), 0.5) AS median,
          QUANTILE_CONT(TRY_CAST(${y} AS DOUBLE), 0.75) AS q3,
          MAX(TRY_CAST(${y} AS DOUBLE)) AS high
        FROM ${table}
        WHERE ${x} IS NOT NULL AND ${y} IS NOT NULL
        GROUP BY 1
        ORDER BY 1 ASC
        LIMIT 12
      `;
    case "bubble":
      if (!x || !y || !size) return null;
      return `
        SELECT
          TRY_CAST(${x} AS DOUBLE) AS x_value,
          TRY_CAST(${y} AS DOUBLE) AS y_value,
          TRY_CAST(${size} AS DOUBLE) AS size_value,
          CAST(${group || x} AS VARCHAR) AS label
        FROM ${table}
        WHERE ${x} IS NOT NULL AND ${y} IS NOT NULL AND ${size} IS NOT NULL
        LIMIT 240
      `;
    case "waterfall":
      if (!x || !y) return null;
      return `
        WITH base AS (
          SELECT
            CAST(${x} AS VARCHAR) AS label,
            AVG(${y}) AS value
          FROM ${table}
          WHERE ${x} IS NOT NULL AND ${y} IS NOT NULL
          GROUP BY 1
          ORDER BY 1 ASC
          LIMIT 12
        )
        SELECT
          label,
          value - LAG(value, 1, 0) OVER (ORDER BY label) AS delta
        FROM base
      `;
    case "map":
      return null;
  }
}

function buildOption(draft: TemplateDraft, rows: Record<string, unknown>[], dark: boolean): EChartsOption | null {
  const textColor = dark ? "#cbd5e1" : "#334155";
  const borderColor = dark ? "#1e293b" : "#e2e8f0";
  const palette = ["#0ea5e9", "#14b8a6", "#22c55e", "#f59e0b", "#f97316"];

  if (draft.kind === "map") {
    return null;
  }

  if (draft.kind === "pie") {
    return {
      title: { text: draft.title, left: 16, textStyle: { color: textColor, fontSize: 15 } },
      legend: { bottom: 0, textStyle: { color: textColor } },
      series: [
        {
          type: "pie",
          radius: ["42%", "72%"],
          center: ["50%", "44%"],
          color: palette,
          data: rows.map((row) => ({ name: String(row.label ?? ""), value: readNumber(row.value) })),
        },
      ],
    };
  }

  if (draft.kind === "funnel") {
    return {
      title: { text: draft.title, left: 16, textStyle: { color: textColor, fontSize: 15 } },
      series: [
        {
          type: "funnel",
          top: 40,
          bottom: 18,
          left: "12%",
          width: "76%",
          sort: "descending",
          color: palette,
          data: rows.map((row) => ({ name: String(row.label ?? ""), value: readNumber(row.value) })),
        },
      ],
    };
  }

  if (draft.kind === "histogram") {
    const values = rows.map((row) => readNumber(row.value)).filter((value) => Number.isFinite(value));
    if (values.length === 0) {
      return null;
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const binCount = Math.max(6, Math.min(16, Math.round(Math.sqrt(values.length))));
    const step = (max - min) / binCount || 1;
    const labels = Array.from({ length: binCount }, (_, index) => {
      const start = min + (index * step);
      const end = start + step;
      return `${start.toFixed(1)}-${end.toFixed(1)}`;
    });
    const counts = new Array<number>(binCount).fill(0);

    values.forEach((value) => {
      const index = Math.min(Math.max(Math.floor((value - min) / step), 0), binCount - 1);
      counts[index] += 1;
    });

    return {
      title: { text: draft.title, left: 16, textStyle: { color: textColor, fontSize: 15 } },
      grid: { top: 54, right: 18, bottom: 60, left: 48 },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { color: textColor, rotate: 24 },
        axisLine: { lineStyle: { color: borderColor } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: textColor },
        splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
      },
      series: [
        {
          type: "bar",
          data: counts,
          itemStyle: { color: palette[0], borderRadius: [4, 4, 0, 0] },
        },
      ],
    };
  }

  if (draft.kind === "box-plot") {
    return {
      title: { text: draft.title, left: 16, textStyle: { color: textColor, fontSize: 15 } },
      grid: { top: 54, right: 18, bottom: 48, left: 48 },
      xAxis: {
        type: "category",
        data: rows.map((row) => String(row.label ?? "")),
        axisLabel: { color: textColor },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: textColor },
        splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
      },
      series: [
        {
          type: "boxplot",
          data: rows.map((row) => [
            readNumber(row.low),
            readNumber(row.q1),
            readNumber(row.median),
            readNumber(row.q3),
            readNumber(row.high),
          ]),
          itemStyle: { color: palette[1] },
        },
      ],
    };
  }

  if (draft.kind === "bubble") {
    return {
      title: { text: draft.title, left: 16, textStyle: { color: textColor, fontSize: 15 } },
      grid: { top: 54, right: 18, bottom: 48, left: 48 },
      xAxis: {
        type: "value",
        axisLabel: { color: textColor },
        splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: textColor },
        splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
      },
      series: [
        {
          type: "scatter",
          data: rows.map((row) => [readNumber(row.x_value), readNumber(row.y_value), readNumber(row.size_value)]),
          symbolSize: (value: number[]) => Math.max(8, Math.min(40, value[2] / 6 || 10)),
          itemStyle: { color: palette[2], opacity: 0.72 },
        },
      ],
    };
  }

  if (draft.kind === "waterfall") {
    return {
      title: { text: draft.title, left: 16, textStyle: { color: textColor, fontSize: 15 } },
      grid: { top: 54, right: 18, bottom: 48, left: 48 },
      xAxis: {
        type: "category",
        data: rows.map((row) => String(row.label ?? "")),
        axisLabel: { color: textColor },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: textColor },
        splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
      },
      series: [
        {
          type: "bar",
          data: rows.map((row) => ({
            value: readNumber(row.delta),
            itemStyle: { color: readNumber(row.delta) >= 0 ? palette[2] : palette[4] },
          })),
        },
      ],
    };
  }

  if (draft.kind === "dashboard") {
    return {
      title: { text: draft.title, left: 16, textStyle: { color: textColor, fontSize: 15 } },
      tooltip: { trigger: "axis" },
      legend: { right: 16, textStyle: { color: textColor } },
      grid: { top: 56, right: 18, bottom: 54, left: 48 },
      xAxis: {
        type: "category",
        data: rows.map((row) => String(row.label ?? "")),
        axisLabel: { color: textColor },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: textColor },
        splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
      },
      series: [
        {
          name: "Bar",
          type: "bar",
          data: rows.map((row) => readNumber(row.value)),
          itemStyle: { color: palette[0], borderRadius: [4, 4, 0, 0] },
        },
        {
          name: "Line",
          type: "line",
          smooth: true,
          data: rows.map((row) => readNumber(row.value)),
          itemStyle: { color: palette[3] },
          lineStyle: { color: palette[3], width: 2.5 },
        },
      ],
    };
  }

  const xLabels = rows.map((row) => String(row.label ?? ""));
  const values = rows.map((row) => readNumber(row.value));

  if (draft.kind === "horizontal-bar") {
    return {
      title: { text: draft.title, left: 16, textStyle: { color: textColor, fontSize: 15 } },
      grid: { top: 54, right: 18, bottom: 30, left: 96 },
      xAxis: {
        type: "value",
        axisLabel: { color: textColor },
        splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
      },
      yAxis: {
        type: "category",
        data: xLabels,
        axisLabel: { color: textColor },
      },
      series: [
        {
          type: "bar",
          data: values,
          itemStyle: { color: palette[1], borderRadius: [0, 6, 6, 0] },
        },
      ],
    };
  }

  return {
    title: { text: draft.title, left: 16, textStyle: { color: textColor, fontSize: 15 } },
    tooltip: { trigger: "axis" },
    grid: { top: 54, right: 18, bottom: 54, left: 48 },
    xAxis: {
      type: "category",
      data: xLabels,
      axisLabel: { color: textColor, rotate: xLabels.length > 8 ? 22 : 0 },
      axisLine: { lineStyle: { color: borderColor } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        type: draft.kind === "line" ? "line" : draft.kind === "combo" ? "line" : "bar",
        data: values,
        smooth: draft.kind !== "bar",
        areaStyle: draft.kind === "combo" ? { opacity: 0.14 } : undefined,
        itemStyle: { color: palette[0] },
        lineStyle: { color: palette[0], width: 2.5 },
      },
    ],
  };
}

function Thumbnail({ kind }: { kind: TemplateKind }) {
  const bars = (
    <div className="flex h-full items-end gap-1">
      {[30, 46, 22, 58, 38].map((height) => (
        <span key={height} className="w-2 rounded-full bg-sky-500/80" style={{ height: `${height}%` }} />
      ))}
    </div>
  );

  const line = (
    <svg viewBox="0 0 100 54" className="h-full w-full">
      <polyline fill="none" stroke="rgba(56,189,248,0.95)" strokeWidth="6" points="6,44 26,30 46,34 66,18 94,12" />
    </svg>
  );

  const pie = (
    <div className="flex h-full items-center justify-center">
      <div className="h-12 w-12 rounded-full bg-[conic-gradient(#0ea5e9_0_120deg,#14b8a6_120deg_245deg,#f59e0b_245deg_360deg)]" />
    </div>
  );

  const thumbnails: Record<TemplateKind, ReactElement> = {
    bar: bars,
    "horizontal-bar": bars,
    line,
    combo: line,
    dashboard: line,
    pie,
    funnel: bars,
    histogram: bars,
    "box-plot": bars,
    bubble: line,
    waterfall: bars,
    map: (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/20 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        Map
      </div>
    ),
  };

  return (
    <div className="h-16 overflow-hidden rounded-2xl border border-white/10 bg-white/10 p-3 dark:bg-slate-950/30">
      {thumbnails[kind]}
    </div>
  );
}

export default function ChartTemplates({ tableName, columns }: ChartTemplatesProps) {
  const dark = useDarkMode();
  const [activeFilter, setActiveFilter] = useState<TemplateKind | "all">("all");
  const [activeDraft, setActiveDraft] = useState<TemplateDraft | null>(null);
  const [savedTemplates, setSavedTemplates] = useLocalStorage<SavedTemplate[]>(STORAGE_KEY, []);
  const [previewState, setPreviewState] = useState<PreviewState>({
    option: null,
    sql: null,
    note: "Pick a template to preview it with auto-mapped fields.",
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fieldSummary = useMemo(() => candidatePools(columns), [columns]);
  const galleryTemplates = useMemo(() => {
    const base = activeFilter === "all" ? TEMPLATES : TEMPLATES.filter((template) => template.kind === activeFilter);
    return [...base];
  }, [activeFilter]);

  useEffect(() => {
    if (!activeDraft) {
      return;
    }

    let cancelled = false;
    const draft = activeDraft;
    const sql = buildSql(tableName, draft);

    async function loadPreview(): Promise<void> {
      setBusy(true);
      try {
        if (draft.kind === "map") {
          if (!cancelled) {
            setPreviewState({
              option: null,
              sql: null,
              note: draft.geoField
                ? `Map placeholder is ready for ${draft.geoField}. Connect a geographic renderer when you want choropleth support.`
                : "No geographic column was auto-detected. Choose a region or country field to make this template useful.",
            });
          }
          return;
        }

        if (!sql) {
          if (!cancelled) {
            setPreviewState({
              option: null,
              sql: null,
              note: "This template needs more compatible columns. Adjust the builder fields to continue.",
            });
          }
          return;
        }

        const rows = await runQuery(sql);
        if (!cancelled) {
          setPreviewState({
            option: buildOption(draft, rows, dark),
            sql,
            note: rows.length > 0 ? "Template applied with auto-mapped columns." : "The template ran, but DuckDB returned no rows.",
          });
        }
      } catch (error) {
        if (!cancelled) {
          setPreviewState({
            option: null,
            sql,
            note: error instanceof Error ? error.message : "Preview query failed.",
          });
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    }

    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [activeDraft, dark, tableName]);

  function applyTemplate(template: TemplateDefinition): void {
    setActiveDraft(autoMapTemplate(template, columns));
    setNotice(`Applied ${template.name} with auto-mapped fields.`);
  }

  function saveCurrentTemplate(): void {
    if (!activeDraft) {
      return;
    }

    const name = activeDraft.title.trim() || activeDraft.templateId;
    setSavedTemplates((current) => [
      {
        id: `${activeDraft.templateId}-${Date.now()}`,
        name,
        kind: activeDraft.kind,
        title: activeDraft.title,
        xAxis: activeDraft.xAxis,
        yAxis: activeDraft.yAxis,
        groupBy: activeDraft.groupBy,
        sizeAxis: activeDraft.sizeAxis,
        geoField: activeDraft.geoField,
        sourceTemplateId: activeDraft.templateId,
        createdAt: Date.now(),
      },
      ...current,
    ].slice(0, 20));
    setNotice(`Saved "${name}" to localStorage.`);
  }

  return (
    <section className="overflow-hidden rounded-[30px] border border-white/15 bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.15),transparent_24%),linear-gradient(135deg,rgba(248,250,252,0.92),rgba(226,232,240,0.78))] shadow-[0_30px_120px_-50px_rgba(15,23,42,0.9)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.16),transparent_24%),linear-gradient(135deg,rgba(2,6,23,0.95),rgba(15,23,42,0.88))]">
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" />
              Chart templates
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
              One-click chart starters for {tableName}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Choose from a gallery of built-in chart patterns, auto-map the best-fit columns, then save your customized version as a reusable local template.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur-xl dark:bg-slate-950/45">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Saved templates</div>
            <div className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">{savedTemplates.length}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-6 py-6 xl:grid-cols-[0.94fr_1.06fr]">
        <div className="space-y-5">
          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveFilter("all")}
                className={`rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] ${
                  activeFilter === "all"
                    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                    : "border-white/10 bg-white/10 text-slate-500 dark:bg-slate-950/35 dark:text-slate-400"
                }`}
              >
                All
              </button>
              {Array.from(new Set(TEMPLATES.map((template) => template.kind))).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setActiveFilter(kind)}
                  className={`rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] ${
                    activeFilter === kind
                      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                      : "border-white/10 bg-white/10 text-slate-500 dark:bg-slate-950/35 dark:text-slate-400"
                  }`}
                >
                  {kind}
                </button>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {galleryTemplates.map((template) => (
                <motion.button
                  key={template.id}
                  type="button"
                  whileHover={{ y: -3 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  onClick={() => applyTemplate(template)}
                  className={`rounded-3xl border p-4 text-left transition ${
                    activeDraft?.templateId === template.id
                      ? "border-emerald-400/30 bg-emerald-500/10"
                      : "border-white/10 bg-white/10 hover:border-emerald-400/20 dark:bg-slate-950/35"
                  }`}
                >
                  <Thumbnail kind={template.kind} />
                  <div className="mt-4 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-950 dark:text-slate-50">{template.name}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{template.description}</p>
                    </div>
                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      {template.kind}
                    </span>
                  </div>
                </motion.button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
            <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <Layers3 className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
              Auto-mapped field pools
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 dark:bg-slate-950/35">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Numeric</div>
                <div className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">{fieldSummary.numeric.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 dark:bg-slate-950/35">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Date</div>
                <div className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">{fieldSummary.dates.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 dark:bg-slate-950/35">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Category</div>
                <div className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">{fieldSummary.categorical.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 dark:bg-slate-950/35">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Geo-ish</div>
                <div className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">{fieldSummary.geographic.length}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <Gauge className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                Generated preview
              </div>
              {busy ? (
                <div className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Querying
                </div>
              ) : null}
            </div>

            {previewState.option ? (
              <ReactECharts option={previewState.option} style={{ height: 420, width: "100%" }} notMerge lazyUpdate opts={{ renderer: "svg" }} />
            ) : (
              <div className="flex h-[420px] items-center justify-center rounded-2xl border border-dashed border-white/10 px-6 text-center text-sm leading-6 text-slate-500 dark:text-slate-400">
                {previewState.note}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
            <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <SlidersHorizontal className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
              Custom template builder
            </div>

            {activeDraft ? (
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block text-sm text-slate-600 dark:text-slate-300">
                  <span className="mb-2 block font-medium text-slate-900 dark:text-slate-100">Title</span>
                  <input
                    value={activeDraft.title}
                    onChange={(event) => setActiveDraft((current) => (current ? { ...current, title: event.target.value } : current))}
                    className="w-full rounded-2xl border border-white/10 bg-white/50 px-3 py-2.5 outline-none dark:bg-slate-950/45"
                  />
                </label>
                <label className="block text-sm text-slate-600 dark:text-slate-300">
                  <span className="mb-2 block font-medium text-slate-900 dark:text-slate-100">X axis</span>
                  <select
                    value={activeDraft.xAxis}
                    onChange={(event) => setActiveDraft((current) => (current ? { ...current, xAxis: event.target.value } : current))}
                    className="w-full rounded-2xl border border-white/10 bg-white/50 px-3 py-2.5 outline-none dark:bg-slate-950/45"
                  >
                    <option value="">No field</option>
                    {columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-slate-600 dark:text-slate-300">
                  <span className="mb-2 block font-medium text-slate-900 dark:text-slate-100">Y axis</span>
                  <select
                    value={activeDraft.yAxis}
                    onChange={(event) => setActiveDraft((current) => (current ? { ...current, yAxis: event.target.value } : current))}
                    className="w-full rounded-2xl border border-white/10 bg-white/50 px-3 py-2.5 outline-none dark:bg-slate-950/45"
                  >
                    <option value="">No field</option>
                    {columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-slate-600 dark:text-slate-300">
                  <span className="mb-2 block font-medium text-slate-900 dark:text-slate-100">Group / color</span>
                  <select
                    value={activeDraft.groupBy}
                    onChange={(event) => setActiveDraft((current) => (current ? { ...current, groupBy: event.target.value } : current))}
                    className="w-full rounded-2xl border border-white/10 bg-white/50 px-3 py-2.5 outline-none dark:bg-slate-950/45"
                  >
                    <option value="">No field</option>
                    {columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-slate-600 dark:text-slate-300">
                  <span className="mb-2 block font-medium text-slate-900 dark:text-slate-100">Bubble size</span>
                  <select
                    value={activeDraft.sizeAxis}
                    onChange={(event) => setActiveDraft((current) => (current ? { ...current, sizeAxis: event.target.value } : current))}
                    className="w-full rounded-2xl border border-white/10 bg-white/50 px-3 py-2.5 outline-none dark:bg-slate-950/45"
                  >
                    <option value="">No field</option>
                    {columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-slate-600 dark:text-slate-300">
                  <span className="mb-2 block font-medium text-slate-900 dark:text-slate-100">Geo field</span>
                  <select
                    value={activeDraft.geoField}
                    onChange={(event) => setActiveDraft((current) => (current ? { ...current, geoField: event.target.value } : current))}
                    className="w-full rounded-2xl border border-white/10 bg-white/50 px-3 py-2.5 outline-none dark:bg-slate-950/45"
                  >
                    <option value="">No field</option>
                    {columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-sm text-slate-500 dark:text-slate-400">
                Choose a template to start customizing and save your own version.
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={saveCurrentTemplate}
                disabled={!activeDraft}
                className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-800 disabled:opacity-60 dark:text-emerald-200"
              >
                <Save className="h-4 w-4" />
                Save current config
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
            <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <Save className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
              Saved custom templates
            </div>
            <div className="space-y-3">
              {savedTemplates.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                  Saved templates live in localStorage so recurring chart shapes can be reopened quickly.
                </div>
              ) : (
                savedTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() =>
                      setActiveDraft({
                        templateId: template.sourceTemplateId,
                        kind: template.kind,
                        title: template.title,
                        xAxis: template.xAxis,
                        yAxis: template.yAxis,
                        groupBy: template.groupBy,
                        sizeAxis: template.sizeAxis,
                        geoField: template.geoField,
                      })
                    }
                    className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-left transition hover:border-emerald-400/20 hover:bg-white/15 dark:bg-slate-950/35"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{template.name}</span>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        {template.kind}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      {template.title} · {template.xAxis || "—"} / {template.yAxis || "—"}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
            <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <BarChart3 className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
              Template SQL
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/85 p-4 text-xs leading-6 text-cyan-200">
              {previewState.sql ?? "-- This template uses a placeholder or still needs valid field assignments."}
            </div>
          </div>

          <AnimatePresence>
            {notice ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200"
              >
                {notice}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
