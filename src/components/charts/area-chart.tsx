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
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  AreaChart as AreaChartIcon,
  Layers3,
  Loader2,
  Sigma,
  SplitSquareHorizontal,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface AreaChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

type AreaAggregation = "SUM" | "AVG" | "MIN" | "MAX";

interface AggregatedRow {
  xLabel: string;
  xNumber: number | null;
  xTime: number | null;
  groupLabel: string;
  value: number;
}

interface AreaSeries {
  name: string;
  values: number[];
  total: number;
}

interface AreaChartResult {
  error: string | null;
  xLabels: string[];
  series: AreaSeries[];
  bucketCount: number;
  renderedGroups: number;
  totalValue: number;
  droppedGroups: number;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100";
const SERIES_COLORS = [
  "#38bdf8",
  "#2dd4bf",
  "#a78bfa",
  "#f59e0b",
  "#fb7185",
  "#22c55e",
  "#f97316",
] as const;
const MAX_GROUPS = 6;

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

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toTimestamp(value: unknown) {
  if (value == null) return null;
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isGroupableColumn(column: ColumnProfile) {
  if (column.type === "string" || column.type === "boolean") return true;
  return column.type === "number" && column.uniqueCount > 1 && column.uniqueCount <= 12;
}

function pickDefaultX(columns: ColumnProfile[]) {
  return (
    columns.find((column) => column.type === "date")?.name ??
    columns.find((column) => column.type === "string" || column.type === "boolean")?.name ??
    columns.find((column) => column.type === "number")?.name ??
    columns.find((column) => column.type !== "unknown")?.name ??
    ""
  );
}

async function loadAreaData(
  tableName: string,
  xColumn: string,
  xType: ColumnProfile["type"],
  yColumn: string,
  groupColumn: string,
  aggregation: AreaAggregation,
): Promise<AreaChartResult> {
  if (!xColumn || !yColumn) {
    return {
      error: "Choose both an X column and a numeric Y column.",
      xLabels: [],
      series: [],
      bucketCount: 0,
      renderedGroups: 0,
      totalValue: 0,
      droppedGroups: 0,
    };
  }

  const safeTable = quoteIdentifier(tableName);
  const safeX = quoteIdentifier(xColumn);
  const safeY = quoteIdentifier(yColumn);
  const safeGroup = groupColumn ? quoteIdentifier(groupColumn) : null;
  const groupProjection = safeGroup
    ? `COALESCE(CAST(${safeGroup} AS VARCHAR), 'Unknown') AS group_label`
    : "'All rows' AS group_label";
  const aggregationExpression = `${aggregation}(metric_value)`;

  const rows = await runQuery(`
    WITH prepared AS (
      SELECT
        CAST(${safeX} AS VARCHAR) AS x_label,
        TRY_CAST(${safeX} AS DOUBLE) AS x_number,
        TRY_CAST(${safeX} AS TIMESTAMP) AS x_time,
        ${groupProjection},
        TRY_CAST(${safeY} AS DOUBLE) AS metric_value
      FROM ${safeTable}
      WHERE ${safeX} IS NOT NULL
        AND ${safeY} IS NOT NULL
        AND TRY_CAST(${safeY} AS DOUBLE) IS NOT NULL
    )
    SELECT
      x_label,
      MIN(x_number) AS x_number,
      MIN(x_time) AS x_time,
      group_label,
      ${aggregationExpression} AS metric_value
    FROM prepared
    GROUP BY 1, 4
    HAVING ${aggregationExpression} IS NOT NULL
  `);

  const parsedRows = rows.flatMap<AggregatedRow>((row) => {
    const xLabel = String(row.x_label ?? "");
    const groupLabel = String(row.group_label ?? "All rows");
    const value = toNumber(row.metric_value);
    if (!xLabel || !groupLabel || value == null) return [];
    return [
      {
        xLabel,
        xNumber: toNumber(row.x_number),
        xTime: toTimestamp(row.x_time),
        groupLabel,
        value,
      },
    ];
  });

  if (parsedRows.length === 0) {
    return {
      error: "The selected columns did not produce any numeric area data.",
      xLabels: [],
      series: [],
      bucketCount: 0,
      renderedGroups: 0,
      totalValue: 0,
      droppedGroups: 0,
    };
  }

  const groupTotals = new Map<string, number>();
  const xTotals = new Map<string, number>();
  const xMeta = new Map<string, { xNumber: number | null; xTime: number | null }>();

  for (const row of parsedRows) {
    groupTotals.set(row.groupLabel, (groupTotals.get(row.groupLabel) ?? 0) + row.value);
    xTotals.set(row.xLabel, (xTotals.get(row.xLabel) ?? 0) + row.value);
    if (!xMeta.has(row.xLabel)) {
      xMeta.set(row.xLabel, { xNumber: row.xNumber, xTime: row.xTime });
    }
  }

  const sortedGroups = [...groupTotals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name]) => name);
  const keptGroups = groupColumn ? sortedGroups.slice(0, MAX_GROUPS) : sortedGroups;
  const droppedGroups = groupColumn ? Math.max(sortedGroups.length - keptGroups.length, 0) : 0;

