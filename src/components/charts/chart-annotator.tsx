"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Download,
  Highlighter,
  LineChart,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { buildMetricExpression, quoteIdentifier } from "@/lib/utils/sql";
import { useDuckDBQuery } from "@/hooks/use-duckdb-query";
import type { ColumnProfile } from "@/types/dataset";

interface ChartAnnotatorProps {
  tableName: string;
  columns: ColumnProfile[];
}

type ChartType = "bar" | "line" | "area" | "scatter";
type AnnotationKind = "text" | "line" | "region";

interface ChartConfig {
  chartType: ChartType;
  xColumn: string;
  yColumn: string;
  aggregation: "SUM" | "AVG" | "COUNT";
}

interface BaseAnnotation {
  id: string;
  chartKey: string;
  label: string;
  color: string;
  createdAt: number;
}

interface TextAnnotation extends BaseAnnotation {
  kind: "text";
  xValue: string;
  yValue: string;
}

interface LineAnnotation extends BaseAnnotation {
  kind: "line";
  axis: "x" | "y";
  value: string;
}

interface RegionAnnotation extends BaseAnnotation {
  kind: "region";
  axis: "x" | "y";
  start: string;
  end: string;
}

type ChartAnnotation = TextAnnotation | LineAnnotation | RegionAnnotation;
type Notice = string | null;

const EASE = [0.22, 1, 0.36, 1] as const;
const EMPTY_ROWS: Record<string, unknown>[] = [];
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange() {
  listeners.forEach((listener) => listener());
}

function storageKey(tableName: string) {
  return `datalens:chart-annotations:${tableName}`;
}
function readAnnotations(tableName: string): ChartAnnotation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(tableName));
    return raw ? (JSON.parse(raw) as ChartAnnotation[]) : [];
  } catch {
    return [];
  }
}

function writeAnnotations(tableName: string, annotations: ChartAnnotation[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(tableName), JSON.stringify(annotations));
  emitChange();
}

function useDarkMode() {
  return useSyncExternalStore(
    (listener) => {
      if (typeof document === "undefined") return () => undefined;
      const observer = new MutationObserver(listener);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => observer.disconnect();
    },
    () => (typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : false),
    () => false,
  );
}

function buildSql(tableName: string, config: ChartConfig) {
  const safeTable = quoteIdentifier(tableName);
  const safeX = quoteIdentifier(config.xColumn);
  const safeY = quoteIdentifier(config.yColumn);

  if (config.chartType === "scatter") {
    return `SELECT ${safeX} AS x_value, ${safeY} AS y_value FROM ${safeTable} WHERE ${safeX} IS NOT NULL AND ${safeY} IS NOT NULL LIMIT 400`;
  }

  const measure = buildMetricExpression(config.aggregation, config.yColumn, quoteIdentifier, { cast: false });
  return [
    `SELECT CAST(${safeX} AS VARCHAR) AS x_value, ${measure} AS y_value`,
    `FROM ${safeTable}`,
    `WHERE ${safeX} IS NOT NULL${config.aggregation === "COUNT" ? "" : ` AND ${safeY} IS NOT NULL`}`,
    "GROUP BY 1",
    "ORDER BY 1",
    "LIMIT 80",
  ].join(" ");
}

function chartKey(config: ChartConfig) {
  return `${config.chartType}:${config.xColumn}:${config.yColumn}:${config.aggregation}`;
}

function annotationSummary(annotation: ChartAnnotation) {
  if (annotation.kind === "text") return `${annotation.xValue}, ${annotation.yValue}`;
  if (annotation.kind === "line") return `${annotation.axis.toUpperCase()} = ${annotation.value}`;
  return `${annotation.axis.toUpperCase()} ${annotation.start} -> ${annotation.end}`;
}

