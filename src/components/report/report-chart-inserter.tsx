"use client";

import { startTransition, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import {
  BarChart as EChartsBarChart,
  LineChart,
  PieChart,
  ScatterChart,
} from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  BarChart3,
  Eye,
  FilePlus2,
  Layers3,
  Loader2,
  PieChart as PieChartIcon,
  ScatterChart as ScatterChartIcon,
  TrendingUp,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
} from "@/lib/utils/advanced-analytics";
import { formatNumber, generateId } from "@/lib/utils/formatters";
import type { ChartType } from "@/types/chart";
import type { ReportChartWidget } from "@/types/report";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  LineChart,
  EChartsBarChart,
  PieChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface ReportChartInserterProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface ChartTypeDefinition {
  type: Extract<ChartType, "bar" | "line" | "area" | "pie" | "scatter">;
  label: string;
  description: string;
  icon: typeof BarChart3;
}

const CHART_TYPES: readonly ChartTypeDefinition[] = [
  {
    type: "bar",
    label: "Bar",
    description: "Rank categories by a grouped metric.",
    icon: BarChart3,
  },
  {
    type: "line",
    label: "Line",
    description: "Track a measure over an ordered dimension.",
    icon: TrendingUp,
  },
  {
    type: "area",
    label: "Area",
    description: "Show volume while preserving the trend path.",
    icon: Layers3,
  },
  {
    type: "pie",
    label: "Pie",
    description: "Display part-to-whole composition for top groups.",
    icon: PieChartIcon,
  },
  {
    type: "scatter",
    label: "Scatter",
    description: "Inspect the relationship between two numeric fields.",
    icon: ScatterChartIcon,
  },
] as const;

function buildPreviewSql(
  tableName: string,
  chartType: ChartTypeDefinition["type"],
  xAxis: string,
  yAxis: string,
) {
  const table = quoteIdentifier(tableName);
  const safeX = quoteIdentifier(xAxis);
  const safeY = quoteIdentifier(yAxis);

  if (chartType === "scatter") {
    return `SELECT CAST(${safeX} AS DOUBLE) AS x_value, CAST(${safeY} AS DOUBLE) AS y_value FROM ${table} WHERE ${safeX} IS NOT NULL AND ${safeY} IS NOT NULL LIMIT 120`;
  }

  if (chartType === "pie") {
    return `SELECT CAST(${safeX} AS VARCHAR) AS bucket_label, AVG(CAST(${safeY} AS DOUBLE)) AS bucket_value FROM ${table} WHERE ${safeX} IS NOT NULL AND ${safeY} IS NOT NULL GROUP BY 1 ORDER BY bucket_value DESC LIMIT 8`;
  }

  return `SELECT CAST(${safeX} AS VARCHAR) AS bucket_label, AVG(CAST(${safeY} AS DOUBLE)) AS bucket_value FROM ${table} WHERE ${safeX} IS NOT NULL AND ${safeY} IS NOT NULL GROUP BY 1 ORDER BY 1 LIMIT 24`;
}

function buildChartOption(
  chartType: ChartTypeDefinition["type"],
  rows: Record<string, unknown>[],
  dark: boolean,
): EChartsOption {
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";

  if (chartType === "scatter") {
    const data = rows.map((row) => [Number(row.x_value ?? 0), Number(row.y_value ?? 0)]);

    return {
      tooltip: {
        trigger: "item",
        formatter: (params: unknown) => {
          const item = params as { value?: [number, number] };
          return `x: ${Number(item.value?.[0] ?? 0).toFixed(2)}<br/>y: ${Number(
            item.value?.[1] ?? 0,
          ).toFixed(2)}`;
        },
      },
      grid: { left: 24, right: 20, top: 20, bottom: 30, containLabel: true },
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
          data,
          symbolSize: 9,
          itemStyle: { color: "#06b6d4", opacity: 0.8 },
        },
      ],
    };
  }

  if (chartType === "pie") {
    return {
      tooltip: {
        trigger: "item",
        formatter: (params: unknown) => {
          const item = params as { name?: string; value?: number };
          return `${item.name ?? ""}: ${Number(item.value ?? 0).toFixed(2)}`;
        },
      },
      legend: {
        bottom: 0,
        textStyle: { color: textColor },
      },
      series: [
        {
          type: "pie",
          radius: ["38%", "68%"],
          data: rows.map((row) => ({
            name: String(row.bucket_label ?? ""),
            value: Number(row.bucket_value ?? 0),
          })),
          itemStyle: { borderWidth: 2, borderColor: dark ? "#020617" : "#ffffff" },
        },
      ],
    };
  }

  const labels = rows.map((row) => String(row.bucket_label ?? ""));
  const data = rows.map((row) => Number(row.bucket_value ?? 0));

  return {
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const items = Array.isArray(params)
          ? (params as Array<{ axisValueLabel?: string; value?: number }>)
          : [params as { axisValueLabel?: string; value?: number }];
        return `${items[0]?.axisValueLabel ?? ""}: ${Number(
          items[0]?.value ?? 0,
        ).toFixed(2)}`;
      },
    },
    grid: { left: 24, right: 20, top: 20, bottom: 40, containLabel: true },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { color: textColor, rotate: labels.length > 8 ? 24 : 0 },
      boundaryGap: chartType === "bar",
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        type: chartType === "bar" ? "bar" : "line",
        smooth: chartType !== "bar",
        data,
        lineStyle: { color: "#06b6d4", width: 3 },
        areaStyle:
          chartType === "area" ? { color: "rgba(6, 182, 212, 0.12)" } : undefined,
        itemStyle:
          chartType === "bar"
            ? { color: "#06b6d4", borderRadius: [8, 8, 0, 0] }
            : { color: "#06b6d4" },
      },
    ],
  };
}

