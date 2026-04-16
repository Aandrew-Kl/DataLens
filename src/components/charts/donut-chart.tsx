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
import { PieChart } from "echarts/charts";
import { LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  CircleDashed,
  Donut,
  Loader2,
  Percent,
  Tags,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([PieChart, LegendComponent, TooltipComponent, CanvasRenderer]);

interface DonutChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

type DonutLabelMode =
  | "name"
  | "percent"
  | "value"
  | "name-percent"
  | "name-value";

interface DonutSlice {
  name: string;
  value: number;
  share: number;
}

interface DonutChartResult {
  slices: DonutSlice[];
  total: number;
  error: string | null;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100";
const SLICE_COLORS = [
  "#38bdf8",
  "#2dd4bf",
  "#f59e0b",
  "#a78bfa",
  "#fb7185",
  "#22c55e",
  "#f97316",
  "#818cf8",
  "#14b8a6",
  "#eab308",
] as const;

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

function isCategoryColumn(column: ColumnProfile) {
  if (column.type === "string" || column.type === "boolean") return true;
  return column.uniqueCount > 1 && column.uniqueCount <= 20;
}

function buildLabelText(
  item: { name: string; value: number; percent: number },
  mode: DonutLabelMode,
) {
  const percent = `${item.percent.toFixed(1)}%`;
  switch (mode) {
    case "name":
      return item.name;
    case "percent":
      return percent;
    case "value":
      return formatNumber(item.value);
    case "name-value":
      return `${item.name}\n${formatNumber(item.value)}`;
    default:
      return `${item.name}\n${percent}`;
  }
}

async function loadDonutData(
  tableName: string,
  categoryColumn: string,
  valueColumn: string,
): Promise<DonutChartResult> {
  if (!categoryColumn || !valueColumn) {
    return { slices: [], total: 0, error: "Choose a category column and a numeric value column." };
  }

  const safeTable = quoteIdentifier(tableName);
  const safeCategory = quoteIdentifier(categoryColumn);
  const useCount = valueColumn === "__count__";
  const safeValue = useCount ? null : quoteIdentifier(valueColumn);

  const rows = await runQuery(`
    WITH grouped AS (
      SELECT
        COALESCE(CAST(${safeCategory} AS VARCHAR), 'Unknown') AS category_label,
        ${useCount ? "COUNT(*)" : `SUM(TRY_CAST(${safeValue} AS DOUBLE))`} AS metric_value
      FROM ${safeTable}
      WHERE ${safeCategory} IS NOT NULL
        ${useCount ? "" : `AND ${safeValue} IS NOT NULL AND TRY_CAST(${safeValue} AS DOUBLE) IS NOT NULL`}
      GROUP BY 1
    )
    SELECT category_label, metric_value
    FROM grouped
    WHERE metric_value IS NOT NULL
    ORDER BY metric_value DESC, category_label
  `);

  const parsed = rows
    .flatMap<Pick<DonutSlice, "name" | "value">>((row) => {
      const name = String(row.category_label ?? "");
      const value = toNumber(row.metric_value);
      if (!name || value == null || value <= 0) return [];
      return [{ name, value }];
    });

  if (parsed.length === 0) {
    return {
      slices: [],
      total: 0,
      error: "The selected configuration produced no positive slices.",
    };
  }

  const topSlices = parsed.slice(0, 8);
  const otherValue = parsed.slice(8).reduce((sum, item) => sum + item.value, 0);
  const merged = otherValue > 0 ? [...topSlices, { name: "Other", value: otherValue }] : topSlices;
  const total = merged.reduce((sum, item) => sum + item.value, 0);

  return {
    slices: merged.map((item) => ({
      ...item,
      share: total === 0 ? 0 : (item.value / total) * 100,
    })),
    total,
    error: null,
  };
}

function buildDonutOption(
  result: DonutChartResult,
  dark: boolean,
  innerRadius: number,
  labelMode: DonutLabelMode,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#0f172a" : "#ffffff";

  return {
    animationDuration: 520,
    color: [...SLICE_COLORS],
    legend: {
      orient: "vertical",
      right: 8,
      top: "middle",
      type: "scroll",
      textStyle: { color: textColor },
      pageTextStyle: { color: textColor },
    },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const item = params as { name?: string; value?: number; percent?: number };
        return [
          `<strong>${item.name ?? "Slice"}</strong>`,
          `Value: ${formatNumber(Number(item.value ?? 0))}`,
          `Share: ${(Number(item.percent ?? 0)).toFixed(1)}%`,
        ].join("<br/>");
      },
    },
    series: [
      {
        type: "pie",
        radius: [`${innerRadius}%`, "78%"],
        center: ["38%", "52%"],
        avoidLabelOverlap: true,
        selectedMode: "single",
        minAngle: 4,
        stillShowZeroSum: false,
        itemStyle: {
          borderColor,
          borderWidth: 2,
          borderRadius: 10,
        },
        emphasis: {
          focus: "self",
          scale: true,
          scaleSize: 12,
          itemStyle: {
            shadowBlur: 22,
            shadowColor: dark ? "rgba(15,23,42,0.65)" : "rgba(15,23,42,0.22)",
          },
        },
        label: {
          show: true,
          color: textColor,
          fontSize: 11,
          formatter: (params: unknown) => {
            const item = params as { name?: string; value?: number; percent?: number };
            return buildLabelText(
              {
                name: String(item.name ?? "Slice"),
                value: Number(item.value ?? 0),
                percent: Number(item.percent ?? 0),
              },
              labelMode,
            );
          },
        },
        labelLine: {
          lineStyle: { color: dark ? "#475569" : "#94a3b8" },
        },
        data: result.slices.map((slice) => ({
          name: slice.name,
          value: slice.value,
        })),
      },
    ],
  };
}