export default function ChartAnnotator({ tableName, columns }: ChartAnnotatorProps) {
  const allAnnotations = useSyncExternalStore(subscribe, () => readAnnotations(tableName), () => []);
  const dark = useDarkMode();
  const chartRef = useRef<ReactECharts | null>(null);
  const [config, setConfig] = useState<ChartConfig>({
    chartType: "line",
    xColumn: columns[0]?.name ?? "",
    yColumn: columns.find((column) => column.type === "number")?.name ?? columns[0]?.name ?? "",
    aggregation: "SUM",
  });
  const [querySql, setQuerySql] = useState<string | null>(null);
  const [manualNotice, setManualNotice] = useState<Notice>(null);
  const [annotationKind, setAnnotationKind] = useState<AnnotationKind>("text");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#06b6d4");
  const [pointX, setPointX] = useState("");
  const [pointY, setPointY] = useState("");
  const [axis, setAxis] = useState<"x" | "y">("y");
  const [lineValue, setLineValue] = useState("");
  const [regionStart, setRegionStart] = useState("");
  const [regionEnd, setRegionEnd] = useState("");
  const {
    data: queryRows,
    loading,
    error: queryError,
    refetch,
  } = useDuckDBQuery(querySql);
  const rows = queryRows ?? EMPTY_ROWS;
  const notice =
    manualNotice
    ?? queryError
    ?? (querySql && !loading && queryRows ? "Chart data loaded from DuckDB." : null);

  const currentChartKey = chartKey(config);
  const annotations = useMemo(
    () => allAnnotations.filter((annotation) => annotation.chartKey === currentChartKey),
    [allAnnotations, currentChartKey],
  );

  const option = useMemo<EChartsOption>(() => {
    const textColor = dark ? "#cbd5e1" : "#475569";
    const lineColor = dark ? "#334155" : "#cbd5e1";
    const textAnnotations = annotations.filter((annotation): annotation is TextAnnotation => annotation.kind === "text");
    const lineAnnotations = annotations.filter((annotation): annotation is LineAnnotation => annotation.kind === "line");
    const regionAnnotations = annotations.filter((annotation): annotation is RegionAnnotation => annotation.kind === "region");
    const seriesType = config.chartType === "area" ? "line" : config.chartType;

    return {
      animationDuration: 500,
      tooltip: { trigger: config.chartType === "scatter" ? "item" : "axis" },
      grid: { left: 56, right: 24, top: 28, bottom: 48, containLabel: true },
      xAxis: config.chartType === "scatter"
        ? { type: "value", name: config.xColumn, axisLabel: { color: textColor }, axisLine: { lineStyle: { color: lineColor } } }
        : { type: "category", name: config.xColumn, data: rows.map((row) => String(row.x_value ?? "")), axisLabel: { color: textColor }, axisLine: { lineStyle: { color: lineColor } } },
      yAxis: { type: "value", name: config.yColumn, axisLabel: { color: textColor }, splitLine: { lineStyle: { color: lineColor, type: "dashed" } } },
      series: [
        {
          type: seriesType,
          smooth: config.chartType !== "bar" && config.chartType !== "scatter",
          areaStyle: config.chartType === "area" ? { opacity: 0.16, color: "#22c55e" } : undefined,
          data: config.chartType === "scatter" ? rows.map((row) => [Number(row.x_value ?? 0), Number(row.y_value ?? 0)]) : rows.map((row) => Number(row.y_value ?? 0)),
          itemStyle: { color: "#06b6d4" },
          lineStyle: { color: "#06b6d4", width: 3 },
          symbolSize: 8,
          markPoint: textAnnotations.length > 0 ? {
            label: { color: dark ? "#f8fafc" : "#0f172a", formatter: "{b}" },
            data: textAnnotations.map((annotation) => ({
              name: annotation.label,
              coord: config.chartType === "scatter" ? [Number(annotation.xValue), Number(annotation.yValue)] : [annotation.xValue, Number(annotation.yValue)],
              itemStyle: { color: annotation.color },
            })),
          } : undefined,
          markLine: lineAnnotations.length > 0 ? {
            symbol: "none",
            data: lineAnnotations.map((annotation) => annotation.axis === "x" ? { xAxis: annotation.value, name: annotation.label, lineStyle: { color: annotation.color } } : { yAxis: Number(annotation.value), name: annotation.label, lineStyle: { color: annotation.color } }),
          } : undefined,
          markArea: regionAnnotations.length > 0 ? {
            data: regionAnnotations.map((annotation) => annotation.axis === "x" ? [{ name: annotation.label, xAxis: annotation.start, itemStyle: { color: annotation.color, opacity: 0.12 } }, { xAxis: annotation.end }] : [{ name: annotation.label, yAxis: Number(annotation.start), itemStyle: { color: annotation.color, opacity: 0.12 } }, { yAxis: Number(annotation.end) }]),
          } : undefined,
        },
      ],
    };
  }, [annotations, config, dark, rows]);

  function loadChart() {
    if (!config.xColumn || !config.yColumn) {
      setManualNotice("Select chart columns first.");
      return;
    }

    const nextSql = buildSql(tableName, config);
    setManualNotice(null);

    if (querySql === nextSql) {
      refetch();
      return;
    }

    setQuerySql(nextSql);
  }

  function resetEditor() {
    setEditingId(null);
    setLabel("");
    setColor("#06b6d4");
    setPointX("");
    setPointY("");
    setAxis("y");
    setLineValue("");
    setRegionStart("");
    setRegionEnd("");
  }

  function saveAnnotation() {
    if (!label.trim()) {
      setManualNotice("Annotation label is required.");
      return;
    }

    const base = { id: editingId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, chartKey: currentChartKey, label: label.trim(), color, createdAt: Date.now() };
    const annotation: ChartAnnotation = annotationKind === "text"
      ? { ...base, kind: "text", xValue: pointX, yValue: pointY }
      : annotationKind === "line"
        ? { ...base, kind: "line", axis, value: lineValue }
        : { ...base, kind: "region", axis, start: regionStart, end: regionEnd };

    const nextAnnotations = editingId
      ? allAnnotations.map((entry) => (entry.id === editingId ? annotation : entry))
      : [annotation, ...allAnnotations];

    writeAnnotations(tableName, nextAnnotations);
    setManualNotice(editingId ? "Annotation updated." : "Annotation saved.");
    resetEditor();
  }

  function editAnnotation(annotation: ChartAnnotation) {
    setEditingId(annotation.id);
    setAnnotationKind(annotation.kind);
    setLabel(annotation.label);
    setColor(annotation.color);
    if (annotation.kind === "text") {
      setPointX(annotation.xValue);
      setPointY(annotation.yValue);
    } else if (annotation.kind === "line") {
      setAxis(annotation.axis);
      setLineValue(annotation.value);
    } else {
      setAxis(annotation.axis);
      setRegionStart(annotation.start);
      setRegionEnd(annotation.end);
    }
  }

  function deleteAnnotation(annotationId: string) {
    writeAnnotations(tableName, allAnnotations.filter((annotation) => annotation.id !== annotationId));
    setManualNotice("Annotation deleted.");
    if (editingId === annotationId) resetEditor();
  }

  function exportPng() {
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance) {
      setManualNotice("Render the chart before exporting it.");
      return;
    }

    const url = instance.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: dark ? "#020617" : "#f8fafc" });
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${tableName}-annotated-chart.png`;
    anchor.click();
  }

  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/20 bg-white/60 shadow-2xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45">
      <div className="border-b border-white/15 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300">
            <Highlighter className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Chart Annotator</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">Annotated charts for {tableName}</h2>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5">
        {notice ? <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">{notice}</div> : null}

        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }} className="grid gap-4 lg:grid-cols-[1.2fr_0.9fr]">
          <div className="space-y-4 rounded-[1.75rem] border border-white/15 bg-white/50 p-4 dark:bg-slate-900/40">
            <div className="grid gap-3 md:grid-cols-4">
              <select value={config.chartType} onChange={(event) => setConfig((current) => ({ ...current, chartType: event.target.value as ChartType }))} className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50">
                <option value="bar">Bar</option>
                <option value="line">Line</option>
                <option value="area">Area</option>
                <option value="scatter">Scatter</option>
              </select>
              <select value={config.xColumn} onChange={(event) => setConfig((current) => ({ ...current, xColumn: event.target.value }))} className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50">
                {columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
              </select>
              <select value={config.yColumn} onChange={(event) => setConfig((current) => ({ ...current, yColumn: event.target.value }))} className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50">
                {columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
              </select>
              <select value={config.aggregation} onChange={(event) => setConfig((current) => ({ ...current, aggregation: event.target.value as ChartConfig["aggregation"] }))} className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50">
                <option value="SUM">SUM</option>
                <option value="AVG">AVG</option>
                <option value="COUNT">COUNT</option>
              </select>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void loadChart()} className="inline-flex items-center gap-2 rounded-2xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-amber-500">
                <LineChart className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {loading ? "Loading chart" : "Load chart"}
              </button>
              <button type="button" onClick={exportPng} className="inline-flex items-center gap-2 rounded-2xl border border-white/20 px-4 py-3 text-sm text-slate-700 transition hover:bg-white/40 dark:text-slate-200">
                <Download className="h-4 w-4" />
                Export PNG
              </button>
            </div>

            <div className="overflow-hidden rounded-[1.5rem] border border-white/15 bg-white/35 p-3 dark:bg-slate-950/30">
              <ReactECharts ref={chartRef} option={option} style={{ height: 420 }} onEvents={{ click: (params: { value?: number[] | number; name?: string }) => {
                if (config.chartType === "scatter" && Array.isArray(params.value)) {
                  setPointX(String(params.value[0] ?? ""));
                  setPointY(String(params.value[1] ?? ""));
                } else {
                  setPointX(String(params.name ?? ""));
                  setPointY(String(params.value ?? ""));
                }
                setAnnotationKind("text");
              } }} />
            </div>
          </div>

          <div className="space-y-4 rounded-[1.75rem] border border-white/15 bg-white/50 p-4 dark:bg-slate-900/40">
            <div className="grid gap-3">
              <select value={annotationKind} onChange={(event) => setAnnotationKind(event.target.value as AnnotationKind)} className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50">
                <option value="text">Text annotation</option>
                <option value="line">Reference line</option>
                <option value="region">Highlight region</option>
              </select>
              <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label" className="w-full rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50" />
              <input value={color} onChange={(event) => setColor(event.target.value)} type="color" className="h-12 w-full rounded-2xl border border-white/20 bg-white/70 px-3 py-2 dark:bg-slate-950/60" />
              {annotationKind === "text" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <input value={pointX} onChange={(event) => setPointX(event.target.value)} placeholder="X value" className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50" />
                  <input value={pointY} onChange={(event) => setPointY(event.target.value)} placeholder="Y value" className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50" />
                </div>
              ) : null}
              {annotationKind !== "text" ? (
                <select value={axis} onChange={(event) => setAxis(event.target.value as "x" | "y")} className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50">
                  <option value="x">Vertical / X axis</option>
                  <option value="y">Horizontal / Y axis</option>
                </select>
              ) : null}
              {annotationKind === "line" ? <input value={lineValue} onChange={(event) => setLineValue(event.target.value)} placeholder="Line value" className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50" /> : null}
              {annotationKind === "region" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <input value={regionStart} onChange={(event) => setRegionStart(event.target.value)} placeholder="Start" className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50" />
                  <input value={regionEnd} onChange={(event) => setRegionEnd(event.target.value)} placeholder="End" className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/60 dark:text-slate-50" />
                </div>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={saveAnnotation} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500">
                  <Plus className="h-4 w-4" />
                  {editingId ? "Update" : "Add"}
                </button>
                <button type="button" onClick={resetEditor} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/20 px-4 py-3 text-sm text-slate-700 transition hover:bg-white/40 dark:text-slate-200">
                  <Trash2 className="h-4 w-4" />
                  Reset
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Annotation panel</h3>
              <AnimatePresence initial={false}>
                {annotations.length === 0 ? (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-[1.5rem] border border-dashed border-white/20 bg-white/35 px-5 py-8 text-center text-sm text-slate-500 dark:bg-slate-900/30 dark:text-slate-400">
                    No annotations saved for the current chart shape.
                  </motion.div>
                ) : (
                  annotations.map((annotation) => (
                    <motion.article key={annotation.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.24, ease: EASE }} className="rounded-[1.25rem] border border-white/15 bg-white/35 p-4 dark:bg-slate-900/30">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: annotation.color }} />
                            <h4 className="font-semibold text-slate-950 dark:text-slate-50">{annotation.label}</h4>
                          </div>
                          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{annotation.kind}</p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{annotationSummary(annotation)}</p>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => editAnnotation(annotation)} className="rounded-2xl border border-white/20 p-2 text-slate-700 transition hover:bg-white/40 dark:text-slate-200">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => deleteAnnotation(annotation.id)} className="rounded-2xl border border-rose-300/40 bg-rose-500/10 p-2 text-rose-700 transition hover:bg-rose-500/15 dark:text-rose-300">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </motion.article>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
