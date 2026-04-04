"use client";

import { memo, startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ReactECharts from "echarts-for-react";
import {
  BarChart3,
  FileDown,
  GripVertical,
  LayoutDashboard,
  LineChart,
  Loader2,
  PencilLine,
  PieChart,
  Plus,
  Save,
  ScatterChart,
  Table2,
  Trash2,
  Type,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber, generateId } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DashboardBuilderProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

type WidgetType = "bar" | "line" | "pie" | "scatter" | "kpi" | "table" | "text";
type Aggregation = "sum" | "avg" | "count" | "min" | "max";
type Notice = { tone: "success" | "error" | "info"; message: string } | null;

interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  xAxis: string;
  yAxis: string;
  aggregation: Aggregation;
  color: string;
  tableColumns: string[];
  text: string;
}

interface WidgetRuntime {
  loading: boolean;
  error: string | null;
  rows: Record<string, unknown>[];
  value?: number | string;
}

const EASE = [0.16, 1, 0.3, 1] as const;
const STORAGE_KEY_PREFIX = "datalens-dashboard:";
const COLORS = ["#38bdf8", "#14b8a6", "#22c55e", "#a855f7", "#f97316", "#ef4444"] as const;
const WIDGET_TYPES: Array<{
  type: WidgetType;
  label: string;
  description: string;
  icon: typeof BarChart3;
}> = [
  { type: "bar", label: "Bar Chart", description: "Compare categories with aggregated bars.", icon: BarChart3 },
  { type: "line", label: "Line Chart", description: "Track ordered values as a line.", icon: LineChart },
  { type: "pie", label: "Pie Chart", description: "Show category share as slices.", icon: PieChart },
  { type: "scatter", label: "Scatter Plot", description: "Plot two numeric measures.", icon: ScatterChart },
  { type: "kpi", label: "KPI Card", description: "Highlight a single metric.", icon: LayoutDashboard },
  { type: "table", label: "Table Widget", description: "Embed a compact data preview.", icon: Table2 },
  { type: "text", label: "Text Widget", description: "Add narrative context to the dashboard.", icon: Type },
];

