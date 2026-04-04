"use client";

import {
  Suspense,
  startTransition,
  use,
  useMemo,
  useState,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BoxplotChart, ScatterChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Download,
  Filter,
  RefreshCw,
  Sigma,
} from "lucide-react";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([BoxplotChart, ScatterChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface OutlierExplorerProps {
  tableName: string;
  columns: ColumnProfile[];
}

type FilterMode = "all" | "outliers" | "clean";

interface OutlierSummary {
  rowCount: number;
  nonNullCount: number;
  q1: number;
  median: number;
  q3: number;
  iqr: number;
  lowerBound: number;
  upperBound: number;
  min: number;
  max: number;
}

interface ExplorerRow {
  __metric: number;
  __is_outlier: boolean;
  values: Record<string, unknown>;
}

interface ReadyOutlierState {
  status: "ready";
  columnName: string;
  summary: OutlierSummary;
  rows: ExplorerRow[];
}

interface EmptyOutlierState {
  status: "empty";
  message: string;
}

interface ErrorOutlierState {
  status: "error";
  message: string;
}

type OutlierResult = ReadyOutlierState | EmptyOutlierState | ErrorOutlierState;

function numericColumns(columns: ColumnProfile[]) {
  return columns.filter((column) => column.type === "number");
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function buildOutlierChart(
  summary: OutlierSummary,
  rows: ExplorerRow[],
): EChartsOption {
  return {
    animationDuration: 350,
    tooltip: {
      formatter: (params: unknown) => {
        const point = params as {
          seriesType?: string;
          data?: number | number[];
        };
        if (point.seriesType === "scatter" && Array.isArray(point.data)) {
          return `Outlier value: ${formatNumber(point.data[1] ?? 0)}`;
        }

        return [
          `Min: ${summary.min.toFixed(2)}`,
          `Q1: ${summary.q1.toFixed(2)}`,
          `Median: ${summary.median.toFixed(2)}`,
          `Q3: ${summary.q3.toFixed(2)}`,
          `Max: ${summary.max.toFixed(2)}`,
        ].join("<br/>");
      },
    },
    grid: { left: 18, right: 18, top: 20, bottom: 28, containLabel: true },
    xAxis: {
      type: "category",
      data: ["Distribution"],
      axisLabel: { color: "#64748b", fontSize: 11 },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#64748b", fontSize: 11 },
    },
    series: [
      {
        type: "boxplot",
        data: [[summary.min, summary.q1, summary.median, summary.q3, summary.max]],
        itemStyle: {
          color: "rgba(6, 182, 212, 0.18)",
          borderColor: "#06b6d4",
          borderWidth: 2,
        },
      },
      {
        type: "scatter",
        data: rows
          .filter((row) => row.__is_outlier)
          .map((row) => [0, row.__metric]),
        itemStyle: {
          color: "#f43f5e",
        },
      },
    ],
  };
}

function buildCsv(rows: ExplorerRow[]) {
  if (rows.length === 0) return "";

  const headers = Array.from(
    rows.reduce((set, row) => {
      set.add("__metric");
      set.add("__is_outlier");
      for (const key of Object.keys(row.values)) {
        set.add(key);
      }
      return set;
    }, new Set<string>()),
  );

  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => {
          const rawValue =
            header === "__metric"
              ? row.__metric
              : header === "__is_outlier"
                ? row.__is_outlier
                : row.values[header];
          const stringValue = formatCell(rawValue).replaceAll('"', '""');
          return `"${stringValue}"`;
        })
        .join(","),
    ),
  ];

  return lines.join("\n");
}

