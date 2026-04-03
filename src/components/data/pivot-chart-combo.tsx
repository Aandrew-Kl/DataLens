"use client";

import { useMemo, useRef, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  BarChart3,
  Download,
  Eye,
  ImageDown,
  LayoutGrid,
  Loader2,
  Table2,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  dataUrlToBytes,
  quoteIdentifier,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface PivotChartComboProps {
  tableName: string;
  columns: ColumnProfile[];
}

type Aggregation = "sum" | "avg" | "count" | "min" | "max";
type ViewMode = "table" | "chart" | "split";
type ChartMode = "bar" | "line";

interface PivotResult {
  rowKeys: string[];
  columnKeys: string[];
  grid: Map<string, number>;
  rowTotals: Map<string, number>;
}

const AGGREGATIONS = ["sum", "avg", "count", "min", "max"] as const;
const VIEW_MODES = ["table", "chart", "split"] as const;
const CHART_MODES = ["bar", "line"] as const;

function cellKey(rowKey: string, columnKey: string) {
  return `${rowKey}\u0000${columnKey}`;
}

function buildAggregationExpression(aggregation: Aggregation, valueColumn: string) {
  if (aggregation === "count") return "COUNT(*)";
  const column = quoteIdentifier(valueColumn);
  if (aggregation === "sum") return `SUM(TRY_CAST(${column} AS DOUBLE))`;
  if (aggregation === "avg") return `AVG(TRY_CAST(${column} AS DOUBLE))`;
  if (aggregation === "min") return `MIN(TRY_CAST(${column} AS DOUBLE))`;
  return `MAX(TRY_CAST(${column} AS DOUBLE))`;
}

async function loadPivotResult(args: {
  tableName: string;
  rowField: string;
  columnField: string | null;
  valueField: string;
  aggregation: Aggregation;
}) {
  const rowIdentifier = quoteIdentifier(args.rowField);
  const valueExpression = buildAggregationExpression(args.aggregation, args.valueField);
  const query = args.columnField
    ? `
        SELECT
          CAST(${rowIdentifier} AS VARCHAR) AS pivot_row,
          CAST(${quoteIdentifier(args.columnField)} AS VARCHAR) AS pivot_column,
          ${valueExpression} AS pivot_value
        FROM ${quoteIdentifier(args.tableName)}
        WHERE ${rowIdentifier} IS NOT NULL
          AND ${quoteIdentifier(args.columnField)} IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 1, 2
      `
    : `
        SELECT
          CAST(${rowIdentifier} AS VARCHAR) AS pivot_row,
          ${valueExpression} AS pivot_value
        FROM ${quoteIdentifier(args.tableName)}
        WHERE ${rowIdentifier} IS NOT NULL
        GROUP BY 1
        ORDER BY 1
      `;

  const rows = await runQuery(query);
  const rowKeys = new Set<string>();
  const columnKeys = new Set<string>();
  const grid = new Map<string, number>();

  for (const row of rows) {
    const rowKey = String(row.pivot_row ?? "");
    const columnKey = args.columnField ? String(row.pivot_column ?? "") : "__value__";
    const numericValue = Number(row.pivot_value ?? 0);
    rowKeys.add(rowKey);
    columnKeys.add(columnKey);
    grid.set(cellKey(rowKey, columnKey), Number.isFinite(numericValue) ? numericValue : 0);
  }

  const sortedRows = [...rowKeys].sort((left, right) => left.localeCompare(right));
  const sortedColumns = [...columnKeys].sort((left, right) => left.localeCompare(right));
  const rowTotals = new Map<string, number>();

  for (const rowKey of sortedRows) {
    const total = sortedColumns.reduce(
      (sum, columnKey) => sum + (grid.get(cellKey(rowKey, columnKey)) ?? 0),
      0,
    );
    rowTotals.set(rowKey, total);
  }

  return {
    rowKeys: sortedRows,
    columnKeys: sortedColumns,
    grid,
    rowTotals,
  } satisfies PivotResult;
}

function buildCsv(result: PivotResult) {
  return [
    ["row", ...result.columnKeys, "total"].join(","),
    ...result.rowKeys.map((rowKey) =>
      [
        rowKey,
        ...result.columnKeys.map((columnKey) => result.grid.get(cellKey(rowKey, columnKey)) ?? 0),
        result.rowTotals.get(rowKey) ?? 0,
      ].join(","),
    ),
  ].join("\n");
}

function buildChartOption(
  result: PivotResult,
  chartMode: ChartMode,
  dark: boolean,
): EChartsOption {
  return {
    animationDuration: 420,
    grid: { left: 54, right: 24, top: 48, bottom: 42, containLabel: true },
    legend: {
      top: 4,
      textStyle: { color: dark ? "#cbd5e1" : "#334155" },
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
      formatter: (params: unknown) => {
        const records = Array.isArray(params)
          ? (params as Array<{ axisValueLabel?: string; seriesName?: string; value?: number }>)
          : [];
        if (records.length === 0) return "Pivot result";
        return [
          String(records[0]?.axisValueLabel ?? ""),
          ...records.map(
            (record) => `${String(record.seriesName ?? "Series")}: ${formatNumber(Number(record.value ?? 0))}`,
          ),
        ].join("<br/>");
      },
    },
    xAxis: {
      type: "category",
      data: result.rowKeys,
      axisLabel: { color: dark ? "#cbd5e1" : "#475569", rotate: result.rowKeys.length > 6 ? 18 : 0 },
      axisLine: { lineStyle: { color: dark ? "#334155" : "#cbd5e1" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: dark ? "#cbd5e1" : "#475569" },
      splitLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" } },
    },
    series: result.columnKeys.map((columnKey) => ({
      name: columnKey === "__value__" ? "Value" : columnKey,
      type: chartMode,
      smooth: chartMode === "line",
      data: result.rowKeys.map((rowKey) => result.grid.get(cellKey(rowKey, columnKey)) ?? 0),
    })),
  };
}

function PivotTable({ result }: { result: PivotResult | null }) {
  if (!result) {
    return (
      <div className="rounded-2xl border border-dashed border-white/20 px-4 py-8 text-sm text-slate-500 dark:text-slate-400">
        Build the pivot first to inspect the table.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/20">
      <table className="min-w-full text-left text-sm text-slate-700 dark:text-slate-200">
        <thead className="bg-slate-950/5 text-xs uppercase tracking-[0.16em] text-slate-500 dark:bg-white/5 dark:text-slate-400">
          <tr>
            <th className="px-4 py-3">Row</th>
            {result.columnKeys.map((columnKey) => (
              <th key={columnKey} className="px-4 py-3">
                {columnKey === "__value__" ? "Value" : columnKey}
              </th>
            ))}
            <th className="px-4 py-3">Total</th>
          </tr>
        </thead>
        <tbody>
          {result.rowKeys.map((rowKey) => (
            <tr key={rowKey} className="border-t border-white/15">
              <td className="px-4 py-3 font-medium">{rowKey}</td>
              {result.columnKeys.map((columnKey) => (
                <td key={`${rowKey}-${columnKey}`} className="px-4 py-3">
                  {formatNumber(result.grid.get(cellKey(rowKey, columnKey)) ?? 0)}
                </td>
              ))}
              <td className="px-4 py-3 font-semibold">
                {formatNumber(result.rowTotals.get(rowKey) ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PivotChartCombo({
  tableName,
  columns,
}: PivotChartComboProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const dimensionColumns = useMemo(
    () => columns.filter((column) => column.type !== "number"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [rowField, setRowField] = useState(dimensionColumns[0]?.name ?? "");
  const [columnField, setColumnField] = useState(dimensionColumns[1]?.name ?? "");
  const [valueField, setValueField] = useState(numericColumns[0]?.name ?? "");
  const [aggregation, setAggregation] = useState<Aggregation>("sum");
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [chartMode, setChartMode] = useState<ChartMode>("bar");
  const [result, setResult] = useState<PivotResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(
    "Configure the pivot, then switch between table, chart, or split view.",
  );

  const option = useMemo(
    () => buildChartOption(result ?? { rowKeys: [], columnKeys: [], grid: new Map(), rowTotals: new Map() }, chartMode, dark),
    [chartMode, dark, result],
  );

  async function handleBuild() {
    if (!rowField || !valueField) {
      setNotice("Choose row and value fields to build the pivot.");
      return;
    }
    setLoading(true);
    setNotice("Building pivot and chart...");

    try {
      const nextResult = await loadPivotResult({
        tableName,
        rowField,
        columnField: columnField || null,
        valueField,
        aggregation,
      });
      setResult(nextResult);
      setNotice(`Built a pivot with ${formatNumber(nextResult.rowKeys.length)} rows.`);
    } catch (error) {
      setResult(null);
      setNotice(error instanceof Error ? error.message : "Pivot build failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleExportCsv() {
    if (!result) return;
    downloadFile(buildCsv(result), `${tableName}-pivot-chart.csv`, "text/csv;charset=utf-8;");
  }

  function handleExportPng() {
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance) return;
    const output = dataUrlToBytes(
      instance.getDataURL({
        type: "png",
        pixelRatio: 2,
        backgroundColor: dark ? "#020617" : "#ffffff",
      }),
    );
    downloadFile([output.bytes], `${tableName}-pivot-chart.png`, output.mimeType);
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} space-y-6 p-6`}
    >
      <div className="flex flex-col gap-4 border-b border-white/20 pb-6 dark:border-white/10 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
            <LayoutGrid className="h-3.5 w-3.5" />
            Pivot Chart Combo
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
              Combine pivot tables and charts in one coordinated workspace
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Configure rows, columns, and values once. DataLens renders the pivot result,
              turns it into a chart automatically, and lets you switch between table-only,
              chart-only, or split layouts.
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <select aria-label="Pivot row field" value={rowField} onChange={(event) => setRowField(event.currentTarget.value)} className={FIELD_CLASS}>
            {dimensionColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <select aria-label="Pivot column field" value={columnField} onChange={(event) => setColumnField(event.currentTarget.value)} className={FIELD_CLASS}>
            <option value="">No column split</option>
            {dimensionColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <select aria-label="Pivot value field" value={valueField} onChange={(event) => setValueField(event.currentTarget.value)} className={FIELD_CLASS}>
            {numericColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <select aria-label="Pivot aggregation" value={aggregation} onChange={(event) => setAggregation(event.currentTarget.value as Aggregation)} className={FIELD_CLASS}>
            {AGGREGATIONS.map((aggregationOption) => (
              <option key={aggregationOption} value={aggregationOption}>
                {aggregationOption.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={handleBuild} className={BUTTON_CLASS}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
          Build pivot combo
        </button>
        <button type="button" onClick={handleExportCsv} disabled={!result} className={BUTTON_CLASS}>
          <Download className="h-4 w-4" />
          Export CSV
        </button>
        <button type="button" onClick={handleExportPng} disabled={!result} className={BUTTON_CLASS}>
          <ImageDown className="h-4 w-4" />
          Export PNG
        </button>
        <select aria-label="Pivot view mode" value={viewMode} onChange={(event) => setViewMode(event.currentTarget.value as ViewMode)} className={FIELD_CLASS}>
          {VIEW_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
        <select aria-label="Pivot chart mode" value={chartMode} onChange={(event) => setChartMode(event.currentTarget.value as ChartMode)} className={FIELD_CLASS}>
          {CHART_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-300">{notice}</p>

      <div
        className={
          viewMode === "split"
            ? "grid gap-6 xl:grid-cols-[1fr_1fr]"
            : "grid gap-6"
        }
      >
        {viewMode !== "chart" ? (
          <div className={`${GLASS_CARD_CLASS} space-y-4 p-5`}>
            <div className="flex items-center gap-2">
              <Table2 className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Pivot Table</p>
            </div>
            <PivotTable result={result} />
          </div>
        ) : null}

        {viewMode !== "table" ? (
          <div className={`${GLASS_CARD_CLASS} space-y-4 p-5`}>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Generated Chart</p>
            </div>
            <ReactEChartsCore
              ref={chartRef}
              echarts={echarts}
              option={option}
              notMerge
              lazyUpdate
              style={{ height: 360 }}
            />
          </div>
        ) : null}
      </div>
    </motion.section>
  );
}
