"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactECharts from "echarts-for-react";
import {
  Hash,
  Type,
  Calendar,
  ToggleLeft,
  HelpCircle,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  AlertTriangle,
  ListOrdered,
  Regex,
  Clock,
  ArrowDownUp,
} from "lucide-react";
import type { ColumnProfile, ColumnType } from "@/types/dataset";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface ColumnStatsProps {
  tableName: string;
  column: ColumnProfile;
  rowCount: number;
}

interface NumericStats {
  count: number;
  distinctCount: number;
  nullCount: number;
  mean: number;
  median: number;
  mode: number | null;
  stddev: number;
  min: number;
  max: number;
  range: number;
  q1: number;
  q2: number;
  q3: number;
  skewness: number;
  histogram: { bin: string; count: number }[];
  boxplot: { min: number; q1: number; median: number; q3: number; max: number };
}

interface StringStats {
  count: number;
  distinctCount: number;
  nullCount: number;
  minLength: number;
  maxLength: number;
  avgLength: number;
  topValues: { value: string; count: number }[];
  leastCommon: { value: string; count: number }[];
  patterns: string[];
}

interface DateStats {
  count: number;
  distinctCount: number;
  nullCount: number;
  minDate: string;
  maxDate: string;
  dateRange: string;
  monthly: { month: string; count: number }[];
  dayOfWeek: { day: string; count: number }[];
  gaps: { from: string; to: string; gapDays: number }[];
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function quoteId(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

function toNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function isDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

const TYPE_ICONS: Record<ColumnType, React.ElementType> = {
  string: Type,
  number: Hash,
  date: Calendar,
  boolean: ToggleLeft,
  unknown: HelpCircle,
};

const TYPE_COLORS: Record<ColumnType, { accent: string; bg: string }> = {
  number: { accent: "#10b981", bg: "bg-emerald-100 dark:bg-emerald-900/40" },
  string: { accent: "#3b82f6", bg: "bg-blue-100 dark:bg-blue-900/40" },
  date: { accent: "#f59e0b", bg: "bg-amber-100 dark:bg-amber-900/40" },
  boolean: { accent: "#8b5cf6", bg: "bg-purple-100 dark:bg-purple-900/40" },
  unknown: { accent: "#6b7280", bg: "bg-gray-100 dark:bg-gray-800" },
};

const SECTION_VARIANTS = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.35, ease: "easeOut" as const },
  }),
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* -------------------------------------------------------------------------- */
/*  Stat presentational pieces                                                */
/* -------------------------------------------------------------------------- */

function StatRow({ label, value, mono = true }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`text-xs font-medium text-gray-800 dark:text-gray-200 ${mono ? "font-mono" : ""}`}>
        {typeof value === "number" ? formatNumber(value) : value}
      </span>
    </div>
  );
}

