"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  CircleAlert,
  Download,
  LineChart,
  Loader2,
  PieChart,
  Save,
  ScatterChart,
  Sigma,
  Sparkles,
} from "lucide-react";
import type { ColumnProfile } from "@/types/dataset";
import type { ChartConfig, ChartType } from "@/types/chart";
import { runQuery } from "@/lib/duckdb/client";
import ChartRenderer from "@/components/charts/chart-renderer";

type BuilderChartType = Exclude<ChartType, "heatmap">;
type Aggregation = NonNullable<ChartConfig["aggregation"]>;

export interface ChartBuilderProps {
  tableName: string;
  columns: ColumnProfile[];
}

export interface SavedChartSnapshot {
  tableName: string;
  config: ChartConfig;
  data: Record<string, unknown>[];
  sql: string;
  savedAt: number;
}

type Notice = {
  tone: "success" | "error" | "info";
  message: string;
};

export const CHART_SAVED_EVENT = "datalens:chart-saved";
export const SAVED_CHARTS_STORAGE_KEY = "datalens-saved-charts";

const CHART_TYPES: BuilderChartType[] = [
  "bar",
  "line",
  "pie",
  "scatter",
  "area",
  "histogram",
];

const AGGREGATIONS: Aggregation[] = ["sum", "avg", "count", "min", "max"];

const CHART_TYPE_META: Record<
  BuilderChartType,
  {
    label: string;
    icon: LucideIcon;
    accent: string;
    description: string;
  }
> = {
  bar: {
    label: "Bar",
    icon: BarChart3,
    accent: "from-blue-500/20 to-cyan-500/10 text-blue-600 dark:text-blue-300",
    description: "Rank categories by an aggregated measure.",
  },
  line: {
    label: "Line",
    icon: LineChart,
    accent: "from-emerald-500/20 to-teal-500/10 text-emerald-600 dark:text-emerald-300",
    description: "Track change across a sequence on the x-axis.",
  },
  pie: {
    label: "Pie",
    icon: PieChart,
    accent: "from-violet-500/20 to-fuchsia-500/10 text-violet-600 dark:text-violet-300",
    description: "Compare category share of the selected measure.",
  },
  scatter: {
    label: "Scatter",
    icon: ScatterChart,
    accent: "from-amber-500/20 to-orange-500/10 text-amber-600 dark:text-amber-300",
    description: "Compare two numeric measures without aggregation.",
  },
  area: {
    label: "Area",
    icon: Activity,
    accent: "from-cyan-500/20 to-sky-500/10 text-cyan-600 dark:text-cyan-300",
    description: "Highlight volume trends with a filled line chart.",
  },
  histogram: {
    label: "Histogram",
    icon: BarChart3,
    accent: "from-rose-500/20 to-pink-500/10 text-rose-600 dark:text-rose-300",
    description: "Inspect the distribution of a numeric column.",
  },
};

const panelVariants = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: "easeOut" as const },
  },
};
function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "chart";
}

function buildDefaultTitle(
  type: BuilderChartType,
  xAxis: string,
  yAxis: string,
  aggregation: Aggregation,
  groupBy: string,
): string {
  if (type === "histogram") {
    return `${yAxis} distribution`;
  }

  if (type === "scatter") {
    return xAxis && yAxis ? `${yAxis} vs ${xAxis}` : "Scatter plot";
  }

  if (!xAxis || !yAxis) {
    return "Untitled chart";
  }

  const metricLabel = aggregation === "count" ? `Count of ${yAxis}` : `${toTitleCase(aggregation)} ${yAxis}`;

  if (groupBy) {
    return `${metricLabel} by ${xAxis} and ${groupBy}`;
  }

  return `${metricLabel} by ${xAxis}`;
}