function ChartTypeCard({
  definition,
  active,
  onSelect,
}: {
  definition: ChartTypeDefinition;
  active: boolean;
  onSelect: (type: ChartTypeDefinition["type"]) => void;
}) {
  const Icon = definition.icon;

  return (
    <button
      type="button"
      onClick={() => onSelect(definition.type)}
      className={`${GLASS_CARD_CLASS} p-4 text-left transition ${
        active ? "ring-2 ring-cyan-400/70" : "hover:-translate-y-0.5"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-cyan-500/10 p-2.5 text-cyan-700 dark:text-cyan-300">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-base font-semibold text-slate-950 dark:text-white">
            {definition.label}
          </p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {definition.description}
          </p>
        </div>
      </div>
    </button>
  );
}

export default function ReportChartInserter({
  tableName,
  columns,
}: ReportChartInserterProps) {
  const dark = useDarkMode();
  const categoricalColumns = useMemo(
    () => columns.filter((column) => column.type !== "number"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [chartType, setChartType] =
    useState<ChartTypeDefinition["type"]>("bar");
  const [selectedXAxis, setSelectedXAxis] = useState("");
  const [selectedYAxis, setSelectedYAxis] = useState("");
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [insertedCharts, setInsertedCharts] = useState<ReportChartWidget[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const activeXAxis =
    categoricalColumns.find((column) => column.name === selectedXAxis)?.name ??
    columns[0]?.name ??
    "";
  const activeYAxis =
    numericColumns.find((column) => column.name === selectedYAxis)?.name ??
    numericColumns[0]?.name ??
    "";
  const chartOption = useMemo(
    () => buildChartOption(chartType, previewRows, dark),
    [chartType, dark, previewRows],
  );

  async function handlePreview() {
    if (!activeXAxis || !activeYAxis) {
      setStatus("Choose both an x-axis field and a metric field.");
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      const sql = buildPreviewSql(tableName, chartType, activeXAxis, activeYAxis);
      const rows = await runQuery(sql);
      startTransition(() => {
        setPreviewRows(rows);
      });
      setStatus(`Loaded ${formatNumber(rows.length)} rows for the preview chart.`);
    } catch (error) {
      setPreviewRows([]);
      setStatus(
        error instanceof Error ? error.message : "Chart preview failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleInsertChart() {
    if (previewRows.length === 0 || !activeXAxis || !activeYAxis) {
      setStatus("Preview a chart before inserting it into the report section.");
      return;
    }

    const widget: ReportChartWidget = {
      id: generateId(),
      type: "chart",
      chartType,
      title: `${tableName}: ${activeYAxis} by ${activeXAxis}`,
      sql: buildPreviewSql(tableName, chartType, activeXAxis, activeYAxis),
      xAxis: activeXAxis,
      yAxis: activeYAxis,
      aggregation: "avg",
    };

    setInsertedCharts((current) => [widget, ...current]);
    setStatus(`Added ${widget.title} to the report section queue.`);
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <FilePlus2 className="h-3.5 w-3.5" />
            Report chart inserter
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Browse chart patterns and stage them for report sections
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Choose a chart type, bind the fields, preview the result, and add
            the configuration to a local report section queue.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handlePreview()}
            disabled={loading || !activeXAxis || !activeYAxis}
            className={BUTTON_CLASS}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
            Preview chart
          </button>
          <button
            type="button"
            onClick={handleInsertChart}
            disabled={previewRows.length === 0}
            className={BUTTON_CLASS}
          >
            <FilePlus2 className="h-4 w-4" />
            Add to report section
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {CHART_TYPES.map((definition) => (
          <ChartTypeCard
            key={definition.type}
            definition={definition}
            active={definition.type === chartType}
            onSelect={setChartType}
          />
        ))}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            X-axis column
          </span>
          <select
            aria-label="X-axis column"
            value={activeXAxis}
            onChange={(event) => setSelectedXAxis(event.target.value)}
            className={FIELD_CLASS}
          >
            {columns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Metric column
          </span>
          <select
            aria-label="Metric column"
            value={activeYAxis}
            onChange={(event) => setSelectedYAxis(event.target.value)}
            className={FIELD_CLASS}
          >
            {numericColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {status ? (
        <p className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-700 dark:text-cyan-300">
          {status}
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
          className={`${GLASS_CARD_CLASS} p-4`}
        >
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">
            Preview
          </h3>
          <div className="mt-4">
            <ReactEChartsCore
              echarts={echarts}
              option={chartOption}
              style={{ height: 320 }}
              notMerge
              lazyUpdate
            />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, ease: ANALYTICS_EASE }}
          className={`${GLASS_CARD_CLASS} p-4`}
        >
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">
            Report section queue
          </h3>
          <div className="mt-4 space-y-3">
            {insertedCharts.length === 0 ? (
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                Add a previewed chart to stage it for a report section.
              </p>
            ) : (
              insertedCharts.map((chart) => (
                <div
                  key={chart.id}
                  className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-slate-950/40"
                >
                  <p className="font-medium text-slate-950 dark:text-white">
                    {chart.title}
                  </p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {chart.chartType} · {chart.xAxis} vs {chart.yAxis}
                  </p>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
