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
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  BarChart3,
  Database,
  ListFilter,
  RefreshCw,
  Sigma,
  Tag,
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
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface ColumnStatisticsProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface HistogramBin {
  label: string;
  count: number;
}

interface ValueCount {
  label: string;
  count: number;
  share: number;
}

interface NumericStatistics {
  kind: "numeric";
  rowCount: number;
  nonNullCount: number;
  distinctCount: number;
  nullCount: number;
  mean: number | null;
  median: number | null;
  mode: number | null;
  stdDev: number | null;
  variance: number | null;
  skewness: number | null;
  kurtosis: number | null;
  histogram: HistogramBin[];
}

interface CategoricalStatistics {
  kind: "categorical";
  rowCount: number;
  nonNullCount: number;
  distinctCount: number;
  nullCount: number;
  topValues: ValueCount[];
}

type ColumnDetail = NumericStatistics | CategoricalStatistics;

interface ReadyStatisticsState {
  status: "ready";
  column: ColumnProfile;
  detail: ColumnDetail;
}

interface EmptyStatisticsState {
  status: "empty";
  message: string;
}

interface ErrorStatisticsState {
  status: "error";
  message: string;
}

type ColumnStatisticsResult =
  | ReadyStatisticsState
  | EmptyStatisticsState
  | ErrorStatisticsState;

function isNumericColumn(column: ColumnProfile) {
  if (column.type === "number") return true;
  return column.sampleValues
    .filter((value) => value !== null)
    .every((value) => {
      if (typeof value === "number") return Number.isFinite(value);
      if (typeof value === "string" && value.trim() !== "") {
        return Number.isFinite(Number(value));
      }
      return false;
    });
}

function toFiniteNumber(value: unknown) {
  const parsed = toNumber(value);
  return parsed !== null && Number.isFinite(parsed) ? parsed : null;
}

function formatStat(value: number | null, digits = 2) {
  if (value === null) return "—";
  if (Math.abs(value) >= 1000) return formatNumber(value);
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toFixed(digits);
}

function buildDistributionOption(detail: ColumnDetail): EChartsOption {
  if (detail.kind === "numeric") {
    return {
      animationDuration: 350,
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const points = params as Array<{ axisValue?: string; data?: number }>;
          const point = Array.isArray(points) ? points[0] : undefined;
          return `${point?.axisValue ?? "Bin"}: ${formatNumber(point?.data ?? 0)}`;
        },
      },
      grid: { left: 18, right: 18, top: 20, bottom: 32, containLabel: true },
      xAxis: {
        type: "category",
        data: detail.histogram.map((bin) => bin.label),
        axisLabel: { color: "#64748b", fontSize: 11 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#64748b", fontSize: 11 },
      },
      series: [
        {
          type: "bar",
          data: detail.histogram.map((bin) => bin.count),
          itemStyle: {
            color: "#06b6d4",
            borderRadius: [10, 10, 0, 0],
          },
        },
      ],
    };
  }

  return {
    animationDuration: 350,
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => {
        const points = params as Array<{ axisValue?: string; data?: number }>;
        const point = Array.isArray(points) ? points[0] : undefined;
        return `${point?.axisValue ?? "Value"}: ${formatNumber(point?.data ?? 0)}`;
      },
    },
    grid: { left: 18, right: 18, top: 20, bottom: 32, containLabel: true },
    xAxis: {
      type: "category",
      data: detail.topValues.map((value) => value.label),
      axisLabel: { color: "#64748b", fontSize: 11, rotate: 18 },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#64748b", fontSize: 11 },
    },
    series: [
      {
        type: "bar",
        data: detail.topValues.map((value) => value.count),
        itemStyle: {
          color: "#8b5cf6",
          borderRadius: [10, 10, 0, 0],
        },
      },
    ],
  };
}

async function queryRowCount(tableName: string) {
  const rows = await runQuery(
    `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tableName)}`,
  );
  return Math.max(0, Math.round(toNumber(rows[0]?.row_count) ?? 0));
}

