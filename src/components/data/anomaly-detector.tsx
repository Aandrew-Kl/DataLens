"use client";

import { startTransition, useMemo, useRef, useState, useSyncExternalStore } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { LineChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Download,
  Loader2,
  Radar,
  Sigma,
  TimerReset,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { exportToCSV } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([LineChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface AnomalyDetectorProps {
  tableName: string;
  columns: ColumnProfile[];
}

type DetectionMethod = "zscore" | "iqr" | "modified_zscore" | "isolation_forest";
type Severity = "mild" | "moderate" | "severe";

interface CandidatePoint {
  rowId: number;
  label: string;
  timestamp: string | null;
  value: number;
  baselineValue: number;
  row: Record<string, unknown>;
}

interface AnomalyPoint extends CandidatePoint {
  score: number;
  isAnomaly: boolean;
  severity: Severity | null;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 dark:bg-slate-950/45 dark:text-slate-100";

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

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower] ?? 0;
  const weight = position - lower;
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
}

function median(values: number[]) {
  return percentile(values, 0.5);
}

function mean(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function rollingMedian(values: number[], index: number, radius = 3) {
  const start = Math.max(0, index - radius);
  const end = Math.min(values.length, index + radius + 1);
  const window = values.slice(start, end);
  return median(window);
}

function nearestNeighborGap(values: number[], value: number) {
  if (values.length <= 1) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = sorted.findIndex((entry) => entry === value);
  const leftGap = index > 0 ? Math.abs(value - sorted[index - 1]) : Number.POSITIVE_INFINITY;
  const rightGap = index >= 0 && index < sorted.length - 1 ? Math.abs(sorted[index + 1] - value) : Number.POSITIVE_INFINITY;
  const gap = Math.min(leftGap, rightGap);
  return Number.isFinite(gap) ? gap : 0;
}

function buildSensitivityThreshold(method: DetectionMethod, sensitivity: number) {
  const ratio = sensitivity / 10;
  switch (method) {
    case "zscore":
      return 4.2 - ratio * 2.8;
    case "iqr":
      return 3 - ratio * 1.8;
    case "modified_zscore":
      return 6 - ratio * 4.5;
    case "isolation_forest":
      return 2.3 - ratio * 1.4;
    default:
      return 3;
  }
}

function classifySeverity(score: number, threshold: number): Severity {
  if (score >= threshold * 2.2) return "severe";
  if (score >= threshold * 1.4) return "moderate";
  return "mild";
}

function buildAnomalyQuery(tableName: string, numericColumn: string, dateColumn: string | null) {
  const safeTable = quoteIdentifier(tableName);
  const safeNumeric = quoteIdentifier(numericColumn);
  const dateSelect = dateColumn ? `CAST(${quoteIdentifier(dateColumn)} AS VARCHAR) AS __date_value,` : `NULL AS __date_value,`;
  const sourceOrder = dateColumn ? quoteIdentifier(dateColumn) : "__source_order";

  return `
    WITH base AS (
      SELECT
        row_number() OVER () AS __source_order,
        ${dateSelect}
        TRY_CAST(${safeNumeric} AS DOUBLE) AS __metric,
        *
      FROM ${safeTable}
      WHERE ${safeNumeric} IS NOT NULL
        AND TRY_CAST(${safeNumeric} AS DOUBLE) IS NOT NULL
        ${dateColumn ? `AND ${quoteIdentifier(dateColumn)} IS NOT NULL` : ""}
    )
    SELECT
      row_number() OVER (ORDER BY ${sourceOrder}) AS __row_id,
      *
    FROM base
    ORDER BY ${sourceOrder}
    LIMIT 1500
  `;
}

function buildCandidatePoints(rows: Record<string, unknown>[], timeSeriesMode: boolean) {
  const rawValues = rows.map((row) => toNumber(row.__metric));
  return rows.map((row, index) => ({
    rowId: Number(row.__row_id ?? index + 1),
    label: timeSeriesMode ? String(row.__date_value ?? `Point ${index + 1}`) : `Row ${index + 1}`,
    timestamp: row.__date_value == null ? null : String(row.__date_value),
    value: rawValues[index] ?? 0,
    baselineValue: timeSeriesMode ? (rawValues[index] ?? 0) - rollingMedian(rawValues, index) : rawValues[index] ?? 0,
    row,
  }));
}

function detectAnomalies(points: CandidatePoint[], method: DetectionMethod, sensitivity: number) {
  const threshold = buildSensitivityThreshold(method, sensitivity);
  const baseline = points.map((point) => point.baselineValue);
  const values = points.map((point) => point.value);

  if (points.length === 0) {
    return { threshold, results: [] as AnomalyPoint[] };
  }

  if (method === "zscore") {
    const avg = mean(baseline);
    const std = standardDeviation(baseline);
    return {
      threshold,
      results: points.map((point) => {
        const score = std === 0 ? 0 : Math.abs((point.baselineValue - avg) / std);
        const isAnomaly = score >= threshold;
        return {
          ...point,
          score,
          isAnomaly,
          severity: isAnomaly ? classifySeverity(score, threshold) : null,
        };
      }),
    };
  }

  if (method === "iqr") {
    const q1 = percentile(baseline, 0.25);
    const q3 = percentile(baseline, 0.75);
    const iqr = q3 - q1 || 1;
    const lowerBound = q1 - threshold * iqr;
    const upperBound = q3 + threshold * iqr;
    return {
      threshold,
      results: points.map((point) => {
        const outsideDistance =
          point.baselineValue < lowerBound
            ? lowerBound - point.baselineValue
            : point.baselineValue > upperBound
              ? point.baselineValue - upperBound
              : 0;
        const score = outsideDistance / iqr;
        const isAnomaly = point.baselineValue < lowerBound || point.baselineValue > upperBound;
        return {
          ...point,
          score,
          isAnomaly,
          severity: isAnomaly ? classifySeverity(Math.max(score, threshold), threshold) : null,
        };
      }),
    };
  }

  if (method === "modified_zscore") {
    const med = median(baseline);
    const mad = median(baseline.map((value) => Math.abs(value - med))) || 1;
    return {
      threshold,
      results: points.map((point) => {
        const score = (0.6745 * Math.abs(point.baselineValue - med)) / mad;
        const isAnomaly = score >= threshold;
        return {
          ...point,
          score,
          isAnomaly,
          severity: isAnomaly ? classifySeverity(score, threshold) : null,
        };
      }),
    };
  }

  const med = median(values);
  const mad = median(values.map((value) => Math.abs(value - med))) || 1;
  const q1 = percentile(values, 0.25);
  const q3 = percentile(values, 0.75);
  const spread = q3 - q1 || standardDeviation(values) || 1;

  return {
    threshold,
    results: points.map((point) => {
      const robustScore = Math.abs(point.value - med) / mad;
      const localIsolation = nearestNeighborGap(values, point.value) / spread;
      const trendDisruption = Math.abs(point.baselineValue) / spread;
      const score = robustScore * 0.65 + localIsolation * 0.75 + trendDisruption * 0.55;
      const isAnomaly = score >= threshold;
      return {
        ...point,
        score,
        isAnomaly,
        severity: isAnomaly ? classifySeverity(score, threshold) : null,
      };
    }),
  };
}

function buildOption(
  dark: boolean,
  points: AnomalyPoint[],
  timeSeriesMode: boolean,
  numericColumn: string,
  dateColumn: string | null,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const normalSeries = points.filter((point) => !point.isAnomaly);
  const anomalySeries = points.filter((point) => point.isAnomaly);
  const xValues = timeSeriesMode ? points.map((point) => point.label) : points.map((point) => point.rowId);

  return {
    animationDuration: 520,
    legend: {
      bottom: 0,
      textStyle: { color: textColor },
    },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params;
        const rawIndex =
          typeof (item as { data?: unknown }).data === "object"
          && (item as { data?: { pointIndex?: number } }).data
          && "pointIndex" in ((item as { data?: { pointIndex?: number } }).data ?? {})
            ? Number((item as { data?: { pointIndex?: number } }).data?.pointIndex ?? 0)
            : Number((item as { dataIndex?: number }).dataIndex ?? 0);
        const point = points[rawIndex];
        if (!point) return "";
        return [
          `<strong>${point.label}</strong>`,
          `${numericColumn}: ${formatNumber(point.value)}`,
          `Score: ${point.score.toFixed(2)}`,
          point.severity ? `Severity: ${point.severity}` : "Severity: normal",
          point.timestamp && dateColumn ? `${dateColumn}: ${point.timestamp}` : "",
        ]
          .filter(Boolean)
          .join("<br/>");
      },
    },
    grid: {
      left: 56,
      right: 24,
      top: 24,
      bottom: 60,
      containLabel: true,
    },
    xAxis: {
      type: timeSeriesMode ? "category" : "value",
      name: timeSeriesMode ? dateColumn ?? "Observation" : "Row index",
      data: timeSeriesMode ? xValues : undefined,
      axisLabel: { color: textColor },
      axisLine: { lineStyle: { color: borderColor } },
    },
    yAxis: {
      type: "value",
      name: numericColumn,
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      ...(timeSeriesMode
        ? [{
            name: "Series",
            type: "line" as const,
            showSymbol: false,
            smooth: true,
            data: points.map((point) => [point.label, point.value]),
            lineStyle: { color: "#38bdf8", width: 2.5 },
            z: 1,
          }]
        : []),
      {
        name: "Normal",
        type: "scatter",
        data: normalSeries.map((point) => ({
          value: timeSeriesMode ? [point.label, point.value] : [point.rowId, point.value],
          pointIndex: points.indexOf(point),
        })),
        itemStyle: { color: "#38bdf8", opacity: 0.75 },
        symbolSize: 8,
        z: 3,
      },
      {
        name: "Anomaly",
        type: "scatter",
        data: anomalySeries.map((point) => ({
          value: timeSeriesMode ? [point.label, point.value] : [point.rowId, point.value],
          pointIndex: points.indexOf(point),
        })),
        itemStyle: { color: "#ef4444", opacity: 0.9 },
        symbolSize: 12,
        z: 4,
      },
    ],
  };
}

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 dark:bg-slate-950/45">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

export default function AnomalyDetector({ tableName, columns }: AnomalyDetectorProps) {
  const dark = useSyncExternalStore(subscribeDarkMode, getDarkModeSnapshot, () => false);
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const dateColumns = useMemo(
    () => columns.filter((column) => column.type === "date"),
    [columns],
  );

  const [numericColumn, setNumericColumn] = useState(numericColumns[0]?.name ?? "");
  const [method, setMethod] = useState<DetectionMethod>("zscore");
  const [sensitivity, setSensitivity] = useState(6);
  const [timeSeriesMode, setTimeSeriesMode] = useState(false);
  const [dateColumn, setDateColumn] = useState(dateColumns[0]?.name ?? "");
  const [points, setPoints] = useState<AnomalyPoint[]>([]);
  const [threshold, setThreshold] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const anomalies = useMemo(
    () => points.filter((point) => point.isAnomaly).sort((left, right) => right.score - left.score),
    [points],
  );
  const severityDistribution = useMemo(
    () => ({
      mild: anomalies.filter((point) => point.severity === "mild").length,
      moderate: anomalies.filter((point) => point.severity === "moderate").length,
      severe: anomalies.filter((point) => point.severity === "severe").length,
    }),
    [anomalies],
  );
  const anomalyRate = useMemo(
    () => (points.length === 0 ? 0 : (anomalies.length / points.length) * 100),
    [anomalies.length, points.length],
  );
  const option = useMemo(
    () => buildOption(dark, points, timeSeriesMode, numericColumn, timeSeriesMode ? dateColumn : null),
    [dark, points, timeSeriesMode, numericColumn, dateColumn],
  );

  async function analyze() {
    if (!numericColumn) {
      setError("Select a numeric column to analyze.");
      return;
    }

    if (timeSeriesMode && !dateColumn) {
      setError("Select a date column for time series mode.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(buildAnomalyQuery(tableName, numericColumn, timeSeriesMode ? dateColumn : null));
      const candidates = buildCandidatePoints(rows, timeSeriesMode);
      const detected = detectAnomalies(candidates, method, sensitivity);
      startTransition(() => {
        setThreshold(detected.threshold);
        setPoints(detected.results);
      });
    } catch (analysisError) {
      setPoints([]);
      setError(analysisError instanceof Error ? analysisError.message : "Failed to detect anomalies.");
    } finally {
      setLoading(false);
    }
  }

  function exportAnomalies() {
    if (anomalies.length === 0) return;
    exportToCSV(
      anomalies.map((point) => ({
        __score: point.score.toFixed(2),
        __severity: point.severity,
        __label: point.label,
        ...point.row,
      })),
      `${tableName}-${numericColumn}-anomalies.csv`,
    );
  }

  function exportChart() {
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance) return;
    const url = instance.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: dark ? "#020617" : "#f8fafc",
    });
    const link = document.createElement("a");
    link.href = url;
    link.download = `${tableName}-${numericColumn}-anomalies.png`;
    link.click();
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: EASE }}
      className={`${PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-rose-700 dark:text-rose-300">
            <AlertTriangle className="h-4 w-4" />
            Statistical Anomaly Detection
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">Surface outliers, trend breaks, and isolated observations</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
            Compare classic Z-score, IQR, Modified Z-score, and a rule-based isolation approximation, then export the suspicious rows as a filtered dataset.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <SummaryMetric label="Rows analyzed" value={formatNumber(points.length)} />
          <SummaryMetric label="Anomalies" value={formatNumber(anomalies.length)} />
          <SummaryMetric label="Anomaly rate" value={`${anomalyRate.toFixed(1)}%`} />
          <SummaryMetric label="Threshold" value={threshold.toFixed(2)} />
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_0.9fr_0.9fr_0.8fr_1fr_auto]">
        <select value={numericColumn} onChange={(event) => setNumericColumn(event.target.value)} className={FIELD_CLASS}>
          <option value="">Numeric column</option>
          {numericColumns.map((column) => (
            <option key={column.name} value={column.name}>
              {column.name}
            </option>
          ))}
        </select>
        <select value={method} onChange={(event) => setMethod(event.target.value as DetectionMethod)} className={FIELD_CLASS}>
          <option value="zscore">Z-score</option>
          <option value="iqr">IQR</option>
          <option value="modified_zscore">Modified Z-score</option>
          <option value="isolation_forest">Isolation Forest approximation</option>
        </select>
        <label className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/45 dark:text-slate-200">
          <Sigma className="h-4 w-4 text-cyan-500" />
          <span className="whitespace-nowrap">Sensitivity {sensitivity}</span>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={sensitivity}
            onChange={(event) => setSensitivity(Number(event.target.value))}
            className="w-full accent-cyan-500"
          />
        </label>
        <label className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/45 dark:text-slate-200">
          <TimerReset className="h-4 w-4 text-cyan-500" />
          <input
            type="checkbox"
            checked={timeSeriesMode}
            onChange={(event) => setTimeSeriesMode(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-cyan-500 focus:ring-cyan-400"
          />
          Time series mode
        </label>
        <select value={dateColumn} onChange={(event) => setDateColumn(event.target.value)} className={FIELD_CLASS} disabled={!timeSeriesMode}>
          <option value="">Date column</option>
          {dateColumns.map((column) => (
            <option key={column.name} value={column.name}>
              {column.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void analyze()}
          disabled={loading || !numericColumn || (timeSeriesMode && !dateColumn)}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
          Detect anomalies
        </button>
      </div>

      {error ? (
        <div className="mt-5 rounded-2xl border border-rose-300/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.45fr_0.8fr]">
        <div className="rounded-[1.5rem] border border-white/15 bg-white/65 p-4 dark:bg-slate-950/35">
          {points.length === 0 ? (
            <div className="flex min-h-[400px] items-center justify-center rounded-[1.25rem] border border-dashed border-white/20 text-center text-sm text-slate-500 dark:text-slate-400">
              Run the detector to plot normal observations and anomalies.
            </div>
          ) : (
            <ReactEChartsCore
              ref={chartRef}
              echarts={echarts}
              option={option}
              notMerge
              lazyUpdate
              style={{ height: 440 }}
            />
          )}
        </div>

        <div className="space-y-4 rounded-[1.5rem] border border-white/15 bg-white/65 p-4 dark:bg-slate-950/35">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Severity distribution</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Scores are bucketed into mild, moderate, and severe bands relative to the current sensitivity threshold.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={exportChart}
                disabled={points.length === 0}
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-950/45 dark:text-slate-200 dark:hover:bg-slate-950/65"
              >
                <Download className="h-4 w-4" />
                PNG
              </button>
              <button
                type="button"
                onClick={exportAnomalies}
                disabled={anomalies.length === 0}
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-950/45 dark:text-slate-200 dark:hover:bg-slate-950/65"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/15 bg-white/70 p-4 dark:bg-slate-950/45">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Mild</p>
              <p className="mt-1 text-lg font-semibold text-amber-600 dark:text-amber-300">{formatNumber(severityDistribution.mild)}</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/70 p-4 dark:bg-slate-950/45">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Moderate</p>
              <p className="mt-1 text-lg font-semibold text-orange-600 dark:text-orange-300">{formatNumber(severityDistribution.moderate)}</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/70 p-4 dark:bg-slate-950/45">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Severe</p>
              <p className="mt-1 text-lg font-semibold text-rose-600 dark:text-rose-300">{formatNumber(severityDistribution.severe)}</p>
            </div>
          </div>

          <div className="max-h-[280px] space-y-3 overflow-y-auto pr-1">
            {anomalies.length === 0 ? (
              <div className="rounded-[1.25rem] border border-dashed border-white/20 px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                No anomalies were flagged with the current settings.
              </div>
            ) : (
              anomalies.slice(0, 20).map((point) => (
                <div key={point.rowId} className="rounded-2xl border border-white/15 bg-white/70 p-4 dark:bg-slate-950/45">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{point.label}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {numericColumn}: {formatNumber(point.value)}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${point.severity === "severe" ? "bg-rose-500/10 text-rose-600 dark:text-rose-300" : point.severity === "moderate" ? "bg-orange-500/10 text-orange-600 dark:text-orange-300" : "bg-amber-500/10 text-amber-600 dark:text-amber-300"}`}>
                      {point.score.toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Severity: {point.severity}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-[1.5rem] border border-white/15 bg-white/65 p-4 dark:bg-slate-950/35">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Anomalous rows</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">The highest-scoring outliers are listed first with their raw row payload ready for export.</p>
          </div>
        </div>

        {anomalies.length === 0 ? (
          <div className="mt-4 rounded-[1.25rem] border border-dashed border-white/20 px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            No anomalies to list yet.
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-[1.25rem] border border-white/15">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-white/85 dark:bg-slate-950/70">
                  <tr>
                    <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Observation</th>
                    <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Value</th>
                    <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Score</th>
                    <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Severity</th>
                    <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Row preview</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10 bg-white/60 dark:bg-slate-950/45">
                  {anomalies.slice(0, 50).map((point) => (
                    <tr key={`${point.rowId}-${point.label}`}>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{point.label}</td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{formatNumber(point.value)}</td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{point.score.toFixed(2)}</td>
                      <td className="px-3 py-2 text-slate-700 capitalize dark:text-slate-200">{point.severity}</td>
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                        {Object.entries(point.row)
                          .filter(([key]) => !key.startsWith("__"))
                          .slice(0, 3)
                          .map(([key, value]) => `${key}: ${String(value)}`)
                          .join(" • ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </motion.section>
  );
}