function SectionHeading({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-gray-400 dark:text-gray-500" />
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h4>
    </div>
  );
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-lg bg-gray-200/60 dark:bg-gray-700/40 ${className}`} />
  );
}

function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBlock key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-red-500 dark:text-red-400 p-4">
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Chart helpers                                                             */
/* -------------------------------------------------------------------------- */

function baseChartTheme(dark: boolean) {
  return {
    textColor: dark ? "#a1a1aa" : "#71717a",
    borderColor: dark ? "#27272a" : "#e5e7eb",
    bgColor: dark ? "#18181bee" : "#ffffffee",
    tooltipBorder: dark ? "#3f3f46" : "#e5e7eb",
    tooltipText: dark ? "#e4e4e7" : "#27272a",
  };
}

/* -------------------------------------------------------------------------- */
/*  Numeric stats fetcher + view                                              */
/* -------------------------------------------------------------------------- */

async function fetchNumericStats(tableName: string, col: string): Promise<NumericStats> {
  const c = quoteId(col);

  const [basicRows, modeRows, histRows, boxRows] = await Promise.all([
    runQuery(`
      SELECT
        COUNT(${c}) AS cnt,
        COUNT(DISTINCT ${c}) AS distinct_cnt,
        COUNT(*) - COUNT(${c}) AS null_cnt,
        AVG(${c}::DOUBLE) AS mean_val,
        MEDIAN(${c}::DOUBLE) AS median_val,
        STDDEV_SAMP(${c}::DOUBLE) AS stddev_val,
        MIN(${c}::DOUBLE) AS min_val,
        MAX(${c}::DOUBLE) AS max_val,
        QUANTILE_CONT(${c}::DOUBLE, 0.25) AS q1,
        QUANTILE_CONT(${c}::DOUBLE, 0.50) AS q2,
        QUANTILE_CONT(${c}::DOUBLE, 0.75) AS q3,
        SKEWNESS(${c}::DOUBLE) AS skew_val
      FROM "${tableName}"
    `),
    runQuery(`
      SELECT ${c}::DOUBLE AS mode_val, COUNT(*) AS freq
      FROM "${tableName}"
      WHERE ${c} IS NOT NULL
      GROUP BY ${c}
      ORDER BY freq DESC
      LIMIT 1
    `),
    runQuery(`
      WITH bounds AS (
        SELECT MIN(${c}::DOUBLE) AS lo, MAX(${c}::DOUBLE) AS hi FROM "${tableName}" WHERE ${c} IS NOT NULL
      ),
      params AS (
        SELECT lo, hi, CASE WHEN hi = lo THEN 1 ELSE (hi - lo) / 20.0 END AS bw FROM bounds
      )
      SELECT
        FLOOR((${c}::DOUBLE - p.lo) / p.bw) AS bucket,
        ROUND(p.lo + FLOOR((${c}::DOUBLE - p.lo) / p.bw) * p.bw, 4) AS bin_start,
        COUNT(*) AS cnt
      FROM "${tableName}", params p
      WHERE ${c} IS NOT NULL
      GROUP BY bucket, bin_start
      ORDER BY bucket
    `),
    runQuery(`
      SELECT
        MIN(${c}::DOUBLE) AS bx_min,
        QUANTILE_CONT(${c}::DOUBLE, 0.25) AS bx_q1,
        MEDIAN(${c}::DOUBLE) AS bx_med,
        QUANTILE_CONT(${c}::DOUBLE, 0.75) AS bx_q3,
        MAX(${c}::DOUBLE) AS bx_max
      FROM "${tableName}"
      WHERE ${c} IS NOT NULL
    `),
  ]);

  const b = basicRows[0] ?? {};
  const m = modeRows[0];
  const bx = boxRows[0] ?? {};

  return {
    count: toNum(b.cnt),
    distinctCount: toNum(b.distinct_cnt),
    nullCount: toNum(b.null_cnt),
    mean: toNum(b.mean_val),
    median: toNum(b.median_val),
    mode: m ? toNum(m.mode_val) : null,
    stddev: toNum(b.stddev_val),
    min: toNum(b.min_val),
    max: toNum(b.max_val),
    range: toNum(b.max_val) - toNum(b.min_val),
    q1: toNum(b.q1),
    q2: toNum(b.q2),
    q3: toNum(b.q3),
    skewness: toNum(b.skew_val),
    histogram: histRows.map((r) => ({
      bin: String(r.bin_start),
      count: toNum(r.cnt),
    })),
    boxplot: {
      min: toNum(bx.bx_min),
      q1: toNum(bx.bx_q1),
      median: toNum(bx.bx_med),
      q3: toNum(bx.bx_q3),
      max: toNum(bx.bx_max),
    },
  };
}

function NumericStatsView({ stats }: { stats: NumericStats }) {
  const dark = isDark();
  const t = baseChartTheme(dark);
  const accent = TYPE_COLORS.number.accent;

  const SkewnessIcon = stats.skewness > 0.5 ? TrendingUp : stats.skewness < -0.5 ? TrendingDown : Minus;
  const skewnessLabel =
    stats.skewness > 0.5
      ? "Right-skewed"
      : stats.skewness < -0.5
        ? "Left-skewed"
        : "Approximately symmetric";

  const histogramOption = useMemo(
    () => ({
      tooltip: {
        trigger: "axis",
        backgroundColor: t.bgColor,
        borderColor: t.tooltipBorder,
        textStyle: { color: t.tooltipText, fontSize: 12 },
        borderWidth: 1,
      },
      grid: { left: 40, right: 16, top: 16, bottom: 32, containLabel: true },
      xAxis: {
        type: "category",
        data: stats.histogram.map((h) => h.bin),
        axisLabel: {
          color: t.textColor,
          fontSize: 10,
          rotate: 45,
          formatter: (v: string) => {
            const n = Number(v);
            return Number.isFinite(n) ? formatNumber(n) : v;
          },
        },
        axisLine: { lineStyle: { color: t.borderColor } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: t.textColor, fontSize: 10 },
        splitLine: { lineStyle: { color: t.borderColor, type: "dashed" } },
      },
      series: [
        {
          type: "bar",
          data: stats.histogram.map((h) => h.count),
          itemStyle: { color: accent, borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 28,
        },
      ],
    }),
    [stats.histogram, t, accent],
  );

  const boxplotOption = useMemo(() => {
    const bp = stats.boxplot;
    return {
      tooltip: {
        trigger: "item",
        backgroundColor: t.bgColor,
        borderColor: t.tooltipBorder,
        textStyle: { color: t.tooltipText, fontSize: 12 },
        borderWidth: 1,
        formatter: () =>
          `Min: ${formatNumber(bp.min)}<br/>Q1: ${formatNumber(bp.q1)}<br/>Median: ${formatNumber(bp.median)}<br/>Q3: ${formatNumber(bp.q3)}<br/>Max: ${formatNumber(bp.max)}`,
      },
      grid: { left: 40, right: 16, top: 16, bottom: 24 },
      xAxis: { type: "category", data: [""], axisLine: { lineStyle: { color: t.borderColor } } },
      yAxis: {
        type: "value",
        axisLabel: { color: t.textColor, fontSize: 10 },
        splitLine: { lineStyle: { color: t.borderColor, type: "dashed" } },
      },
      series: [
        {
          type: "boxplot",
          data: [[bp.min, bp.q1, bp.median, bp.q3, bp.max]],
          itemStyle: { color: accent, borderColor: accent },
        },
      ],
    };
  }, [stats.boxplot, t, accent]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left - Stats */}
      <div className="space-y-5">
        <motion.div custom={0} variants={SECTION_VARIANTS} initial="hidden" animate="visible">
          <SectionHeading icon={ListOrdered} title="Counts" />
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
            <StatRow label="Total Count" value={stats.count} />
            <StatRow label="Distinct Count" value={stats.distinctCount} />
            <StatRow label="Null Count" value={stats.nullCount} />
            <StatRow label="Null %" value={stats.count + stats.nullCount > 0 ? formatPercent((stats.nullCount / (stats.count + stats.nullCount)) * 100) : "0%"} />
          </div>
        </motion.div>

        <motion.div custom={1} variants={SECTION_VARIANTS} initial="hidden" animate="visible">
          <SectionHeading icon={BarChart3} title="Central Tendency" />
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
            <StatRow label="Mean" value={stats.mean.toFixed(4)} />
            <StatRow label="Median" value={stats.median.toFixed(4)} />
            <StatRow label="Mode" value={stats.mode !== null ? stats.mode.toFixed(4) : "N/A"} />
            <StatRow label="Std Deviation" value={stats.stddev.toFixed(4)} />
          </div>
        </motion.div>

        <motion.div custom={2} variants={SECTION_VARIANTS} initial="hidden" animate="visible">
          <SectionHeading icon={ArrowDownUp} title="Range & Quartiles" />
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
            <StatRow label="Min" value={stats.min.toFixed(4)} />
            <StatRow label="Max" value={stats.max.toFixed(4)} />
            <StatRow label="Range" value={stats.range.toFixed(4)} />
            <StatRow label="Q1 (25th)" value={stats.q1.toFixed(4)} />
            <StatRow label="Q2 (50th)" value={stats.q2.toFixed(4)} />
            <StatRow label="Q3 (75th)" value={stats.q3.toFixed(4)} />
            <StatRow label="IQR" value={(stats.q3 - stats.q1).toFixed(4)} />
          </div>
        </motion.div>

        <motion.div custom={3} variants={SECTION_VARIANTS} initial="hidden" animate="visible">
          <div className="flex items-center gap-2 mb-2">
            <SkewnessIcon className="w-4 h-4 text-gray-400 dark:text-gray-500" />
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Skewness</h4>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
            <StatRow label="Skewness" value={stats.skewness.toFixed(4)} />
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 italic">{skewnessLabel}</div>
          </div>
        </motion.div>
      </div>

      {/* Right - Charts */}
      <div className="space-y-5">
        <motion.div custom={0} variants={SECTION_VARIANTS} initial="hidden" animate="visible">
          <SectionHeading icon={BarChart3} title="Histogram" />
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2">
            <ReactECharts option={histogramOption} style={{ height: 240 }} notMerge />
          </div>
        </motion.div>

        <motion.div custom={1} variants={SECTION_VARIANTS} initial="hidden" animate="visible">
          <SectionHeading icon={ArrowDownUp} title="Box Plot" />
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2">
            <ReactECharts option={boxplotOption} style={{ height: 200 }} notMerge />
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  String stats fetcher + view                                               */
/* -------------------------------------------------------------------------- */

async function fetchStringStats(tableName: string, col: string): Promise<StringStats> {
  const c = quoteId(col);

  const [basicRows, topRows, leastRows, patternRows] = await Promise.all([
    runQuery(`
      SELECT
        COUNT(${c}) AS cnt,
        COUNT(DISTINCT ${c}) AS distinct_cnt,
        COUNT(*) - COUNT(${c}) AS null_cnt,
        MIN(LENGTH(${c})) AS min_len,
        MAX(LENGTH(${c})) AS max_len,
        AVG(LENGTH(${c})) AS avg_len
      FROM "${tableName}"
    `),
    runQuery(`
      SELECT ${c} AS val, COUNT(*) AS freq
      FROM "${tableName}"
      WHERE ${c} IS NOT NULL
      GROUP BY ${c}
      ORDER BY freq DESC
      LIMIT 10
    `),
    runQuery(`
      SELECT ${c} AS val, COUNT(*) AS freq
      FROM "${tableName}"
      WHERE ${c} IS NOT NULL
      GROUP BY ${c}
      ORDER BY freq ASC
      LIMIT 5
    `),
    runQuery(`
      SELECT
        SUM(CASE WHEN regexp_matches(${c}, '^[\\w.+-]+@[\\w-]+\\.[a-zA-Z]{2,}$') THEN 1 ELSE 0 END) AS email_cnt,
        SUM(CASE WHEN regexp_matches(${c}, '^\\d{4}-\\d{2}-\\d{2}') THEN 1 ELSE 0 END) AS date_cnt,
        SUM(CASE WHEN regexp_matches(${c}, '^https?://') THEN 1 ELSE 0 END) AS url_cnt,
        SUM(CASE WHEN regexp_matches(${c}, '^\\+?\\d[\\d\\s\\-()]{6,}$') THEN 1 ELSE 0 END) AS phone_cnt,
        SUM(CASE WHEN regexp_matches(${c}, '^[A-Z]{1,3}[\\-\\s]?\\d{2,}') THEN 1 ELSE 0 END) AS code_cnt,
        COUNT(${c}) AS total
      FROM "${tableName}"
      WHERE ${c} IS NOT NULL
    `),
  ]);

  const b = basicRows[0] ?? {};
  const p = patternRows[0] ?? {};
  const total = toNum(p.total) || 1;
  const patterns: string[] = [];

  if (toNum(p.email_cnt) / total > 0.5) patterns.push("Looks like email addresses");
  if (toNum(p.date_cnt) / total > 0.5) patterns.push("Looks like date strings");
  if (toNum(p.url_cnt) / total > 0.5) patterns.push("Looks like URLs");
  if (toNum(p.phone_cnt) / total > 0.5) patterns.push("Looks like phone numbers");
  if (toNum(p.code_cnt) / total > 0.3) patterns.push("Looks like codes / identifiers");
  if (patterns.length === 0) patterns.push("No dominant pattern detected");

  return {
    count: toNum(b.cnt),
    distinctCount: toNum(b.distinct_cnt),
    nullCount: toNum(b.null_cnt),
    minLength: toNum(b.min_len),
    maxLength: toNum(b.max_len),
    avgLength: toNum(b.avg_len),
    topValues: topRows.map((r) => ({ value: String(r.val ?? ""), count: toNum(r.freq) })),
    leastCommon: leastRows.map((r) => ({ value: String(r.val ?? ""), count: toNum(r.freq) })),
    patterns,
  };
}

function StringStatsView({ stats }: { stats: StringStats }) {
  const dark = isDark();
  const t = baseChartTheme(dark);
  const accent = TYPE_COLORS.string.accent;
  const maxCount = stats.topValues.length > 0 ? stats.topValues[0].count : 1;

  const topValuesOption = useMemo(
    () => ({
      tooltip: {
        trigger: "axis",
        backgroundColor: t.bgColor,
        borderColor: t.tooltipBorder,
        textStyle: { color: t.tooltipText, fontSize: 12 },
        borderWidth: 1,
      },
      grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: "value",
        axisLabel: { color: t.textColor, fontSize: 10 },
        splitLine: { lineStyle: { color: t.borderColor, type: "dashed" } },
      },
      yAxis: {
        type: "category",
        data: [...stats.topValues].reverse().map((v) => {
          const label = v.value;
          return label.length > 20 ? label.slice(0, 18) + "\u2026" : label;
        }),
        axisLabel: { color: t.textColor, fontSize: 10, width: 120, overflow: "truncate" },
        axisLine: { lineStyle: { color: t.borderColor } },
        axisTick: { show: false },
      },
      series: [
        {
          type: "bar",
          data: [...stats.topValues].reverse().map((v) => v.count),
          itemStyle: { color: accent, borderRadius: [0, 3, 3, 0] },
          barMaxWidth: 20,
        },
      ],
    }),
    [stats.topValues, t, accent],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left - Stats */}
      <div className="space-y-5">
        <motion.div custom={0} variants={SECTION_VARIANTS} initial="hidden" animate="visible">
          <SectionHeading icon={ListOrdered} title="Counts" />
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
            <StatRow label="Total Count" value={stats.count} />
            <StatRow label="Distinct Count" value={stats.distinctCount} />
            <StatRow label="Null Count" value={stats.nullCount} />
            <StatRow label="Uniqueness" value={stats.count > 0 ? formatPercent((stats.distinctCount / stats.count) * 100) : "N/A"} />
          </div>
        </motion.div>

        <motion.div custom={1} variants={SECTION_VARIANTS} initial="hidden" animate="visible">
          <SectionHeading icon={Type} title="Length Analysis" />
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
            <StatRow label="Min Length" value={stats.minLength} />
            <StatRow label="Max Length" value={stats.maxLength} />
            <StatRow label="Avg Length" value={stats.avgLength.toFixed(1)} />
          </div>
        </motion.div>

        <motion.div custom={2} variants={SECTION_VARIANTS} initial="hidden" animate="visible">
          <SectionHeading icon={Regex} title="Pattern Analysis" />
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-1.5">
            {stats.patterns.map((p, i) => (
              <div key={i} className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-2">
                <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-blue-400 dark:bg-blue-500 flex-shrink-0" />
                {p}
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div custom={3} variants={SECTION_VARIANTS} initial="hidden" animate="visible">
          <SectionHeading icon={ArrowDownUp} title="Least Common Values" />
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
            {stats.leastCommon.map((v, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                <span className="text-xs text-gray-600 dark:text-gray-400 truncate max-w-[60%]" title={v.value}>
                  {v.value || "(empty)"}
                </span>
                <span className="text-xs font-mono text-gray-800 dark:text-gray-200">{formatNumber(v.count)}</span>
              </div>
            ))}
            {stats.leastCommon.length === 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">No data</p>
            )}
          </div>
        </motion.div>
      </div>

      {/* Right - Charts */}
      <div className="space-y-5">
        <motion.div custom={0} variants={SECTION_VARIANTS} initial="hidden" animate="visible">
          <SectionHeading icon={BarChart3} title="Top 10 Values" />
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2">
            <ReactECharts option={topValuesOption} style={{ height: Math.max(180, stats.topValues.length * 28) }} notMerge />
          </div>
        </motion.div>

        <motion.div custom={1} variants={SECTION_VARIANTS} initial="hidden" animate="visible">
          <SectionHeading icon={BarChart3} title="Value Frequency" />
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-2">
            {stats.topValues.slice(0, 5).map((v, i) => (
              <div key={i}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600 dark:text-gray-400 truncate max-w-[60%]" title={v.value}>
                    {v.value || "(empty)"}
                  </span>
                  <span className="font-mono text-gray-700 dark:text-gray-300">{formatNumber(v.count)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: accent }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(v.count / maxCount) * 100}%` }}
                    transition={{ duration: 0.5, delay: i * 0.06 }}
                  />
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Date stats fetcher + view                                                 */
/* -------------------------------------------------------------------------- */