  const rowsByGroup = new Map<string, AggregatedRow[]>();
  for (const row of parsedRows) {
    const targetGroup =
      keptGroups.includes(row.groupLabel) || !groupColumn ? row.groupLabel : "Other";
    const bucket = rowsByGroup.get(targetGroup) ?? [];
    bucket.push({ ...row, groupLabel: targetGroup });
    rowsByGroup.set(targetGroup, bucket);
  }

  const sortedXLabels = [...xTotals.keys()].sort((left, right) => {
    const leftMeta = xMeta.get(left);
    const rightMeta = xMeta.get(right);

    if (xType === "date") {
      const delta = (leftMeta?.xTime ?? Number.POSITIVE_INFINITY) - (rightMeta?.xTime ?? Number.POSITIVE_INFINITY);
      if (delta !== 0) return delta;
    }

    if (xType === "number") {
      const delta = (leftMeta?.xNumber ?? Number.POSITIVE_INFINITY) - (rightMeta?.xNumber ?? Number.POSITIVE_INFINITY);
      if (delta !== 0) return delta;
    }

    if (xType === "string" || xType === "boolean") {
      const totalDelta = (xTotals.get(right) ?? 0) - (xTotals.get(left) ?? 0);
      if (totalDelta !== 0) return totalDelta;
    }

    return left.localeCompare(right);
  });

  const maxBuckets = xType === "date" || xType === "number" ? 48 : 18;
  const keptXLabels = sortedXLabels.slice(0, maxBuckets);
  const xIndex = new Map(keptXLabels.map((label, index) => [label, index]));

  const series = [...rowsByGroup.entries()]
    .map<AreaSeries>(([groupName, groupRows]) => {
      const values = new Array(keptXLabels.length).fill(0);
      let total = 0;

      for (const row of groupRows) {
        const index = xIndex.get(row.xLabel);
        if (index == null) continue;
        values[index] += row.value;
        total += row.value;
      }

      return { name: groupName, values, total };
    })
    .filter((entry) => entry.total > 0)
    .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name));

  return {
    error: series.length === 0 ? "The selected configuration collapsed to empty buckets." : null,
    xLabels: keptXLabels,
    series,
    bucketCount: keptXLabels.length,
    renderedGroups: series.length,
    totalValue: series.reduce((sum, entry) => sum + entry.total, 0),
    droppedGroups,
  };
}

