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
import { HeatmapChart as EChartsHeatmapChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  Flame,
  Grid2X2,
  Loader2,
  Palette,
  Sigma,
  SlidersHorizontal,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import { buildMetricExpression } from "@/lib/utils/sql-safe";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  EChartsHeatmapChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

interface HeatmapChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

type HeatmapAggregation = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";
type HeatmapPalette = "blue" | "green" | "red" | "diverging";
type AxisSort = "none" | "asc" | "desc";

interface HeatmapCell {
  xLabel: string;
  yLabel: string;
  value: number;
}

interface HeatmapResult {
  cells: HeatmapCell[];
  xLabels: string[];
  yLabels: string[];
  rowTotals: Record<string, number>;
  columnTotals: Record<string, number>;
  min: number;
  max: number;
  total: number;
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
function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function paletteColors(palette: HeatmapPalette) {
  switch (palette) {
    case "green":
      return ["#dcfce7", "#4ade80", "#166534"];
    case "red":
      return ["#fee2e2", "#f87171", "#991b1b"];
    case "diverging":
      return ["#1d4ed8", "#f8fafc", "#dc2626"];
    default:
      return ["#dbeafe", "#38bdf8", "#1d4ed8"];
  }
}

function sortLabels(
  labels: string[],
  totals: Record<string, number>,
  sortMode: AxisSort,
) {
  const next = [...labels];
  if (sortMode === "none") {
    return next;
  }
  next.sort((left, right) => {
    const leftTotal = totals[left] ?? 0;
    const rightTotal = totals[right] ?? 0;
    if (sortMode === "asc") {
      return leftTotal - rightTotal || left.localeCompare(right);
    }
    return rightTotal - leftTotal || left.localeCompare(right);
  });
  return next;
}

async function loadHeatmapData(
  tableName: string,
  xColumn: string,
  yColumn: string,
  valueColumn: string,
  aggregation: HeatmapAggregation,
): Promise<HeatmapResult> {
  if (!xColumn || !yColumn) {
    return {
      cells: [],
      xLabels: [],
      yLabels: [],
      rowTotals: {},
      columnTotals: {},
      min: 0,
      max: 0,
      total: 0,
      error: "Choose both X and Y dimensions to render the heatmap.",
    };
  }

  const safeTable = quoteIdentifier(tableName);
  const safeX = quoteIdentifier(xColumn);
  const safeY = quoteIdentifier(yColumn);
  const useRowCount = aggregation === "COUNT" || valueColumn === "__count__";
  const safeValue = useRowCount ? null : quoteIdentifier(valueColumn);

  const metricProjection = useRowCount
    ? ""
    : `, TRY_CAST(${safeValue} AS DOUBLE) AS metric_value`;
  const metricFilter = useRowCount
    ? ""
    : `AND ${safeValue} IS NOT NULL AND TRY_CAST(${safeValue} AS DOUBLE) IS NOT NULL`;
  const metricSelect = useRowCount
    ? "COUNT(*)"
    : buildMetricExpression(aggregation, "metric_value", (column) => column, { cast: false });

  const rows = await runQuery(`
    WITH filtered AS (
      SELECT
        CAST(${safeX} AS VARCHAR) AS x_label,
        CAST(${safeY} AS VARCHAR) AS y_label
        ${metricProjection}
      FROM ${safeTable}
      WHERE ${safeX} IS NOT NULL
        AND ${safeY} IS NOT NULL
        ${metricFilter}
    ),
    top_x AS (
      SELECT x_label
      FROM filtered
      GROUP BY 1
      ORDER BY COUNT(*) DESC, x_label
      LIMIT 16
    ),
    top_y AS (
      SELECT y_label
      FROM filtered
      GROUP BY 1
      ORDER BY COUNT(*) DESC, y_label
      LIMIT 16
    )
    SELECT
      x_label,
      y_label,
      ${metricSelect} AS cell_value
    FROM filtered
    WHERE x_label IN (SELECT x_label FROM top_x)
      AND y_label IN (SELECT y_label FROM top_y)
    GROUP BY 1, 2
    HAVING ${metricSelect} IS NOT NULL
    ORDER BY y_label, x_label
  `);

  const cells = rows.flatMap<HeatmapCell>((row) => {
    const xLabel = String(row.x_label ?? "");
    const yLabel = String(row.y_label ?? "");
    if (!xLabel || !yLabel) return [];
    return [{ xLabel, yLabel, value: toNumber(row.cell_value) }];
  });

  if (cells.length === 0) {
    return {
      cells: [],
      xLabels: [],
      yLabels: [],
      rowTotals: {},
      columnTotals: {},
      min: 0,
      max: 0,
      total: 0,
      error: "The selected combination produced no non-null cells.",
    };
  }

  const xLabels = Array.from(new Set(cells.map((cell) => cell.xLabel)));
  const yLabels = Array.from(new Set(cells.map((cell) => cell.yLabel)));
  const rowTotals: Record<string, number> = {};
  const columnTotals: Record<string, number> = {};

  for (const cell of cells) {
    rowTotals[cell.yLabel] = (rowTotals[cell.yLabel] ?? 0) + cell.value;
    columnTotals[cell.xLabel] = (columnTotals[cell.xLabel] ?? 0) + cell.value;
  }

  return {
    cells,
    xLabels,
    yLabels,
    rowTotals,
    columnTotals,
    min: Math.min(...cells.map((cell) => cell.value)),
    max: Math.max(...cells.map((cell) => cell.value)),
    total: cells.reduce((sum, cell) => sum + cell.value, 0),
    error: null,
  };
}

function resolveVisualRange(
  result: HeatmapResult,
  minOverride: string,
  maxOverride: string,
) {
  const parsedMin = minOverride.trim() === "" ? null : Number(minOverride);
  const parsedMax = maxOverride.trim() === "" ? null : Number(maxOverride);
  const min =
    parsedMin != null && Number.isFinite(parsedMin) ? parsedMin : result.min;
  const max =
    parsedMax != null && Number.isFinite(parsedMax) ? parsedMax : result.max;
  if (min === max) {
    return [min, min + 1] as const;
  }
  return [Math.min(min, max), Math.max(min, max)] as const;
}

function buildHeatmapOption(
  result: HeatmapResult,
  dark: boolean,
  xSort: AxisSort,
  ySort: AxisSort,
  palette: HeatmapPalette,
  showLabels: boolean,
  visualRange: readonly [number, number],
): EChartsOption {
  const xLabels = sortLabels(result.xLabels, result.columnTotals, xSort);
  const yLabels = sortLabels(result.yLabels, result.rowTotals, ySort);
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#0f172a" : "#ffffff";
  const xIndex = new Map(xLabels.map((label, index) => [label, index]));
  const yIndex = new Map(yLabels.map((label, index) => [label, index]));

  return {
    animationDuration: 500,
    grid: {
      left: 96,
      right: 34,
      top: 22,
      bottom: 76,
    },
    tooltip: {
      position: "top",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params;
        const raw = item as {
          data?: [number, number, number];
        };
        const xLabel = xLabels[raw.data?.[0] ?? 0] ?? "";
        const yLabel = yLabels[raw.data?.[1] ?? 0] ?? "";
        const value = raw.data?.[2] ?? 0;
        return [
          `<strong>${yLabel}</strong> vs <strong>${xLabel}</strong>`,
          `Exact value: ${formatNumber(Number(value))}`,
          `Row total: ${formatNumber(result.rowTotals[yLabel] ?? 0)}`,
          `Column total: ${formatNumber(result.columnTotals[xLabel] ?? 0)}`,
        ].join("<br/>");
      },
    },
    xAxis: {
      type: "category",
      data: xLabels,
      splitArea: { show: false },
      axisLabel: {
        color: textColor,
        rotate: xLabels.length > 8 ? 28 : 0,
      },
    },
    yAxis: {
      type: "category",
      data: yLabels,
      splitArea: { show: false },
      axisLabel: { color: textColor },
    },
    visualMap: {
      min: visualRange[0],
      max: visualRange[1],
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 10,
      textStyle: { color: textColor },
      inRange: {
        color: paletteColors(palette),
      },
    },
    series: [
      {
        type: "heatmap",
        data: result.cells
          .map((cell) => [
            xIndex.get(cell.xLabel),
            yIndex.get(cell.yLabel),
            cell.value,
          ])
          .filter(
            (item): item is [number, number, number] =>
              typeof item[0] === "number" && typeof item[1] === "number",
          ),
        label: {
          show: showLabels,
          color: dark ? "#f8fafc" : "#0f172a",
          fontSize: 11,
          formatter: (params) => formatNumber(Number((params as { data?: [number, number, number] }).data?.[2] ?? 0)),
        },
        itemStyle: {
          borderColor,
          borderWidth: 1,
          borderRadius: 6,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 18,
            shadowColor: dark ? "rgba(15,23,42,0.7)" : "rgba(14,165,233,0.35)",
          },
        },
      },
    ],
  };
}

