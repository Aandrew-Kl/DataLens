"use client";

import {
  Suspense,
  startTransition,
  use,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  BarChart3,
  Download,
  Plus,
  Rows4,
  Sigma,
  Trash2,
  Users2,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  quoteLiteral,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  BarChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

interface SegmentComparisonProps {
  tableName: string;
  columns: ColumnProfile[];
}

type SegmentOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "greater_than"
  | "less_than"
  | "between";

type SegmentView = "chart" | "table";
type MetricAggregation = "average" | "sum" | "count";

interface SegmentDefinition {
  id: string;
  name: string;
  column: string;
  operator: SegmentOperator;
  value: string;
  secondValue: string;
}

interface SegmentMetric {
  id: string;
  name: string;
  rowCount: number;
  meanValue: number;
  sumValue: number;
  stddevValue: number;
  displayValue: number;
  deltaPct: number | null;
  pValue: number | null;
  significance: "baseline" | "significant" | "directional" | "weak";
}

interface SegmentResult {
  metrics: SegmentMetric[];
  error: string | null;
}

const segmentComparisonCache = new Map<string, Promise<SegmentResult>>();

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
        {value}
      </div>
    </div>
  );
}

function SegmentComparisonLoading() {
  return (
    <div
      className={`${GLASS_PANEL_CLASS} flex min-h-[30rem] items-center justify-center`}
    >
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Loading segment comparison…
      </div>
    </div>
  );
}

function createSegmentId() {
  return Math.random().toString(36).slice(2, 10);
}

function initialSegments(columns: ColumnProfile[]) {
  const baseColumn =
    columns.find((column) => column.type === "string" || column.type === "boolean") ??
    columns[0];
  const samples = baseColumn?.sampleValues
    .map((value) => String(value ?? ""))
    .filter((value) => value.length > 0) ?? ["A", "B"];

  return [
    {
      id: "segment-a",
      name: "Segment A",
      column: baseColumn?.name ?? "",
      operator: "equals" as const,
      value: samples[0] ?? "",
      secondValue: "",
    },
    {
      id: "segment-b",
      name: "Segment B",
      column: baseColumn?.name ?? "",
      operator: "equals" as const,
      value: samples[1] ?? samples[0] ?? "",
      secondValue: "",
    },
  ] satisfies SegmentDefinition[];
}

function erf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * absolute);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-absolute * absolute));
  return sign * y;
}