async function loadOutlierState(
  tableName: string,
  columns: ColumnProfile[],
  selectedColumn: string,
): Promise<OutlierResult> {
  const targetColumn = numericColumns(columns).find(
    (column) => column.name === selectedColumn,
  );
  if (!targetColumn) {
    return {
      status: "empty",
      message: "Select a numeric column to explore outliers.",
    };
  }

  try {
    const table = quoteIdentifier(tableName);
    const column = quoteIdentifier(targetColumn.name);
    const summarySql = `
      WITH clean AS (
        SELECT CAST(${column} AS DOUBLE) AS metric
        FROM ${table}
        WHERE ${column} IS NOT NULL
      ),
      bounds AS (
        SELECT
          QUANTILE_CONT(metric, 0.25) AS q1,
          MEDIAN(metric) AS median_value,
          QUANTILE_CONT(metric, 0.75) AS q3
        FROM clean
      )
      SELECT
        (SELECT COUNT(*) FROM ${table}) AS row_count,
        (SELECT COUNT(*) FROM clean) AS non_null_count,
        q1,
        median_value,
        q3,
        q3 - q1 AS iqr,
        q1 - 1.5 * (q3 - q1) AS lower_bound,
        q3 + 1.5 * (q3 - q1) AS upper_bound,
        (SELECT MIN(metric) FROM clean) AS min_value,
        (SELECT MAX(metric) FROM clean) AS max_value
      FROM bounds
    `;
    const summaryRow = (await runQuery(summarySql))[0] ?? {};

    const summary: OutlierSummary = {
      rowCount: Math.max(0, Math.round(toNumber(summaryRow.row_count) ?? 0)),
      nonNullCount: Math.max(
        0,
        Math.round(toNumber(summaryRow.non_null_count) ?? 0),
      ),
      q1: toNumber(summaryRow.q1) ?? 0,
      median: toNumber(summaryRow.median_value) ?? 0,
      q3: toNumber(summaryRow.q3) ?? 0,
      iqr: toNumber(summaryRow.iqr) ?? 0,
      lowerBound: toNumber(summaryRow.lower_bound) ?? 0,
      upperBound: toNumber(summaryRow.upper_bound) ?? 0,
      min: toNumber(summaryRow.min_value) ?? 0,
      max: toNumber(summaryRow.max_value) ?? 0,
    };

    if (summary.nonNullCount === 0 || summary.iqr <= 0) {
      return {
        status: "empty",
        message: "No non-null numeric values were available for IQR analysis.",
      };
    }

    const rowsSql = `
      WITH flagged AS (
        SELECT
          *,
          CAST(${column} AS DOUBLE) AS __metric,
          CASE
            WHEN CAST(${column} AS DOUBLE) < ${summary.lowerBound}
              OR CAST(${column} AS DOUBLE) > ${summary.upperBound}
            THEN TRUE
            ELSE FALSE
          END AS __is_outlier
        FROM ${table}
        WHERE ${column} IS NOT NULL
      )
      SELECT *
      FROM flagged
      ORDER BY __is_outlier DESC, ABS(__metric - ${summary.median}) DESC
      LIMIT 60
    `;
    const rowResults = await runQuery(rowsSql);

    return {
      status: "ready",
      columnName: targetColumn.name,
      summary,
      rows: rowResults
        .map((row) => {
          const metric = toNumber(row.__metric);
          if (metric === null) return null;

          const values: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(row)) {
            if (key === "__metric" || key === "__is_outlier") continue;
            values[key] = value;
          }

          return {
            __metric: metric,
            __is_outlier: Boolean(row.__is_outlier),
            values,
          } satisfies ExplorerRow;
        })
        .filter((row): row is ExplorerRow => row !== null),
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Unable to load outlier exploration data.",
    };
  }
}

function ExplorerFallback() {
  return (
    <div className="grid gap-4 lg:grid-cols-[0.95fr,1.05fr]">
      <div className={`${GLASS_CARD_CLASS} animate-pulse p-5`}>
        <div className="h-4 w-28 rounded-full bg-slate-200/80 dark:bg-slate-800/80" />
        <div className="mt-4 h-40 rounded-3xl bg-slate-200/70 dark:bg-slate-800/70" />
      </div>
      <div className={`${GLASS_CARD_CLASS} animate-pulse p-5`}>
        <div className="h-4 w-28 rounded-full bg-slate-200/80 dark:bg-slate-800/80" />
        <div className="mt-4 h-40 rounded-3xl bg-slate-200/70 dark:bg-slate-800/70" />
      </div>
    </div>
  );
}

