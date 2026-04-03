"use client";

import {
  Suspense,
  startTransition,
  use,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import {
  BoxplotChart as EChartsBoxplotChart,
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
  BoxSelect,
  Loader2,
  ScatterChart as ScatterIcon,
  Sigma,
  SplitSquareVertical,
  Waypoints,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  EChartsBoxplotChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface BoxplotChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

type Orientation = "vertical" | "horizontal";

interface BoxplotStat {
  metric: string;
  group: string;
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  rawMin: number;
  rawMax: number;
  mean: number;
  rowCount: number;
  outlierCount: number;
}

interface PlotPoint {
  label: string;
  metric: string;
  group: string;
  value: number;
  kind: "outlier" | "sample";
}

interface BoxplotResult {
  stats: BoxplotStat[];
  outliers: PlotPoint[];
  samplePoints: PlotPoint[];
  totalRows: number;
  error: string | null;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100";

function subscribeDarkMode(listener: () => void) {
  if (typeof document === "undefined") return () => undefined;
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getDarkModeSnapshot() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

function useDarkMode() {
  return useSyncExternalStore(subscribeDarkMode, getDarkModeSnapshot, () => false);
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function deterministicJitter(index: number) {
  return ((index % 11) - 5) * 0.06;
}

async function loadBoxplotData(
  tableName: string,
  selectedMetrics: string[],
  groupByColumn: string,
  showPoints: boolean,
): Promise<BoxplotResult> {
  if (selectedMetrics.length === 0) {
    return {
      stats: [],
      outliers: [],
      samplePoints: [],
      totalRows: 0,
      error: "Choose at least one numeric column to render a box plot.",
    };
  }

  const safeTable = quoteIdentifier(tableName);
  const groupExpression = groupByColumn
    ? `COALESCE(CAST(${quoteIdentifier(groupByColumn)} AS VARCHAR), 'Unknown')`
    : "'All rows'";
  const groupFilter = groupByColumn ? `AND ${quoteIdentifier(groupByColumn)} IS NOT NULL` : "";
  const baseSql = selectedMetrics
    .map(
      (metric) => `
        SELECT
          ${quoteLiteral(metric)} AS metric_name,
          ${groupExpression} AS group_label,
          TRY_CAST(${quoteIdentifier(metric)} AS DOUBLE) AS metric_value
        FROM ${safeTable}
        WHERE ${quoteIdentifier(metric)} IS NOT NULL
          AND TRY_CAST(${quoteIdentifier(metric)} AS DOUBLE) IS NOT NULL
          ${groupFilter}
      `,
    )
    .join(" UNION ALL ");

  const scopedBase = `
    WITH base AS (${baseSql}),
    group_rank AS (
      SELECT group_label
      FROM base
      GROUP BY 1
      ORDER BY COUNT(*) DESC, group_label
      LIMIT ${groupByColumn ? 8 : 1}
    ),
    scoped AS (
      SELECT *
      FROM base
      WHERE group_label IN (SELECT group_label FROM group_rank)
    ),
    stats AS (
      SELECT
        metric_name,
        group_label,
        COUNT(*) AS row_count,
        AVG(metric_value) AS mean_value,
        QUANTILE_CONT(metric_value, 0.25) AS q1_value,
        QUANTILE_CONT(metric_value, 0.5) AS median_value,
        QUANTILE_CONT(metric_value, 0.75) AS q3_value,
        MIN(metric_value) AS raw_min,
        MAX(metric_value) AS raw_max
      FROM scoped
      GROUP BY 1, 2
    ),
    whiskers AS (
      SELECT
        stats.metric_name,
        stats.group_label,
        stats.row_count,
        stats.mean_value,
        stats.q1_value,
        stats.median_value,
        stats.q3_value,
        stats.raw_min,
        stats.raw_max,
        MIN(
          CASE
            WHEN scoped.metric_value >= stats.q1_value - 1.5 * (stats.q3_value - stats.q1_value)
            THEN scoped.metric_value
            ELSE NULL
          END
        ) AS whisker_min,
        MAX(
          CASE
            WHEN scoped.metric_value <= stats.q3_value + 1.5 * (stats.q3_value - stats.q1_value)
            THEN scoped.metric_value
            ELSE NULL
          END
        ) AS whisker_max
      FROM stats
      JOIN scoped
        ON scoped.metric_name = stats.metric_name
       AND scoped.group_label = stats.group_label
      GROUP BY
        stats.metric_name,
        stats.group_label,
        stats.row_count,
        stats.mean_value,
        stats.q1_value,
        stats.median_value,
        stats.q3_value,
        stats.raw_min,
        stats.raw_max
    ),
    outliers AS (
      SELECT
        scoped.metric_name,
        scoped.group_label,
        scoped.metric_value,
        ABS(scoped.metric_value - whiskers.median_value) AS distance,
        ROW_NUMBER() OVER (
          PARTITION BY scoped.metric_name, scoped.group_label
          ORDER BY ABS(scoped.metric_value - whiskers.median_value) DESC, scoped.metric_value DESC
        ) AS outlier_rank
      FROM scoped
      JOIN whiskers
        ON whiskers.metric_name = scoped.metric_name
       AND whiskers.group_label = scoped.group_label
      WHERE scoped.metric_value < whiskers.q1_value - 1.5 * (whiskers.q3_value - whiskers.q1_value)
         OR scoped.metric_value > whiskers.q3_value + 1.5 * (whiskers.q3_value - whiskers.q1_value)
    )
  `;

  const summaryRows = await runQuery(`
    ${scopedBase}
    SELECT
      whiskers.metric_name,
      whiskers.group_label,
      whiskers.row_count,
      whiskers.mean_value,
      whiskers.q1_value,
      whiskers.median_value,
      whiskers.q3_value,
      whiskers.raw_min,
      whiskers.raw_max,
      COALESCE(whiskers.whisker_min, whiskers.raw_min) AS whisker_min,
      COALESCE(whiskers.whisker_max, whiskers.raw_max) AS whisker_max,
      COALESCE(outlier_counts.outlier_count, 0) AS outlier_count
    FROM whiskers
    LEFT JOIN (
      SELECT metric_name, group_label, COUNT(*) AS outlier_count
      FROM outliers
      GROUP BY 1, 2
    ) AS outlier_counts
      ON outlier_counts.metric_name = whiskers.metric_name
     AND outlier_counts.group_label = whiskers.group_label
    ORDER BY whiskers.metric_name, whiskers.group_label
  `);

  const outlierRows = await runQuery(`
    ${scopedBase}
    SELECT
      metric_name,
      group_label,
      metric_value
    FROM outliers
    WHERE outlier_rank <= 18
    ORDER BY metric_name, group_label, metric_value
  `);

  const sampleRows = showPoints
    ? await runQuery(`
        ${scopedBase}
        SELECT
          metric_name,
          group_label,
          metric_value
        FROM (
          SELECT
            scoped.metric_name,
            scoped.group_label,
            scoped.metric_value,
            ROW_NUMBER() OVER (
              PARTITION BY scoped.metric_name, scoped.group_label
              ORDER BY RANDOM()
            ) AS sample_rank
          FROM scoped
        ) AS samples
        WHERE sample_rank <= 42
        ORDER BY metric_name, group_label
      `)
    : [];

  const stats = summaryRows.map((row) => {
    const metric = String(row.metric_name ?? "Metric");
    const group = String(row.group_label ?? "All rows");
    return {
      metric,
      group,
      label: groupByColumn ? `${group} • ${metric}` : metric,
      min: toNumber(row.whisker_min),
      q1: toNumber(row.q1_value),
      median: toNumber(row.median_value),
      q3: toNumber(row.q3_value),
      max: toNumber(row.whisker_max),
      rawMin: toNumber(row.raw_min),
      rawMax: toNumber(row.raw_max),
      mean: toNumber(row.mean_value),
      rowCount: Number(row.row_count ?? 0),
      outlierCount: Number(row.outlier_count ?? 0),
    } satisfies BoxplotStat;
  });

  const outliers = outlierRows.map((row) => {
    const metric = String(row.metric_name ?? "Metric");
    const group = String(row.group_label ?? "All rows");
    return {
      metric,
      group,
      label: groupByColumn ? `${group} • ${metric}` : metric,
      value: toNumber(row.metric_value),
      kind: "outlier",
    } satisfies PlotPoint;
  });

  const samplePoints = sampleRows.map((row) => {
    const metric = String(row.metric_name ?? "Metric");
    const group = String(row.group_label ?? "All rows");
    return {
      metric,
      group,
      label: groupByColumn ? `${group} • ${metric}` : metric,
      value: toNumber(row.metric_value),
      kind: "sample",
    } satisfies PlotPoint;
  });

  if (stats.length === 0) {
    return {
      stats: [],
      outliers: [],
      samplePoints: [],
      totalRows: 0,
      error: "The selected columns do not contain enough numeric values for a box plot.",
    };
  }

  return {
    stats,
    outliers,
    samplePoints,
    totalRows: stats.reduce((sum, stat) => sum + stat.rowCount, 0),
    error: null,
  };
}

function buildBoxplotOption(
  result: BoxplotResult,
  dark: boolean,
  orientation: Orientation,
  showPoints: boolean,
): EChartsOption {
  const labels = result.stats.map((stat) => stat.label);
  const labelIndex = new Map(labels.map((label, index) => [label, index]));
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const vertical = orientation === "vertical";

  const boxSeries = result.stats.map((stat) => ({
    name: stat.label,
    value: [stat.min, stat.q1, stat.median, stat.q3, stat.max],
    details: stat,
  }));

  const outlierSeries = result.outliers.map((point, index) => {
    const categoryIndex = labelIndex.get(point.label) ?? 0;
    return vertical
      ? [categoryIndex + deterministicJitter(index), point.value, point.label]
      : [point.value, categoryIndex + deterministicJitter(index), point.label];
  });

  const sampleSeries = result.samplePoints.map((point, index) => {
    const categoryIndex = labelIndex.get(point.label) ?? 0;
    return vertical
      ? [categoryIndex + deterministicJitter(index), point.value, point.label]
      : [point.value, categoryIndex + deterministicJitter(index), point.label];
  });

  return {
    animationDuration: 540,
    legend: {
      top: 0,
      textStyle: { color: textColor },
    },
    grid: {
      left: vertical ? 52 : 132,
      right: 24,
      top: 42,
      bottom: vertical ? 62 : 40,
      containLabel: true,
    },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params;
        const payload = item as {
          seriesType?: string;
          seriesName?: string;
          data?: {
            details?: BoxplotStat;
          };
          value?: [number, number, string];
        };

        if (payload.seriesType === "boxplot" && payload.data?.details) {
          const stat = payload.data.details;
          return [
            `<strong>${stat.label}</strong>`,
            `Median: ${formatNumber(stat.median)}`,
            `Q1 / Q3: ${formatNumber(stat.q1)} / ${formatNumber(stat.q3)}`,
            `Whisker min / max: ${formatNumber(stat.min)} / ${formatNumber(stat.max)}`,
            `Raw min / max: ${formatNumber(stat.rawMin)} / ${formatNumber(stat.rawMax)}`,
            `Mean: ${formatNumber(stat.mean)}`,
            `Rows: ${formatNumber(stat.rowCount)}`,
            `Outliers: ${formatNumber(stat.outlierCount)}`,
          ].join("<br/>");
        }

        const value = payload.value?.[vertical ? 1 : 0] ?? 0;
        const label = String(payload.value?.[2] ?? payload.seriesName ?? "Point");
        return [
          `<strong>${label}</strong>`,
          `${payload.seriesName ?? "Point"}: ${formatNumber(Number(value))}`,
        ].join("<br/>");
      },
    },
    xAxis: vertical
      ? {
          type: "category",
          data: labels,
          axisLabel: {
            color: textColor,
            rotate: labels.length > 5 ? 26 : 0,
          },
          axisLine: { lineStyle: { color: borderColor } },
        }
      : {
          type: "value",
          axisLabel: { color: textColor },
          splitLine: {
            lineStyle: { color: borderColor, type: "dashed" },
          },
        },
    yAxis: vertical
      ? {
          type: "value",
          axisLabel: { color: textColor },
          splitLine: {
            lineStyle: { color: borderColor, type: "dashed" },
          },
        }
      : {
          type: "category",
          data: labels,
          axisLabel: { color: textColor },
          axisLine: { lineStyle: { color: borderColor } },
        },
    series: [
      {
        name: "Box plot",
        type: "boxplot" as const,
        itemStyle: {
          color: "rgba(56,189,248,0.35)",
          borderColor: "#06b6d4",
          borderWidth: 1.5,
        },
        emphasis: {
          itemStyle: {
            color: "rgba(56,189,248,0.55)",
          },
        },
        data: boxSeries,
      },
      {
        name: "Outliers",
        type: "scatter" as const,
        symbolSize: 10,
        itemStyle: {
          color: "#f97316",
          opacity: 0.9,
        },
        data: outlierSeries,
      },
      ...(showPoints
        ? [
            {
              name: "Sample points",
              type: "scatter" as const,
              symbolSize: 6,
              itemStyle: {
                color: "#a78bfa",
                opacity: 0.38,
              },
              data: sampleSeries,
            },
          ]
        : []),
    ],
  };
}

function BoxplotLoading() {
  return (
    <div className={`${PANEL_CLASS} flex min-h-[28rem] items-center justify-center`}>
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading box plot…
      </div>
    </div>
  );
}

function MetricToggle({
  active,
  label,
  onToggle,
}: {
  active: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-2xl border px-3 py-2 text-left text-sm transition ${
        active
          ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-700 dark:text-cyan-200"
          : "border-white/15 bg-white/45 text-slate-600 hover:border-cyan-300/40 dark:bg-slate-950/35 dark:text-slate-300"
      }`}
    >
      {label}
    </button>
  );
}

function BoxplotChartReady({ tableName, columns }: BoxplotChartProps) {
  const dark = useDarkMode();
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const categoryColumns = useMemo(
    () =>
      columns.filter(
        (column) =>
          column.type === "string" ||
          column.type === "boolean" ||
          column.type === "date" ||
          column.type === "unknown",
      ),
    [columns],
  );
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(
    numericColumns.slice(0, Math.min(3, numericColumns.length)).map((column) => column.name),
  );
  const [groupByColumn, setGroupByColumn] = useState("");
  const [orientation, setOrientation] = useState<Orientation>("vertical");
  const [showPoints, setShowPoints] = useState(true);

  const effectiveMetrics = selectedMetrics.filter((metric) =>
    numericColumns.some((column) => column.name === metric),
  );
  const safeGroupBy = categoryColumns.some((column) => column.name === groupByColumn)
    ? groupByColumn
    : "";

  const dataPromise = useMemo(
    () =>
      loadBoxplotData(tableName, effectiveMetrics, safeGroupBy, showPoints).catch(
        (error) => ({
          stats: [],
          outliers: [],
          samplePoints: [],
          totalRows: 0,
          error:
            error instanceof Error
              ? error.message
              : "Unable to render box plot.",
        }),
      ),
    [effectiveMetrics, safeGroupBy, showPoints, tableName],
  );

  const result = use(dataPromise);
  const option = useMemo(
    () => buildBoxplotOption(result, dark, orientation, showPoints),
    [dark, orientation, result, showPoints],
  );

  function toggleMetric(metricName: string) {
    startTransition(() => {
      setSelectedMetrics((current) => {
        if (current.includes(metricName)) {
          return current.filter((entry) => entry !== metricName);
        }
        return [...current, metricName].slice(0, 6);
      });
    });
  }

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: EASE }}
        className={`${PANEL_CLASS} p-5`}
      >
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
                <BoxSelect className="h-3.5 w-3.5" />
                Box plot diagnostics
              </div>
              <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                Compare median, quartiles, whiskers, and outliers
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Five-number summaries are computed in DuckDB. Outliers use the 1.5×IQR
                rule and sample points can be overlaid for texture.
              </p>
            </div>

            <div>
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <Sigma className="h-3.5 w-3.5" />
                Numeric measures
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {numericColumns.map((column) => (
                  <MetricToggle
                    key={column.name}
                    active={effectiveMetrics.includes(column.name)}
                    label={column.name}
                    onToggle={() => toggleMetric(column.name)}
                  />
                ))}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Group by
                </label>
                <select
                  value={safeGroupBy}
                  onChange={(event) =>
                    startTransition(() => setGroupByColumn(event.target.value))
                  }
                  className={FIELD_CLASS}
                >
                  <option value="">No grouping</option>
                  {categoryColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Orientation
                </label>
                <select
                  value={orientation}
                  onChange={(event) =>
                    startTransition(() => setOrientation(event.target.value as Orientation))
                  }
                  className={FIELD_CLASS}
                >
                  <option value="vertical">Vertical</option>
                  <option value="horizontal">Horizontal</option>
                </select>
              </div>

              <label className="flex items-center justify-between rounded-2xl border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/35 dark:text-slate-200">
                <span>Overlay points</span>
                <input
                  checked={showPoints}
                  onChange={(event) =>
                    startTransition(() => setShowPoints(event.target.checked))
                  }
                  type="checkbox"
                  className="h-4 w-4 rounded border-white/20 bg-white/70 text-cyan-500"
                />
              </label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <Sigma className="h-3.5 w-3.5" />
                Groups rendered
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
                {result.stats.length}
              </div>
            </div>

            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <ScatterIcon className="h-3.5 w-3.5" />
                Outliers
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
                {result.outliers.length}
              </div>
            </div>

            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <Waypoints className="h-3.5 w-3.5" />
                Rows profiled
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
                {formatNumber(result.totalRows)}
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: EASE }}
        className={`${PANEL_CLASS} p-5`}
      >
        {result.error ? (
          <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 px-4 py-5 text-sm text-rose-700 dark:text-rose-300">
            {result.error}
          </div>
        ) : (
          <ReactEChartsCore
            echarts={echarts}
            option={option}
            notMerge
            lazyUpdate
            style={{ height: 560 }}
          />
        )}
      </motion.section>

      {result.stats.length > 0 ? (
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.48, ease: EASE }}
          className={`${PANEL_CLASS} p-5`}
        >
          <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <SplitSquareVertical className="h-3.5 w-3.5" />
            Statistical summary
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {result.stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35"
              >
                <div className="text-sm font-semibold text-slate-950 dark:text-white">
                  {stat.label}
                </div>
                <div className="mt-3 grid gap-2 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                  <div>Median: {formatNumber(stat.median)}</div>
                  <div>Mean: {formatNumber(stat.mean)}</div>
                  <div>Q1: {formatNumber(stat.q1)}</div>
                  <div>Q3: {formatNumber(stat.q3)}</div>
                  <div>Min / Max: {formatNumber(stat.min)} / {formatNumber(stat.max)}</div>
                  <div>Outliers: {formatNumber(stat.outlierCount)}</div>
                </div>
              </div>
            ))}
          </div>
        </motion.section>
      ) : null}
    </div>
  );
}

export default function BoxplotChart({ tableName, columns }: BoxplotChartProps) {
  return (
    <Suspense fallback={<BoxplotLoading />}>
      <BoxplotChartReady tableName={tableName} columns={columns} />
    </Suspense>
  );
}