function normalCdf(value: number) {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

function zTestPValue(left: SegmentMetric, right: SegmentMetric) {
  if (
    left.rowCount < 2 ||
    right.rowCount < 2 ||
    left.stddevValue <= 0 ||
    right.stddevValue <= 0
  ) {
    return null;
  }

  const denominator = Math.sqrt(
    left.stddevValue ** 2 / left.rowCount +
      right.stddevValue ** 2 / right.rowCount,
  );

  if (!Number.isFinite(denominator) || denominator === 0) {
    return null;
  }

  const zScore = (right.meanValue - left.meanValue) / denominator;
  return 2 * (1 - normalCdf(Math.abs(zScore)));
}

function buildSegmentClause(
  segment: SegmentDefinition,
  columnMap: Map<string, ColumnProfile>,
) {
  const column = columnMap.get(segment.column);
  if (!column || !segment.value.trim()) return null;

  const safeColumn = quoteIdentifier(segment.column);

  if (column.type === "number") {
    const firstValue = Number(segment.value);
    const secondValue = Number(segment.secondValue);
    if (!Number.isFinite(firstValue)) return null;

    if (segment.operator === "greater_than") {
      return `TRY_CAST(${safeColumn} AS DOUBLE) > ${firstValue}`;
    }
    if (segment.operator === "less_than") {
      return `TRY_CAST(${safeColumn} AS DOUBLE) < ${firstValue}`;
    }
    if (segment.operator === "between" && Number.isFinite(secondValue)) {
      return `TRY_CAST(${safeColumn} AS DOUBLE) BETWEEN ${Math.min(firstValue, secondValue)} AND ${Math.max(firstValue, secondValue)}`;
    }
    if (segment.operator === "not_equals") {
      return `CAST(${safeColumn} AS DOUBLE) <> ${firstValue}`;
    }
    return `CAST(${safeColumn} AS DOUBLE) = ${firstValue}`;
  }

  if (column.type === "date") {
    const firstValue = quoteLiteral(segment.value);
    const secondValue = segment.secondValue.trim()
      ? quoteLiteral(segment.secondValue)
      : null;
    if (segment.operator === "greater_than") {
      return `TRY_CAST(${safeColumn} AS TIMESTAMP) > TRY_CAST(${firstValue} AS TIMESTAMP)`;
    }
    if (segment.operator === "less_than") {
      return `TRY_CAST(${safeColumn} AS TIMESTAMP) < TRY_CAST(${firstValue} AS TIMESTAMP)`;
    }
    if (segment.operator === "between" && secondValue) {
      return `TRY_CAST(${safeColumn} AS TIMESTAMP) BETWEEN TRY_CAST(${firstValue} AS TIMESTAMP) AND TRY_CAST(${secondValue} AS TIMESTAMP)`;
    }
    if (segment.operator === "not_equals") {
      return `CAST(${safeColumn} AS VARCHAR) <> ${firstValue}`;
    }
    return `CAST(${safeColumn} AS VARCHAR) = ${firstValue}`;
  }

  const literal = quoteLiteral(segment.value);
  if (segment.operator === "contains") {
    return `LOWER(CAST(${safeColumn} AS VARCHAR)) LIKE LOWER('%' || ${literal} || '%')`;
  }
  if (segment.operator === "not_equals") {
    return `CAST(${safeColumn} AS VARCHAR) <> ${literal}`;
  }
  return `CAST(${safeColumn} AS VARCHAR) = ${literal}`;
}

function buildChartOption(metrics: SegmentMetric[], dark: boolean): EChartsOption {
  return {
    animationDuration: 520,
    grid: { left: 54, right: 24, top: 24, bottom: 28 },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params;
        const point = metrics.find((metric) => metric.name === String(item.name));
        if (!point) return "";
        return [
          `<strong>${point.name}</strong>`,
          `Value: ${formatNumber(point.displayValue)}`,
          `Rows: ${formatNumber(point.rowCount)}`,
          `Delta vs baseline: ${
            point.deltaPct == null ? "—" : formatPercent(point.deltaPct)
          }`,
          `p-value: ${point.pValue == null ? "—" : point.pValue.toFixed(3)}`,
        ].join("<br/>");
      },
    },
    xAxis: {
      type: "category",
      data: metrics.map((metric) => metric.name),
      axisLabel: { color: dark ? "#cbd5e1" : "#475569" },
      axisLine: { lineStyle: { color: dark ? "#334155" : "#cbd5e1" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: dark ? "#cbd5e1" : "#475569" },
      splitLine: {
        lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" },
      },
    },
    series: [
      {
        type: "bar",
        data: metrics.map((metric, index) => ({
          value: metric.displayValue,
          itemStyle: {
            color:
              index === 0
                ? "#38bdf8"
                : (metric.deltaPct ?? 0) >= 0
                  ? "#22c55e"
                  : "#ef4444",
            borderRadius: [8, 8, 0, 0],
          },
        })),
      },
    ],
  };
}

