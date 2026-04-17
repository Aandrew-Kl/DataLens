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
import { HeatmapChart, LineChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  GitCompareArrows,
  Grid2X2,
  Loader2,
  Radar,
  SlidersHorizontal,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  ScatterChart,
  LineChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

interface CorrelationFinderProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface CorrelationPair {
  id: string;
  left: string;
  right: string;
  correlation: number;
  pairCount: number;
  strength: number;
}

interface HeatCell {
  xIndex: number;
  yIndex: number;
  value: number | null;
}

interface CorrelationSnapshot {
  error: string | null;
  analyzedColumns: string[];
  omittedCount: number;
  pairs: CorrelationPair[];
  cells: HeatCell[];
}

interface ScatterPoint {
  x: number;
  y: number;
}

interface ScatterPreview {
  points: ScatterPoint[];
  line: Array<[number, number]>;
  error: string | null;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const MAX_ANALYZED_COLUMNS = 12;

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

function pairId(left: string, right: string) {
  return [left, right].sort((a, b) => a.localeCompare(b)).join("::");
}

function describeCorrelation(value: number) {
  const strength = Math.abs(value);
  if (strength >= 0.85) return value > 0 ? "Very strong positive" : "Very strong negative";
  if (strength >= 0.65) return value > 0 ? "Strong positive" : "Strong negative";
  if (strength >= 0.45) return value > 0 ? "Moderate positive" : "Moderate negative";
  if (strength >= 0.25) return value > 0 ? "Weak positive" : "Weak negative";
  return "Near-zero";
}

function buildRegressionLine(points: ScatterPoint[]) {
  if (points.length < 3) return [];

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
    sumXY += point.x * point.y;
    sumXX += point.x * point.x;
  }

  const count = points.length;
  const denominator = count * sumXX - sumX * sumX;
  if (!Number.isFinite(denominator) || denominator === 0) return [];

  const slope = (count * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / count;
  const xValues = points.map((point) => point.x);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);

  return [
    [minX, slope * minX + intercept],
    [maxX, slope * maxX + intercept],
  ] as Array<[number, number]>;
}

async function loadCorrelationSnapshot(
  tableName: string,
  numericColumns: ColumnProfile[],
): Promise<CorrelationSnapshot> {
  const rankedColumns = [...numericColumns].sort(
    (left, right) =>
      (right.uniqueCount - right.nullCount) - (left.uniqueCount - left.nullCount) ||
      left.name.localeCompare(right.name),
  );
  const selectedColumns = rankedColumns.slice(0, MAX_ANALYZED_COLUMNS);

  if (selectedColumns.length < 2) {
    return {
      error: "At least two numeric columns are required for pairwise Pearson correlations.",
      analyzedColumns: selectedColumns.map((column) => column.name),
      omittedCount: Math.max(numericColumns.length - selectedColumns.length, 0),
      pairs: [],
      cells: [],
    };
  }

  const safeTable = quoteIdentifier(tableName);
  const unionQuery = selectedColumns.flatMap((leftColumn, leftIndex) =>
    selectedColumns.slice(leftIndex + 1).map((rightColumn) => {
      const safeLeft = quoteIdentifier(leftColumn.name);
      const safeRight = quoteIdentifier(rightColumn.name);

      return `
        SELECT
          '${leftColumn.name.replaceAll("'", "''")}' AS left_name,
          '${rightColumn.name.replaceAll("'", "''")}' AS right_name,
          corr(TRY_CAST(${safeLeft} AS DOUBLE), TRY_CAST(${safeRight} AS DOUBLE)) AS correlation_value,
          COUNT(*) FILTER (
            WHERE TRY_CAST(${safeLeft} AS DOUBLE) IS NOT NULL
              AND TRY_CAST(${safeRight} AS DOUBLE) IS NOT NULL
          ) AS pair_count
        FROM ${safeTable}
      `;
    }),
  );

  const rows = await runQuery(unionQuery.join(" UNION ALL "));
  const pairs = rows
    .flatMap<CorrelationPair>((row) => {
      const correlation = toNumber(row.correlation_value);
      const pairCount = Number(row.pair_count ?? 0);
      const left = String(row.left_name ?? "");
      const right = String(row.right_name ?? "");
      if (!left || !right || correlation == null || pairCount < 3) return [];
      return [
        {
          id: pairId(left, right),
          left,
          right,
          correlation,
          pairCount,
          strength: Math.abs(correlation),
        },
      ];
    })
    .sort((left, right) => right.strength - left.strength || left.id.localeCompare(right.id));

  const labels = selectedColumns.map((column) => column.name);
  const pairLookup = new Map(pairs.map((pair) => [pair.id, pair]));
  const cells: HeatCell[] = [];

  labels.forEach((rowLabel, rowIndex) => {
    labels.forEach((columnLabel, columnIndex) => {
      if (rowLabel === columnLabel) {
        cells.push({ xIndex: columnIndex, yIndex: rowIndex, value: 1 });
        return;
      }
      cells.push({
        xIndex: columnIndex,
        yIndex: rowIndex,
        value: pairLookup.get(pairId(rowLabel, columnLabel))?.correlation ?? null,
      });
    });
  });

  return {
    error: null,
    analyzedColumns: labels,
    omittedCount: Math.max(numericColumns.length - selectedColumns.length, 0),
    pairs,
    cells,
  };
}

async function loadScatterPreview(
  tableName: string,
  pair: CorrelationPair | null,
): Promise<ScatterPreview> {
  if (!pair) {
    return { points: [], line: [], error: "No correlation pair is available for preview." };
  }

  const safeTable = quoteIdentifier(tableName);
  const safeLeft = quoteIdentifier(pair.left);
  const safeRight = quoteIdentifier(pair.right);

  const rows = await runQuery(`
    SELECT
      TRY_CAST(${safeLeft} AS DOUBLE) AS left_value,
      TRY_CAST(${safeRight} AS DOUBLE) AS right_value
    FROM ${safeTable}
    WHERE TRY_CAST(${safeLeft} AS DOUBLE) IS NOT NULL
      AND TRY_CAST(${safeRight} AS DOUBLE) IS NOT NULL
    USING SAMPLE 360 ROWS
  `);

  const points = rows.flatMap<ScatterPoint>((row) => {
    const x = toNumber(row.left_value);
    const y = toNumber(row.right_value);
    if (x == null || y == null) return [];
    return [{ x, y }];
  });

  if (points.length === 0) {
    return { points: [], line: [], error: "The selected pair has no overlapping numeric rows." };
  }

  return {
    points,
    line: buildRegressionLine(points),
    error: null,
  };
}

function buildHeatmapOption(
  snapshot: CorrelationSnapshot,
  dark: boolean,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";

  return {
    animationDuration: 380,
    tooltip: {
      position: "top",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const item = params as { value?: [number, number, number | null] };
        const xIndex = Number(item.value?.[0] ?? 0);
        const yIndex = Number(item.value?.[1] ?? 0);
        const value = item.value?.[2];
        const left = snapshot.analyzedColumns[yIndex] ?? "";
        const right = snapshot.analyzedColumns[xIndex] ?? "";
        return `${left} ↔ ${right}<br/>Correlation: ${typeof value === "number" ? value.toFixed(3) : "—"}`;
      },
    },
    grid: { left: 100, right: 26, top: 18, bottom: 50 },
    xAxis: {
      type: "category",
      data: snapshot.analyzedColumns,
      axisLabel: {
        color: textColor,
        rotate: snapshot.analyzedColumns.length > 7 ? 28 : 0,
      },
    },
    yAxis: {
      type: "category",
      data: snapshot.analyzedColumns,
      axisLabel: { color: textColor },
    },
    visualMap: {
      min: -1,
      max: 1,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      textStyle: { color: textColor },
      inRange: {
        color: ["#dc2626", "#f8fafc", "#0284c7"],
      },
    },
    series: [
      {
        type: "heatmap",
        data: snapshot.cells.map((cell) => [cell.xIndex, cell.yIndex, cell.value]),
        label: {
          show: true,
          formatter: (params: unknown) => {
            const item = params as { value?: [number, number, number | null] };
            const value = item.value?.[2];
            return typeof value === "number" ? value.toFixed(2) : "";
          },
          color: dark ? "#e2e8f0" : "#0f172a",
          fontSize: 10,
        },
        itemStyle: {
          borderWidth: 1,
          borderColor: dark ? "#020617" : "#ffffff",
        },
      },
    ],
  };
}

