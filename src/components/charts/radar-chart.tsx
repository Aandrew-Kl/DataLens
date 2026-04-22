"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
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
import { RadarChart as EChartsRadarChart } from "echarts/charts";
import {
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  Layers3,
  Loader2,
  Radar,
  RefreshCw,
  Sigma,
  Sparkles,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([EChartsRadarChart, LegendComponent, TooltipComponent, CanvasRenderer]);

interface RadarChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface RadarAxis {
  name: string;
  min: number;
  max: number;
}

interface RadarSeriesRow {
  name: string;
  normalized: number[];
  rawValues: number[];
  sampleSize: number;
}

interface RadarQueryResult {
  axes: RadarAxis[];
  series: RadarSeriesRow[];
  filteredRowCount: number;
  error: string | null;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100";
const SERIES_COLORS = ["#38bdf8", "#34d399", "#f59e0b", "#a78bfa", "#fb7185", "#2dd4bf"] as const;

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
function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatMetric(value: number) {
  return Math.abs(value) >= 1000 ? formatNumber(value) : value.toFixed(2);
}

function buildRadarOption(
  axes: RadarAxis[],
  series: RadarSeriesRow[],
  dark: boolean,
  areaFill: boolean,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";

  return {
    animationDuration: 540,
    color: [...SERIES_COLORS],
    legend: {
      top: 0,
      textStyle: { color: textColor },
    },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params;
        const payload = item as {
          seriesName?: string;
          data?: { rawValues?: number[]; sampleSize?: number };
        };
        const lines = [
          `<strong>${payload.seriesName ?? "Series"}</strong>`,
          `Rows: ${formatNumber(payload.data?.sampleSize ?? 0)}`,
        ];

        axes.forEach((axis, index) => {
          const value = payload.data?.rawValues?.[index];
          lines.push(`${axis.name}: ${typeof value === "number" ? formatMetric(value) : "—"}`);
        });

        return lines.join("<br/>");
      },
    },
    radar: {
      center: ["50%", "57%"],
      radius: "66%",
      splitNumber: 5,
      axisName: {
        color: textColor,
        fontSize: 12,
      },
      splitLine: {
        lineStyle: {
          color: dark ? "rgba(148,163,184,0.18)" : "rgba(100,116,139,0.18)",
        },
      },
      splitArea: {
        areaStyle: {
          color: dark
            ? ["rgba(15,23,42,0.5)", "rgba(15,23,42,0.72)"]
            : ["rgba(248,250,252,0.7)", "rgba(226,232,240,0.55)"],
        },
      },
      axisLine: {
        lineStyle: {
          color: dark ? "rgba(148,163,184,0.16)" : "rgba(100,116,139,0.16)",
        },
      },
      indicator: axes.map((axis) => ({
        name: axis.name,
        max: 1,
      })),
    },
    series: [
      {
        type: "radar",
        symbol: "circle",
        symbolSize: 7,
        data: series.map((entry, index) => ({
          value: entry.normalized,
          name: entry.name,
          rawValues: entry.rawValues,
          sampleSize: entry.sampleSize,
          lineStyle: {
            width: 2.5,
            color: SERIES_COLORS[index % SERIES_COLORS.length],
          },
          itemStyle: {
            color: SERIES_COLORS[index % SERIES_COLORS.length],
          },
          areaStyle: areaFill
            ? {
                opacity: 0.14,
                color: SERIES_COLORS[index % SERIES_COLORS.length],
              }
            : undefined,
        })),
      },
    ],
  };
}