function HeatmapLoading() {
  return (
    <div className={`${PANEL_CLASS} flex min-h-[28rem] items-center justify-center`}>
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading heatmap analysis…
      </div>
    </div>
  );
}

function HeatmapChartReady({ tableName, columns }: HeatmapChartProps) {
  const dark = useDarkMode();
  const dimensionColumns = useMemo(() => columns, [columns]);
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [xColumn, setXColumn] = useState(
    dimensionColumns[0]?.name ?? "",
  );
  const [yColumn, setYColumn] = useState(
    dimensionColumns[1]?.name ?? dimensionColumns[0]?.name ?? "",
  );
  const [valueColumn, setValueColumn] = useState(
    numericColumns[0]?.name ?? "__count__",
  );
  const [aggregation, setAggregation] = useState<HeatmapAggregation>(
    numericColumns[0] ? "SUM" : "COUNT",
  );
  const [palette, setPalette] = useState<HeatmapPalette>("blue");
  const [showLabels, setShowLabels] = useState(false);
  const [xSort, setXSort] = useState<AxisSort>("none");
  const [ySort, setYSort] = useState<AxisSort>("desc");
  const [minOverride, setMinOverride] = useState("");
  const [maxOverride, setMaxOverride] = useState("");

  const safeX = dimensionColumns.some((column) => column.name === xColumn)
    ? xColumn
    : dimensionColumns[0]?.name ?? "";
  const safeY = dimensionColumns.some((column) => column.name === yColumn)
    ? yColumn
    : dimensionColumns[1]?.name ?? dimensionColumns[0]?.name ?? "";
  const safeValue =
    valueColumn === "__count__" ||
    numericColumns.some((column) => column.name === valueColumn)
      ? valueColumn
      : numericColumns[0]?.name ?? "__count__";
  const safeAggregation =
    safeValue === "__count__" ? "COUNT" : aggregation;

  const dataPromise = useMemo(
    () =>
      loadHeatmapData(tableName, safeX, safeY, safeValue, safeAggregation).catch(
        (error) => ({
          cells: [],
          xLabels: [],
          yLabels: [],
          rowTotals: {},
          columnTotals: {},
          min: 0,
          max: 0,
          total: 0,
          error:
            error instanceof Error
              ? error.message
              : "Unable to render heatmap.",
        }),
      ),
    [safeAggregation, safeValue, safeX, safeY, tableName],
  );

  const result = use(dataPromise);
  const visualRange = useMemo(
    () => resolveVisualRange(result, minOverride, maxOverride),
    [maxOverride, minOverride, result],
  );
  const option = useMemo(
    () =>
      buildHeatmapOption(
        result,
        dark,
        xSort,
        ySort,
        palette,
        showLabels,
        visualRange,
      ),
    [dark, palette, result, showLabels, visualRange, xSort, ySort],
  );

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: EASE }}
        className={`${PANEL_CLASS} p-5`}
      >
        <div className="grid gap-4 xl:grid-cols-[1.12fr_0.88fr]">
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
                <Grid2X2 className="h-3.5 w-3.5" />
                Heatmap matrix
              </div>
              <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                Compare two dimensions with an intensity map
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Values are aggregated in DuckDB, then sorted and color-mapped in the
                client for fast exploration.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  X-axis
                </label>
                <select
                  value={safeX}
                  onChange={(event) =>
                    startTransition(() => setXColumn(event.target.value))
                  }
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
                  onChange={(event) =>
                    startTransition(() => setYColumn(event.target.value))
                  }
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
                  Value
                </label>
                <select
                  value={safeValue}
                  onChange={(event) =>
                    startTransition(() => setValueColumn(event.target.value))
                  }
                  className={FIELD_CLASS}
                >
                  <option value="__count__">Row count</option>
                  {numericColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Aggregation
                </label>
                <select
                  value={safeAggregation}
                  onChange={(event) =>
                    startTransition(
                      () =>
                        setAggregation(event.target.value as HeatmapAggregation),
                    )
                  }
                  disabled={safeValue === "__count__"}
                  className={`${FIELD_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <option value="COUNT">COUNT</option>
                  <option value="SUM">SUM</option>
                  <option value="AVG">AVG</option>
                  <option value="MIN">MIN</option>
                  <option value="MAX">MAX</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Palette
                </label>
                <select
                  value={palette}
                  onChange={(event) =>
                    startTransition(() => setPalette(event.target.value as HeatmapPalette))
                  }
                  className={FIELD_CLASS}
                >
                  <option value="blue">Sequential blue</option>
                  <option value="green">Sequential green</option>
                  <option value="red">Sequential red</option>
                  <option value="diverging">Diverging</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Sort rows
                </label>
                <select
                  value={ySort}
                  onChange={(event) =>
                    startTransition(() => setYSort(event.target.value as AxisSort))
                  }
                  className={FIELD_CLASS}
                >
                  <option value="none">Original</option>
                  <option value="desc">High to low</option>
                  <option value="asc">Low to high</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Sort columns
                </label>
                <select
                  value={xSort}
                  onChange={(event) =>
                    startTransition(() => setXSort(event.target.value as AxisSort))
                  }
                  className={FIELD_CLASS}
                >
                  <option value="none">Original</option>
                  <option value="desc">High to low</option>
                  <option value="asc">Low to high</option>
                </select>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <label className="rounded-2xl border border-white/15 bg-white/45 px-4 py-3 dark:bg-slate-950/35">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Min color
                </div>
                <input
                  value={minOverride}
                  onChange={(event) => setMinOverride(event.target.value)}
                  placeholder={String(result.min)}
                  className="w-full bg-transparent text-sm text-slate-900 outline-none dark:text-slate-100"
                />
              </label>

              <label className="rounded-2xl border border-white/15 bg-white/45 px-4 py-3 dark:bg-slate-950/35">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  <Palette className="h-3.5 w-3.5" />
                  Max color
                </div>
                <input
                  value={maxOverride}
                  onChange={(event) => setMaxOverride(event.target.value)}
                  placeholder={String(result.max)}
                  className="w-full bg-transparent text-sm text-slate-900 outline-none dark:text-slate-100"
                />
              </label>

              <label className="flex items-center justify-between rounded-2xl border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/35 dark:text-slate-200">
                <span>Cell labels</span>
                <input
                  checked={showLabels}
                  onChange={(event) =>
                    startTransition(() => setShowLabels(event.target.checked))
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
                Total metric
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
                {formatNumber(result.total)}
              </div>
            </div>

            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <Grid2X2 className="h-3.5 w-3.5" />
                Matrix size
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
                {result.yLabels.length} × {result.xLabels.length}
              </div>
            </div>

            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <Flame className="h-3.5 w-3.5" />
                Color range
              </div>
              <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
                {formatNumber(visualRange[0])} to {formatNumber(visualRange[1])}
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
    </div>
  );
}

export default function HeatmapChart({ tableName, columns }: HeatmapChartProps) {
  return (
    <Suspense fallback={<HeatmapLoading />}>
      <HeatmapChartReady tableName={tableName} columns={columns} />
    </Suspense>
  );
}