function quoteId(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function tableStorageKey(tableName: string): string {
  return `${STORAGE_KEY_PREFIX}${tableName}`;
}

function buildDefaultWidget(type: WidgetType, columns: ColumnProfile[]): WidgetConfig {
  const numericColumns = columns.filter((column) => column.type === "number");
  const categoricalColumns = columns.filter((column) => column.type !== "number");
  const xAxis = categoricalColumns[0]?.name ?? columns[0]?.name ?? "";
  const yAxis = numericColumns[0]?.name ?? columns[0]?.name ?? "";
  return {
    id: generateId(),
    type,
    title:
      type === "kpi"
        ? `KPI • ${yAxis || "Metric"}`
        : type === "table"
          ? "Mini data table"
          : type === "text"
            ? "Notes"
            : `${type[0].toUpperCase()}${type.slice(1)} widget`,
    xAxis,
    yAxis,
    aggregation: type === "scatter" ? "avg" : "sum",
    color: COLORS[0],
    tableColumns: columns.slice(0, 4).map((column) => column.name),
    text: "Use this space for notes, caveats, and next steps.",
  };
}

function widgetQuery(tableName: string, widget: WidgetConfig): string | null {
  const tableSql = quoteId(tableName);
  const xAxis = widget.xAxis ? quoteId(widget.xAxis) : "";
  const yAxis = widget.yAxis ? quoteId(widget.yAxis) : "";
  if (widget.type === "text") return null;
  if (widget.type === "table") {
    const selected = widget.tableColumns.length
      ? widget.tableColumns.map((column) => quoteId(column)).join(", ")
      : "*";
    return `SELECT ${selected} FROM ${tableSql} LIMIT 8`;
  }
  if (widget.type === "kpi") {
    if (widget.aggregation === "count") return `SELECT COUNT(*) AS value FROM ${tableSql}`;
    if (!widget.yAxis) return null;
    return `SELECT ${widget.aggregation}(${yAxis}) AS value FROM ${tableSql} WHERE ${yAxis} IS NOT NULL`;
  }
  if (widget.type === "scatter") {
    if (!widget.xAxis || !widget.yAxis) return null;
    return `
      SELECT ${xAxis} AS x_value, ${yAxis} AS y_value
      FROM ${tableSql}
      WHERE ${xAxis} IS NOT NULL AND ${yAxis} IS NOT NULL
      LIMIT 240
    `;
  }
  if (!widget.xAxis) return null;
  if (widget.type === "pie") {
    const metricSql = widget.aggregation === "count" || !widget.yAxis ? "COUNT(*)" : `${widget.aggregation}(${yAxis})`;
    return `
      SELECT ${xAxis} AS label, ${metricSql} AS value
      FROM ${tableSql}
      WHERE ${xAxis} IS NOT NULL
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 10
    `;
  }
  if (!widget.yAxis) return null;
  return `
    SELECT ${xAxis} AS label, ${widget.aggregation}(${yAxis}) AS value
    FROM ${tableSql}
    WHERE ${xAxis} IS NOT NULL AND ${yAxis} IS NOT NULL
    GROUP BY 1
    ORDER BY ${widget.type === "line" ? "1 ASC" : "2 DESC"}
    LIMIT 24
  `;
}

function buildChartOption(widget: WidgetConfig, rows: Record<string, unknown>[], dark: boolean): Record<string, unknown> {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const axisLine = dark ? "#334155" : "#cbd5e1";
  const tooltip = {
    backgroundColor: dark ? "#020617ee" : "#ffffffee",
    borderColor: dark ? "#1e293b" : "#e2e8f0",
    textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
  };

  if (widget.type === "pie") {
    return {
      color: [widget.color, "#818cf8", "#22c55e", "#f59e0b", "#f97316", "#ef4444"],
      tooltip: { ...tooltip, trigger: "item" },
      legend: { bottom: 0, textStyle: { color: textColor, fontSize: 11 } },
      series: [
        {
          type: "pie",
          radius: ["42%", "72%"],
          center: ["50%", "42%"],
          data: rows.map((row) => ({
            name: String(row.label ?? ""),
            value: Number(row.value ?? 0),
          })),
          itemStyle: {
            borderWidth: 2,
            borderColor: dark ? "#020617" : "#ffffff",
            borderRadius: 8,
          },
        },
      ],
    };
  }

  if (widget.type === "scatter") {
    return {
      color: [widget.color],
      tooltip: { ...tooltip, trigger: "item" },
      grid: { left: 40, right: 18, top: 24, bottom: 36, containLabel: true },
      xAxis: {
        type: "value",
        name: widget.xAxis,
        nameTextStyle: { color: textColor },
        axisLabel: { color: textColor },
        splitLine: { lineStyle: { color: axisLine, type: "dashed" } },
      },
      yAxis: {
        type: "value",
        name: widget.yAxis,
        nameTextStyle: { color: textColor },
        axisLabel: { color: textColor },
        splitLine: { lineStyle: { color: axisLine, type: "dashed" } },
      },
      series: [
        {
          type: "scatter",
          data: rows.map((row) => [Number(row.x_value ?? 0), Number(row.y_value ?? 0)]),
          symbolSize: 9,
          itemStyle: { opacity: 0.75 },
        },
      ],
    };
  }

  const labels = rows.map((row) => String(row.label ?? ""));
  const values = rows.map((row) => Number(row.value ?? 0));
  return {
    color: [widget.color],
    tooltip: { ...tooltip, trigger: "axis" },
    grid: { left: 40, right: 18, top: 24, bottom: 46, containLabel: true },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { color: textColor, rotate: labels.length > 8 ? 24 : 0, fontSize: 11 },
      axisLine: { lineStyle: { color: axisLine } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor, fontSize: 11 },
      splitLine: { lineStyle: { color: axisLine, type: "dashed" } },
    },
    series: [
      {
        type: widget.type,
        data: values,
        smooth: widget.type === "line",
        areaStyle: widget.type === "line" ? undefined : undefined,
        itemStyle: { borderRadius: widget.type === "bar" ? [8, 8, 0, 0] : 0 },
        lineStyle: widget.type === "line" ? { width: 3 } : undefined,
      },
    ],
  };
}