function buildAreaOption(
  result: AreaChartResult,
  dark: boolean,
  stacked: boolean,
  aggregation: AreaAggregation,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";

  return {
    animationDuration: 520,
    color: [...SERIES_COLORS],
    legend: {
      top: 0,
      textStyle: { color: textColor },
      pageTextStyle: { color: textColor },
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const items = Array.isArray(params)
          ? (params as Array<{
              axisValue?: string;
              marker?: string;
              seriesName?: string;
              value?: number;
            }>)
          : [];
        if (items.length === 0) return "";
        const lines = [`<strong>${items[0]?.axisValue ?? ""}</strong>`];
        let total = 0;
        for (const item of items) {
          const value = Number(item.value ?? 0);
          total += value;
          lines.push(`${item.marker ?? ""}${item.seriesName ?? "Series"}: ${formatNumber(value)}`);
        }
        if (stacked) {
          lines.push(`<span style="opacity:0.8">Stacked total: ${formatNumber(total)}</span>`);
        }
        lines.push(`<span style="opacity:0.8">${aggregation} aggregation</span>`);
        return lines.join("<br/>");
      },
    },
    grid: {
      left: 28,
      right: 24,
      top: 48,
      bottom: 36,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: result.xLabels,
      boundaryGap: false,
      axisLabel: {
        color: textColor,
        rotate: result.xLabels.length > 10 ? 28 : 0,
      },
      axisLine: {
        lineStyle: { color: borderColor },
      },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: {
        lineStyle: {
          color: dark ? "rgba(148,163,184,0.16)" : "rgba(148,163,184,0.24)",
          type: "dashed",
        },
      },
    },
    series: result.series.map((entry, index) => {
      const color = SERIES_COLORS[index % SERIES_COLORS.length];
      return {
        name: entry.name,
        type: "line",
        stack: stacked ? "total" : undefined,
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        sampling: "lttb",
        emphasis: { focus: "series" },
        lineStyle: {
          width: 2.5,
          color,
        },
        itemStyle: {
          color,
          borderColor: dark ? "#020617" : "#ffffff",
          borderWidth: 1.5,
        },
        areaStyle: {
          opacity: stacked ? 0.32 : 0.2,
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: `${color}D9` },
            { offset: 1, color: `${color}14` },
          ]),
        },
        data: entry.values,
      };
    }),
  };
}

function AreaChartLoading() {
  return (
    <div className={`${PANEL_CLASS} flex min-h-[30rem] items-center justify-center`}>
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading stacked area chart…
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">{value}</div>
    </div>
  );
}