function buildScatterOption(
  preview: ScatterPreview,
  pair: CorrelationPair | null,
  dark: boolean,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";

  return {
    animationDuration: 420,
    color: ["#22d3ee", "#f97316"],
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const item = params as { value?: [number, number] };
        return [
          `<strong>${pair?.left ?? "X"} vs ${pair?.right ?? "Y"}</strong>`,
          `${pair?.left ?? "X"}: ${formatNumber(Number(item.value?.[0] ?? 0))}`,
          `${pair?.right ?? "Y"}: ${formatNumber(Number(item.value?.[1] ?? 0))}`,
        ].join("<br/>");
      },
    },
    grid: {
      left: 28,
      right: 24,
      top: 28,
      bottom: 32,
      containLabel: true,
    },
    xAxis: {
      type: "value",
      name: pair?.left ?? "",
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
      splitLine: {
        lineStyle: {
          color: dark ? "rgba(148,163,184,0.16)" : "rgba(148,163,184,0.24)",
          type: "dashed",
        },
      },
    },
    yAxis: {
      type: "value",
      name: pair?.right ?? "",
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
      splitLine: {
        lineStyle: {
          color: dark ? "rgba(148,163,184,0.16)" : "rgba(148,163,184,0.24)",
          type: "dashed",
        },
      },
    },
    series: [
      {
        type: "scatter",
        data: preview.points.map((point) => [point.x, point.y]),
        symbolSize: 8,
        itemStyle: { opacity: 0.72 },
      },
      {
        type: "line",
        data: preview.line,
        symbol: "none",
        lineStyle: { width: 2, type: "dashed" },
      },
    ],
  };
}