async function loadSegmentComparison(
  tableName: string,
  segments: SegmentDefinition[],
  columns: ColumnProfile[],
  metricColumn: string,
  aggregation: MetricAggregation,
): Promise<SegmentResult> {
  if (!metricColumn) {
    return { metrics: [], error: "Choose a numeric metric column to compare." };
  }

  if (segments.length < 2) {
    return { metrics: [], error: "Create at least two segments for comparison." };
  }

  const columnMap = new Map(columns.map((column) => [column.name, column]));
  const safeTable = quoteIdentifier(tableName);
  const safeMetric = quoteIdentifier(metricColumn);

  const clauses = segments.map((segment) => buildSegmentClause(segment, columnMap));
  if (clauses.some((clause) => clause === null)) {
    return {
      metrics: [],
      error: "Each segment needs a valid column and comparison value.",
    };
  }

  const metricRows = await Promise.all(
    segments.map(async (segment, index) => {
      const clause = clauses[index];
      const rows = await runQuery(`
        SELECT
          COUNT(*) AS row_count,
          AVG(TRY_CAST(${safeMetric} AS DOUBLE)) AS mean_value,
          SUM(TRY_CAST(${safeMetric} AS DOUBLE)) AS sum_value,
          STDDEV_SAMP(TRY_CAST(${safeMetric} AS DOUBLE)) AS stddev_value
        FROM ${safeTable}
        WHERE ${clause}
          AND ${safeMetric} IS NOT NULL
          AND TRY_CAST(${safeMetric} AS DOUBLE) IS NOT NULL
      `);
      const row = rows[0] ?? {};
      return {
        id: segment.id,
        name: segment.name.trim() || `Segment ${index + 1}`,
        rowCount: Math.round(toNumber(row.row_count) ?? 0),
        meanValue: toNumber(row.mean_value) ?? 0,
        sumValue: toNumber(row.sum_value) ?? 0,
        stddevValue: toNumber(row.stddev_value) ?? 0,
      };
    }),
  );

  const baseline = metricRows[0];

  const metrics: SegmentMetric[] = metricRows.map((row, index) => {
    const displayValue =
      aggregation === "count"
        ? row.rowCount
        : aggregation === "sum"
          ? row.sumValue
          : row.meanValue;
    const baselineValue =
      aggregation === "count"
        ? baseline.rowCount
        : aggregation === "sum"
          ? baseline.sumValue
          : baseline.meanValue;
    const deltaPct =
      index === 0 || baselineValue === 0
        ? null
        : ((displayValue - baselineValue) / Math.abs(baselineValue)) * 100;
    const pValue = index === 0 ? null : zTestPValue(baseline as SegmentMetric, row as SegmentMetric);

    return {
      ...row,
      displayValue,
      deltaPct,
      pValue,
      significance:
        index === 0
          ? "baseline"
          : pValue != null && pValue < 0.05
            ? "significant"
            : pValue != null && pValue < 0.15
              ? "directional"
              : "weak",
    };
  });

  if (metrics.every((metric) => metric.rowCount === 0)) {
    return {
      metrics: [],
      error:
        "The current segment filters returned no rows. Adjust the conditions and try again.",
    };
  }

  return { metrics, error: null };
}

function getCachedSegmentComparison(
  cacheKey: string,
  load: () => Promise<SegmentResult>,
) {
  const cached = segmentComparisonCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const request = load();
  segmentComparisonCache.set(cacheKey, request);
  return request;
}

