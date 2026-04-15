"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ElementType,
  type ReactNode,
} from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BarChart3,
  CalendarRange,
  Check,
  Clipboard,
  Copy,
  Download,
  Hash,
  Loader2,
  Mail,
  Phone,
  ShieldCheck,
  Sigma,
  Type,
  X,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface ColumnProfilerAdvancedProps {
  tableName: string;
  column: ColumnProfile;
  rowCount: number;
  onClose: () => void;
}

interface HistogramBin {
  label: string;
  count: number;
}

interface FrequencyRow {
  value: string;
  count: number;
  percentage: number;
}

interface ColumnStatistics {
  count: number;
  nulls: number;
  unique: number;
  min: string | number | null;
  max: string | number | null;
  mean: number | null;
  median: number | null;
  stddev: number | null;
  variance: number | null;
  skewness: number | null;
  kurtosis: number | null;
}

interface PatternMetrics {
  nonNull: number;
  emailCount: number;
  phoneCount: number;
  urlCount: number;
  blankCount: number;
  trimmedCount: number;
}

interface TemporalGap {
  start: string;
  end: string;
  days: number;
}

interface TemporalMetrics {
  minDate: string | null;
  maxDate: string | null;
  rangeDays: number;
  dayOfWeek: HistogramBin[];
  gaps: TemporalGap[];
}

interface OutlierMetrics {
  q1: number | null;
  median: number | null;
  q3: number | null;
  lowerBound: number | null;
  upperBound: number | null;
  whiskerLow: number | null;
  whiskerHigh: number | null;
  outlierCount: number;
  topOutliers: FrequencyRow[];
}

interface QualityMetrics {
  completeness: number;
  uniqueness: number;
  patternConformity: number;
  conformityLabel: string;
}

interface AdvancedProfileData {
  statistics: ColumnStatistics;
  histogram: HistogramBin[];
  frequencyRows: FrequencyRow[];
  patterns: PatternMetrics | null;
  temporal: TemporalMetrics | null;
  outliers: OutlierMetrics | null;
  quality: QualityMetrics;
}