async function fetchDateStats(tableName: string, col: string): Promise<DateStats> {
  const c = quoteId(col);

  const [basicRows, monthlyRows, dowRows, gapRows] = await Promise.all([
    runQuery(`
      SELECT
        COUNT(${c}) AS cnt,
        COUNT(DISTINCT ${c}) AS distinct_cnt,
        COUNT(*) - COUNT(${c}) AS null_cnt,
        MIN(${c}::DATE)::VARCHAR AS min_d,
        MAX(${c}::DATE)::VARCHAR AS max_d,
        DATEDIFF('day', MIN(${c}::DATE), MAX(${c}::DATE)) AS range_days
      FROM "${tableName}"
    `),
    runQuery(`
      SELECT
        STRFTIME(${c}::DATE, '%Y-%m') AS month_key,
        COUNT(*) AS cnt
      FROM "${tableName}"
      WHERE ${c} IS NOT NULL
      GROUP BY month_key
      ORDER BY month_key
    `),
    runQuery(`
      SELECT
        DAYOFWEEK(${c}::DATE) AS dow,
        COUNT(*) AS cnt
      FROM "${tableName}"
      WHERE ${c} IS NOT NULL
      GROUP BY dow
      ORDER BY dow
    `),
    runQuery(`
      WITH ordered AS (
        SELECT ${c}::DATE AS d, LAG(${c}::DATE) OVER (ORDER BY ${c}::DATE) AS prev_d
        FROM "${tableName}"
        WHERE ${c} IS NOT NULL
      ),
      gaps AS (
        SELECT prev_d::VARCHAR AS gap_from, d::VARCHAR AS gap_to, DATEDIFF('day', prev_d, d) AS gap_days
        FROM ordered
        WHERE prev_d IS NOT NULL AND DATEDIFF('day', prev_d, d) > 30
      )
      SELECT * FROM gaps ORDER BY gap_days DESC LIMIT 5
    `),
  ]);

  const b = basicRows[0] ?? {};
  const rangeDays = toNum(b.range_days);
  let dateRange = `${rangeDays} days`;
  if (rangeDays > 365) dateRange = `${(rangeDays / 365.25).toFixed(1)} years`;
  else if (rangeDays > 60) dateRange = `${Math.round(rangeDays / 30.44)} months`;

  return {
    count: toNum(b.cnt),
    distinctCount: toNum(b.distinct_cnt),
    nullCount: toNum(b.null_cnt),
    minDate: String(b.min_d ?? "N/A"),
    maxDate: String(b.max_d ?? "N/A"),
    dateRange,
    monthly: monthlyRows.map((r) => ({ month: String(r.month_key), count: toNum(r.cnt) })),
    dayOfWeek: dowRows.map((r) => ({
      day: DAY_LABELS[toNum(r.dow)] ?? String(r.dow),
      count: toNum(r.cnt),
    })),
    gaps: gapRows.map((r) => ({
      from: String(r.gap_from),
      to: String(r.gap_to),
      gapDays: toNum(r.gap_days),
    })),
  };
}