function exportHtml(tableName: string, widgets: WidgetConfig[], runtimes: Record<string, WidgetRuntime>) {
  const payload = widgets.map((widget) => ({
    ...widget,
    runtime: runtimes[widget.id],
  }));
  const safeJson = JSON.stringify(payload).replaceAll("</script>", "<\\/script>");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${tableName} dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/echarts@6/dist/echarts.min.js"></script>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: linear-gradient(135deg, #020617, #0f172a 50%, #082f49); color: #e2e8f0; }
    .shell { padding: 32px; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    .card { border: 1px solid rgba(255,255,255,.08); background: rgba(15,23,42,.68); border-radius: 24px; padding: 18px; backdrop-filter: blur(22px); }
    .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: .18em; color: #7dd3fc; }
    .title { font-size: 18px; font-weight: 700; margin: 8px 0 0; }
    .subtle { color: #94a3b8; font-size: 13px; }
    .chart { height: 240px; margin-top: 14px; }
    .kpi { font-size: 42px; font-weight: 800; margin: 20px 0 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 14px; }
    th, td { padding: 10px; border-bottom: 1px solid rgba(255,255,255,.07); text-align: left; font-size: 13px; }
    .text-widget { white-space: pre-wrap; line-height: 1.6; margin-top: 14px; color: #cbd5e1; }
  </style>
</head>
<body>
  <div class="shell">
    <div class="card" style="margin-bottom: 16px;">
      <div class="eyebrow">Saved dashboard</div>
      <div class="title">${tableName}</div>
      <p class="subtle">${widgets.length} widget${widgets.length === 1 ? "" : "s"} exported as standalone HTML.</p>
    </div>
    <div class="grid" id="grid"></div>
  </div>
  <script>
    function escapeHtml(str) {
      return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
    function sanitizeChartId(str) {
      return String(str).replace(/[^A-Za-z0-9_-]/g, "");
    }
    function chartDomId(str, index) {
      const safeId = sanitizeChartId(str);
      return "chart-" + (safeId ? safeId + "-" + index : "widget-" + index);
    }
    const widgets = ${safeJson};
    const grid = document.getElementById("grid");
    const dark = true;
    const textColor = "#cbd5e1";
    const axisLine = "#334155";
    const tooltip = { backgroundColor: "#020617ee", borderColor: "#1e293b", textStyle: { color: "#e2e8f0" } };
    function chartOption(widget, rows) {
      if (widget.type === "pie") {
        return { color: [widget.color, "#818cf8", "#22c55e", "#f59e0b", "#f97316", "#ef4444"], tooltip: Object.assign({}, tooltip, { trigger: "item" }), legend: { bottom: 0, textStyle: { color: textColor, fontSize: 11 } }, series: [{ type: "pie", radius: ["42%", "72%"], center: ["50%", "42%"], data: rows.map((row) => ({ name: String(row.label ?? ""), value: Number(row.value ?? 0) })) }] };
      }
      if (widget.type === "scatter") {
        return { color: [widget.color], tooltip: Object.assign({}, tooltip, { trigger: "item" }), grid: { left: 40, right: 18, top: 24, bottom: 36, containLabel: true }, xAxis: { type: "value", name: widget.xAxis, nameTextStyle: { color: textColor }, axisLabel: { color: textColor }, splitLine: { lineStyle: { color: axisLine, type: "dashed" } } }, yAxis: { type: "value", name: widget.yAxis, nameTextStyle: { color: textColor }, axisLabel: { color: textColor }, splitLine: { lineStyle: { color: axisLine, type: "dashed" } } }, series: [{ type: "scatter", data: rows.map((row) => [Number(row.x_value ?? 0), Number(row.y_value ?? 0)]), symbolSize: 9 }] };
      }
      const labels = rows.map((row) => String(row.label ?? ""));
      return { color: [widget.color], tooltip: Object.assign({}, tooltip, { trigger: "axis" }), grid: { left: 40, right: 18, top: 24, bottom: 46, containLabel: true }, xAxis: { type: "category", data: labels, axisLabel: { color: textColor, rotate: labels.length > 8 ? 24 : 0, fontSize: 11 }, axisLine: { lineStyle: { color: axisLine } } }, yAxis: { type: "value", axisLabel: { color: textColor }, splitLine: { lineStyle: { color: axisLine, type: "dashed" } } }, series: [{ type: widget.type, data: rows.map((row) => Number(row.value ?? 0)), smooth: widget.type === "line" }] };
    }
    widgets.forEach((widget, index) => {
      const card = document.createElement("article");
      card.className = "card";
      card.innerHTML = '<div class="eyebrow">' + escapeHtml(widget.type) + '</div><div class="title">' + escapeHtml(widget.title) + '</div>';
      if (widget.type === "kpi") {
        card.innerHTML += '<div class="kpi">' + escapeHtml(widget.runtime?.value ?? "—") + '</div><div class="subtle">' + escapeHtml(widget.aggregation.toUpperCase()) + ' of ' + escapeHtml(widget.yAxis || "rows") + '</div>';
      } else if (widget.type === "table") {
        const rows = widget.runtime?.rows ?? [];
        const headers = widget.tableColumns.map((name) => '<th>' + escapeHtml(name) + '</th>').join('');
        const body = rows.map((row) => '<tr>' + widget.tableColumns.map((name) => '<td>' + escapeHtml(String(row[name] ?? "null")) + '</td>').join('') + '</tr>').join('');
        card.innerHTML += '<table><thead><tr>' + headers + '</tr></thead><tbody>' + body + '</tbody></table>';
      } else if (widget.type === "text") {
        card.innerHTML += '<div class="text-widget">' + escapeHtml(widget.text).replaceAll('\\n', '<br />') + '</div>';
      } else {
        const chart = document.createElement("div");
        chart.className = "chart";
        chart.id = chartDomId(widget.id, index);
        card.appendChild(chart);
      }
      grid.appendChild(card);
    });
    widgets.forEach((widget, index) => {
      if (["bar", "line", "pie", "scatter"].includes(widget.type)) {
        const chartNode = document.getElementById(chartDomId(widget.id, index));
        if (chartNode) {
          const chart = echarts.init(chartNode);
          chart.setOption(chartOption(widget, widget.runtime?.rows ?? []));
        }
      }
    });
  </script>
</body>
</html>`;
}

function WidgetCard({
  widget,
  runtime,
  dark,
  onConfigure,
  onRemove,
}: {
  widget: WidgetConfig;
  runtime: WidgetRuntime | undefined;
  dark: boolean;
  onConfigure: () => void;
  onRemove: () => void;
}) {
  const chartWidget = widget.type === "bar" || widget.type === "line" || widget.type === "pie" || widget.type === "scatter";
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2, ease: EASE }}
      className={`rounded-3xl border border-white/10 bg-white/10 p-4 shadow-xl shadow-slate-950/10 backdrop-blur-xl dark:bg-slate-950/40 ${widget.type === "table" ? "xl:col-span-2" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-2xl border border-white/10 bg-black/10 p-2 text-slate-500 dark:text-slate-300">
            <GripVertical className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-950 dark:text-slate-50">{widget.title}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{widget.type}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onConfigure} className="rounded-2xl border border-white/10 bg-white/10 p-2 text-slate-600 transition hover:bg-white/15 dark:text-slate-300">
            <PencilLine className="h-4 w-4" />
          </button>
          <button type="button" onClick={onRemove} className="rounded-2xl border border-red-400/20 bg-red-500/10 p-2 text-red-700 transition hover:bg-red-500/15 dark:text-red-300">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-4">
        {runtime?.loading ? (
          <div className="flex h-56 items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-cyan-500" />
            Loading preview...
          </div>
        ) : runtime?.error ? (
          <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-6 text-sm text-red-700 dark:text-red-300">{runtime.error}</div>
        ) : widget.type === "kpi" ? (
          <div className="rounded-2xl border border-white/10 bg-black/10 px-5 py-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {widget.aggregation.toUpperCase()} • {widget.yAxis || "rows"}
            </p>
            <p className="mt-4 text-4xl font-semibold text-slate-950 dark:text-slate-50">
              {typeof runtime?.value === "number" ? formatNumber(runtime.value) : runtime?.value ?? "—"}
            </p>
          </div>
        ) : widget.type === "table" ? (
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <div className="max-h-64 overflow-auto">
              <table className="min-w-full divide-y divide-white/10 text-sm">
                <thead className="bg-black/10">
                  <tr>
                    {widget.tableColumns.map((column) => (
                      <th key={column} className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-200">{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10 bg-white/5">
                  {(runtime?.rows ?? []).map((row, index) => (
                    <tr key={`${widget.id}-${index}`}>
                      {widget.tableColumns.map((column) => (
                        <td key={column} className="px-4 py-3 text-slate-600 dark:text-slate-300">{String(row[column] ?? "null")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : widget.type === "text" ? (
          <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-5 text-sm leading-7 text-slate-700 dark:text-slate-300">{widget.text}</div>
        ) : chartWidget ? (
          <div className="rounded-2xl border border-white/10 bg-black/10 p-2">
            <ReactECharts option={buildChartOption(widget, runtime?.rows ?? [], dark)} style={{ height: 260 }} notMerge lazyUpdate />
          </div>
        ) : null}
      </div>
    </motion.article>
  );
}

function DashboardBuilder({ tableName, columns, rowCount }: DashboardBuilderProps) {
  const [widgets, setWidgets] = useState<WidgetConfig[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeWidgetId, setActiveWidgetId] = useState<string | null>(null);
  const [runtimeById, setRuntimeById] = useState<Record<string, WidgetRuntime>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const deferredWidgets = useDeferredValue(widgets);
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const activeWidget = useMemo(
    () => widgets.find((widget) => widget.id === activeWidgetId) ?? null,
    [activeWidgetId, widgets],
  );

  useEffect(() => {
    if (!deferredWidgets.length) return;
    let cancelled = false;

    async function loadPreviews() {
      startTransition(() => {
        setRuntimeById((current) =>
          Object.fromEntries(
            deferredWidgets.map((widget) => [
              widget.id,
              { loading: true, error: null, rows: current[widget.id]?.rows ?? [], value: current[widget.id]?.value },
            ]),
          ),
        );
      });
      const entries = await Promise.all(
        deferredWidgets.map(async (widget) => {
          try {
            const sql = widgetQuery(tableName, widget);
            if (!sql) {
              return [widget.id, { loading: false, error: null, rows: [], value: widget.type === "text" ? widget.text : undefined }] as const;
            }
            const rows = await runQuery(sql);
            if (widget.type === "kpi") {
              return [widget.id, { loading: false, error: null, rows, value: Number(rows[0]?.value ?? 0) }] as const;
            }
            return [widget.id, { loading: false, error: null, rows }] as const;
          } catch (error) {
            return [
              widget.id,
              {
                loading: false,
                error: error instanceof Error ? error.message : "Widget preview failed.",
                rows: [],
              },
            ] as const;
          }
        }),
      );

      if (!cancelled) {
        startTransition(() => setRuntimeById(Object.fromEntries(entries)));
      }
    }

    void loadPreviews();
    return () => {
      cancelled = true;
    };
  }, [deferredWidgets, tableName]);

  function addWidget(type: WidgetType) {
    const nextWidget = buildDefaultWidget(type, columns);
    startTransition(() => {
      setWidgets((current) => [nextWidget, ...current]);
      setActiveWidgetId(nextWidget.id);
      setPanelOpen(true);
    });
  }

  function updateWidget(id: string, patch: Partial<WidgetConfig>) {
    setWidgets((current) => current.map((widget) => (widget.id === id ? { ...widget, ...patch } : widget)));
  }

  function removeWidget(id: string) {
    startTransition(() => {
      setWidgets((current) => current.filter((widget) => widget.id !== id));
      if (activeWidgetId === id) setActiveWidgetId(null);
    });
  }

  function handleSave() {
    try {
      localStorage.setItem(tableStorageKey(tableName), JSON.stringify({ savedAt: Date.now(), widgets }));
      setNotice({ tone: "success", message: `Saved ${widgets.length} widgets for ${tableName}.` });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Failed to save the dashboard." });
    }
  }

  function handleLoad() {
    try {
      const raw = localStorage.getItem(tableStorageKey(tableName));
      if (!raw) {
        setNotice({ tone: "info", message: `No saved dashboard exists for ${tableName}.` });
        return;
      }
      const parsed = JSON.parse(raw) as { widgets?: WidgetConfig[] };
      const nextWidgets = Array.isArray(parsed.widgets) ? parsed.widgets : [];
      setWidgets(nextWidgets);
      setActiveWidgetId(nextWidgets[0]?.id ?? null);
      setPanelOpen(Boolean(nextWidgets.length));
      setNotice({ tone: "success", message: `Loaded ${nextWidgets.length} saved widgets.` });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Failed to load the dashboard." });
    }
  }

  function handleExport() {
    try {
      const html = exportHtml(tableName, widgets, runtimeById);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${tableName}-dashboard.html`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice({ tone: "success", message: "Exported the dashboard as standalone HTML." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Failed to export the dashboard." });
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      className="overflow-hidden rounded-3xl border border-white/10 bg-white/10 shadow-2xl shadow-slate-950/10 backdrop-blur-xl dark:bg-slate-950/45"
    >
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
              <LayoutDashboard className="h-3.5 w-3.5" />
              Dashboard Builder
            </div>
            <h2 className="mt-3 text-xl font-semibold text-slate-950 dark:text-slate-50">Build a custom dashboard for {tableName}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Add widgets, configure columns and aggregations, and save the resulting layout to localStorage. This view uses live DuckDB
              previews for every chart, KPI, and mini table.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setPanelOpen((current) => !current)} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500">
              <Plus className="h-4 w-4" />
              Add Widget
            </button>
            <button type="button" onClick={handleSave} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white/15 dark:text-slate-200">
              <Save className="h-4 w-4" />
              Save Dashboard
            </button>
            <button type="button" onClick={handleLoad} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white/15 dark:text-slate-200">
              <LayoutDashboard className="h-4 w-4" />
              Load Dashboard
            </button>
            <button type="button" onClick={handleExport} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white/15 dark:text-slate-200">
              <FileDown className="h-4 w-4" />
              Export Dashboard
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {[
            { label: "Dataset rows", value: formatNumber(rowCount) },
            { label: "Available columns", value: formatNumber(columns.length) },
            { label: "Widgets", value: formatNumber(widgets.length) },
          ].map((card) => (
            <div key={card.label} className="rounded-2xl border border-white/10 bg-white/10 p-4 dark:bg-slate-950/35">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{card.label}</p>
              <p className="mt-3 text-2xl font-semibold text-slate-950 dark:text-slate-50">{card.value}</p>
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {notice ? (
            <motion.div
              key={notice.message}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
                notice.tone === "success"
                  ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : notice.tone === "error"
                    ? "border-red-400/25 bg-red-500/10 text-red-700 dark:text-red-300"
                    : "border-sky-400/25 bg-sky-500/10 text-sky-700 dark:text-sky-300"
              }`}
            >
              {notice.message}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="grid gap-6 p-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <AnimatePresence>
            {panelOpen ? (
              <motion.div
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2, ease: EASE }}
                className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35"
              >
                <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">Add widget</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {WIDGET_TYPES.map((item) => (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => addWidget(item.type)}
                      className="rounded-2xl border border-white/10 bg-black/10 p-4 text-left transition hover:border-cyan-400/30 hover:bg-cyan-500/10"
                    >
                      <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                        <item.icon className="h-4 w-4 text-cyan-500" />
                        {item.label}
                      </p>
                      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{item.description}</p>
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
            <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">Widget configuration</p>
            {activeWidget ? (
              <div className="mt-4 space-y-4">
                <label className="block text-sm text-slate-600 dark:text-slate-300">
                  <span className="mb-2 block font-medium text-slate-800 dark:text-slate-100">Title</span>
                  <input
                    value={activeWidget.title}
                    onChange={(event) => updateWidget(activeWidget.id, { title: event.target.value })}
                    className="w-full rounded-2xl border border-white/10 bg-black/10 px-3 py-2.5 text-slate-900 outline-none transition focus:border-cyan-400 dark:text-slate-100"
                  />
                </label>

                {activeWidget.type !== "text" && activeWidget.type !== "table" ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-sm text-slate-600 dark:text-slate-300">
                      <span className="mb-2 block font-medium text-slate-800 dark:text-slate-100">X axis</span>
                      <select value={activeWidget.xAxis} onChange={(event) => updateWidget(activeWidget.id, { xAxis: event.target.value })} className="w-full rounded-2xl border border-white/10 bg-black/10 px-3 py-2.5 text-slate-900 outline-none transition focus:border-cyan-400 dark:text-slate-100">
                        {columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
                      </select>
                    </label>
                    <label className="text-sm text-slate-600 dark:text-slate-300">
                      <span className="mb-2 block font-medium text-slate-800 dark:text-slate-100">Y axis / metric</span>
                      <select value={activeWidget.yAxis} onChange={(event) => updateWidget(activeWidget.id, { yAxis: event.target.value })} className="w-full rounded-2xl border border-white/10 bg-black/10 px-3 py-2.5 text-slate-900 outline-none transition focus:border-cyan-400 dark:text-slate-100">
                        {columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
                      </select>
                    </label>
                  </div>
                ) : null}

                {activeWidget.type !== "text" && activeWidget.type !== "table" ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-sm text-slate-600 dark:text-slate-300">
                      <span className="mb-2 block font-medium text-slate-800 dark:text-slate-100">Aggregation</span>
                      <select value={activeWidget.aggregation} onChange={(event) => updateWidget(activeWidget.id, { aggregation: event.target.value as Aggregation })} className="w-full rounded-2xl border border-white/10 bg-black/10 px-3 py-2.5 text-slate-900 outline-none transition focus:border-cyan-400 dark:text-slate-100">
                        {(["sum", "avg", "count", "min", "max"] as const).map((aggregation) => <option key={aggregation} value={aggregation}>{aggregation.toUpperCase()}</option>)}
                      </select>
                    </label>
                    <label className="text-sm text-slate-600 dark:text-slate-300">
                      <span className="mb-2 block font-medium text-slate-800 dark:text-slate-100">Color</span>
                      <div className="flex flex-wrap gap-2">
                        {COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => updateWidget(activeWidget.id, { color })}
                            className={`h-9 w-9 rounded-full border ${activeWidget.color === color ? "border-white/70" : "border-white/10"}`}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </label>
                  </div>
                ) : null}

                {activeWidget.type === "table" ? (
                  <div>
                    <p className="mb-3 text-sm font-medium text-slate-800 dark:text-slate-100">Displayed columns</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {columns.map((column) => {
                        const active = activeWidget.tableColumns.includes(column.name);
                        return (
                          <button
                            key={column.name}
                            type="button"
                            onClick={() =>
                              updateWidget(activeWidget.id, {
                                tableColumns: active
                                  ? activeWidget.tableColumns.filter((name) => name !== column.name)
                                  : [...activeWidget.tableColumns, column.name],
                              })
                            }
                            className={`rounded-2xl border px-3 py-2 text-left text-sm transition ${active ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" : "border-white/10 bg-black/10 text-slate-700 dark:text-slate-300"}`}
                          >
                            {column.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {activeWidget.type === "text" ? (
                  <label className="block text-sm text-slate-600 dark:text-slate-300">
                    <span className="mb-2 block font-medium text-slate-800 dark:text-slate-100">Text content</span>
                    <textarea
                      value={activeWidget.text}
                      onChange={(event) => updateWidget(activeWidget.id, { text: event.target.value })}
                      rows={6}
                      className="w-full rounded-2xl border border-white/10 bg-black/10 px-3 py-3 text-slate-900 outline-none transition focus:border-cyan-400 dark:text-slate-100"
                    />
                  </label>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-8 text-sm text-slate-500 dark:text-slate-400">
                Select a widget to edit its layout, metrics, and title.
              </div>
            )}
          </div>
        </div>

        <div>
          {widgets.length ? (
            <AnimatePresence>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {widgets.map((widget) => (
                  <WidgetCard
                    key={widget.id}
                    widget={widget}
                    runtime={runtimeById[widget.id]}
                    dark={dark}
                    onConfigure={() => {
                      setActiveWidgetId(widget.id);
                      setPanelOpen(true);
                    }}
                    onRemove={() => removeWidget(widget.id)}
                  />
                ))}
              </div>
            </AnimatePresence>
          ) : (
            <div className="rounded-3xl border border-dashed border-white/10 px-6 py-16 text-center text-sm text-slate-500 dark:text-slate-400">
              Add a widget to start building a responsive dashboard layout.
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}

export default memo(DashboardBuilder);