interface LoadState {
  key: string;
  data: AdvancedProfileData | null;
  error: string | null;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
function toNumber(value: unknown) {
  const parsed = value == null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: unknown) {
  return value == null ? null : String(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatPercent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

function formatMetric(value: number | null, digits = 2) {
  if (value == null) return "—";
  if (Math.abs(value) >= 1000 || Number.isInteger(value)) return formatNumber(value);
  return value.toFixed(digits);
}

function formatRangeValue(value: string | number | null) {
  if (value == null) return "—";
  return typeof value === "number" ? formatMetric(value) : value;
}

function escapeCsv(value: unknown) {
  if (value == null) return "";
  const text = String(value);
  if (text.includes(",") || text.includes('"') || text.includes("\n") || text.includes("\r")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function darkModeSubscribe(onStoreChange: () => void) {
  if (typeof document === "undefined") return () => undefined;
  const root = document.documentElement;
  const observer = new MutationObserver(onStoreChange);
  observer.observe(root, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function getDarkModeSnapshot() {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

function useDarkMode() {
  return useSyncExternalStore(darkModeSubscribe, getDarkModeSnapshot, () => false);
}

function Card({
  title,
  icon: Icon,
  subtitle,
  children,
}: {
  title: string;
  icon: ElementType;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: EASE }}
      className="rounded-[1.75rem] border border-white/20 bg-white/70 p-5 shadow-xl shadow-slate-950/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <Icon className="h-4 w-4" />
            {title}
          </div>
          {subtitle ? (
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {children}
    </motion.section>
  );
}

function MetricCell({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/20 bg-slate-50/80 px-4 py-3 dark:border-white/10 dark:bg-slate-900/45">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">{value}</p>
    </div>
  );
}

function buildHistogramOption(
  bins: HistogramBin[],
  dark: boolean,
  color: string,
): EChartsOption {
  return {
    animationDuration: 420,
    grid: { left: 18, right: 18, top: 24, bottom: 36, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#1e293b" : "#dbe4f0",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
    },
    xAxis: {
      type: "category",
      data: bins.map((bin) => bin.label),
      axisLabel: {
        color: dark ? "#94a3b8" : "#64748b",
        rotate: bins.length > 10 ? 28 : 0,
        fontSize: 11,
      },
      axisLine: { lineStyle: { color: dark ? "#1e293b" : "#dbe4f0" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: dark ? "#94a3b8" : "#64748b", fontSize: 11 },
      splitLine: {
        lineStyle: { color: dark ? "#1e293b" : "#dbe4f0", type: "dashed" },
      },
    },
    series: [
      {
        type: "bar",
        data: bins.map((bin) => bin.count),
        barMaxWidth: 26,
        itemStyle: { color, borderRadius: [8, 8, 0, 0] },
      },
    ],
  };
}

function buildBoxPlotOption(outliers: OutlierMetrics, dark: boolean): EChartsOption {
  return {
    animationDuration: 420,
    grid: { left: 18, right: 18, top: 18, bottom: 30, containLabel: true },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#1e293b" : "#dbe4f0",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
      formatter: [
        `Whisker low: ${formatMetric(outliers.whiskerLow)}`,
        `Q1: ${formatMetric(outliers.q1)}`,
        `Median: ${formatMetric(outliers.median)}`,
        `Q3: ${formatMetric(outliers.q3)}`,
        `Whisker high: ${formatMetric(outliers.whiskerHigh)}`,
      ].join("<br/>"),
    },
    xAxis: {
      type: "category",
      data: ["IQR"],
      axisLabel: { color: dark ? "#94a3b8" : "#64748b" },
      axisLine: { lineStyle: { color: dark ? "#1e293b" : "#dbe4f0" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: dark ? "#94a3b8" : "#64748b", fontSize: 11 },
      splitLine: {
        lineStyle: { color: dark ? "#1e293b" : "#dbe4f0", type: "dashed" },
      },
    },
    series: [
      {
        type: "boxplot",
        itemStyle: {
          color: "rgba(14,165,233,0.18)",
          borderColor: "#38bdf8",
          borderWidth: 2,
        },
        data: [[
          outliers.whiskerLow ?? 0,
          outliers.q1 ?? 0,
          outliers.median ?? 0,
          outliers.q3 ?? 0,
          outliers.whiskerHigh ?? 0,
        ]],
      },
    ],
  };
}

async function loadBaseStatistics(
  tableName: string,
  column: ColumnProfile,
): Promise<ColumnStatistics> {
  const table = quoteIdentifier(tableName);
  const field = quoteIdentifier(column.name);

  if (column.type === "number") {
    const row = (await runQuery(`
      SELECT
        COUNT(${field}) AS value_count,
        COUNT(*) - COUNT(${field}) AS null_count,
        COUNT(DISTINCT ${field}) AS unique_count,
        MIN(${field}) AS min_value,
        MAX(${field}) AS max_value,
        AVG(${field}) AS mean_value,
        MEDIAN(${field}) AS median_value,
        STDDEV_SAMP(${field}) AS stddev_value,
        VAR_SAMP(${field}) AS variance_value,
        SKEWNESS(${field}) AS skewness_value,
        KURTOSIS(${field}) AS kurtosis_value
      FROM ${table}
    `))[0] ?? {};

    return {
      count: toNumber(row.value_count) ?? 0,
      nulls: toNumber(row.null_count) ?? 0,
      unique: toNumber(row.unique_count) ?? 0,
      min: toNumber(row.min_value),
      max: toNumber(row.max_value),
      mean: toNumber(row.mean_value),
      median: toNumber(row.median_value),
      stddev: toNumber(row.stddev_value),
      variance: toNumber(row.variance_value),
      skewness: toNumber(row.skewness_value),
      kurtosis: toNumber(row.kurtosis_value),
    };
  }

  if (column.type === "date") {
    const parsed = `TRY_CAST(${field} AS TIMESTAMP)`;
    const row = (await runQuery(`
      WITH parsed_values AS (
        SELECT ${field} AS raw_value, ${parsed} AS parsed_value
        FROM ${table}
      )
      SELECT
        COUNT(parsed_value) AS value_count,
        COUNT(*) - COUNT(raw_value) AS null_count,
        COUNT(DISTINCT parsed_value) AS unique_count,
        CAST(MIN(parsed_value) AS VARCHAR) AS min_value,
        CAST(MAX(parsed_value) AS VARCHAR) AS max_value
      FROM parsed_values
    `))[0] ?? {};

    return {
      count: toNumber(row.value_count) ?? 0,
      nulls: toNumber(row.null_count) ?? 0,
      unique: toNumber(row.unique_count) ?? 0,
      min: toText(row.min_value),
      max: toText(row.max_value),
      mean: null,
      median: null,
      stddev: null,
      variance: null,
      skewness: null,
      kurtosis: null,
    };
  }

  const row = (await runQuery(`
    SELECT
      COUNT(${field}) AS value_count,
      COUNT(*) - COUNT(${field}) AS null_count,
      COUNT(DISTINCT ${field}) AS unique_count,
      MIN(CAST(${field} AS VARCHAR)) AS min_value,
      MAX(CAST(${field} AS VARCHAR)) AS max_value
    FROM ${table}
  `))[0] ?? {};

  return {
    count: toNumber(row.value_count) ?? 0,
    nulls: toNumber(row.null_count) ?? 0,
    unique: toNumber(row.unique_count) ?? 0,
    min: toText(row.min_value),
    max: toText(row.max_value),
    mean: null,
    median: null,
    stddev: null,
    variance: null,
    skewness: null,
    kurtosis: null,
  };
}

async function loadHistogram(
  tableName: string,
  column: ColumnProfile,
): Promise<HistogramBin[]> {
  const table = quoteIdentifier(tableName);
  const field = quoteIdentifier(column.name);

  if (column.type === "number") {
    const rows = await runQuery(`
      WITH clean AS (
        SELECT CAST(${field} AS DOUBLE) AS value
        FROM ${table}
        WHERE ${field} IS NOT NULL
      ),
      bounds AS (
        SELECT MIN(value) AS min_value, MAX(value) AS max_value
        FROM clean
      ),
      bins AS (
        SELECT range AS bucket FROM range(0, 30)
      ),
      grouped AS (
        SELECT
          CASE
            WHEN bounds.max_value = bounds.min_value THEN 0
            ELSE LEAST(
              CAST(FLOOR(((clean.value - bounds.min_value) / NULLIF(bounds.max_value - bounds.min_value, 0)) * 30) AS INTEGER),
              29
            )
          END AS bucket,
          COUNT(*) AS bucket_count
        FROM clean, bounds
        GROUP BY 1
      )
      SELECT
        bins.bucket AS bucket,
        bounds.min_value + ((bounds.max_value - bounds.min_value) / 30.0) * bins.bucket AS start_value,
        CASE
          WHEN bins.bucket = 29 THEN bounds.max_value
          ELSE bounds.min_value + ((bounds.max_value - bounds.min_value) / 30.0) * (bins.bucket + 1)
        END AS end_value,
        COALESCE(grouped.bucket_count, 0) AS bucket_count
      FROM bins, bounds
      LEFT JOIN grouped USING (bucket)
      ORDER BY bucket
    `);

    return rows.map((row) => ({
      label: `${formatMetric(toNumber(row.start_value), 1)}–${formatMetric(toNumber(row.end_value), 1)}`,
      count: toNumber(row.bucket_count) ?? 0,
    }));
  }

  if (column.type === "date") {
    const parsed = `TRY_CAST(${field} AS TIMESTAMP)`;
    const rows = await runQuery(`
      WITH clean AS (
        SELECT DATE_TRUNC('month', ${parsed}) AS bucket
        FROM ${table}
        WHERE ${parsed} IS NOT NULL
      )
      SELECT STRFTIME(bucket, '%Y-%m') AS label, COUNT(*) AS bucket_count
      FROM clean
      GROUP BY 1
      ORDER BY label
      LIMIT 20
    `);

    return rows.map((row) => ({
      label: String(row.label ?? ""),
      count: toNumber(row.bucket_count) ?? 0,
    }));
  }

  const rows = await runQuery(`
    WITH ranked AS (
      SELECT CAST(${field} AS VARCHAR) AS value_label, COUNT(*) AS bucket_count
      FROM ${table}
      WHERE ${field} IS NOT NULL
      GROUP BY 1
    )
    SELECT value_label, bucket_count
    FROM ranked
    ORDER BY bucket_count DESC, value_label
    LIMIT 20
  `);

  return rows.map((row) => ({
    label: String(row.value_label ?? "null"),
    count: toNumber(row.bucket_count) ?? 0,
  }));
}

async function loadFrequencyRows(
  tableName: string,
  columnName: string,
): Promise<FrequencyRow[]> {
  const table = quoteIdentifier(tableName);
  const field = quoteIdentifier(columnName);
  const rows = await runQuery(`
    WITH ranked AS (
      SELECT CAST(${field} AS VARCHAR) AS value_label, COUNT(*) AS value_count
      FROM ${table}
      WHERE ${field} IS NOT NULL
      GROUP BY 1
    )
    SELECT
      value_label,
      value_count,
      value_count * 100.0 / NULLIF(SUM(value_count) OVER (), 0) AS percentage
    FROM ranked
    ORDER BY value_count DESC, value_label
    LIMIT 50
  `);

  return rows.map((row) => ({
    value: String(row.value_label ?? "null"),
    count: toNumber(row.value_count) ?? 0,
    percentage: toNumber(row.percentage) ?? 0,
  }));
}

async function loadPatternMetrics(
  tableName: string,
  columnName: string,
): Promise<PatternMetrics> {
  const table = quoteIdentifier(tableName);
  const field = quoteIdentifier(columnName);
  const row = (await runQuery(String.raw`
    WITH clean AS (
      SELECT CAST(${field} AS VARCHAR) AS value
      FROM ${table}
      WHERE ${field} IS NOT NULL
    )
    SELECT
      COUNT(*) AS non_null_count,
      SUM(CASE WHEN regexp_matches(value, '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') THEN 1 ELSE 0 END) AS email_count,
      SUM(CASE WHEN regexp_matches(value, '^(\+?\d[\d\-\s().]{6,}\d)$') THEN 1 ELSE 0 END) AS phone_count,
      SUM(CASE WHEN regexp_matches(value, '^(https?://|www\.)') THEN 1 ELSE 0 END) AS url_count,
      SUM(CASE WHEN TRIM(value) = '' THEN 1 ELSE 0 END) AS blank_count,
      SUM(CASE WHEN value = TRIM(value) THEN 1 ELSE 0 END) AS trimmed_count
    FROM clean
  `))[0] ?? {};

  return {
    nonNull: toNumber(row.non_null_count) ?? 0,
    emailCount: toNumber(row.email_count) ?? 0,
    phoneCount: toNumber(row.phone_count) ?? 0,
    urlCount: toNumber(row.url_count) ?? 0,
    blankCount: toNumber(row.blank_count) ?? 0,
    trimmedCount: toNumber(row.trimmed_count) ?? 0,
  };
}

async function loadTemporalMetrics(
  tableName: string,
  columnName: string,
): Promise<TemporalMetrics> {
  const table = quoteIdentifier(tableName);
  const field = quoteIdentifier(columnName);
  const parsed = `TRY_CAST(${field} AS TIMESTAMP)`;

  const [summaryRow, weekdayRows, gapRows] = await Promise.all([
    runQuery(`
      WITH clean AS (
        SELECT ${parsed} AS value
        FROM ${table}
        WHERE ${parsed} IS NOT NULL
      )
      SELECT
        CAST(MIN(value) AS VARCHAR) AS min_date,
        CAST(MAX(value) AS VARCHAR) AS max_date,
        DATE_DIFF('day', CAST(MIN(value) AS DATE), CAST(MAX(value) AS DATE)) AS range_days
      FROM clean
    `),
    runQuery(`
      WITH clean AS (
        SELECT ${parsed} AS value
        FROM ${table}
        WHERE ${parsed} IS NOT NULL
      )
      SELECT STRFTIME(value, '%A') AS label, COUNT(*) AS bucket_count
      FROM clean
      GROUP BY 1
      ORDER BY CAST(STRFTIME(MIN(value), '%w') AS INTEGER)
    `),
    runQuery(`
      WITH distinct_days AS (
        SELECT DISTINCT CAST(${parsed} AS DATE) AS day_value
        FROM ${table}
        WHERE ${parsed} IS NOT NULL
      ),
      lagged AS (
        SELECT
          LAG(day_value) OVER (ORDER BY day_value) AS previous_day,
          day_value AS current_day,
          DATE_DIFF('day', LAG(day_value) OVER (ORDER BY day_value), day_value) AS gap_days
        FROM distinct_days
      )
      SELECT
        CAST(previous_day AS VARCHAR) AS start_date,
        CAST(current_day AS VARCHAR) AS end_date,
        gap_days
      FROM lagged
      WHERE previous_day IS NOT NULL AND gap_days > 1
      ORDER BY gap_days DESC, current_day
      LIMIT 8
    `),
  ]);

  const weekdayMap = new Map(
    weekdayRows.map((row) => [String(row.label ?? ""), toNumber(row.bucket_count) ?? 0]),
  );
  const summary = summaryRow[0] ?? {};

  return {
    minDate: toText(summary.min_date),
    maxDate: toText(summary.max_date),
    rangeDays: toNumber(summary.range_days) ?? 0,
    dayOfWeek: WEEKDAYS.map((day) => ({
      label: day,
      count: weekdayMap.get(day) ?? 0,
    })),
    gaps: gapRows.map((row) => ({
      start: String(row.start_date ?? ""),
      end: String(row.end_date ?? ""),
      days: toNumber(row.gap_days) ?? 0,
    })),
  };
}

async function loadOutlierMetrics(
  tableName: string,
  columnName: string,
): Promise<OutlierMetrics> {
  const table = quoteIdentifier(tableName);
  const field = quoteIdentifier(columnName);

  const [summaryRows, outlierRows] = await Promise.all([
    runQuery(`
      WITH bounds AS (
        SELECT
          QUANTILE_CONT(${field}, 0.25) AS q1,
          MEDIAN(${field}) AS median_value,
          QUANTILE_CONT(${field}, 0.75) AS q3
        FROM ${table}
        WHERE ${field} IS NOT NULL
      )
      SELECT
        q1,
        median_value,
        q3,
        q1 - 1.5 * (q3 - q1) AS lower_bound,
        q3 + 1.5 * (q3 - q1) AS upper_bound,
        MIN(${field}) FILTER (WHERE ${field} >= q1 - 1.5 * (q3 - q1)) AS whisker_low,
        MAX(${field}) FILTER (WHERE ${field} <= q3 + 1.5 * (q3 - q1)) AS whisker_high,
        COUNT(*) FILTER (
          WHERE ${field} IS NOT NULL
            AND (
              ${field} < q1 - 1.5 * (q3 - q1)
              OR ${field} > q3 + 1.5 * (q3 - q1)
            )
        ) AS outlier_count
      FROM ${table}, bounds
    `),
    runQuery(`
      WITH bounds AS (
        SELECT
          QUANTILE_CONT(${field}, 0.25) AS q1,
          QUANTILE_CONT(${field}, 0.75) AS q3
        FROM ${table}
        WHERE ${field} IS NOT NULL
      ),
      grouped AS (
        SELECT CAST(${field} AS VARCHAR) AS value_label, COUNT(*) AS value_count
        FROM ${table}, bounds
        WHERE ${field} IS NOT NULL
          AND (
            ${field} < q1 - 1.5 * (q3 - q1)
            OR ${field} > q3 + 1.5 * (q3 - q1)
          )
        GROUP BY 1
      )
      SELECT
        value_label,
        value_count,
        value_count * 100.0 / NULLIF(SUM(value_count) OVER (), 0) AS percentage
      FROM grouped
      ORDER BY value_count DESC, value_label
      LIMIT 12
    `),
  ]);

  const summary = summaryRows[0] ?? {};

  return {
    q1: toNumber(summary.q1),
    median: toNumber(summary.median_value),
    q3: toNumber(summary.q3),
    lowerBound: toNumber(summary.lower_bound),
    upperBound: toNumber(summary.upper_bound),
    whiskerLow: toNumber(summary.whisker_low),
    whiskerHigh: toNumber(summary.whisker_high),
    outlierCount: toNumber(summary.outlier_count) ?? 0,
    topOutliers: outlierRows.map((row) => ({
      value: String(row.value_label ?? ""),
      count: toNumber(row.value_count) ?? 0,
      percentage: toNumber(row.percentage) ?? 0,
    })),
  };
}

function buildQualityMetrics(
  column: ColumnProfile,
  rowCount: number,
  statistics: ColumnStatistics,
  patterns: PatternMetrics | null,
): QualityMetrics {
  const completeness = rowCount > 0 ? (statistics.count / rowCount) * 100 : 0;
  const uniqueness = statistics.count > 0 ? (statistics.unique / statistics.count) * 100 : 0;

  if (column.type === "string" && patterns) {
    const dominantCount = Math.max(patterns.emailCount, patterns.phoneCount, patterns.urlCount);
    const dominantLabel =
      dominantCount === patterns.emailCount
        ? "Email format"
        : dominantCount === patterns.phoneCount
          ? "Phone format"
          : dominantCount === patterns.urlCount
            ? "URL format"
            : "Whitespace hygiene";
    const conformityBase = dominantCount > 0 ? dominantCount : patterns.trimmedCount - patterns.blankCount;
    const patternConformity =
      patterns.nonNull > 0 ? clamp((conformityBase / patterns.nonNull) * 100, 0, 100) : 100;

    return {
      completeness,
      uniqueness,
      patternConformity,
      conformityLabel: dominantCount > 0 ? dominantLabel : "Clean trimmed text",
    };
  }

  return {
    completeness,
    uniqueness,
    patternConformity: 100,
    conformityLabel: column.type === "date" ? "Valid temporal parse" : "Type-consistent values",
  };
}

async function loadAdvancedProfile(
  tableName: string,
  column: ColumnProfile,
  rowCount: number,
): Promise<AdvancedProfileData> {
  const statistics = await loadBaseStatistics(tableName, column);

  const [histogram, frequencyRows, patterns, temporal, outliers] = await Promise.all([
    loadHistogram(tableName, column),
    loadFrequencyRows(tableName, column.name),
    column.type === "string" ? loadPatternMetrics(tableName, column.name) : Promise.resolve(null),
    column.type === "date" ? loadTemporalMetrics(tableName, column.name) : Promise.resolve(null),
    column.type === "number" ? loadOutlierMetrics(tableName, column.name) : Promise.resolve(null),
  ]);

  return {
    statistics,
    histogram,
    frequencyRows,
    patterns,
    temporal,
    outliers,
    quality: buildQualityMetrics(column, rowCount, statistics, patterns),
  };
}

export default function ColumnProfilerAdvanced({
  tableName,
  column,
  rowCount,
  onClose,
}: ColumnProfilerAdvancedProps) {
  const dark = useDarkMode();
  const requestKey = useMemo(
    () => JSON.stringify({ tableName, rowCount, column }),
    [column, rowCount, tableName],
  );

  const [loadState, setLoadState] = useState<LoadState>({
    key: "",
    data: null,
    error: null,
  });
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const data = await loadAdvancedProfile(tableName, column, rowCount);
        if (cancelled) return;
        setLoadState({ key: requestKey, data, error: null });
      } catch (error) {
        if (cancelled) return;
        setLoadState({
          key: requestKey,
          data: null,
          error: error instanceof Error ? error.message : "Failed to profile the selected column.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [column, requestKey, rowCount, tableName]);

  const data = loadState.key === requestKey ? loadState.data : null;
  const loading = loadState.key !== requestKey;

  const histogramColor =
    column.type === "number" ? "#38bdf8" : column.type === "date" ? "#34d399" : "#a855f7";

  const handleCopyStatistics = async () => {
    if (!data) return;
    const payload = {
      tableName,
      column: column.name,
      type: column.type,
      statistics: data.statistics,
      quality: data.quality,
      patterns: data.patterns,
      temporal: data.temporal,
      outliers: data.outliers,
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleExportColumn = async () => {
    setExporting(true);
    try {
      const rows = await runQuery(
        `SELECT ${quoteIdentifier(column.name)} AS value FROM ${quoteIdentifier(tableName)}`,
      );
      const csv = ["value", ...rows.map((row) => escapeCsv(row.value))].join("\n");
      triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${tableName}-${column.name}.csv`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-md sm:p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24, ease: EASE }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 28, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.99 }}
          transition={{ duration: 0.34, ease: EASE }}
          onClick={(event) => event.stopPropagation()}
          className="flex h-[96vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-[2rem] border border-white/15 bg-slate-100/90 shadow-2xl shadow-slate-950/30 backdrop-blur-2xl dark:bg-slate-950/85"
        >
          <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 px-5 py-4 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/80">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-600 dark:text-cyan-400">
                  Column Deep Dive
                </p>
                <h2 className="mt-2 truncate text-2xl font-semibold text-slate-950 dark:text-white">
                  {column.name}
                </h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                  Full statistical profile for <span className="font-medium">{tableName}</span>, including distribution, quality signals, and type-specific analysis.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyStatistics}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-cyan-500/40 dark:hover:text-cyan-300"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy Statistics"}
                </button>
                <button
                  type="button"
                  onClick={handleExportColumn}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-cyan-500/40 dark:hover:text-cyan-300"
                >
                  {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Export Column
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-rose-300 hover:text-rose-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-rose-500/40 dark:hover:text-rose-300"
                >
                  <X className="h-4 w-4" />
                  Close
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {loading && !data ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-72 animate-pulse rounded-[1.75rem] border border-white/20 bg-white/60 dark:border-white/10 dark:bg-slate-900/40"
                  />
                ))}
              </div>
            ) : loadState.error ? (
              <Card title="Profile Error" icon={AlertTriangle} subtitle={loadState.error}>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  DuckDB could not compute the requested column profile for this field.
                </p>
              </Card>
            ) : data ? (
              <div className="grid gap-4">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                  <Card title="Statistics" icon={Sigma} subtitle="Core descriptive metrics computed directly in DuckDB.">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <MetricCell label="Count" value={formatNumber(data.statistics.count)} />
                      <MetricCell label="Nulls" value={formatNumber(data.statistics.nulls)} />
                      <MetricCell label="Unique" value={formatNumber(data.statistics.unique)} />
                      <MetricCell label="Min" value={formatRangeValue(data.statistics.min)} />
                      <MetricCell label="Max" value={formatRangeValue(data.statistics.max)} />
                      <MetricCell label="Mean" value={formatMetric(data.statistics.mean)} />
                      <MetricCell label="Median" value={formatMetric(data.statistics.median)} />
                      <MetricCell label="Stddev" value={formatMetric(data.statistics.stddev)} />
                      <MetricCell label="Variance" value={formatMetric(data.statistics.variance)} />
                      <MetricCell label="Skewness" value={formatMetric(data.statistics.skewness)} />
                      <MetricCell label="Kurtosis" value={formatMetric(data.statistics.kurtosis)} />
                    </div>
                  </Card>

                  <Card title="Data Quality" icon={ShieldCheck} subtitle="Completeness, uniqueness, and conformity indicators for this field.">
                    <div className="space-y-4">
                      {[
                        {
                          label: "Completeness",
                          value: data.quality.completeness,
                          color: "from-emerald-400 to-green-500",
                        },
                        {
                          label: "Uniqueness",
                          value: data.quality.uniqueness,
                          color: "from-cyan-400 to-sky-500",
                        },
                        {
                          label: data.quality.conformityLabel,
                          value: data.quality.patternConformity,
                          color: "from-violet-400 to-fuchsia-500",
                        },
                      ].map((metric) => (
                        <div key={metric.label}>
                          <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                            <span className="text-slate-600 dark:text-slate-300">{metric.label}</span>
                            <span className="font-semibold text-slate-950 dark:text-white">
                              {formatPercent(metric.value)}
                            </span>
                          </div>
                          <div className="h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                            <div
                              className={`h-full rounded-full bg-gradient-to-r ${metric.color}`}
                              style={{ width: `${clamp(metric.value, 3, 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <Card title="Distribution" icon={BarChart3} subtitle={column.type === "number" ? "30-bin histogram" : column.type === "date" ? "Monthly temporal distribution" : "Top 20 values"}>
                    <ReactECharts
                      option={buildHistogramOption(data.histogram, dark, histogramColor)}
                      style={{ height: 320, width: "100%" }}
                    />
                  </Card>

                  <Card title="Value Frequency" icon={Clipboard} subtitle="Top 50 most common values with relative share.">
                    <div className="max-h-[320px] overflow-auto rounded-3xl border border-white/20 dark:border-white/10">
                      <table className="min-w-full divide-y divide-slate-200/70 text-sm dark:divide-slate-800/70">
                        <thead className="sticky top-0 bg-slate-50/90 backdrop-blur dark:bg-slate-950/90">
                          <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                            <th className="px-4 py-3">Value</th>
                            <th className="px-4 py-3">Count</th>
                            <th className="px-4 py-3">Share</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200/70 bg-white/50 dark:divide-slate-800/70 dark:bg-slate-950/30">
                          {data.frequencyRows.map((row) => (
                            <tr key={`${row.value}-${row.count}`}>
                              <td className="max-w-[26rem] px-4 py-3 text-slate-700 dark:text-slate-200" title={row.value}>
                                {row.value}
                              </td>
                              <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                                {formatNumber(row.count)}
                              </td>
                              <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                                {formatPercent(row.percentage, row.percentage >= 10 ? 1 : 2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </div>

                {data.patterns ? (
                  <Card title="Pattern Analysis" icon={Type} subtitle="Regex-based structure detection executed in SQL.">
                    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
                      <MetricCell label="Email-like" value={formatNumber(data.patterns.emailCount)} />
                      <MetricCell label="Phone-like" value={formatNumber(data.patterns.phoneCount)} />
                      <MetricCell label="URL-like" value={formatNumber(data.patterns.urlCount)} />
                      <MetricCell label="Blank Strings" value={formatNumber(data.patterns.blankCount)} />
                    </div>
                    <div className="mt-5 grid gap-4 lg:grid-cols-3">
                      <div className="rounded-3xl border border-cyan-400/20 bg-cyan-500/10 p-4 text-sm text-cyan-700 dark:border-cyan-400/10 dark:text-cyan-200">
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4" />
                          Email coverage
                        </div>
                        <p className="mt-2 text-lg font-semibold">
                          {formatPercent((data.patterns.emailCount / Math.max(data.patterns.nonNull, 1)) * 100)}
                        </p>
                      </div>
                      <div className="rounded-3xl border border-violet-400/20 bg-violet-500/10 p-4 text-sm text-violet-700 dark:border-violet-400/10 dark:text-violet-200">
                        <div className="flex items-center gap-2">
                          <Phone className="h-4 w-4" />
                          Phone coverage
                        </div>
                        <p className="mt-2 text-lg font-semibold">
                          {formatPercent((data.patterns.phoneCount / Math.max(data.patterns.nonNull, 1)) * 100)}
                        </p>
                      </div>
                      <div className="rounded-3xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:border-emerald-400/10 dark:text-emerald-200">
                        <div className="flex items-center gap-2">
                          <Clipboard className="h-4 w-4" />
                          Trimmed values
                        </div>
                        <p className="mt-2 text-lg font-semibold">
                          {formatPercent((data.patterns.trimmedCount / Math.max(data.patterns.nonNull, 1)) * 100)}
                        </p>
                      </div>
                    </div>
                  </Card>
                ) : null}

                {data.temporal ? (
                  <Card title="Temporal Analysis" icon={CalendarRange} subtitle="Range, weekday activity, and date gaps extracted from parsed timestamps.">
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                      <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <MetricCell label="Min Date" value={data.temporal.minDate ?? "—"} />
                          <MetricCell label="Max Date" value={data.temporal.maxDate ?? "—"} />
                          <MetricCell label="Range" value={`${formatNumber(data.temporal.rangeDays)} days`} />
                        </div>
                        <div className="rounded-3xl border border-white/20 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-slate-900/45">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                            Largest Gaps
                          </p>
                          <div className="mt-3 space-y-2">
                            {data.temporal.gaps.length > 0 ? (
                              data.temporal.gaps.map((gap) => (
                                <div
                                  key={`${gap.start}-${gap.end}`}
                                  className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm dark:border-white/10 dark:bg-slate-950/50"
                                >
                                  <div className="font-medium text-slate-950 dark:text-white">
                                    {gap.days} day gap
                                  </div>
                                  <div className="mt-1 text-slate-600 dark:text-slate-300">
                                    {gap.start} → {gap.end}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <p className="text-sm text-slate-600 dark:text-slate-300">
                                No multi-day gaps were detected between observed dates.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-3xl border border-white/20 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-slate-900/45">
                        <ReactECharts
                          option={buildHistogramOption(data.temporal.dayOfWeek, dark, "#34d399")}
                          style={{ height: 320, width: "100%" }}
                        />
                      </div>
                    </div>
                  </Card>
                ) : null}

                {data.outliers ? (
                  <Card title="Outlier Detection" icon={Hash} subtitle="IQR-based outlier scan with whiskers and frequent extreme values.">
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                      <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <MetricCell label="Q1" value={formatMetric(data.outliers.q1)} />
                          <MetricCell label="Median" value={formatMetric(data.outliers.median)} />
                          <MetricCell label="Q3" value={formatMetric(data.outliers.q3)} />
                          <MetricCell label="Lower Bound" value={formatMetric(data.outliers.lowerBound)} />
                          <MetricCell label="Upper Bound" value={formatMetric(data.outliers.upperBound)} />
                          <MetricCell label="Outliers" value={formatNumber(data.outliers.outlierCount)} />
                        </div>
                        <div className="rounded-3xl border border-white/20 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-slate-900/45">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                            Most Frequent Outlier Values
                          </p>
                          <div className="mt-3 space-y-2">
                            {data.outliers.topOutliers.length > 0 ? (
                              data.outliers.topOutliers.map((row) => (
                                <div
                                  key={`${row.value}-${row.count}`}
                                  className="flex items-center justify-between rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-sm dark:border-white/10 dark:bg-slate-950/50"
                                >
                                  <span className="truncate pr-3 text-slate-700 dark:text-slate-200">{row.value}</span>
                                  <span className="font-semibold text-slate-950 dark:text-white">
                                    {formatNumber(row.count)} · {formatPercent(row.percentage, 1)}
                                  </span>
                                </div>
                              ))
                            ) : (
                              <p className="text-sm text-slate-600 dark:text-slate-300">
                                No outlier values exceeded the IQR thresholds.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-3xl border border-white/20 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-slate-900/45">
                        <ReactECharts
                          option={buildBoxPlotOption(data.outliers, dark)}
                          style={{ height: 320, width: "100%" }}
                        />
                      </div>
                    </div>
                  </Card>
                ) : null}
              </div>
            ) : null}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
