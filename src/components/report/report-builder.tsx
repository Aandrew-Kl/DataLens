"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Download,
  Eye,
  FileText,
  Hash,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";

import { runQuery } from "@/lib/duckdb/client";
import { generateReportHTML } from "@/lib/utils/report-export";
import type { ChartConfig } from "@/types/chart";
import type { DatasetMeta, ColumnProfile } from "@/types/dataset";
import type { ReportConfig, ReportWidget } from "@/types/report";

interface ReportBuilderProps {
  dataset: DatasetMeta;
  columns: ColumnProfile[];
}

type ChartTypeValue = ChartConfig["type"];
type ChartAggregation = NonNullable<ChartConfig["aggregation"]>;
type MetricFormat = "number" | "compact" | "currency" | "percent";

const CHART_TYPES: { value: ChartTypeValue; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "pie", label: "Pie" },
  { value: "scatter", label: "Scatter" },
  { value: "histogram", label: "Histogram" },
  { value: "heatmap", label: "Heatmap" },
];

const AGGREGATIONS: ChartAggregation[] = ["sum", "avg", "count", "min", "max"];

const METRIC_FORMATS: { value: MetricFormat; label: string }[] = [
  { value: "number", label: "Number" },
  { value: "compact", label: "Compact" },
  { value: "currency", label: "Currency" },
  { value: "percent", label: "Percent" },
];

function sanitizeTableName(filename: string): string {
  return (
    filename
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50) || "data"
  );
}

function createWidgetId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
function toNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatMetricValue(value: unknown, format?: string): string {
  const numeric = toNumeric(value);

  if (numeric === null) return String(value ?? "—");

  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(numeric);
    case "percent":
      return new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 2,
      }).format(numeric);
    case "compact":
      return new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(numeric);
    default:
      return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
      }).format(numeric);
  }
}

function slugifyFilename(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "report"
  );
}

function getDefaultChartFields(columns: ColumnProfile[]): {
  xAxis: string;
  yAxis: string;
} {
  const categorical =
    columns.find((column) => column.type === "string" || column.type === "date") ??
    columns[0];
  const numeric = columns.find((column) => column.type === "number") ?? columns[0];

  return {
    xAxis: categorical?.name ?? "",
    yAxis: numeric?.name ?? "",
  };
}

function buildChartSQL(
  tableName: string,
  chartType: ChartTypeValue,
  xAxis: string,
  yAxis: string,
  aggregation: ChartAggregation,
): string {
  const table = quoteIdentifier(tableName);
  const safeX = quoteIdentifier(xAxis);
  const safeY = quoteIdentifier(yAxis);

  switch (chartType) {
    case "scatter":
      return `SELECT ${safeX} AS ${safeX}, ${safeY} AS ${safeY} FROM ${table} WHERE ${safeX} IS NOT NULL AND ${safeY} IS NOT NULL LIMIT 150`;
    case "heatmap":
      return `SELECT ${safeX} AS ${safeX}, ${safeY} AS ${safeY}, COUNT(*) AS value FROM ${table} WHERE ${safeX} IS NOT NULL AND ${safeY} IS NOT NULL GROUP BY 1, 2 ORDER BY value DESC LIMIT 60`;
    case "histogram":
      return `SELECT ROUND(CAST(${safeY} AS DOUBLE), 0) AS ${safeX}, COUNT(*) AS ${safeY} FROM ${table} WHERE ${safeY} IS NOT NULL GROUP BY 1 ORDER BY 1 LIMIT 30`;
    default:
      return `SELECT ${safeX} AS ${safeX}, ${aggregation}(${safeY}) AS ${safeY} FROM ${table} WHERE ${safeX} IS NOT NULL AND ${safeY} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 24`;
  }
}

function buildMetricSQL(
  tableName: string,
  columnName: string,
  aggregation: ChartAggregation,
): string {
  const table = quoteIdentifier(tableName);
  const safeColumn = quoteIdentifier(columnName);

  if (aggregation === "count") {
    return `SELECT COUNT(${safeColumn}) AS value FROM ${table}`;
  }

  return `SELECT ${aggregation}(${safeColumn}) AS value FROM ${table} WHERE ${safeColumn} IS NOT NULL`;
}

