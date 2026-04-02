"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ElementType,
} from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CalendarRange,
  Database,
  HardDrive,
  Hash,
  Rows3,
  ShieldCheck,
  Type,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataProfilerSummaryProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

interface SummaryMetrics {
  totalRows: number;
  totalColumns: number;
  numericColumns: number;
  textColumns: number;
  dateColumns: number;
  totalNulls: number;
  completeness: number;
  qualityScore: number;
  memoryBytes: number;
  outlierColumns: number;
}

interface SummaryLoadState {
  key: string;
  metrics: SummaryMetrics | null;
  error: string | null;
}

interface TrendMeta {
  direction: "up" | "down" | "flat";
  label: string;
  tone: "emerald" | "sky" | "amber" | "rose";
  points: number[];
}

interface MetricCardConfig {
  icon: ElementType;
  label: string;
  value: number;
  formatter: (value: number) => string;
  accent: string;
  trend: TrendMeta;
}

const EASE = [0.22, 1, 0.36, 1] as const;

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function toNumber(value: unknown) {
  const parsed = value == null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatPercent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
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

function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(0);
  const previousTargetRef = useRef(0);

  useEffect(() => {
    let frame = 0;
    let startTime = 0;
    const previous = previousTargetRef.current;
    const delta = target - previous;
    previousTargetRef.current = target;

    function tick(timestamp: number) {
      if (!startTime) startTime = timestamp;
      const progress = clamp((timestamp - startTime) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(previous + delta * eased);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    }

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [duration, target]);

  return value;
}

function Sparkline({
  points,
  color,
  dark,
}: {
  points: number[];
  color: string;
  dark: boolean;
}) {
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const spread = Math.max(max - min, 1);
  const coordinates = points.map((point, index) => {
    const x = (index / Math.max(points.length - 1, 1)) * 100;
    const y = 100 - ((point - min) / spread) * 100;
    return `${x},${y}`;
  });

  return (
    <svg viewBox="0 0 100 36" className="h-9 w-20">
      <polyline
        fill="none"
        stroke={dark ? "rgba(148,163,184,0.25)" : "rgba(148,163,184,0.3)"}
        strokeWidth="1"
        points="0,32 100,32"
      />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={coordinates.join(" ")}
      />
    </svg>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  formatter,
  accent,
  trend,
  index,
}: MetricCardConfig & { index: number }) {
  const dark = useDarkMode();
  const animated = useCountUp(value);
  const arrow = trend.direction === "up" ? "\u2191" : trend.direction === "down" ? "\u2193" : "\u2192";
  const trendTone =
    trend.tone === "emerald"
      ? "text-emerald-600 dark:text-emerald-300"
      : trend.tone === "sky"
        ? "text-sky-600 dark:text-sky-300"
        : trend.tone === "amber"
          ? "text-amber-600 dark:text-amber-300"
          : "text-rose-600 dark:text-rose-300";

  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, delay: index * 0.04, ease: EASE }}
      className="rounded-3xl border border-white/20 bg-white/70 p-4 shadow-xl shadow-slate-950/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45"
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-2xl p-3 ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
        <Sparkline
          points={trend.points}
          color={trend.tone === "emerald" ? "#34d399" : trend.tone === "sky" ? "#38bdf8" : trend.tone === "amber" ? "#f59e0b" : "#fb7185"}
          dark={dark}
        />
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
        {formatter(animated)}
      </p>
      <p className={`mt-2 text-xs font-medium ${trendTone}`}>
        {arrow} {trend.label}
      </p>
    </motion.article>
  );
}

function buildTrendPoints(seed: number) {
  const base = clamp(seed, 0.05, 1);
  return [
    base * 0.58,
    base * 0.72,
    base * 0.68,
    base * 0.84,
    base,
  ].map((value) => Number(value.toFixed(3)));
}