function CorrelationFinderLoading() {
  return (
    <div className={`${PANEL_CLASS} flex min-h-[34rem] items-center justify-center`}>
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        Discovering pairwise correlations…
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

function CorrelationFinderReady({ tableName, columns }: CorrelationFinderProps) {
  const dark = useDarkMode();
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [threshold, setThreshold] = useState(0.45);
  const [view, setView] = useState<"ranked" | "heatmap">("ranked");
  const [selectedPairId, setSelectedPairId] = useState("");

  const snapshotPromise = useMemo(
    () =>
      loadCorrelationSnapshot(tableName, numericColumns).catch((error) => ({
        error: error instanceof Error ? error.message : "Unable to compute correlations.",
        analyzedColumns: [],
        omittedCount: 0,
        pairs: [],
        cells: [],
      })),
    [numericColumns, tableName],
  );

  const snapshot = use(snapshotPromise);
  const filteredPairs = useMemo(
    () => snapshot.pairs.filter((pair) => pair.strength >= threshold),
    [snapshot.pairs, threshold],
  );
  const strongestPair = snapshot.pairs[0] ?? null;
  const activePair =
    filteredPairs.find((pair) => pair.id === selectedPairId) ??
    snapshot.pairs.find((pair) => pair.id === selectedPairId) ??
    filteredPairs[0] ??
    strongestPair;

  const previewPromise = useMemo(
    () =>
      loadScatterPreview(tableName, activePair).catch((error) => ({
        points: [],
        line: [],
        error: error instanceof Error ? error.message : "Unable to build the scatter preview.",
      })),
    [activePair, tableName],
  );

  const preview = use(previewPromise);
  const scatterOption = useMemo(
    () => buildScatterOption(preview, activePair, dark),
    [activePair, dark, preview],
  );
  const heatmapOption = useMemo(
    () => buildHeatmapOption(snapshot, dark),
    [dark, snapshot],
  );

  if (numericColumns.length < 2) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.34, ease: EASE }}
        className={`${PANEL_CLASS} p-6`}
      >
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
          <GitCompareArrows className="h-8 w-8 text-slate-400 dark:text-slate-500" />
          <div className="space-y-2">
            <p className="text-lg font-semibold text-slate-900 dark:text-white">
              Correlation finder needs at least two numeric columns
            </p>
            <p className="max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Add more numeric measures to compute pairwise Pearson coefficients and
              generate ranked scatter previews.
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
                <GitCompareArrows className="h-3.5 w-3.5" />
                Correlation discovery
              </div>
              <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                Rank the strongest Pearson relationships automatically
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                DuckDB computes pairwise coefficients, the UI ranks them by absolute
                strength, and the preview panel samples points for the current leader.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
              <label className="rounded-2xl border border-white/15 bg-white/45 px-4 py-3 dark:bg-slate-950/35">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Strength threshold
                </div>
                <input
                  type="range"
                  min={0}
                  max={95}
                  step={1}
                  value={Math.round(threshold * 100)}
                  onChange={(event) =>
                    startTransition(() => setThreshold(Number(event.target.value) / 100))
                  }
                  className="w-full accent-cyan-500"
                />
                <div className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                  |r| ≥ {threshold.toFixed(2)}
                </div>
              </label>

              <button
                type="button"
                onClick={() => startTransition(() => setView("ranked"))}
                className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                  view === "ranked"
                    ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200"
                    : "border-white/15 bg-white/45 text-slate-600 dark:bg-slate-950/35 dark:text-slate-200"
                }`}
              >
                Ranked pairs
              </button>

              <button
                type="button"
                onClick={() => startTransition(() => setView("heatmap"))}
                className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                  view === "heatmap"
                    ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200"
                    : "border-white/15 bg-white/45 text-slate-600 dark:bg-slate-950/35 dark:text-slate-200"
                }`}
              >
                Heatmap view
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <MetricCard label="Analyzed columns" value={formatNumber(snapshot.analyzedColumns.length)} />
            <MetricCard label="Pairs above threshold" value={formatNumber(filteredPairs.length)} />
            <MetricCard
              label="Strongest pair"
              value={strongestPair ? strongestPair.correlation.toFixed(2) : "—"}
            />
          </div>
        </div>

        {snapshot.omittedCount > 0 ? (
          <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
            Limited the scan to the top {formatNumber(MAX_ANALYZED_COLUMNS)} numeric columns by coverage to keep pair discovery responsive.
          </div>
        ) : null}
      </motion.section>

      {snapshot.error ? (
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className={`${PANEL_CLASS} p-5`}
        >
          <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 px-4 py-5 text-sm text-rose-700 dark:text-rose-300">
            {snapshot.error}
          </div>
        </motion.section>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[0.96fr_1.04fr]">
          <motion.section
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className={`${PANEL_CLASS} p-5`}
          >
            {view === "ranked" ? (
              <>
                <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  <Radar className="h-3.5 w-3.5" />
                  Ranked pairs
                </div>
                <div className="space-y-3">
                  {(filteredPairs.length > 0 ? filteredPairs : snapshot.pairs.slice(0, 8)).map((pair) => {
                    const active = pair.id === activePair?.id;
                    return (
                      <button
                        key={pair.id}
                        type="button"
                        onClick={() => startTransition(() => setSelectedPairId(pair.id))}
                        className={`w-full rounded-3xl border p-4 text-left transition ${
                          active
                            ? "border-cyan-400/40 bg-cyan-500/10 shadow-[0_18px_50px_-34px_rgba(6,182,212,0.55)]"
                            : "border-white/15 bg-white/45 hover:border-cyan-300/30 dark:bg-slate-950/35"
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-950 dark:text-white">
                              {pair.left} ↔ {pair.right}
                            </div>
                            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                              {describeCorrelation(pair.correlation)} relationship across {formatNumber(pair.pairCount)} overlapping rows
                            </div>
                          </div>
                          <div className="rounded-full border border-white/15 bg-white/55 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-950/45 dark:text-slate-200">
                            r = {pair.correlation.toFixed(3)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {filteredPairs.length === 0 ? (
                  <div className="mt-4 rounded-2xl border border-dashed border-white/15 px-4 py-5 text-sm text-slate-500 dark:text-slate-400">
                    No pairs cleared the current threshold. Showing the strongest available relationships instead.
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  <Grid2X2 className="h-3.5 w-3.5" />
                  Heatmap view
                </div>
                <ReactEChartsCore
                  echarts={echarts}
                  option={heatmapOption}
                  notMerge
                  lazyUpdate
                  style={{ height: 560 }}
                  onEvents={{
                    click: (params: { value?: [number, number, number | null] }) => {
                      const xIndex = Number(params.value?.[0] ?? -1);
                      const yIndex = Number(params.value?.[1] ?? -1);
                      const left = snapshot.analyzedColumns[yIndex];
                      const right = snapshot.analyzedColumns[xIndex];
                      if (!left || !right || left === right) return;
                      startTransition(() => setSelectedPairId(pairId(left, right)));
                    },
                  }}
                />
                <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">
                  Click any off-diagonal cell to send that pair to the scatter preview panel.
                </div>
              </>
            )}
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, ease: EASE }}
            className={`${PANEL_CLASS} p-5`}
          >
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Scatter preview
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                  {activePair ? `${activePair.left} vs ${activePair.right}` : "No pair selected"}
                </div>
              </div>
              {activePair ? (
                <div className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-700 dark:text-cyan-200">
                  r = {activePair.correlation.toFixed(3)}
                </div>
              ) : null}
            </div>

            {preview.error ? (
              <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 px-4 py-5 text-sm text-rose-700 dark:text-rose-300">
                {preview.error}
              </div>
            ) : (
              <ReactEChartsCore
                echarts={echarts}
                option={scatterOption}
                notMerge
                lazyUpdate
                style={{ height: 400 }}
              />
            )}

            {activePair ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <MetricCard label="Pair strength" value={activePair.strength.toFixed(2)} />
                <MetricCard label="Direction" value={activePair.correlation >= 0 ? "Positive" : "Negative"} />
                <MetricCard label="Overlap rows" value={formatNumber(activePair.pairCount)} />
              </div>
            ) : null}
          </motion.section>
        </div>
      )}
    </div>
  );
}

export default function CorrelationFinder({
  tableName,
  columns,
}: CorrelationFinderProps) {
  return (
    <Suspense fallback={<CorrelationFinderLoading />}>
      <CorrelationFinderReady tableName={tableName} columns={columns} />
    </Suspense>
  );
}