function SegmentComparisonReady({
  tableName,
  columns,
}: SegmentComparisonProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [metricColumn, setMetricColumn] = useState(numericColumns[0]?.name ?? "");
  const [aggregation, setAggregation] = useState<MetricAggregation>("average");
  const [view, setView] = useState<SegmentView>("chart");
  const [segments, setSegments] = useState<SegmentDefinition[]>(() =>
    initialSegments(columns),
  );

  const safeMetricColumn = numericColumns.some(
    (column) => column.name === metricColumn,
  )
    ? metricColumn
    : numericColumns[0]?.name ?? "";
  const availableColumns = columns.filter((column) => column.name.length > 0);

  const safeSegments = useMemo(
    () =>
      segments.map((segment) => {
        const fallbackColumn = availableColumns[0]?.name ?? "";
        const column = availableColumns.some((item) => item.name === segment.column)
          ? segment.column
          : fallbackColumn;
        return { ...segment, column };
      }),
    [availableColumns, segments],
  );
  const queryKey = useMemo(
    () =>
      JSON.stringify({
        tableName,
        metric: safeMetricColumn,
        aggregation,
        segments: safeSegments.map((segment) => ({
          id: segment.id,
          name: segment.name,
          column: segment.column,
          operator: segment.operator,
          value: segment.value,
          secondValue: segment.secondValue,
        })),
      }),
    [aggregation, safeMetricColumn, safeSegments, tableName],
  );

  const resultPromise = useMemo(
    () =>
      getCachedSegmentComparison(queryKey, () =>
        loadSegmentComparison(
          tableName,
          safeSegments,
          columns,
          safeMetricColumn,
          aggregation,
        ).catch((error) => ({
          metrics: [],
          error:
            error instanceof Error
              ? error.message
              : "Unable to compare segments.",
        })),
      ),
    [aggregation, columns, queryKey, safeMetricColumn, safeSegments, tableName],
  );

  const result = use(resultPromise);
  const chartOption = useMemo(
    () => buildChartOption(result.metrics, dark),
    [dark, result.metrics],
  );

  function updateSegment(id: string, patch: Partial<SegmentDefinition>) {
    startTransition(() => {
      setSegments((current) =>
        current.map((segment) =>
          segment.id === id ? { ...segment, ...patch } : segment,
        ),
      );
    });
  }

  function addSegment() {
    if (segments.length >= 4) return;
    const fallbackColumn = availableColumns[0]?.name ?? "";
    startTransition(() => {
      setSegments((current) => [
        ...current,
        {
          id: createSegmentId(),
          name: `Segment ${current.length + 1}`,
          column: fallbackColumn,
          operator: "equals",
          value: "",
          secondValue: "",
        },
      ]);
    });
  }

  function removeSegment(id: string) {
    if (segments.length <= 2) return;
    startTransition(() => {
      setSegments((current) => current.filter((segment) => segment.id !== id));
    });
  }

  function exportComparison() {
    if (result.metrics.length === 0) return;
    const lines = [
      "segment,row_count,mean,sum,display_value,delta_pct,p_value,significance",
      ...result.metrics.map((metric) =>
        [
          `"${metric.name}"`,
          metric.rowCount,
          metric.meanValue.toFixed(4),
          metric.sumValue.toFixed(4),
          metric.displayValue.toFixed(4),
          metric.deltaPct == null ? "" : metric.deltaPct.toFixed(2),
          metric.pValue == null ? "" : metric.pValue.toFixed(4),
          metric.significance,
        ].join(","),
      ),
    ].join("\n");

    downloadFile(
      lines,
      `${tableName}-${safeMetricColumn}-segment-comparison.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  const baseline = result.metrics[0];

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/20 bg-fuchsia-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-700 dark:text-fuchsia-300">
              <Users2 className="h-4 w-4" />
              Segment Comparison
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Compare one metric across hand-built segments
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Build two to four segments from column conditions, compare side by
              side, and flag baseline differences with a simple z-test.
            </p>
          </div>
          <button
            type="button"
            onClick={exportComparison}
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.2fr_0.9fr_0.9fr]">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Metric column
            </label>
            <select
              aria-label="Metric column"
              value={safeMetricColumn}
              onChange={(event) =>
                startTransition(() => setMetricColumn(event.target.value))
              }
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
              Aggregation
            </label>
            <select
              aria-label="Aggregation"
              value={aggregation}
              onChange={(event) =>
                startTransition(() =>
                  setAggregation(event.target.value as MetricAggregation),
                )
              }
              className={FIELD_CLASS}
            >
              <option value="average">Average</option>
              <option value="sum">Sum</option>
              <option value="count">Count</option>
            </select>
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              View
            </label>
            <select
              aria-label="View"
              value={view}
              onChange={(event) =>
                startTransition(() =>
                  setView(event.target.value as SegmentView),
                )
              }
              className={FIELD_CLASS}
            >
              <option value="chart">Chart</option>
              <option value="table">Table</option>
            </select>
          </div>
        </div>

        <div className="grid gap-4">
          {safeSegments.map((segment, index) => (
            <div
              key={segment.id}
              className={`${GLASS_CARD_CLASS} grid gap-3 p-4 xl:grid-cols-[0.8fr_1fr_0.8fr_1fr_1fr_auto]`}
            >
              <input
                aria-label={`Segment name ${index + 1}`}
                value={segment.name}
                onChange={(event) =>
                  updateSegment(segment.id, { name: event.target.value })
                }
                className={FIELD_CLASS}
              />
              <select
                aria-label={`Segment column ${index + 1}`}
                value={segment.column}
                onChange={(event) =>
                  updateSegment(segment.id, { column: event.target.value })
                }
                className={FIELD_CLASS}
              >
                {availableColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Segment operator ${index + 1}`}
                value={segment.operator}
                onChange={(event) =>
                  updateSegment(segment.id, {
                    operator: event.target.value as SegmentOperator,
                  })
                }
                className={FIELD_CLASS}
              >
                <option value="equals">Equals</option>
                <option value="not_equals">Not equals</option>
                <option value="contains">Contains</option>
                <option value="greater_than">Greater than</option>
                <option value="less_than">Less than</option>
                <option value="between">Between</option>
              </select>
              <input
                aria-label={`Segment value ${index + 1}`}
                value={segment.value}
                onChange={(event) =>
                  updateSegment(segment.id, { value: event.target.value })
                }
                className={FIELD_CLASS}
                placeholder="Value"
              />
              <input
                aria-label={`Segment second value ${index + 1}`}
                value={segment.secondValue}
                onChange={(event) =>
                  updateSegment(segment.id, { secondValue: event.target.value })
                }
                className={FIELD_CLASS}
                placeholder={segment.operator === "between" ? "Upper bound" : "Optional"}
                disabled={segment.operator !== "between"}
              />
              <button
                type="button"
                onClick={() => removeSegment(segment.id)}
                className={BUTTON_CLASS}
                disabled={segments.length <= 2}
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addSegment}
            className={BUTTON_CLASS}
            disabled={segments.length >= 4}
          >
            <Plus className="h-4 w-4" />
            Add segment
          </button>
        </div>

        {result.error ? (
          <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-5 text-sm text-rose-700 dark:text-rose-300">
            {result.error}
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="Baseline"
                value={baseline?.name ?? "—"}
              />
              <SummaryCard
                label="Rows compared"
                value={formatNumber(
                  result.metrics.reduce((sum, metric) => sum + metric.rowCount, 0),
                )}
              />
              <SummaryCard
                label="Significant deltas"
                value={formatNumber(
                  result.metrics.filter(
                    (metric) => metric.significance === "significant",
                  ).length,
                )}
              />
              <SummaryCard
                label="Metric mode"
                value={aggregation}
              />
            </div>

            {view === "chart" ? (
              <div className={`${GLASS_CARD_CLASS} p-4`}>
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  <BarChart3 className="h-4 w-4" />
                  Segment value comparison
                </div>
                <ReactEChartsCore
                  ref={chartRef}
                  echarts={echarts}
                  option={chartOption}
                  notMerge
                  lazyUpdate
                  style={{ height: 360 }}
                />
              </div>
            ) : (
              <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
                <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  <Rows4 className="h-4 w-4" />
                  Comparison table
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-white/10 text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="px-5 py-3">Segment</th>
                        <th className="px-5 py-3">Rows</th>
                        <th className="px-5 py-3">Value</th>
                        <th className="px-5 py-3">Delta</th>
                        <th className="px-5 py-3">p-value</th>
                        <th className="px-5 py-3">Signal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.metrics.map((metric) => (
                        <tr key={metric.id} className="border-b border-white/5">
                          <td className="px-5 py-4 text-slate-950 dark:text-white">
                            {metric.name}
                          </td>
                          <td className="px-5 py-4 text-slate-600 dark:text-slate-300">
                            {formatNumber(metric.rowCount)}
                          </td>
                          <td className="px-5 py-4 font-medium text-slate-950 dark:text-white">
                            {formatNumber(metric.displayValue)}
                          </td>
                          <td
                            className={`px-5 py-4 ${
                              (metric.deltaPct ?? 0) >= 0
                                ? "text-emerald-600 dark:text-emerald-300"
                                : "text-rose-600 dark:text-rose-300"
                            }`}
                          >
                            {metric.deltaPct == null
                              ? "—"
                              : formatPercent(metric.deltaPct)}
                          </td>
                          <td className="px-5 py-4 text-slate-600 dark:text-slate-300">
                            {metric.pValue == null ? "—" : metric.pValue.toFixed(3)}
                          </td>
                          <td className="px-5 py-4 capitalize text-slate-950 dark:text-white">
                            {metric.significance}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </motion.section>
  );
}

export default function SegmentComparison(props: SegmentComparisonProps) {
  return (
    <Suspense fallback={<SegmentComparisonLoading />}>
      <SegmentComparisonReady {...props} />
    </Suspense>
  );
}