function DateStatsView({ stats }: { stats: DateStats }) {
  const dark = isDark();
  const t = baseChartTheme(dark);
  const accent = TYPE_COLORS.date.accent;

  const monthlyOption = useMemo(
    () => ({
      tooltip: {
        trigger: "axis",
        backgroundColor: t.bgColor,
        borderColor: t.tooltipBorder,
        textStyle: { color: t.tooltipText, fontSize: 12 },
        borderWidth: 1,
      },
      grid: { left: 40, right: 16, top: 16, bottom: 40, containLabel: true },
      xAxis: {
        type: "category",
        data: stats.monthly.map((m) => m.month),
        axisLabel: { color: t.textColor, fontSize: 10, rotate: 45 },
        axisLine: { lineStyle: { color: t.borderColor } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: t.textColor, fontSize: 10 },
        splitLine: { lineStyle: { color: t.borderColor, type: "dashed" } },
      },
      series: [
        {
          type: "line",
          data: stats.monthly.map((m) => m.count),
          smooth: true,
          lineStyle: { color: accent, width: 2 },
          itemStyle: { color: accent },
          areaStyle: { color: accent + "22" },
          symbol: "circle",
          symbolSize: 4,
        },
      ],
    }),
    [stats.monthly, t, accent],
  );

  const dowOption = useMemo(
    () => ({
      tooltip: {
        trigger: "axis",
        backgroundColor: t.bgColor,
        borderColor: t.tooltipBorder,
        textStyle: { color: t.tooltipText, fontSize: 12 },
        borderWidth: 1,
      },
      grid: { left: 40, right: 16, top: 16, bottom: 24 },
      xAxis: {
        type: "category",
        data: stats.dayOfWeek.map((d) => d.day),
        axisLabel: { color: t.textColor, fontSize: 10 },
        axisLine: { lineStyle: { color: t.borderColor } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: t.textColor, fontSize: 10 },
        splitLine: { lineStyle: { color: t.borderColor, type: "dashed" } },
      },
      series: [
        {
          type: "bar",
          data: stats.dayOfWeek.map((d) => d.count),
          itemStyle: { color: accent, borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 32,
        },
      ],
    }),
    [stats.dayOfWeek, t, accent],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left - Stats */}
      <div className="space-y-5">
        <motion.div custom={0} variants={SECTION_VARIANTS} initial="hidden" animate="visible">
          <SectionHeading icon={ListOrdered} title="Counts" />
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
            <StatRow label="Total Count" value={stats.count} />
            <StatRow label="Distinct Count" value={stats.distinctCount} />
            <StatRow label="Null Count" value={stats.nullCount} />
          </div>
        </motion.div>

        <motion.div custom={1} variants={SECTION_VARIANTS} initial="hidden" animate="visible">
          <SectionHeading icon={Calendar} title="Date Range" />
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
            <StatRow label="Earliest" value={stats.minDate} mono={false} />
            <StatRow label="Latest" value={stats.maxDate} mono={false} />
            <StatRow label="Span" value={stats.dateRange} mono={false} />
          </div>
        </motion.div>

        <motion.div custom={2} variants={SECTION_VARIANTS} initial="hidden" animate="visible">
          <SectionHeading icon={Clock} title="Gap Detection" />
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
            {stats.gaps.length === 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">No significant gaps ({">"}30 days) detected</p>
            )}
            {stats.gaps.map((g, i) => (
              <div key={i} className="py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500 dark:text-gray-400">{g.from} to {g.to}</span>
                  <span className="text-xs font-mono font-medium text-amber-600 dark:text-amber-400">{g.gapDays}d</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Right - Charts */}
      <div className="space-y-5">
        <motion.div custom={0} variants={SECTION_VARIANTS} initial="hidden" animate="visible">
          <SectionHeading icon={TrendingUp} title="Values per Month" />
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2">
            <ReactECharts option={monthlyOption} style={{ height: 240 }} notMerge />
          </div>
        </motion.div>

        <motion.div custom={1} variants={SECTION_VARIANTS} initial="hidden" animate="visible">
          <SectionHeading icon={BarChart3} title="Day of Week Distribution" />
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2">
            <ReactECharts option={dowOption} style={{ height: 200 }} notMerge />
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

export default function ColumnStats({ tableName, column, rowCount }: ColumnStatsProps) {
  const [numericStats, setNumericStats] = useState<NumericStats | null>(null);
  const [stringStats, setStringStats] = useState<StringStats | null>(null);
  const [dateStats, setDateStats] = useState<DateStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const TypeIcon = TYPE_ICONS[column.type] ?? HelpCircle;
  const colors = TYPE_COLORS[column.type] ?? TYPE_COLORS.unknown;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        if (column.type === "number") {
          const data = await fetchNumericStats(tableName, column.name);
          if (!cancelled) setNumericStats(data);
        } else if (column.type === "string") {
          const data = await fetchStringStats(tableName, column.name);
          if (!cancelled) setStringStats(data);
        } else if (column.type === "date") {
          const data = await fetchDateStats(tableName, column.name);
          if (!cancelled) setDateStats(data);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load column statistics");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [tableName, column.name, column.type]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="rounded-xl backdrop-blur-xl bg-white/60 dark:bg-gray-900/60 border border-gray-200/50 dark:border-gray-700/50 shadow-sm"
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-5 border-b border-gray-200 dark:border-gray-700">
        <div className={`w-8 h-8 rounded-lg ${colors.bg} flex items-center justify-center`}>
          <TypeIcon className="w-4 h-4" style={{ color: colors.accent }} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{column.name}</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {column.type.charAt(0).toUpperCase() + column.type.slice(1)} column &middot; {formatNumber(rowCount)} rows
          </p>
        </div>
        {loading && (
          <Loader2 className="w-4 h-4 text-gray-400 dark:text-gray-500 animate-spin flex-shrink-0" />
        )}
      </div>

      {/* Body */}
      <div className="p-5">
        <AnimatePresence mode="wait">
          {loading && (
            <motion.div key="skeleton" exit={{ opacity: 0 }} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <SkeletonRows count={8} />
              <div className="space-y-4">
                <SkeletonBlock className="h-48" />
                <SkeletonBlock className="h-36" />
              </div>
            </motion.div>
          )}

          {!loading && error && <ErrorState message={error} />}

          {!loading && !error && column.type === "number" && numericStats && (
            <motion.div key="numeric" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <NumericStatsView stats={numericStats} />
            </motion.div>
          )}

          {!loading && !error && column.type === "string" && stringStats && (
            <motion.div key="string" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <StringStatsView stats={stringStats} />
            </motion.div>
          )}

          {!loading && !error && column.type === "date" && dateStats && (
            <motion.div key="date" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <DateStatsView stats={dateStats} />
            </motion.div>
          )}

          {!loading && !error && !["number", "string", "date"].includes(column.type) && (
            <motion.div key="unsupported" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="text-center py-8">
                <HelpCircle className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Detailed statistics are not available for <span className="font-medium">{column.type}</span> columns.
                </p>
                <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 max-w-xs mx-auto">
                  <StatRow label="Non-null Count" value={rowCount - column.nullCount} />
                  <StatRow label="Null Count" value={column.nullCount} />
                  <StatRow label="Unique Count" value={column.uniqueCount} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