function getMetricResult(
  rows: Record<string, unknown>[],
  format?: string,
): { value: string; error: string | null } {
  const firstRow = rows[0];

  if (firstRow && typeof firstRow.__error === "string") {
    return { value: "Unavailable", error: String(firstRow.__error) };
  }

  if (!firstRow) {
    return { value: "—", error: null };
  }

  const firstValue = Object.values(firstRow)[0];
  return { value: formatMetricValue(firstValue, format), error: null };
}

function renderRowValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function PreviewChart({
  title,
  xAxis,
  yAxis,
  rows,
}: {
  title: string;
  xAxis: string;
  yAxis: string;
  rows: Record<string, unknown>[];
}) {
  const hasError = rows[0] && typeof rows[0].__error === "string";

  if (hasError) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
        {String(rows[0].__error)}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
        No preview data yet.
      </div>
    );
  }

  const headers = Object.keys(rows[0]);
  const numericValues = rows
    .map((row) => toNumeric(row[yAxis]))
    .filter((value): value is number => value !== null);
  const maxValue =
    numericValues.length > 0
      ? Math.max(...numericValues.map((value) => Math.abs(value)), 1)
      : 1;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/40">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <h4 className="text-sm font-semibold text-white">{title}</h4>
          <p className="text-xs text-slate-400">
            {xAxis} x {yAxis}
          </p>
        </div>
        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-cyan-200">
          Table chart
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-[0.16em] text-slate-400">
            <tr>
              {headers.map((header) => (
                <th key={header} className="px-4 py-3 font-medium">
                  {header}
                </th>
              ))}
              <th className="px-4 py-3 font-medium">Visual</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.slice(0, 10).map((row, index) => {
              const numeric = toNumeric(row[yAxis]);
              const width =
                numeric === null ? 0 : Math.max((Math.abs(numeric) / maxValue) * 100, 2);

              return (
                <tr key={`${title}-${index}`} className="text-slate-200">
                  {headers.map((header) => (
                    <td key={header} className="px-4 py-3 align-top text-sm">
                      {renderRowValue(row[header])}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <div className="flex min-w-44 items-center gap-3">
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                      <span className="min-w-16 text-right text-xs text-slate-400">
                        {numeric === null ? "—" : numeric.toLocaleString()}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ReportBuilder({ dataset, columns }: ReportBuilderProps) {
  const defaultFields = useMemo(() => getDefaultChartFields(columns), [columns]);
  const tableName = useMemo(
    () => sanitizeTableName(dataset.fileName),
    [dataset.fileName],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );

  const [createdAt, setCreatedAt] = useState(() => Date.now());
  const [title, setTitle] = useState(`${dataset.name} Report`);
  const [description, setDescription] = useState(
    `A curated summary of ${dataset.fileName} with KPIs, chart widgets, and written analysis.`,
  );
  const [widgets, setWidgets] = useState<ReportWidget[]>([]);
  const [chartTitle, setChartTitle] = useState("Revenue by category");
  const [chartType, setChartType] = useState<ChartTypeValue>("bar");
  const [chartXAxis, setChartXAxis] = useState(defaultFields.xAxis);
  const [chartYAxis, setChartYAxis] = useState(defaultFields.yAxis);
  const [chartAggregation, setChartAggregation] = useState<ChartAggregation>("sum");
  const [textContent, setTextContent] = useState(
    "Add narrative context here. Summaries, recommendations, or caveats work well in this section.",
  );
  const [metricLabel, setMetricLabel] = useState("Total value");
  const [metricColumn, setMetricColumn] = useState(defaultFields.yAxis);
  const [metricAggregation, setMetricAggregation] =
    useState<ChartAggregation>("sum");
  const [metricFormat, setMetricFormat] = useState<MetricFormat>("number");
  const [previewData, setPreviewData] = useState<
    Record<string, Record<string, unknown>[]>
  >({});
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCreatedAt(Date.now());
    setTitle(`${dataset.name} Report`);
    setDescription(
      `A curated summary of ${dataset.fileName} with KPIs, chart widgets, and written analysis.`,
    );
    setWidgets([]);
    setPreviewData({});
    setChartTitle("Revenue by category");
    setChartType("bar");
    setChartXAxis(defaultFields.xAxis);
    setChartYAxis(defaultFields.yAxis);
    setChartAggregation("sum");
    setTextContent(
      "Add narrative context here. Summaries, recommendations, or caveats work well in this section.",
    );
    setMetricLabel("Total value");
    setMetricColumn(defaultFields.yAxis);
    setMetricAggregation("sum");
    setMetricFormat("number");
    setMessage(null);
    setError(null);
  }, [dataset.fileName, dataset.name, defaultFields.xAxis, defaultFields.yAxis]);

  const reportConfig: ReportConfig = {
    title: title.trim() || `${dataset.name} Report`,
    description: description.trim(),
    widgets,
    createdAt,
  };

  async function collectQueryResults(
    currentWidgets: ReportWidget[],
  ): Promise<Record<string, Record<string, unknown>[]>> {
    const resultMap: Record<string, Record<string, unknown>[]> = {};

    await Promise.all(
      currentWidgets
        .filter((widget) => widget.type !== "text")
        .map(async (widget) => {
          try {
            resultMap[widget.id] = await runQuery(widget.sql);
          } catch (queryError) {
            resultMap[widget.id] = [
              {
                __error:
                  queryError instanceof Error
                    ? queryError.message
                    : "Query execution failed.",
              },
            ];
          }
        }),
    );

    return resultMap;
  }

  function moveWidget(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= widgets.length) return;

    setWidgets((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  function addChartWidget() {
    if (!chartTitle.trim() || !chartXAxis || !chartYAxis) {
      setError("Chart widgets need a title plus valid x and y columns.");
      return;
    }

    const widget: ReportWidget = {
      id: createWidgetId("chart"),
      type: "chart",
      chartType,
      title: chartTitle.trim(),
      sql: buildChartSQL(
        tableName,
        chartType,
        chartXAxis,
        chartYAxis,
        chartAggregation,
      ),
      xAxis: chartXAxis,
      yAxis: chartYAxis,
      aggregation: chartAggregation,
    };

    setWidgets((current) => [...current, widget]);
    setChartTitle(`${chartYAxis} by ${chartXAxis}`);
    setMessage("Chart widget added.");
    setError(null);
  }

  function addTextWidget() {
    if (!textContent.trim()) {
      setError("Text widgets need content.");
      return;
    }

    setWidgets((current) => [
      ...current,
      {
        id: createWidgetId("text"),
        type: "text",
        content: textContent.trim(),
      },
    ]);
    setTextContent("");
    setMessage("Text block added.");
    setError(null);
  }

  function addMetricWidget() {
    if (!metricLabel.trim() || !metricColumn) {
      setError("KPI widgets need a label and numeric column.");
      return;
    }

    setWidgets((current) => [
      ...current,
      {
        id: createWidgetId("metric"),
        type: "metric",
        label: metricLabel.trim(),
        sql: buildMetricSQL(tableName, metricColumn, metricAggregation),
        format: metricFormat === "number" ? undefined : metricFormat,
      },
    ]);
    setMetricLabel(`${metricAggregation.toUpperCase()} ${metricColumn}`);
    setMessage("KPI card added.");
    setError(null);
  }

  async function handlePreview() {
    if (widgets.length === 0) {
      setError("Add at least one widget before previewing the report.");
      return;
    }

    setPreviewing(true);
    setMessage(null);
    setError(null);

    try {
      const nextData = await collectQueryResults(widgets);
      setPreviewData(nextData);
      setMessage("Preview refreshed from DuckDB.");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleExport() {
    if (widgets.length === 0) {
      setError("Add at least one widget before exporting.");
      return;
    }

    setExporting(true);
    setMessage(null);
    setError(null);

    try {
      const nextData = await collectQueryResults(widgets);
      setPreviewData(nextData);

      const html = generateReportHTML(reportConfig, nextData);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slugifyFilename(reportConfig.title)}.html`;
      anchor.click();

      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 500);

      setMessage("Standalone HTML report exported.");
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Export failed unexpectedly.",
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="space-y-6"
    >
      <div className="glass overflow-hidden rounded-[28px] border border-white/10 shadow-2xl shadow-cyan-950/20">
        <div className="border-b border-white/10 bg-gradient-to-r from-slate-950 via-slate-900 to-cyan-950/80 px-6 py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-cyan-200">
                <Sparkles className="h-3.5 w-3.5" />
                Report Builder
              </div>
              <div>
                <h2 className="text-3xl font-semibold tracking-[-0.04em] text-white">
                  Build a polished dataset report
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-slate-300">
                  Compose narrative blocks, KPI cards, and chart widgets, then export
                  the whole report as standalone HTML.
                </p>
              </div>
            </div>

            <div className="grid gap-3 text-sm text-slate-200 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Dataset
                </p>
                <p className="mt-1 font-medium text-white">{dataset.fileName}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  Rows
                </p>
                <p className="mt-1 font-medium text-white">
                  {dataset.rowCount.toLocaleString()}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  DuckDB table
                </p>
                <p className="mt-1 font-medium text-white">{tableName}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 bg-slate-950/60 p-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="glass rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="mb-4 flex items-center gap-3">
                <FileText className="h-5 w-5 text-cyan-300" />
                <h3 className="text-lg font-semibold text-white">Report metadata</h3>
              </div>

              <div className="space-y-4">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-200">Title</span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/40"
                    placeholder="Quarterly performance review"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-200">
                    Description
                  </span>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={4}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/40"
                    placeholder="Summarize the scope and intent of the report."
                  />
                </label>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="glass rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="mb-4 flex items-center gap-3">
                  <BarChart3 className="h-5 w-5 text-cyan-300" />
                  <h3 className="text-lg font-semibold text-white">Chart widget</h3>
                </div>

                <div className="space-y-3">
                  <input
                    value={chartTitle}
                    onChange={(event) => setChartTitle(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/40"
                    placeholder="Widget title"
                  />

                  <select
                    value={chartType}
                    onChange={(event) =>
                      setChartType(event.target.value as ChartTypeValue)
                    }
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/40"
                  >
                    {CHART_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={chartXAxis}
                    onChange={(event) => setChartXAxis(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/40"
                  >
                    {columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        X: {column.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={chartYAxis}
                    onChange={(event) => setChartYAxis(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/40"
                  >
                    {numericColumns.length > 0 ? (
                      numericColumns.map((column) => (
                        <option key={column.name} value={column.name}>
                          Y: {column.name}
                        </option>
                      ))
                    ) : (
                      columns.map((column) => (
                        <option key={column.name} value={column.name}>
                          Y: {column.name}
                        </option>
                      ))
                    )}
                  </select>

                  <select
                    value={chartAggregation}
                    onChange={(event) =>
                      setChartAggregation(event.target.value as ChartAggregation)
                    }
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/40"
                  >
                    {AGGREGATIONS.map((option) => (
                      <option key={option} value={option}>
                        {option.toUpperCase()}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={addChartWidget}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                  >
                    <Plus className="h-4 w-4" />
                    Add chart
                  </button>
                </div>
              </div>

              <div className="glass rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="mb-4 flex items-center gap-3">
                  <FileText className="h-5 w-5 text-amber-300" />
                  <h3 className="text-lg font-semibold text-white">Text block</h3>
                </div>

                <div className="space-y-3">
                  <textarea
                    value={textContent}
                    onChange={(event) => setTextContent(event.target.value)}
                    rows={8}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-400/40"
                    placeholder="Add commentary, methodology, or recommendations."
                  />

                  <button
                    onClick={addTextWidget}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-200"
                  >
                    <Plus className="h-4 w-4" />
                    Add text
                  </button>
                </div>
              </div>

              <div className="glass rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="mb-4 flex items-center gap-3">
                  <Hash className="h-5 w-5 text-emerald-300" />
                  <h3 className="text-lg font-semibold text-white">KPI card</h3>
                </div>

                <div className="space-y-3">
                  <input
                    value={metricLabel}
                    onChange={(event) => setMetricLabel(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/40"
                    placeholder="Metric label"
                  />

                  <select
                    value={metricColumn}
                    onChange={(event) => setMetricColumn(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/40"
                  >
                    {numericColumns.length > 0 ? (
                      numericColumns.map((column) => (
                        <option key={column.name} value={column.name}>
                          {column.name}
                        </option>
                      ))
                    ) : (
                      columns.map((column) => (
                        <option key={column.name} value={column.name}>
                          {column.name}
                        </option>
                      ))
                    )}
                  </select>

                  <select
                    value={metricAggregation}
                    onChange={(event) =>
                      setMetricAggregation(event.target.value as ChartAggregation)
                    }
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/40"
                  >
                    {AGGREGATIONS.map((option) => (
                      <option key={option} value={option}>
                        {option.toUpperCase()}
                      </option>
                    ))}
                  </select>

                  <select
                    value={metricFormat}
                    onChange={(event) =>
                      setMetricFormat(event.target.value as MetricFormat)
                    }
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400/40"
                  >
                    {METRIC_FORMATS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={addMetricWidget}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-200"
                  >
                    <Plus className="h-4 w-4" />
                    Add KPI
                  </button>
                </div>
              </div>
            </div>

            <div className="glass rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">Widget stack</h3>
                  <p className="text-sm text-slate-400">
                    Reorder cards before previewing or exporting.
                  </p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.18em] text-slate-400">
                  {widgets.length} widgets
                </span>
              </div>

              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {widgets.map((widget, index) => (
                    <motion.div
                      key={widget.id}
                      layout
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                            {widget.type}
                          </span>
                          {widget.type === "chart" ? (
                            <span className="text-sm font-medium text-white">
                              {widget.title}
                            </span>
                          ) : widget.type === "metric" ? (
                            <span className="text-sm font-medium text-white">
                              {widget.label}
                            </span>
                          ) : (
                            <span className="text-sm font-medium text-white">
                              Text narrative
                            </span>
                          )}
                        </div>

                        <p className="mt-2 text-sm text-slate-400">
                          {widget.type === "text"
                            ? widget.content
                            : widget.sql}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => moveWidget(index, -1)}
                          disabled={index === 0}
                          className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Move widget up"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => moveWidget(index, 1)}
                          disabled={index === widgets.length - 1}
                          className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Move widget down"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() =>
                            setWidgets((current) =>
                              current.filter((item) => item.id !== widget.id),
                            )
                          }
                          className="rounded-xl border border-red-400/20 bg-red-500/10 p-2 text-red-200 transition hover:bg-red-500/20"
                          aria-label="Remove widget"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {widgets.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/15 bg-slate-950/40 p-6 text-center text-sm text-slate-400">
                    Start by adding a chart, text block, or KPI card.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="glass rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handlePreview}
                  disabled={previewing || widgets.length === 0}
                  className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {previewing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                  Preview
                </button>

                <button
                  onClick={handleExport}
                  disabled={exporting || widgets.length === 0}
                  className="inline-flex items-center gap-2 rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {exporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Export HTML
                </button>
              </div>

              {(message || error) && (
                <div
                  className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
                    error
                      ? "border border-red-500/20 bg-red-500/10 text-red-200"
                      : "border border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                  }`}
                >
                  {error ?? message}
                </div>
              )}
            </div>

            <div className="glass rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    Live preview
                  </p>
                  <h3 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-white">
                    {reportConfig.title}
                  </h3>
                  <p className="mt-2 text-sm text-slate-400">
                    {reportConfig.description || "Add a report description above."}
                  </p>
                </div>

                <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-cyan-200">
                  {new Date(reportConfig.createdAt).toLocaleDateString()}
                </span>
              </div>

              <div className="grid gap-4">
                {widgets.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/15 bg-slate-950/40 p-8 text-center text-sm text-slate-400">
                    The preview area will populate once you add widgets.
                  </div>
                )}

                {widgets.map((widget) => {
                  if (widget.type === "text") {
                    return (
                      <motion.div
                        key={widget.id}
                        layout
                        className="rounded-3xl border border-white/10 bg-slate-950/50 p-5"
                      >
                        <div className="mb-3 flex items-center gap-2">
                          <FileText className="h-4 w-4 text-amber-300" />
                          <span className="text-sm font-semibold text-white">
                            Narrative block
                          </span>
                        </div>
                        <div className="space-y-3 text-sm leading-7 text-slate-200">
                          {widget.content.split("\n").map((line, index) => (
                            <p key={`${widget.id}-${index}`}>{line || "\u00A0"}</p>
                          ))}
                        </div>
                      </motion.div>
                    );
                  }

                  if (widget.type === "metric") {
                    const result = getMetricResult(
                      previewData[widget.id] ?? [],
                      widget.format,
                    );

                    return (
                      <motion.div
                        key={widget.id}
                        layout
                        className="rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-400/10 via-slate-950/60 to-slate-950/80 p-5"
                      >
                        <div className="mb-3 flex items-center gap-2">
                          <Hash className="h-4 w-4 text-emerald-300" />
                          <span className="text-sm font-semibold text-white">
                            {widget.label}
                          </span>
                        </div>
                        <p className="text-4xl font-semibold tracking-[-0.05em] text-white">
                          {result.value}
                        </p>
                        {result.error && (
                          <p className="mt-3 text-sm text-red-200">{result.error}</p>
                        )}
                      </motion.div>
                    );
                  }

                  return (
                    <motion.div key={widget.id} layout>
                      <PreviewChart
                        title={widget.title}
                        xAxis={widget.xAxis}
                        yAxis={widget.yAxis}
                        rows={previewData[widget.id] ?? []}
                      />
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