async function loadRadarData(
  tableName: string,
  axes: string[],
  groupByColumn: string,
  refreshToken: number,
): Promise<RadarQueryResult> {
  void refreshToken;
  if (axes.length === 0) {
    return {
      axes: [],
      series: [],
      filteredRowCount: 0,
      error: "Choose at least one numeric axis.",
    };
  }

  const safeTable = quoteIdentifier(tableName);
  const numericChecks = axes
    .map((column) => `TRY_CAST(${quoteIdentifier(column)} AS DOUBLE) IS NOT NULL`)
    .join(" AND ");
  const numericSelect = axes
    .map(
      (column, index) =>
        `AVG(TRY_CAST(${quoteIdentifier(column)} AS DOUBLE)) AS axis_${index}`,
    )
    .join(", ");
  const groupSelect = groupByColumn
    ? `COALESCE(CAST(${quoteIdentifier(groupByColumn)} AS VARCHAR), 'Unknown') AS group_label`
    : "'Dataset average' AS group_label";
  const groupClause = groupByColumn ? "GROUP BY 1" : "";
  const orderClause = groupByColumn ? "ORDER BY row_count DESC, group_label LIMIT 8" : "";
  const groupFilter = groupByColumn ? `AND ${quoteIdentifier(groupByColumn)} IS NOT NULL` : "";

  const rows = await runQuery(`
    WITH filtered AS (
      SELECT *
      FROM ${safeTable}
      WHERE ${numericChecks}
      ${groupFilter}
    )
    SELECT
      ${groupSelect},
      ${numericSelect},
      COUNT(*) AS row_count
    FROM filtered
    ${groupClause}
    ${orderClause}
  `);

  const series = rows.flatMap<RadarSeriesRow>((row) => {
    const rawValues = axes.map((_, index) => toNumber(row[`axis_${index}`]));
    if (rawValues.some((value) => value == null)) return [];
    return [
      {
        name: String(row.group_label ?? "Group"),
        rawValues: rawValues as number[],
        normalized: [],
        sampleSize: Number(row.row_count ?? 0),
      },
    ];
  });

  if (series.length === 0) {
    return {
      axes: axes.map((axis) => ({ name: axis, min: 0, max: 0 })),
      series: [],
      filteredRowCount: 0,
      error: "No rows remain after filtering for complete numeric values.",
    };
  }

  const radarAxes = axes.map((axis, index) => {
    const values = series.map((entry) => entry.rawValues[index] ?? 0);
    return {
      name: axis,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  });

  const normalizedSeries = series.map((entry) => ({
    ...entry,
    normalized: entry.rawValues.map((value, index) => {
      const axis = radarAxes[index];
      if (!axis || axis.max === axis.min) return 1;
      return (value - axis.min) / (axis.max - axis.min);
    }),
  }));

  return {
    axes: radarAxes,
    series: normalizedSeries,
    filteredRowCount: normalizedSeries.reduce((sum, entry) => sum + entry.sampleSize, 0),
    error: null,
  };
}

function RadarChartLoading() {
  return (
    <div className={`${PANEL_CLASS} flex min-h-[28rem] items-center justify-center`}>
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading radar comparison…
      </div>
    </div>
  );
}

function AxisToggle({
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

function RadarChartReady({ tableName, columns }: RadarChartProps) {
  const dark = useDarkMode();
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const categoryColumns = useMemo(
    () =>
      columns.filter(
        (column) => column.type === "string" || column.type === "boolean",
      ),
    [columns],
  );
  const initialAxes = numericColumns.slice(0, Math.min(5, numericColumns.length)).map((column) => column.name);
  const [selectedAxes, setSelectedAxes] = useState<string[]>(initialAxes);
  const [groupByColumn, setGroupByColumn] = useState("");
  const [areaFill, setAreaFill] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);

  const effectiveAxes = selectedAxes.filter((axis) =>
    numericColumns.some((column) => column.name === axis),
  );
  const effectiveGroupBy = categoryColumns.some((column) => column.name === groupByColumn)
    ? groupByColumn
    : "";

  const dataPromise = useMemo(
    () =>
      loadRadarData(tableName, effectiveAxes, effectiveGroupBy, refreshToken).catch((error) => ({
        axes: [],
        series: [],
        filteredRowCount: 0,
        error: error instanceof Error ? error.message : "Unable to render radar chart.",
      })),
    [effectiveAxes, effectiveGroupBy, refreshToken, tableName],
  );

  const result = use(dataPromise);
  const option = useMemo(
    () => buildRadarOption(result.axes, result.series, dark, areaFill),
    [areaFill, dark, result.axes, result.series],
  );

  function toggleAxis(axisName: string) {
    startTransition(() => {
      setSelectedAxes((current) => {
        if (current.includes(axisName)) {
          return current.filter((entry) => entry !== axisName);
        }
        return [...current, axisName].slice(0, 6);
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
        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
                  <Radar className="h-3.5 w-3.5" />
                  Radar comparison
                </div>
                <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                  Overlay group performance across normalized metrics
                </h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                  Each axis is normalized from 0 to 1 using the observed min and max across the rendered groups.
                </p>
              </div>
              <button
                type="button"
                onClick={() => startTransition(() => setRefreshToken((value) => value + 1))}
                className="rounded-2xl border border-white/20 bg-white/55 px-3 py-2 text-sm text-slate-600 transition hover:border-cyan-300/40 dark:bg-slate-950/35 dark:text-slate-200"
              >
                <span className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </span>
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label
                  htmlFor="radar-chart-group-overlay"
                  className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                >
                  Group overlay
                </label>
                <select
                  id="radar-chart-group-overlay"
                  value={effectiveGroupBy}
                  onChange={(event) =>
                    startTransition(() => setGroupByColumn(event.target.value))
                  }
                  className={FIELD_CLASS}
                >
                  <option value="">Dataset average</option>
                  {categoryColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center justify-between rounded-2xl border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/35 dark:text-slate-200">
                <span className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-cyan-500" />
                  Area fill
                </span>
                <input
                  checked={areaFill}
                  onChange={(event) =>
                    startTransition(() => setAreaFill(event.target.checked))
                  }
                  type="checkbox"
                  className="h-4 w-4 rounded border-white/20 bg-white/70 text-cyan-500"
                />
              </label>
            </div>

            <div>
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <Sigma className="h-3.5 w-3.5" />
                Numeric axes
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {numericColumns.map((column) => (
                  <AxisToggle
                    key={column.name}
                    active={effectiveAxes.includes(column.name)}
                    label={column.name}
                    onToggle={() => toggleAxis(column.name)}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Active axes
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
                {effectiveAxes.length}
              </div>
            </div>
            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Series count
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
                {result.series.length}
              </div>
            </div>
            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Filtered rows
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
                {formatNumber(result.filteredRowCount)}
              </div>
            </div>
          </div>
        </div>
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
          <>
            <ReactEChartsCore
              echarts={echarts}
              option={option}
              notMerge
              lazyUpdate
              style={{ height: 520 }}
            />

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {result.series.map((entry, index) => (
                <div
                  key={entry.name}
                  className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
                    />
                    <div className="text-sm font-semibold text-slate-950 dark:text-white">
                      {entry.name}
                    </div>
                  </div>
                  <div className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    {formatNumber(entry.sampleSize)} rows
                  </div>
                  <div className="mt-3 space-y-2">
                    {result.axes.map((axis, axisIndex) => (
                      <div key={`${entry.name}-${axis.name}`} className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate text-slate-500 dark:text-slate-300">
                          {axis.name}
                        </span>
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {formatMetric(entry.rawValues[axisIndex] ?? 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </motion.section>

      {result.axes.length > 0 ? (
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: EASE }}
          className={`${PANEL_CLASS} p-5`}
        >
          <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <Layers3 className="h-3.5 w-3.5" />
            Normalization range
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {result.axes.map((axis) => (
              <div
                key={axis.name}
                className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35"
              >
                <div className="text-sm font-semibold text-slate-950 dark:text-white">
                  {axis.name}
                </div>
                <div className="mt-3 flex items-center justify-between text-sm text-slate-500 dark:text-slate-300">
                  <span>Min</span>
                  <span>{formatMetric(axis.min)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-slate-500 dark:text-slate-300">
                  <span>Max</span>
                  <span>{formatMetric(axis.max)}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.section>
      ) : null}
    </div>
  );
}

export default function RadarChart({ tableName, columns }: RadarChartProps) {
  return (
    <Suspense fallback={<RadarChartLoading />}>
      <RadarChartReady tableName={tableName} columns={columns} />
    </Suspense>
  );
}