function DonutChartLoading() {
  return (
    <div className={`${PANEL_CLASS} flex min-h-[30rem] items-center justify-center`}>
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading donut chart…
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

function DonutChartReady({ tableName, columns }: DonutChartProps) {
  const dark = useDarkMode();
  const categoryColumns = useMemo(
    () => columns.filter(isCategoryColumn),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );

  const [categoryColumn, setCategoryColumn] = useState(() => categoryColumns[0]?.name ?? "");
  const [valueColumn, setValueColumn] = useState("__count__");
  const [innerRadius, setInnerRadius] = useState(54);
  const [labelMode, setLabelMode] = useState<DonutLabelMode>("name-percent");

  const safeCategory =
    categoryColumns.find((column) => column.name === categoryColumn)?.name ??
    categoryColumns[0]?.name ??
    "";
  const safeValue =
    valueColumn === "__count__" || numericColumns.some((column) => column.name === valueColumn)
      ? valueColumn
      : "__count__";

  const dataPromise = useMemo(
    () =>
      loadDonutData(tableName, safeCategory, safeValue).catch((error) => ({
        slices: [],
        total: 0,
        error: error instanceof Error ? error.message : "Unable to render the donut chart.",
      })),
    [safeCategory, safeValue, tableName],
  );

  const result = use(dataPromise);
  const option = useMemo(
    () => buildDonutOption(result, dark, innerRadius, labelMode),
    [dark, innerRadius, labelMode, result],
  );
  const leadingSlice = result.slices[0] ?? null;

  if (categoryColumns.length === 0) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.34, ease: EASE }}
        className={`${PANEL_CLASS} p-6`}
      >
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
          <Donut className="h-8 w-8 text-slate-400 dark:text-slate-500" />
          <div className="space-y-2">
            <p className="text-lg font-semibold text-slate-900 dark:text-white">
              Donut chart needs at least one category column
            </p>
            <p className="max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Add a low-cardinality string, boolean, or grouped field to compare
              category shares.
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
        <div className="grid gap-4 xl:grid-cols-[1.14fr_0.86fr]">
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
                <Donut className="h-3.5 w-3.5" />
                Donut breakdown
              </div>
              <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                Compare category share with a hover-highlighted ring
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Select a category, choose a metric or row count, and tune the inner
                radius to switch between a compact donut and a thinner radial ring.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Category
                </span>
                <select
                  value={safeCategory}
                  onChange={(event) => startTransition(() => setCategoryColumn(event.target.value))}
                  className={FIELD_CLASS}
                >
                  {categoryColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Value
                </span>
                <select
                  value={safeValue}
                  onChange={(event) => startTransition(() => setValueColumn(event.target.value))}
                  className={FIELD_CLASS}
                >
                  <option value="__count__">Row count</option>
                  {numericColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Labels
                </span>
                <select
                  value={labelMode}
                  onChange={(event) =>
                    startTransition(() => setLabelMode(event.target.value as DonutLabelMode))
                  }
                  className={FIELD_CLASS}
                >
                  <option value="name-percent">Name + percent</option>
                  <option value="name-value">Name + value</option>
                  <option value="name">Name only</option>
                  <option value="percent">Percent only</option>
                  <option value="value">Value only</option>
                </select>
              </label>

              <label className="rounded-2xl border border-white/15 bg-white/45 px-4 py-3 dark:bg-slate-950/35">
                <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  <CircleDashed className="h-3.5 w-3.5" />
                  Inner radius
                </span>
                <input
                  type="range"
                  min={24}
                  max={72}
                  step={2}
                  value={innerRadius}
                  onChange={(event) =>
                    startTransition(() => setInnerRadius(Number(event.target.value)))
                  }
                  className="w-full accent-cyan-500"
                />
                <span className="mt-2 block text-sm font-medium text-slate-900 dark:text-slate-100">
                  {innerRadius}%
                </span>
              </label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <MetricCard label="Total" value={formatNumber(result.total)} />
            <MetricCard label="Slices" value={formatNumber(result.slices.length)} />
            <MetricCard
              label="Largest share"
              value={leadingSlice ? `${leadingSlice.share.toFixed(1)}%` : "—"}
            />
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
          <ReactEChartsCore
            echarts={echarts}
            option={option}
            notMerge
            lazyUpdate
            style={{ height: 560 }}
          />
        )}
      </motion.section>

      {result.slices.length > 0 ? (
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: EASE }}
          className={`${PANEL_CLASS} p-5`}
        >
          <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <Tags className="h-3.5 w-3.5" />
            Slice legend
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {result.slices.map((slice, index) => (
              <div
                key={slice.name}
                className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: SLICE_COLORS[index % SLICE_COLORS.length] }}
                  />
                  <div className="truncate text-sm font-semibold text-slate-950 dark:text-white">
                    {slice.name}
                  </div>
                </div>
                <div className="mt-3 flex items-end justify-between gap-4">
                  <div className="text-2xl font-semibold text-slate-950 dark:text-white">
                    {formatNumber(slice.value)}
                  </div>
                  <div className="inline-flex items-center gap-1 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-700 dark:text-cyan-200">
                    <Percent className="h-3 w-3" />
                    {slice.share.toFixed(1)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.section>
      ) : null}
    </div>
  );
}

export default function DonutChart({ tableName, columns }: DonutChartProps) {
  return (
    <Suspense fallback={<DonutChartLoading />}>
      <DonutChartReady tableName={tableName} columns={columns} />
    </Suspense>
  );
}