function ExplorerBody({
  resource,
  filterMode,
  tableName,
}: {
  resource: Promise<OutlierResult>;
  filterMode: FilterMode;
  tableName: string;
}) {
  const report = use(resource);

  if (report.status === "empty") {
    return (
      <div className={`${GLASS_CARD_CLASS} p-5 text-sm text-slate-600 dark:text-slate-300`}>
        {report.message}
      </div>
    );
  }

  if (report.status === "error") {
    return (
      <div className={`${GLASS_CARD_CLASS} p-5 text-sm text-rose-600 dark:text-rose-300`}>
        {report.message}
      </div>
    );
  }

  const readyReport = report;
  const visibleRows =
    filterMode === "outliers"
      ? readyReport.rows.filter((row) => row.__is_outlier)
      : filterMode === "clean"
        ? readyReport.rows.filter((row) => !row.__is_outlier)
        : readyReport.rows;
  const outlierCount = readyReport.rows.filter((row) => row.__is_outlier).length;
  const chartOption = buildOutlierChart(readyReport.summary, readyReport.rows);
  const nullRate =
    readyReport.summary.rowCount > 0
      ? ((readyReport.summary.rowCount - readyReport.summary.nonNullCount) /
          readyReport.summary.rowCount) *
        100
      : 0;

  function exportRows() {
    const csv = buildCsv(visibleRows);
    if (!csv) return;
    downloadFile(
      csv,
      `${tableName}-${readyReport.columnName}-${filterMode}.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Outliers
          </p>
          <p className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            {formatNumber(outlierCount)}
          </p>
        </div>
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Lower fence
          </p>
          <p className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            {report.summary.lowerBound.toFixed(2)}
          </p>
        </div>
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Upper fence
          </p>
          <p className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            {report.summary.upperBound.toFixed(2)}
          </p>
        </div>
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Null rate
          </p>
          <p className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            {formatPercent(nullRate, 1)}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.95fr,1.05fr]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
          className={`${GLASS_CARD_CLASS} p-5`}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              <Sigma className="h-4 w-4 text-cyan-500" />
              Box plot
            </div>
            <button
              type="button"
              onClick={exportRows}
              disabled={visibleRows.length === 0}
              className={BUTTON_CLASS}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>

          <div className="mt-4 h-[320px]">
            <ReactEChartsCore
              echarts={echarts}
              option={chartOption}
              notMerge
              lazyUpdate
              style={{ height: "100%", width: "100%" }}
            />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: ANALYTICS_EASE, delay: 0.04 }}
          className={`${GLASS_CARD_CLASS} p-5`}
        >
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <AlertTriangle className="h-4 w-4 text-rose-500" />
            {filterMode === "outliers"
              ? "Outlier rows"
              : filterMode === "clean"
                ? "Rows without outliers"
                : "All scanned rows"}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-white/20 text-left text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  <th className="px-3 py-2">Metric</th>
                  <th className="px-3 py-2">Flag</th>
                  {Object.keys(visibleRows[0]?.values ?? {}).map((key) => (
                    <th key={key} className="px-3 py-2">
                      {key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr
                    key={`${row.__metric}-${index}`}
                    className="border-b border-white/10 text-slate-700 dark:text-slate-200"
                  >
                    <td className="px-3 py-2">{row.__metric.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      {row.__is_outlier ? "Outlier" : "Clean"}
                    </td>
                    {Object.entries(row.values).map(([key, value]) => (
                      <td key={key} className="px-3 py-2">
                        {formatCell(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default function OutlierExplorer({
  tableName,
  columns,
}: OutlierExplorerProps) {
  const eligibleColumns = numericColumns(columns);
  const [selectedColumn, setSelectedColumn] = useState<string>(
    () => eligibleColumns[0]?.name ?? "",
  );
  const [filterMode, setFilterMode] = useState<FilterMode>("outliers");
  const [refreshKey, setRefreshKey] = useState(0);

  const resource = useMemo(
    () => {
      void refreshKey;
      return loadOutlierState(tableName, columns, selectedColumn);
    },
    [columns, refreshKey, selectedColumn, tableName],
  );

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            Outlier explorer
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Explore IQR outliers with a box plot and row-level filters
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Pick a numeric column, review the quartile fences, inspect flagged
            rows, switch between outliers and clean records, and export the
            current slice as CSV.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="min-w-64">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Numeric column
            </span>
            <select
              value={selectedColumn}
              onChange={(event) =>
                startTransition(() => setSelectedColumn(event.target.value))
              }
              className={FIELD_CLASS}
            >
              {eligibleColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() =>
              startTransition(() => setRefreshKey((value) => value + 1))
            }
            className={`${BUTTON_CLASS} self-end`}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {[
          { value: "outliers" as const, label: "Only outliers" },
          { value: "clean" as const, label: "Exclude outliers" },
          { value: "all" as const, label: "Include all" },
        ].map((mode) => (
          <button
            key={mode.value}
            type="button"
            aria-pressed={filterMode === mode.value}
            onClick={() => startTransition(() => setFilterMode(mode.value))}
            className={
              filterMode === mode.value
                ? "rounded-2xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-2.5 text-sm font-medium text-cyan-700 dark:text-cyan-300"
                : BUTTON_CLASS
            }
          >
            <Filter className="h-4 w-4" />
            {mode.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        <Suspense fallback={<ExplorerFallback />}>
          <ExplorerBody
            resource={resource}
            filterMode={filterMode}
            tableName={tableName}
          />
        </Suspense>
      </div>
    </section>
  );
}