function buildChartSql(
  tableName: string,
  type: BuilderChartType,
  xAxis: string,
  yAxis: string,
  aggregation: Aggregation,
  groupBy: string,
): string | null {
  const safeTable = quoteIdentifier(tableName);
  const safeX = xAxis ? quoteIdentifier(xAxis) : null;
  const safeY = yAxis ? quoteIdentifier(yAxis) : null;
  const safeGroup = groupBy ? quoteIdentifier(groupBy) : null;

  if (type === "histogram") {
    if (!safeY) return null;
    return [
      `SELECT ${safeY}`,
      `FROM ${safeTable}`,
      `WHERE ${safeY} IS NOT NULL`,
      "LIMIT 5000",
    ].join(" ");
  }

  if (type === "scatter") {
    if (!safeX || !safeY) return null;
    return [
      `SELECT ${safeX}, ${safeY}`,
      `FROM ${safeTable}`,
      `WHERE ${safeX} IS NOT NULL AND ${safeY} IS NOT NULL`,
      "LIMIT 400",
    ].join(" ");
  }

  if (!safeX || !safeY) return null;

  const aggregatedValue = `${aggregation}(${safeY}) AS ${safeY}`;
  const filters = `WHERE ${safeX} IS NOT NULL AND ${safeY} IS NOT NULL`;

  if (type === "pie") {
    return [
      `SELECT ${safeX}, ${aggregatedValue}`,
      `FROM ${safeTable}`,
      filters,
      "GROUP BY 1",
      "ORDER BY 2 DESC",
      "LIMIT 12",
    ].join(" ");
  }

  if (safeGroup) {
    return [
      `SELECT ${safeX}, ${safeGroup}, ${aggregatedValue}`,
      `FROM ${safeTable}`,
      `${filters} AND ${safeGroup} IS NOT NULL`,
      "GROUP BY 1, 2",
      "ORDER BY 1 ASC, 2 ASC",
      type === "bar" ? "LIMIT 120" : "LIMIT 200",
    ].join(" ");
  }

  const orderClause =
    type === "line" || type === "area" ? "ORDER BY 1 ASC" : "ORDER BY 2 DESC";
  const limitClause = type === "bar" ? "LIMIT 24" : "LIMIT 80";

  return [
    `SELECT ${safeX}, ${aggregatedValue}`,
    `FROM ${safeTable}`,
    filters,
    "GROUP BY 1",
    orderClause,
    limitClause,
  ].join(" ");
}