async function loadSummaryMetrics(
  tableName: string,
  columns: ColumnProfile[],
  rowCount: number,
): Promise<SummaryMetrics> {
  const table = quoteIdentifier(tableName);
  const numericColumns = columns.filter((column) => column.type === "number");
  const textColumns = columns.filter((column) => column.type === "string");
  const dateColumns = columns.filter((column) => column.type === "date");

  const nullExpression =
    columns.length > 0
      ? columns
          .map((column) => `SUM(CASE WHEN ${quoteIdentifier(column.name)} IS NULL THEN 1 ELSE 0 END)`)
          .join(" + ")
      : "0";

  const byteExpression =
    columns.length > 0
      ? columns
          .map((column) => `SUM(COALESCE(LENGTH(CAST(${quoteIdentifier(column.name)} AS VARCHAR)), 0))`)
          .join(" + ")
      : "0";

  const totalsSql = `
    SELECT
      COUNT(*) AS total_rows,
      ${nullExpression} AS total_nulls,
      ${byteExpression} AS approx_bytes
    FROM ${table}
  `;

  const totalsRow = (await runQuery(totalsSql))[0] ?? {};

  let outlierColumns = 0;

  if (numericColumns.length > 0) {
    const outlierSql = numericColumns
      .map((column) => {
        const field = quoteIdentifier(column.name);
        return `
          WITH bounds AS (
            SELECT
              QUANTILE_CONT(${field}, 0.25) AS q1,
              QUANTILE_CONT(${field}, 0.75) AS q3
            FROM ${table}
            WHERE ${field} IS NOT NULL
          )
          SELECT
            '${column.name.replace(/'/g, "''")}' AS column_name,
            COUNT(${field}) AS non_null_count,
            COUNT(*) FILTER (
              WHERE ${field} IS NOT NULL
                AND (
                  ${field} < q1 - 1.5 * (q3 - q1)
                  OR ${field} > q3 + 1.5 * (q3 - q1)
                )
            ) AS outlier_count
          FROM ${table}, bounds
        `;
      })
      .join(" UNION ALL ");

    const outlierRows = await runQuery(outlierSql);
    outlierColumns = outlierRows.filter((row) => {
      const count = toNumber(row.outlier_count);
      const nonNull = toNumber(row.non_null_count);
      return count > Math.max(nonNull * 0.01, 5);
    }).length;
  }

  const totalRows = Math.max(toNumber(totalsRow.total_rows), rowCount);
  const totalColumns = columns.length;
  const totalNulls = toNumber(totalsRow.total_nulls);
  const totalCells = Math.max(totalRows * Math.max(totalColumns, 1), 1);
  const completeness = ((totalCells - totalNulls) / totalCells) * 100;
  const averageUniqueness =
    columns.reduce((sum, column) => {
      const nonNull = Math.max(totalRows - column.nullCount, 1);
      return sum + clamp(column.uniqueCount / nonNull, 0, 1);
    }, 0) / Math.max(columns.length, 1);
  const outlierPenalty = numericColumns.length > 0 ? outlierColumns / numericColumns.length : 0;
  const qualityScore = clamp(
    completeness * 0.65 + averageUniqueness * 100 * 0.2 + (1 - outlierPenalty) * 100 * 0.15,
    0,
    100,
  );

  return {
    totalRows,
    totalColumns,
    numericColumns: numericColumns.length,
    textColumns: textColumns.length,
    dateColumns: dateColumns.length,
    totalNulls,
    completeness,
    qualityScore,
    memoryBytes: toNumber(totalsRow.approx_bytes),
    outlierColumns,
  };
}

