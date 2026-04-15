"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { Suspense, startTransition, use, useMemo, useState, useSyncExternalStore } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { ParallelChart as EChartsParallelChart } from "echarts/charts";
import { LegendComponent, ParallelComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { BrushCleaning, Palette, Sigma, SlidersHorizontal } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([EChartsParallelChart, ParallelComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface ParallelCoordinatesProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface ParallelSeriesGroup {
  name: string;
  values: number[][];
}

interface ParallelQueryResult {
  axes: string[];
  groups: ParallelSeriesGroup[];
  rowCount: number;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.8rem] border border-white/15 bg-white/60 shadow-[0_24px_90px_-46px_rgba(15,23,42,0.76)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const FIELD_CLASS =
  "rounded-2xl border border-white/15 bg-white/75 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-white/10 dark:bg-slate-950/45 dark:text-slate-100";
const COLOR_PALETTE = ["#38bdf8", "#34d399", "#f59e0b", "#a78bfa", "#fb7185", "#2dd4bf", "#f97316"] as const;
const SAMPLE_ROWS = 720;
const MAX_GROUPS = 7;

function subscribeDarkMode(listener: () => void) {
  if (typeof document === "undefined") {
    return () => undefined;
  }

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
function isCategoricalColumn(column: ColumnProfile) {
  return (
    column.type === "string" ||
    column.type === "boolean" ||
    ((column.type === "number" || column.type === "unknown") && column.uniqueCount > 1 && column.uniqueCount <= 12)
  );
}

function groupLabel(value: unknown) {
  if (value == null) {
    return "Unspecified";
  }

  const text = String(value).trim();
  return text.length > 0 ? text : "Unspecified";
}

async function loadParallelData(
  tableName: string,
  axes: string[],
  categoryColumn: string,
): Promise<ParallelQueryResult> {
  if (axes.length < 3) {
    return { axes, groups: [], rowCount: 0 };
  }

  const safeTable = quoteIdentifier(tableName);
  const axisChecks = axes
    .map((axis) => `TRY_CAST(${quoteIdentifier(axis)} AS DOUBLE) IS NOT NULL`)
    .join(" AND ");
  const axisSelect = axes
    .map((axis, index) => `TRY_CAST(${quoteIdentifier(axis)} AS DOUBLE) AS axis_${index}`)
    .join(", ");
  const categorySelect = categoryColumn
    ? `, CAST(${quoteIdentifier(categoryColumn)} AS VARCHAR) AS __category`
    : "";

  const rows = await runQuery(`
    SELECT ${axisSelect}${categorySelect}
    FROM ${safeTable}
    WHERE ${axisChecks}
    USING SAMPLE ${SAMPLE_ROWS} ROWS
  `);

  const grouped = new Map<string, number[][]>();
  for (const row of rows) {
    const values = axes.map((_, index) => Number(row[`axis_${index}`]));
    if (values.some((value) => !Number.isFinite(value))) {
      continue;
    }

    const label = categoryColumn ? groupLabel(row.__category) : "All rows";
    const bucket = grouped.get(label) ?? [];
    bucket.push(values);
    grouped.set(label, bucket);
  }

  const sortedGroups = Array.from(grouped.entries())
    .sort((left, right) => right[1].length - left[1].length)
    .slice(0, MAX_GROUPS)
    .map(([name, values]) => ({ name, values }));

  return {
    axes,
    groups: sortedGroups,
    rowCount: sortedGroups.reduce((sum, group) => sum + group.values.length, 0),
  };
}

function buildOption(
  dark: boolean,
  result: ParallelQueryResult,
  opacity: number,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const tooltipColor = dark ? "#020617ee" : "#ffffffee";

  return {
    animationDuration: 500,
    color: [...COLOR_PALETTE],
    legend: {
      top: 12,
      icon: "circle",
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: textColor },
    },
    tooltip: {
      trigger: "item",
      backgroundColor: tooltipColor,
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params;
        const payload = item as {
          seriesName?: string;
          value?: number[];
        };
        const values = payload.value ?? [];
        return [
          `<strong>${payload.seriesName ?? "Series"}</strong>`,
          ...result.axes.map((axis, index) => `${axis}: ${formatNumber(values[index] ?? 0)}`),
        ].join("<br/>");
      },
    },
    parallel: {
      left: 72,
      right: 58,
      top: 72,
      bottom: 40,
      axisExpandable: true,
      axisExpandCenter: 18,
      axisExpandCount: Math.min(result.axes.length, 4),
      axisExpandWidth: 38,
      layout: "horizontal",
    },
    parallelAxis: result.axes.map((axis, index) => ({
      dim: index,
      name: axis,
      type: "value",
      nameLocation: "end",
      nameGap: 18,
      nameTextStyle: {
        color: textColor,
        fontWeight: 600,
      },
      axisLabel: {
        color: textColor,
      },
      axisLine: {
        lineStyle: {
          color: dark ? "rgba(148,163,184,0.42)" : "rgba(100,116,139,0.42)",
          width: 1.5,
        },
      },
      areaSelectStyle: {
        width: 18,
        borderWidth: 1,
        color: dark ? "rgba(34,211,238,0.18)" : "rgba(6,182,212,0.12)",
        borderColor: dark ? "rgba(34,211,238,0.55)" : "rgba(8,145,178,0.45)",
      },
    })),
    series: result.groups.map((group, index) => ({
      name: group.name,
      type: "parallel",
      data: group.values,
      smooth: 0.14,
      lineStyle: {
        width: 1.5,
        opacity,
        color: COLOR_PALETTE[index % COLOR_PALETTE.length],
      },
      emphasis: {
        lineStyle: {
          width: 2.5,
          opacity: Math.min(opacity + 0.18, 1),
        },
      },
      inactiveOpacity: 0.06,
      progressive: 400,
      blendMode: "lighter",
    })),
  };
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
          ? "border-cyan-400/45 bg-cyan-500/12 text-cyan-700 dark:text-cyan-200"
          : "border-white/15 bg-white/45 text-slate-600 hover:border-cyan-300/30 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-300"
      }`}
    >
      {label}
    </button>
  );
}

function ParallelCoordinatesReady({ tableName, columns }: ParallelCoordinatesProps) {
  const dark = useDarkMode();
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const categoricalColumns = useMemo(
    () => columns.filter(isCategoricalColumn),
    [columns],
  );
  const [selectedAxes, setSelectedAxes] = useState<string[]>(
    () => numericColumns.slice(0, Math.min(4, numericColumns.length)).map((column) => column.name),
  );
  const [categoryColumn, setCategoryColumn] = useState("");
  const [opacity, setOpacity] = useState(0.26);

  const effectiveAxes = selectedAxes.filter((axis) =>
    numericColumns.some((column) => column.name === axis),
  );
  const effectiveCategory = categoricalColumns.some((column) => column.name === categoryColumn)
    ? categoryColumn
    : "";
  const dataPromise = useMemo(
    () => loadParallelData(tableName, effectiveAxes, effectiveCategory),
    [effectiveAxes, effectiveCategory, tableName],
  );
  const result = use(dataPromise);
  const option = useMemo(
    () => buildOption(dark, result, opacity),
    [dark, opacity, result],
  );

  function toggleAxis(axisName: string) {
    startTransition(() => {
      setSelectedAxes((current) => {
        if (current.includes(axisName)) {
          return current.filter((entry) => entry !== axisName);
        }

        return [...current, axisName];
      });
    });
  }

  if (numericColumns.length < 3) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: EASE }}
        className={`${PANEL_CLASS} p-6`}
      >
        <div className="flex min-h-[18rem] flex-col items-center justify-center gap-4 text-center">
          <Sigma className="h-8 w-8 text-slate-400" />
          <div className="space-y-2">
            <p className="text-lg font-semibold text-slate-950 dark:text-white">
              Parallel coordinates need at least three numeric columns
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              This dataset does not expose enough numeric dimensions for an axis-linked polyline view.
            </p>
          </div>
        </div>
      </motion.section>
    );
  }

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.34, ease: EASE }}
        className={`${PANEL_CLASS} p-5`}
      >
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
                <BrushCleaning className="h-3.5 w-3.5" />
                Multivariate plot
              </div>
              <h2 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                Parallel coordinates
              </h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Select three or more numeric axes, then drag vertically on any axis to brush and isolate subsets.
              </p>
            </div>

            <div>
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <Sigma className="h-3.5 w-3.5" />
                Axes
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

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Color by
              </label>
              <select
                value={effectiveCategory}
                onChange={(event) => startTransition(() => setCategoryColumn(event.target.value))}
                className={`${FIELD_CLASS} w-full`}
              >
                <option value="">Single color</option>
                {categoricalColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={`${FIELD_CLASS} space-y-3`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-cyan-500" />
                  <span className="text-sm font-semibold text-slate-950 dark:text-white">
                    Line opacity
                  </span>
                </div>
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  {opacity.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0.08"
                max="0.9"
                step="0.02"
                value={opacity}
                onChange={(event) => startTransition(() => setOpacity(Number(event.target.value)))}
                className="w-full accent-cyan-500"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-2xl border border-white/15 bg-white/45 p-4 dark:border-white/10 dark:bg-slate-950/35">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Active axes
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                  {effectiveAxes.length}
                </div>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/45 p-4 dark:border-white/10 dark:bg-slate-950/35">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Groups
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                  {result.groups.length}
                </div>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/45 p-4 dark:border-white/10 dark:bg-slate-950/35">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Sample rows
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                  {formatNumber(result.rowCount)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.38, ease: EASE }}
        className={`${PANEL_CLASS} p-5`}
      >
        {effectiveAxes.length < 3 ? (
          <div className="flex min-h-[26rem] flex-col items-center justify-center gap-3 text-center">
            <Palette className="h-8 w-8 text-slate-400" />
            <div className="space-y-2">
              <p className="text-base font-semibold text-slate-950 dark:text-white">
                Select at least three axes to render the plot
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                The chart activates once three numeric dimensions are selected.
              </p>
            </div>
          </div>
        ) : (
          <>
            <ReactEChartsCore
              echarts={echarts}
              option={option}
              notMerge
              lazyUpdate
              style={{ height: 560, width: "100%" }}
            />
            <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/8 px-4 py-3 text-sm text-cyan-700 dark:text-cyan-300">
              Brush directly on an axis to fade the non-matching polylines and highlight the brushed subset.
            </div>
          </>
        )}
      </motion.section>
    </div>
  );
}

function ParallelCoordinatesLoading() {
  return (
    <section className={`${PANEL_CLASS} p-6`}>
      <div className="animate-pulse space-y-4">
        <div className="h-6 w-44 rounded-full bg-white/50 dark:bg-slate-800/70" />
        <div className="h-4 w-80 rounded-full bg-white/40 dark:bg-slate-800/60" />
        <div className="h-[30rem] rounded-[1.5rem] bg-white/40 dark:bg-slate-900/45" />
      </div>
    </section>
  );
}

export default function ParallelCoordinates(props: ParallelCoordinatesProps) {
  return (
    <Suspense fallback={<ParallelCoordinatesLoading />}>
      <ParallelCoordinatesReady {...props} />
    </Suspense>
  );
}