async function exportPreviewAsPng(container: HTMLElement, fileName: string): Promise<void> {
  const svg = container.querySelector("svg");
  if (!(svg instanceof SVGSVGElement)) {
    throw new Error("No SVG chart preview found.");
  }

  const bounds = svg.getBoundingClientRect();
  const width = Math.max(960, Math.round(bounds.width) || 960);
  const height = Math.max(440, Math.round(bounds.height) || 440);
  const scale = Math.min(window.devicePixelRatio || 1, 2);

  const clonedSvg = svg.cloneNode(true) as SVGSVGElement;
  clonedSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clonedSvg.setAttribute("width", String(width));
  clonedSvg.setAttribute("height", String(height));

  if (!clonedSvg.getAttribute("viewBox")) {
    clonedSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  const serialized = new XMLSerializer().serializeToString(clonedSvg);
  const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Could not load SVG preview."));
      nextImage.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas export is unavailable.");
    }

    context.scale(scale, scale);
    context.fillStyle = document.documentElement.classList.contains("dark")
      ? "#020617"
      : "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const downloadUrl = canvas.toDataURL("image/png");
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = `${slugify(fileName)}.png`;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function readSavedCharts(): SavedChartSnapshot[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(SAVED_CHARTS_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedChartSnapshot[];
  } catch {
    return [];
  }
}

export default function ChartBuilder({ tableName, columns }: ChartBuilderProps) {
  const previewRef = useRef<HTMLDivElement>(null);

  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );

  const [chartType, setChartType] = useState<BuilderChartType>("bar");
  const [xAxis, setXAxis] = useState("");
  const [yAxis, setYAxis] = useState("");
  const [aggregation, setAggregation] = useState<Aggregation>("sum");
  const [groupBy, setGroupBy] = useState("");
  const [title, setTitle] = useState("");
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const supportsAggregation = chartType !== "scatter" && chartType !== "histogram";
  const supportsGroupBy =
    chartType === "bar" || chartType === "line" || chartType === "area";
  const requiresXAxis = chartType !== "histogram";
  const xAxisOptions = chartType === "scatter" ? numericColumns : columns;
  const groupableColumns = columns.filter(
    (column) => column.name !== xAxis && column.name !== yAxis,
  );

  useEffect(() => {
    if (!yAxis && numericColumns[0]) {
      setYAxis(numericColumns[0].name);
    }
  }, [numericColumns, yAxis]);

  useEffect(() => {
    if (!requiresXAxis) {
      if (xAxis) setXAxis("");
      return;
    }

    if (!xAxisOptions.some((column) => column.name === xAxis)) {
      setXAxis(xAxisOptions[0]?.name ?? "");
    }
  }, [requiresXAxis, xAxis, xAxisOptions]);

  useEffect(() => {
    if (!numericColumns.some((column) => column.name === yAxis)) {
      setYAxis(numericColumns[0]?.name ?? "");
    }
  }, [numericColumns, yAxis]);

  useEffect(() => {
    if (!supportsGroupBy) {
      if (groupBy) setGroupBy("");
      return;
    }

    if (!groupableColumns.some((column) => column.name === groupBy)) {
      setGroupBy("");
    }
  }, [groupBy, groupableColumns, supportsGroupBy]);

  const resolvedTitle = title.trim() || buildDefaultTitle(chartType, xAxis, yAxis, aggregation, groupBy);

  const previewConfig = useMemo<ChartConfig>(
    () => ({
      id: "chart-preview",
      type: chartType,
      title: resolvedTitle,
      xAxis: requiresXAxis ? xAxis || undefined : undefined,
      yAxis: yAxis || undefined,
      groupBy: supportsGroupBy && groupBy ? groupBy : undefined,
      aggregation: supportsAggregation ? aggregation : undefined,
    }),
    [
      aggregation,
      chartType,
      groupBy,
      requiresXAxis,
      resolvedTitle,
      supportsAggregation,
      supportsGroupBy,
      xAxis,
      yAxis,
    ],
  );

  const sql = useMemo(
    () => buildChartSql(tableName, chartType, xAxis, yAxis, aggregation, groupBy),
    [aggregation, chartType, groupBy, tableName, xAxis, yAxis],
  );

  useEffect(() => {
    setNotice(null);
  }, [aggregation, chartType, groupBy, title, xAxis, yAxis]);

  useEffect(() => {
    if (!sql) {
      setData([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    let active = true;
    setIsLoading(true);
    setError(null);

    runQuery(sql)
      .then((rows) => {
        if (!active) return;
        setData(rows);
      })
      .catch((queryError: unknown) => {
        if (!active) return;
        setData([]);
        setError(
          queryError instanceof Error
            ? queryError.message
            : "The preview query could not be executed.",
        );
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [sql]);

  async function handleSave(): Promise<void> {
    if (!sql || data.length === 0) return;

    setIsSaving(true);

    try {
      const config: ChartConfig = {
        ...previewConfig,
        id: `chart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      };

      const payload: SavedChartSnapshot = {
        tableName,
        config,
        data,
        sql,
        savedAt: Date.now(),
      };

      let persisted = false;

      try {
        const existing = readSavedCharts();
        window.localStorage.setItem(
          SAVED_CHARTS_STORAGE_KEY,
          JSON.stringify([payload, ...existing].slice(0, 50)),
        );
        persisted = true;
      } catch {
        persisted = false;
      }

      window.dispatchEvent(
        new CustomEvent<SavedChartSnapshot>(CHART_SAVED_EVENT, {
          detail: payload,
        }),
      );

      setNotice({
        tone: "success",
        message: persisted
          ? "Chart saved locally and broadcast to the app."
          : "Chart broadcast to the app, but local storage was unavailable.",
      });
    } catch {
      setNotice({
        tone: "error",
        message: "The chart could not be saved.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleExport(): Promise<void> {
    if (!previewRef.current || data.length === 0) return;

    setIsExporting(true);

    try {
      await exportPreviewAsPng(previewRef.current, resolvedTitle);
      setNotice({
        tone: "success",
        message: "PNG export downloaded.",
      });
    } catch {
      setNotice({
        tone: "error",
        message: "The preview could not be exported as PNG.",
      });
    } finally {
      setIsExporting(false);
    }
  }

  const headerMeta = CHART_TYPE_META[chartType];
  const HeaderIcon = headerMeta.icon;

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <motion.aside
        variants={panelVariants}
        initial="hidden"
        animate="show"
        className="overflow-hidden rounded-3xl border border-white/30 bg-white/60 shadow-[0_24px_80px_-36px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45"
      >
        <div className="border-b border-slate-200/70 bg-linear-to-br from-white/70 to-slate-100/40 p-6 dark:border-slate-800/80 dark:from-slate-900/70 dark:to-slate-950/40">
          <div className="mb-4 inline-flex rounded-2xl border border-white/60 bg-white/60 p-3 shadow-sm dark:border-white/10 dark:bg-white/5">
            <Sparkles className="h-5 w-5 text-violet-500" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Chart Builder
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Build a chart against <span className="font-medium text-slate-900 dark:text-slate-100">{tableName}</span> and preview the result live from DuckDB.
          </p>
        </div>

        <div className="space-y-6 p-6">
          {numericColumns.length === 0 && (
            <div className="rounded-2xl border border-amber-300/60 bg-amber-50/80 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-950/30 dark:text-amber-200">
              This dataset has no numeric columns, so the builder cannot produce aggregated charts yet.
            </div>
          )}

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
              <HeaderIcon className="h-3.5 w-3.5" />
              Chart Type
            </div>
            <div className="grid grid-cols-2 gap-2">
              {CHART_TYPES.map((type) => {
                const meta = CHART_TYPE_META[type];
                const Icon = meta.icon;
                const active = chartType === type;

                return (
                  <motion.button
                    key={type}
                    type="button"
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setChartType(type)}
                    className={`rounded-2xl border px-3 py-3 text-left transition-all ${
                      active
                        ? `border-white/80 bg-linear-to-br ${meta.accent} shadow-sm dark:border-white/15`
                        : "border-slate-200/80 bg-white/60 hover:border-slate-300 hover:bg-white/80 dark:border-slate-800/80 dark:bg-white/5 dark:hover:border-slate-700 dark:hover:bg-white/8"
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {meta.label}
                      </span>
                    </div>
                    <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">
                      {meta.description}
                    </p>
                  </motion.button>
                );
              })}
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
              <Sigma className="h-3.5 w-3.5" />
              Configuration
            </div>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                X-axis
              </span>
              <select
                value={requiresXAxis ? xAxis : ""}
                onChange={(event) => setXAxis(event.target.value)}
                disabled={!requiresXAxis}
                className="w-full rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-500/10 disabled:cursor-not-allowed disabled:bg-slate-100/80 disabled:text-slate-400 dark:border-slate-800/80 dark:bg-slate-900/70 dark:text-slate-100 dark:focus:border-violet-400 dark:disabled:bg-slate-900/30 dark:disabled:text-slate-500"
              >
                <option value="">
                  {requiresXAxis ? "Select a column" : "Histogram uses the selected measure"}
                </option>
                {xAxisOptions.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Y-axis
              </span>
              <select
                value={yAxis}
                onChange={(event) => setYAxis(event.target.value)}
                disabled={numericColumns.length === 0}
                className="w-full rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-500/10 disabled:cursor-not-allowed disabled:bg-slate-100/80 disabled:text-slate-400 dark:border-slate-800/80 dark:bg-slate-900/70 dark:text-slate-100 dark:focus:border-violet-400 dark:disabled:bg-slate-900/30 dark:disabled:text-slate-500"
              >
                <option value="">Select a numeric column</option>
                {numericColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Aggregation
              </span>
              <select
                value={supportsAggregation ? aggregation : "sum"}
                onChange={(event) => setAggregation(event.target.value as Aggregation)}
                disabled={!supportsAggregation}
                className="w-full rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-500/10 disabled:cursor-not-allowed disabled:bg-slate-100/80 disabled:text-slate-400 dark:border-slate-800/80 dark:bg-slate-900/70 dark:text-slate-100 dark:focus:border-violet-400 dark:disabled:bg-slate-900/30 dark:disabled:text-slate-500"
              >
                {AGGREGATIONS.map((value) => (
                  <option key={value} value={value}>
                    {toTitleCase(value)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Group by
              </span>
              <select
                value={supportsGroupBy ? groupBy : ""}
                onChange={(event) => setGroupBy(event.target.value)}
                disabled={!supportsGroupBy}
                className="w-full rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-500/10 disabled:cursor-not-allowed disabled:bg-slate-100/80 disabled:text-slate-400 dark:border-slate-800/80 dark:bg-slate-900/70 dark:text-slate-100 dark:focus:border-violet-400 dark:disabled:bg-slate-900/30 dark:disabled:text-slate-500"
              >
                <option value="">
                  {supportsGroupBy ? "No segmentation" : "Not available for this chart type"}
                </option>
                {groupableColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Title
              </span>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={buildDefaultTitle(chartType, xAxis, yAxis, aggregation, groupBy)}
                className="w-full rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-500/10 dark:border-slate-800/80 dark:bg-slate-900/70 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400"
              />
            </label>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                Generated SQL
              </div>
              <div className="rounded-full border border-slate-200/80 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-400">
                {data.length} rows
              </div>
            </div>
            <pre className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-slate-950 px-4 py-4 text-xs leading-6 text-slate-200 shadow-inner dark:border-slate-800">
              <code>{sql ?? "-- Select the required columns to generate a query."}</code>
            </pre>
          </section>
        </div>
      </motion.aside>

      <motion.section
        variants={panelVariants}
        initial="hidden"
        animate="show"
        transition={{ delay: 0.05 }}
        className="overflow-hidden rounded-3xl border border-white/30 bg-white/60 shadow-[0_24px_80px_-36px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45"
      >
        <div className="flex flex-col gap-4 border-b border-slate-200/70 p-6 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800/80">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
              <BarChart3 className="h-3.5 w-3.5" />
              Live Preview
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              {resolvedTitle}
            </h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {error
                ? "The preview query failed."
                : isLoading
                ? "Running DuckDB query..."
                : sql
                ? "Preview updates automatically as you change the configuration."
                : "Pick chart fields to generate a live preview."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!sql || isLoading || data.length === 0 || isSaving}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-slate-700 dark:hover:bg-slate-900"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={!sql || isLoading || data.length === 0 || isExporting}
              className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export PNG
            </button>
          </div>
        </div>

        <div className="space-y-4 p-6">
          <div
            ref={previewRef}
            className="relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-linear-to-br from-white/90 via-white/70 to-slate-100/60 p-5 shadow-inner dark:border-slate-800/80 dark:from-slate-900/95 dark:via-slate-950/80 dark:to-slate-900/70"
          >
            <div className="pointer-events-none absolute inset-x-10 top-0 h-24 rounded-full bg-violet-500/10 blur-3xl" />
            <AnimatePresence mode="wait">
              {error ? (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="relative flex min-h-[460px] flex-col items-center justify-center gap-3 rounded-[22px] border border-red-300/60 bg-red-50/80 px-6 text-center dark:border-red-500/20 dark:bg-red-950/20"
                >
                  <CircleAlert className="h-9 w-9 text-red-500" />
                  <div>
                    <p className="text-base font-semibold text-red-700 dark:text-red-300">
                      Preview query failed
                    </p>
                    <p className="mt-1 max-w-md text-sm text-red-600/80 dark:text-red-300/80">
                      {error}
                    </p>
                  </div>
                </motion.div>
              ) : isLoading ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="relative flex min-h-[460px] flex-col items-center justify-center gap-4 text-slate-500 dark:text-slate-400"
                >
                  <div className="rounded-2xl border border-white/60 bg-white/70 p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
                    <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
                  </div>
                  <div className="text-center">
                    <p className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      Running DuckDB query
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      The preview refreshes as soon as the result set is ready.
                    </p>
                  </div>
                </motion.div>
              ) : !sql ? (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="relative flex min-h-[460px] flex-col items-center justify-center gap-3 text-center text-slate-500 dark:text-slate-400"
                >
                  <div className="rounded-2xl border border-white/60 bg-white/70 p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
                    <BarChart3 className="h-8 w-8 text-slate-400 dark:text-slate-500" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      Configure your chart
                    </p>
                    <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
                      Choose the required columns and aggregation to generate a live chart preview.
                    </p>
                  </div>
                </motion.div>
              ) : data.length === 0 ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="relative flex min-h-[460px] flex-col items-center justify-center gap-3 text-center text-slate-500 dark:text-slate-400"
                >
                  <div className="rounded-2xl border border-white/60 bg-white/70 p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
                    <BarChart3 className="h-8 w-8 text-slate-400 dark:text-slate-500" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      No rows matched this configuration
                    </p>
                    <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
                      Try a different measure, aggregation, or grouping field.
                    </p>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="chart"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="relative"
                >
                  <ChartRenderer config={previewConfig} data={data} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white/65 px-4 py-3 text-sm dark:border-slate-800/80 dark:bg-slate-900/55 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-slate-600 dark:text-slate-400">
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {data.length.toLocaleString()}
              </span>{" "}
              preview rows
            </div>
            <AnimatePresence mode="wait">
              {notice ? (
                <motion.div
                  key={notice.message}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className={`text-sm ${
                    notice.tone === "success"
                      ? "text-emerald-600 dark:text-emerald-300"
                      : notice.tone === "error"
                      ? "text-red-600 dark:text-red-300"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  {notice.message}
                </motion.div>
              ) : (
                <motion.div
                  key="hint"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-sm text-slate-500 dark:text-slate-400"
                >
                  Save stores the chart in local storage and emits a browser event for integration.
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.section>
    </div>
  );
}