function AreaChartReady({ tableName, columns }: AreaChartProps) {
  const dark = useDarkMode();
  const dimensionColumns = useMemo(
    () => columns.filter((column) => column.type !== "unknown"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const groupableColumns = useMemo(
    () => columns.filter(isGroupableColumn),
    [columns],
  );

  const [xColumn, setXColumn] = useState(() => pickDefaultX(columns));
  const [yColumn, setYColumn] = useState(() => columns.find((column) => column.type === "number")?.name ?? "");
  const [groupColumn, setGroupColumn] = useState("");
  const [stacked, setStacked] = useState(true);
  const [aggregation, setAggregation] = useState<AreaAggregation>("SUM");

  const safeX =
    dimensionColumns.find((column) => column.name === xColumn)?.name ??
    pickDefaultX(dimensionColumns);
  const safeY =
    numericColumns.find((column) => column.name === yColumn)?.name ??
    numericColumns[0]?.name ??
    "";
  const safeGroup =
    groupableColumns.find((column) => column.name === groupColumn && column.name !== safeX)?.name ??
    "";
  const xType =
    dimensionColumns.find((column) => column.name === safeX)?.type ?? "string";

  const dataPromise = useMemo(
    () =>
      loadAreaData(tableName, safeX, xType, safeY, safeGroup, aggregation).catch((error) => ({
        error: error instanceof Error ? error.message : "Unable to render the area chart.",
        xLabels: [],
        series: [],
        bucketCount: 0,
        renderedGroups: 0,
        totalValue: 0,
        droppedGroups: 0,
      })),
    [aggregation, safeGroup, safeX, safeY, tableName, xType],
  );

  const result = use(dataPromise);
  const option = useMemo(
    () => buildAreaOption(result, dark, stacked, aggregation),
    [aggregation, dark, result, stacked],
  );

  if (dimensionColumns.length === 0 || numericColumns.length === 0) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.34, ease: EASE }}
        className={`${PANEL_CLASS} p-6`}
      >
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
          <AreaChartIcon className="h-8 w-8 text-slate-400 dark:text-slate-500" />
          <div className="space-y-2">
            <p className="text-lg font-semibold text-slate-900 dark:text-white">
              Area chart needs one dimension and one numeric measure
            </p>
            <p className="max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Add a numeric column for the Y-axis and at least one non-unknown column
              for the X-axis.
            </p>
          </div>
        </div>
      </motion.section>
    );
  }

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: EASE }}
        className={`${PANEL_CLASS} p-5`}
      >
        <div className="grid gap-4 xl:grid-cols-[1.16fr_0.84fr]">
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
                <AreaChartIcon className="h-3.5 w-3.5" />
                Stacked area
              </div>
              <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                Layer numeric movement across one shared X-axis
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                DuckDB aggregates the metric, then ECharts renders stacked or
                independent gradients for each group.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  X-axis
                </label>
                <select
                  value={safeX}
                  onChange={(event) => startTransition(() => setXColumn(event.target.value))}
                  className={FIELD_CLASS}
                >
                  {dimensionColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Y-axis
                </label>
                <select
                  value={safeY}
                  onChange={(event) => startTransition(() => setYColumn(event.target.value))}
                  className={FIELD_CLASS}
                >
                  {numericColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Grouping
                </label>
                <select
                  value={safeGroup}
                  onChange={(event) => startTransition(() => setGroupColumn(event.target.value))}
                  className={FIELD_CLASS}
                >
                  <option value="">No grouping</option>
                  {groupableColumns
                    .filter((column) => column.name !== safeX)
                    .map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Aggregation
                </label>
                <select
                  value={aggregation}
                  onChange={(event) =>
                    startTransition(() => setAggregation(event.target.value as AreaAggregation))
                  }
                  className={FIELD_CLASS}
                >
                  <option value="SUM">SUM</option>
                  <option value="AVG">AVG</option>
                  <option value="MIN">MIN</option>
                  <option value="MAX">MAX</option>
                </select>
              </div>
            </div>

            <label className="flex items-center justify-between rounded-3xl border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/35 dark:text-slate-200">
              <span className="flex items-center gap-2">
                <Layers3 className="h-4 w-4 text-cyan-500" />
                Stacked mode
              </span>
              <input
                type="checkbox"
                checked={stacked}
                onChange={(event) => startTransition(() => setStacked(event.target.checked))}
                className="h-4 w-4 rounded border-white/20 bg-white/70 text-cyan-500"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <MetricCard label="Buckets" value={formatNumber(result.bucketCount)} />
            <MetricCard label="Series" value={formatNumber(result.renderedGroups)} />
            <MetricCard label="Total metric" value={formatNumber(result.totalValue)} />
          </div>
        </div>

        {result.droppedGroups > 0 ? (
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
            <SplitSquareHorizontal className="h-4 w-4" />
            Collapsed {formatNumber(result.droppedGroups)} low-volume group
            {result.droppedGroups === 1 ? "" : "s"} into the chart limit.
          </div>
        ) : null}
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
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

      {result.series.length > 0 ? (
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: EASE }}
          className={`${PANEL_CLASS} p-5`}
        >
          <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <Sigma className="h-3.5 w-3.5" />
            Series totals
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {result.series.map((series, index) => (
              <div
                key={series.name}
                className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
                  />
                  <div className="truncate text-sm font-semibold text-slate-950 dark:text-white">
                    {series.name}
                  </div>
                </div>
                <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
                  {formatNumber(series.total)}
                </div>
              </div>
            ))}
          </div>
        </motion.section>
      ) : null}
    </div>
  );
}

export default function AreaChart({ tableName, columns }: AreaChartProps) {
  return (
    <Suspense fallback={<AreaChartLoading />}>
      <AreaChartReady tableName={tableName} columns={columns} />
    </Suspense>
  );
}