async function loadNumericStatistics(
  tableName: string,
  columnName: string,
): Promise<NumericStatistics> {
  const table = quoteIdentifier(tableName);
  const column = quoteIdentifier(columnName);
  const baseSql = `
    SELECT
      COUNT(*) AS row_count,
      COUNT(${column}) AS non_null_count,
      COUNT(DISTINCT ${column}) AS distinct_count,
      SUM(CASE WHEN ${column} IS NULL THEN 1 ELSE 0 END) AS null_count,
      AVG(CAST(${column} AS DOUBLE)) AS mean_value,
      MEDIAN(CAST(${column} AS DOUBLE)) AS median_value,
      STDDEV_SAMP(CAST(${column} AS DOUBLE)) AS stddev_value,
      VAR_SAMP(CAST(${column} AS DOUBLE)) AS variance_value,
      SKEWNESS(CAST(${column} AS DOUBLE)) AS skewness_value,
      KURTOSIS(CAST(${column} AS DOUBLE)) AS kurtosis_value
    FROM ${table}
  `;
  const modeSql = `
    SELECT CAST(${column} AS DOUBLE) AS mode_value
    FROM ${table}
    WHERE ${column} IS NOT NULL
    GROUP BY 1
    ORDER BY COUNT(*) DESC, mode_value
    LIMIT 1
  `;
  const histogramSql = `
    WITH clean AS (
      SELECT CAST(${column} AS DOUBLE) AS metric
      FROM ${table}
      WHERE ${column} IS NOT NULL
    ),
    bounds AS (
      SELECT MIN(metric) AS min_value, MAX(metric) AS max_value
      FROM clean
    ),
    bins AS (
      SELECT range AS bin_id
      FROM range(0, 10)
    ),
    grouped AS (
      SELECT
        CASE
          WHEN bounds.max_value = bounds.min_value THEN 0
          ELSE LEAST(
            CAST(
              FLOOR(
                ((clean.metric - bounds.min_value) / NULLIF(bounds.max_value - bounds.min_value, 0)) * 10
              ) AS INTEGER
            ),
            9
          )
        END AS bin_id,
        COUNT(*) AS bucket_count
      FROM clean
      CROSS JOIN bounds
      GROUP BY 1
    )
    SELECT
      bins.bin_id,
      bounds.min_value + ((bounds.max_value - bounds.min_value) / 10.0) * bins.bin_id AS start_value,
      COALESCE(grouped.bucket_count, 0) AS bucket_count
    FROM bins
    CROSS JOIN bounds
    LEFT JOIN grouped ON grouped.bin_id = bins.bin_id
    ORDER BY bins.bin_id
  `;

  const [baseRows, modeRows, histogramRows] = await Promise.all([
    runQuery(baseSql),
    runQuery(modeSql),
    runQuery(histogramSql),
  ]);

  const row = baseRows[0] ?? {};
  return {
    kind: "numeric",
    rowCount: Math.max(0, Math.round(toNumber(row.row_count) ?? 0)),
    nonNullCount: Math.max(0, Math.round(toNumber(row.non_null_count) ?? 0)),
    distinctCount: Math.max(0, Math.round(toNumber(row.distinct_count) ?? 0)),
    nullCount: Math.max(0, Math.round(toNumber(row.null_count) ?? 0)),
    mean: toFiniteNumber(row.mean_value),
    median: toFiniteNumber(row.median_value),
    mode: toFiniteNumber(modeRows[0]?.mode_value),
    stdDev: toFiniteNumber(row.stddev_value),
    variance: toFiniteNumber(row.variance_value),
    skewness: toFiniteNumber(row.skewness_value),
    kurtosis: toFiniteNumber(row.kurtosis_value),
    histogram: histogramRows.map((bin) => ({
      label: formatStat(toFiniteNumber(bin.start_value), 1),
      count: Math.max(0, Math.round(toNumber(bin.bucket_count) ?? 0)),
    })),
  };
}

async function loadCategoricalStatistics(
  tableName: string,
  columnName: string,
): Promise<CategoricalStatistics> {
  const table = quoteIdentifier(tableName);
  const column = quoteIdentifier(columnName);
  const baseSql = `
    SELECT
      COUNT(*) AS row_count,
      COUNT(${column}) AS non_null_count,
      COUNT(DISTINCT ${column}) AS distinct_count,
      SUM(CASE WHEN ${column} IS NULL THEN 1 ELSE 0 END) AS null_count
    FROM ${table}
  `;
  const valuesSql = `
    SELECT
      CAST(${column} AS VARCHAR) AS label,
      COUNT(*) AS bucket_count
    FROM ${table}
    WHERE ${column} IS NOT NULL
    GROUP BY 1
    ORDER BY bucket_count DESC, label
    LIMIT 8
  `;

  const [baseRows, valueRows] = await Promise.all([
    runQuery(baseSql),
    runQuery(valuesSql),
  ]);

  const row = baseRows[0] ?? {};
  const rowCount = Math.max(0, Math.round(toNumber(row.row_count) ?? 0));
  const nonNullCount = Math.max(0, Math.round(toNumber(row.non_null_count) ?? 0));

  return {
    kind: "categorical",
    rowCount,
    nonNullCount,
    distinctCount: Math.max(0, Math.round(toNumber(row.distinct_count) ?? 0)),
    nullCount: Math.max(0, Math.round(toNumber(row.null_count) ?? 0)),
    topValues: valueRows.map((value) => {
      const count = Math.max(0, Math.round(toNumber(value.bucket_count) ?? 0));
      return {
        label: String(value.label ?? "null"),
        count,
        share: nonNullCount > 0 ? (count / nonNullCount) * 100 : 0,
      };
    }),
  };
}