export default function DataProfilerSummary({
  tableName,
  columns,
  rowCount,
}: DataProfilerSummaryProps) {
  const requestKey = useMemo(
    () =>
      JSON.stringify({
        tableName,
        rowCount,
        columns: columns.map((column) => [column.name, column.type, column.nullCount, column.uniqueCount]),
      }),
    [columns, rowCount, tableName],
  );

  const [loadState, setLoadState] = useState<SummaryLoadState>({
    key: "",
    metrics: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const metrics = await loadSummaryMetrics(tableName, columns, rowCount);
        if (cancelled) return;
        setLoadState({ key: requestKey, metrics, error: null });
      } catch (error) {
        if (cancelled) return;
        setLoadState({
          key: requestKey,
          metrics: null,
          error: error instanceof Error ? error.message : "Failed to profile dataset summary.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [columns, requestKey, rowCount, tableName]);

  const metrics = loadState.key === requestKey ? loadState.metrics : null;
  const loading = loadState.key !== requestKey;

  const typeDistribution = useMemo(() => {
    const numeric = columns.filter((column) => column.type === "number").length;
    const text = columns.filter((column) => column.type === "string").length;
    const dates = columns.filter((column) => column.type === "date").length;
    const other = Math.max(columns.length - numeric - text - dates, 0);
    return [
      { label: "Numeric", count: numeric, className: "from-cyan-400 to-sky-500" },
      { label: "Text", count: text, className: "from-violet-400 to-fuchsia-500" },
      { label: "Date", count: dates, className: "from-emerald-400 to-green-500" },
      { label: "Other", count: other, className: "from-amber-400 to-orange-500" },
    ];
  }, [columns]);

  const cards = useMemo<MetricCardConfig[]>(() => {
    if (!metrics) return [];

    const nullRate = metrics.totalColumns > 0 ? metrics.totalNulls / (metrics.totalRows * metrics.totalColumns || 1) : 0;

    return [
      {
        icon: Rows3,
        label: "Total Rows",
        value: metrics.totalRows,
        formatter: (value) => formatNumber(Math.round(value)),
        accent: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
        trend: { direction: "up", label: "Dataset scale", tone: "sky", points: buildTrendPoints(clamp(metrics.totalRows / 5000, 0.08, 1)) },
      },
      {
        icon: Database,
        label: "Total Columns",
        value: metrics.totalColumns,
        formatter: (value) => formatNumber(Math.round(value)),
        accent: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
        trend: { direction: "flat", label: "Schema breadth", tone: "sky", points: buildTrendPoints(clamp(metrics.totalColumns / 32, 0.1, 1)) },
      },
      {
        icon: Hash,
        label: "Numeric Columns",
        value: metrics.numericColumns,
        formatter: (value) => formatNumber(Math.round(value)),
        accent: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
        trend: { direction: "up", label: "Quant-heavy fields", tone: "sky", points: buildTrendPoints(clamp(metrics.numericColumns / Math.max(metrics.totalColumns, 1), 0.08, 1)) },
      },
      {
        icon: Type,
        label: "Text Columns",
        value: metrics.textColumns,
        formatter: (value) => formatNumber(Math.round(value)),
        accent: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
        trend: { direction: "flat", label: "Categorical richness", tone: "amber", points: buildTrendPoints(clamp(metrics.textColumns / Math.max(metrics.totalColumns, 1), 0.08, 1)) },
      },
      {
        icon: CalendarRange,
        label: "Date Columns",
        value: metrics.dateColumns,
        formatter: (value) => formatNumber(Math.round(value)),
        accent: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        trend: { direction: "up", label: "Temporal coverage", tone: "emerald", points: buildTrendPoints(clamp(metrics.dateColumns / Math.max(metrics.totalColumns, 1), 0.08, 1)) },
      },
      {
        icon: AlertTriangle,
        label: "Total Nulls",
        value: metrics.totalNulls,
        formatter: (value) => formatNumber(Math.round(value)),
        accent: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        trend: { direction: nullRate > 0.08 ? "down" : "flat", label: `${formatPercent((1 - nullRate) * 100)} filled`, tone: nullRate > 0.08 ? "rose" : "amber", points: buildTrendPoints(clamp(1 - nullRate, 0.08, 1)) },
      },
      {
        icon: ShieldCheck,
        label: "Data Quality Score",
        value: metrics.qualityScore,
        formatter: (value) => formatPercent(value, 1),
        accent: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        trend: { direction: metrics.qualityScore >= 90 ? "up" : metrics.qualityScore >= 75 ? "flat" : "down", label: `${metrics.outlierColumns} outlier-sensitive columns`, tone: metrics.qualityScore >= 90 ? "emerald" : metrics.qualityScore >= 75 ? "amber" : "rose", points: buildTrendPoints(clamp(metrics.qualityScore / 100, 0.08, 1)) },
      },
      {
        icon: HardDrive,
        label: "Memory Estimate",
        value: metrics.memoryBytes,
        formatter: (value) => formatBytes(value),
        accent: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
        trend: { direction: metrics.memoryBytes > 25 * 1024 ** 2 ? "down" : "flat", label: metrics.memoryBytes > 25 * 1024 ** 2 ? "Heavy browser footprint" : "Comfortable in-browser size", tone: metrics.memoryBytes > 25 * 1024 ** 2 ? "rose" : "sky", points: buildTrendPoints(clamp(metrics.memoryBytes / (32 * 1024 ** 2), 0.08, 1)) },
      },
    ];
  }, [metrics]);

  const summaryText = useMemo(() => {
    if (!metrics) return "";

    const dominantSegment =
      [...typeDistribution].sort((left, right) => right.count - left.count)[0]?.label.toLowerCase() ?? "mixed";
    const completenessText = formatPercent(metrics.completeness, 1);
    const outlierText =
      metrics.outlierColumns === 0
        ? "No columns currently show significant IQR outlier pressure."
        : `${metrics.outlierColumns} column${metrics.outlierColumns === 1 ? "" : "s"} have significant outliers.`;

    return `Your dataset has ${formatNumber(metrics.totalRows)} rows across ${formatNumber(
      metrics.totalColumns,
    )} columns with ${completenessText} data completeness. The schema is mostly ${dominantSegment}, and the in-browser memory estimate is ${formatBytes(
      metrics.memoryBytes,
    )}. ${outlierText}`;
  }, [metrics, typeDistribution]);

  if (loading && !metrics) {
    return (
      <section className="rounded-[2rem] border border-white/20 bg-white/70 p-6 shadow-xl shadow-slate-950/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="h-36 animate-pulse rounded-3xl border border-white/20 bg-slate-200/60 dark:border-white/10 dark:bg-slate-800/40"
            />
          ))}
        </div>
      </section>
    );
  }

  if (!metrics) {
    return (
      <section className="rounded-[2rem] border border-rose-300/30 bg-rose-500/10 p-6 backdrop-blur-xl dark:border-rose-500/20 dark:bg-rose-500/10">
        <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
          {loadState.error ?? "Unable to compute the dataset summary."}
        </p>
      </section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: EASE }}
      className="rounded-[2rem] border border-white/20 bg-white/70 p-6 shadow-xl shadow-slate-950/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45"
    >
      <div className="flex flex-col gap-4 border-b border-slate-200/70 pb-5 dark:border-slate-800/70 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-600 dark:text-cyan-400">
            Executive Summary
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            Profile snapshot for {tableName}
          </h2>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-600 dark:text-slate-300">
            {summaryText}
          </p>
        </div>
        <div className="rounded-3xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-700 dark:border-cyan-400/10 dark:text-cyan-200">
          Score <span className="font-semibold">{formatPercent(metrics.qualityScore)}</span>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card, index) => (
          <MetricCard key={card.label} index={index} {...card} />
        ))}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <div className="rounded-3xl border border-white/20 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-slate-900/45">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Column Type Mix
          </p>
          <div className="mt-4 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800/80">
            <div className="flex h-4 w-full">
              {typeDistribution.map((segment) => (
                <div
                  key={segment.label}
                  className={`bg-gradient-to-r ${segment.className}`}
                  style={{
                    width: `${(segment.count / Math.max(columns.length, 1)) * 100}%`,
                  }}
                  title={`${segment.label}: ${segment.count}`}
                />
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {typeDistribution.map((segment) => (
              <div
                key={segment.label}
                className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-slate-950/50"
              >
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  {segment.label}
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                  {formatNumber(segment.count)}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-white/20 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-slate-900/45">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Quality Notes
          </p>
          <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <div className="rounded-2xl border border-white/20 bg-white/70 p-4 dark:border-white/10 dark:bg-slate-950/50">
              Cell completeness is <span className="font-semibold text-slate-950 dark:text-white">{formatPercent(metrics.completeness)}</span> across {formatNumber(metrics.totalRows * Math.max(metrics.totalColumns, 1))} observed cells.
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/70 p-4 dark:border-white/10 dark:bg-slate-950/50">
              Estimated in-browser footprint is <span className="font-semibold text-slate-950 dark:text-white">{formatBytes(metrics.memoryBytes)}</span>, based on DuckDB string-size estimates for all visible values.
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/70 p-4 dark:border-white/10 dark:bg-slate-950/50">
              {metrics.outlierColumns === 0
                ? "Numeric columns are broadly stable under an IQR scan."
                : `${metrics.outlierColumns} numeric column${metrics.outlierColumns === 1 ? "" : "s"} exceed the outlier significance threshold and deserve follow-up.`}
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