async function loadColumnStatistics(
  tableName: string,
  columns: ColumnProfile[],
  selectedColumnName: string,
): Promise<ColumnStatisticsResult> {
  const selectedColumn = columns.find((column) => column.name === selectedColumnName);
  if (!selectedColumn) {
    return {
      status: "empty",
      message: "Select a profiled column to inspect detailed statistics.",
    };
  }

  try {
    const detail = isNumericColumn(selectedColumn)
      ? await loadNumericStatistics(tableName, selectedColumn.name)
      : await loadCategoricalStatistics(tableName, selectedColumn.name);

    return {
      status: "ready",
      column: selectedColumn,
      detail,
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Unable to load detailed column statistics.",
    };
  }
}

function StatisticsFallback() {
  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr,1.1fr]">
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

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function ColumnStatisticsBody({
  resource,
}: {
  resource: Promise<ColumnStatisticsResult>;
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

  const { column, detail } = report;
  const nullRate = detail.rowCount > 0 ? (detail.nullCount / detail.rowCount) * 100 : 0;
  const option = buildDistributionOption(detail);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Column" value={column.name} />
        <SummaryCard label="Rows" value={formatNumber(detail.rowCount)} />
        <SummaryCard label="Null rate" value={formatPercent(nullRate, 1)} />
        <SummaryCard
          label="Distinct values"
          value={formatNumber(detail.distinctCount)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.95fr,1.05fr]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
          className={`${GLASS_CARD_CLASS} p-5`}
        >
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <Sigma className="h-4 w-4 text-cyan-500" />
            Detailed statistics
          </div>

          {detail.kind === "numeric" ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                ["Mean", formatStat(detail.mean)],
                ["Median", formatStat(detail.median)],
                ["Mode", formatStat(detail.mode)],
                ["Std dev", formatStat(detail.stdDev)],
                ["Variance", formatStat(detail.variance)],
                ["Skewness", formatStat(detail.skewness)],
                ["Kurtosis", formatStat(detail.kurtosis)],
                ["Non-null", formatNumber(detail.nonNullCount)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-3xl border border-white/20 bg-white/60 p-4 dark:bg-slate-950/30"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    {label}
                  </p>
                  <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {detail.topValues.map((value) => (
                <div
                  key={value.label}
                  className="rounded-3xl border border-white/20 bg-white/60 p-4 dark:bg-slate-950/30"
                >
                  <div className="flex items-center justify-between gap-4">
                    <p className="font-medium text-slate-950 dark:text-white">
                      {value.label}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {formatNumber(value.count)}
                    </p>
                  </div>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                    {formatPercent(value.share, 1)} of non-null values
                  </p>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: ANALYTICS_EASE, delay: 0.04 }}
          className={`${GLASS_CARD_CLASS} p-5`}
        >
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <BarChart3 className="h-4 w-4 text-cyan-500" />
            {detail.kind === "numeric" ? "Distribution histogram" : "Value counts"}
          </div>
          <div className="mt-4 h-[320px]">
            <ReactEChartsCore
              echarts={echarts}
              option={option}
              notMerge
              lazyUpdate
              style={{ height: "100%", width: "100%" }}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default function ColumnStatistics({
  tableName,
  columns,
}: ColumnStatisticsProps) {
  const [selectedColumn, setSelectedColumn] = useState<string>(
    () => columns[0]?.name ?? "",
  );
  const [refreshKey, setRefreshKey] = useState(0);

  const resource = useMemo(
    () => loadColumnStatistics(tableName, columns, selectedColumn),
    [columns, refreshKey, selectedColumn, tableName],
  );

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Database className="h-3.5 w-3.5" />
            Column statistics
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Inspect a single column with detailed statistical measures
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Switch between profiled columns to inspect numeric moments or
            categorical value counts, and compare the distribution with a
            rendered ECharts view.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="min-w-64">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Active column
            </span>
            <select
              value={selectedColumn}
              onChange={(event) =>
                startTransition(() => setSelectedColumn(event.target.value))
              }
              className={FIELD_CLASS}
            >
              {columns.map((column) => (
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

      <div className="mt-6">
        <Suspense fallback={<StatisticsFallback />}>
          <ColumnStatisticsBody resource={resource} />
        </Suspense>
      </div>
    </section>
  );
}
