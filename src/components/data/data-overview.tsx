"use client";

import {
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  type Variants,
} from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Database,
  Download,
  FileText,
  Hash,
  PlayCircle,
  Shield,
  Sparkles,
  Table2,
  TerminalSquare,
  Type,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDataHealth } from "@/lib/hooks/use-data-health";
import { formatBytes, formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

export interface DataOverviewProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

type OverviewAction =
  | "export-csv"
  | "run-sql"
  | "view-dashboard"
  | "generate-report";

interface ColumnMetricRow {
  columnName: string;
  nullCount: number;
  uniqueCount: number;
  nonNullCount: number;
  avgTextLength: number;
}

interface RankedColumn {
  label: string;
  value: number;
  secondaryValue: number;
}

interface OverviewSnapshot {
  queriedRowCount: number;
  queriedColumnCount: number;
  estimatedBytes: number;
  totalNulls: number;
  avgCardinality: number;
  topNullColumns: RankedColumn[];
  topCardinalityColumns: RankedColumn[];
}

export const DATA_OVERVIEW_ACTION_EVENT = "datalens:data-overview-action";

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 20, scale: 0.985 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const },
  },
};

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function asNumber(value: unknown) {
  const numeric = value == null ? Number.NaN : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function useDarkMode() {
  const [dark, setDark] = useState(false);
  const syncDarkMode = useEffectEvent(() => {
    setDark(document.documentElement.classList.contains("dark"));
  });

  useEffect(() => {
    syncDarkMode();
    const observer = new MutationObserver(() => syncDarkMode());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return dark;
}

function buildMetricsQuery(tableName: string, columns: ColumnProfile[]) {
  return columns
    .map((column) => {
      const identifier = quoteIdentifier(column.name);
      const columnName = column.name.replaceAll("'", "''");

      return `SELECT
        '${columnName}' AS column_name,
        COUNT(*) - COUNT(${identifier}) AS null_count,
        COUNT(DISTINCT ${identifier}) AS unique_count,
        COUNT(${identifier}) AS non_null_count,
        AVG(CASE WHEN ${identifier} IS NOT NULL THEN LENGTH(CAST(${identifier} AS VARCHAR)) END) AS avg_text_length
      FROM ${quoteIdentifier(tableName)}`;
    })
    .join(" UNION ALL ");
}

function estimateColumnBytes(
  column: ColumnProfile,
  metric: ColumnMetricRow,
  totalRows: number,
) {
  const nonNullCount = metric.nonNullCount;
  const nullBitmapBytes = totalRows / 8;

  if (column.type === "number") {
    return nonNullCount * 8 + nullBitmapBytes;
  }

  if (column.type === "date") {
    return nonNullCount * 8 + nullBitmapBytes;
  }

  if (column.type === "boolean") {
    return nonNullCount + nullBitmapBytes;
  }

  const averageTextBytes = Math.max(metric.avgTextLength, 2);
  return nonNullCount * (averageTextBytes + 10) + nullBitmapBytes;
}

function buildDonutOption(
  dark: boolean,
  distribution: Array<{ name: string; value: number; color: string }>,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#334155";
  const borderColor = dark ? "#020617" : "#ffffff";

  return {
    animationDuration: 520,
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#0f172acc" : "#ffffffee",
      borderWidth: 0,
      textStyle: { color: textColor },
      formatter: (params: unknown) => {
        const item = params as { name?: string; value?: number; percent?: number };
        return `${item.name ?? "Unknown"}<br/>${formatNumber(item.value ?? 0)} columns (${(item.percent ?? 0).toFixed(1)}%)`;
      },
    },
    legend: {
      bottom: 0,
      icon: "circle",
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: textColor },
    },
    series: [
      {
        type: "pie",
        radius: ["58%", "78%"],
        center: ["50%", "44%"],
        minAngle: 8,
        itemStyle: { borderColor, borderWidth: 2 },
        label: {
          color: textColor,
          formatter: "{b|{b}}\n{c} cols",
          rich: { b: { fontWeight: 600, lineHeight: 20 } },
        },
        labelLine: { length: 12, length2: 10 },
        data: distribution.map((item) => ({
          name: item.name,
          value: item.value,
          itemStyle: { color: item.color },
        })),
      },
    ],
  };
}

function buildHorizontalBarOption(
  dark: boolean,
  bars: RankedColumn[],
  color: string,
  labelFormatter: (value: RankedColumn) => string,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#334155";
  const borderColor = dark ? "#1e293b" : "#e2e8f0";

  return {
    animationDuration: 520,
    grid: { top: 12, left: 12, right: 26, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: dark ? "#0f172acc" : "#ffffffee",
      borderWidth: 0,
      textStyle: { color: textColor },
      formatter: (params: unknown) => {
        const item = Array.isArray(params)
          ? (params[0] as { name?: string; value?: number } | undefined)
          : undefined;
        const row = bars.find((entry) => entry.label === item?.name);
        return row ? labelFormatter(row) : `${item?.name ?? "Column"}: ${item?.value ?? 0}`;
      },
    },
    xAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: bars.map((row) => row.label),
      axisLabel: { color: textColor, width: 140, overflow: "truncate" },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    series: [
      {
        type: "bar",
        barWidth: 14,
        data: bars.map((row) => row.value),
        itemStyle: {
          color,
          borderRadius: [0, 999, 999, 0],
          shadowBlur: 24,
          shadowColor: `${color}33`,
        },
        label: {
          show: true,
          position: "right",
          color: textColor,
          formatter: (params: unknown) => {
            const item = params as { value?: number };
            return formatNumber(Number(item.value ?? 0));
          },
        },
      },
    ],
  };
}

function AnimatedValue({
  value,
  formatter,
}: {
  value: number;
  formatter: (value: number) => string;
}) {
  const motionValue = useMotionValue(0);
  const [displayValue, setDisplayValue] = useState(() => formatter(0));

  useMotionValueEvent(motionValue, "change", (latest) => {
    setDisplayValue(formatter(latest));
  });

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1] as const,
    });

    return () => controls.stop();
  }, [motionValue, value]);

  return <motion.span layout>{displayValue}</motion.span>;
}

function StatCard({
  label,
  value,
  helper,
  icon: Icon,
  tint,
}: {
  label: string;
  value: ReactNode;
  helper: string;
  icon: LucideIcon;
  tint: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/15 bg-white/55 p-5 shadow-[0_18px_48px_-28px_rgba(15,23,42,0.65)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/48">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
            {value}
          </p>
        </div>
        <div className={`rounded-2xl p-3 ${tint}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">{helper}</p>
    </div>
  );
}

function ActionButton({
  label,
  description,
  icon: Icon,
  onClick,
}: {
  label: string;
  description: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-[24px] border border-white/15 bg-white/55 p-4 text-left shadow-[0_16px_44px_-30px_rgba(15,23,42,0.8)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-cyan-400/30 hover:bg-white/70 dark:border-white/10 dark:bg-slate-950/44 dark:hover:bg-slate-900/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-2xl bg-cyan-500/12 p-3 text-cyan-700 dark:text-cyan-300">
          <Icon className="h-5 w-5" />
        </div>
        <ArrowRight className="mt-1 h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-cyan-500" />
      </div>
      <p className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-50">
        {label}
      </p>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {description}
      </p>
    </button>
  );
}

export default function DataOverview({
  tableName,
  columns,
  rowCount,
}: DataOverviewProps) {
  const dark = useDarkMode();
  const health = useDataHealth(tableName, columns);
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typeDistribution = useMemo(
    () => [
      {
        name: "Numeric",
        value: columns.filter((column) => column.type === "number").length,
        color: "#22c55e",
      },
      {
        name: "Text",
        value: columns.filter((column) => column.type === "string").length,
        color: "#38bdf8",
      },
      {
        name: "Date",
        value: columns.filter((column) => column.type === "date").length,
        color: "#a78bfa",
      },
      {
        name: "Boolean",
        value: columns.filter((column) => column.type === "boolean").length,
        color: "#f59e0b",
      },
      {
        name: "Unknown",
        value: columns.filter((column) => column.type === "unknown").length,
        color: "#94a3b8",
      },
    ].filter((entry) => entry.value > 0),
    [columns],
  );

  const loadSnapshot = useEffectEvent(async () => {
    if (!tableName || columns.length === 0) {
      startTransition(() => setSnapshot(null));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [countRows, metricRows] = await Promise.all([
        runQuery(`SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tableName)}`),
        runQuery(buildMetricsQuery(tableName, columns)),
      ]);

      const queriedRowCount = asNumber(countRows[0]?.row_count) || rowCount;
      const metrics = metricRows.map((row) => ({
        columnName: String(row.column_name ?? ""),
        nullCount: asNumber(row.null_count),
        uniqueCount: asNumber(row.unique_count),
        nonNullCount: asNumber(row.non_null_count),
        avgTextLength: asNumber(row.avg_text_length),
      }));

      const metricMap = new Map(metrics.map((row) => [row.columnName, row]));
      const totalNulls = metrics.reduce((sum, metric) => sum + metric.nullCount, 0);
      const avgCardinality =
        metrics.reduce((sum, metric) => sum + metric.uniqueCount, 0) /
        Math.max(metrics.length, 1);
      const estimatedBytes = columns.reduce((sum, column) => {
        const metric = metricMap.get(column.name);
        if (!metric) {
          return sum;
        }
        return sum + estimateColumnBytes(column, metric, queriedRowCount);
      }, 0);

      const topNullColumns = [...metrics]
        .sort((left, right) => right.nullCount - left.nullCount)
        .slice(0, 5)
        .map((metric) => ({
          label: metric.columnName,
          value: metric.nullCount,
          secondaryValue:
            queriedRowCount > 0 ? (metric.nullCount / queriedRowCount) * 100 : 0,
        }));

      const topCardinalityColumns = [...metrics]
        .sort((left, right) => right.uniqueCount - left.uniqueCount)
        .slice(0, 5)
        .map((metric) => ({
          label: metric.columnName,
          value: metric.uniqueCount,
          secondaryValue:
            metric.nonNullCount > 0
              ? (metric.uniqueCount / metric.nonNullCount) * 100
              : 0,
        }));

      startTransition(() => {
        setSnapshot({
          queriedRowCount,
          queriedColumnCount: metrics.length,
          estimatedBytes,
          totalNulls,
          avgCardinality,
          topNullColumns,
          topCardinalityColumns,
        });
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to compute dataset overview metrics.",
      );
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void loadSnapshot();
  }, [columns, rowCount, tableName]);

  const quickStats = useMemo(() => {
    const totalRows = snapshot?.queriedRowCount ?? rowCount;
    const columnCount = snapshot?.queriedColumnCount ?? columns.length;
    const populatedCells = totalRows * Math.max(columnCount, 1);
    const nullRatio =
      populatedCells > 0 && snapshot ? snapshot.totalNulls / populatedCells : 0;

    return [
      {
        label: "Total Nulls",
        value: snapshot ? formatNumber(snapshot.totalNulls) : "—",
        helper: `${formatPercent(nullRatio * 100)} of profiled cells`,
        icon: AlertTriangle,
        tint: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
      },
      {
        label: "Numeric Columns",
        value: formatNumber(
          columns.filter((column) => column.type === "number").length,
        ),
        helper: "Ideal for measures, KPIs, and trend charts",
        icon: Hash,
        tint: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
      },
      {
        label: "Text Columns",
        value: formatNumber(
          columns.filter((column) => column.type === "string").length,
        ),
        helper: "Good candidates for grouping and labels",
        icon: Type,
        tint: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
      },
      {
        label: "Date Columns",
        value: formatNumber(
          columns.filter((column) => column.type === "date").length,
        ),
        helper: "Available time axes for seasonality and forecasting",
        icon: CalendarDays,
        tint: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
      },
      {
        label: "Avg Cardinality",
        value: snapshot ? formatNumber(snapshot.avgCardinality) : "—",
        helper: "Average distinct values per column",
        icon: Activity,
        tint: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
      },
      {
        label: "Data Quality",
        value: health.loading ? "…" : `${health.score}/100`,
        helper: health.loading
          ? "Computing completeness, consistency, and outlier risk"
          : `Current grade ${health.grade}`,
        icon: Shield,
        tint: "bg-cyan-500/12 text-cyan-700 dark:text-cyan-300",
      },
    ];
  }, [columns, health.grade, health.loading, health.score, rowCount, snapshot]);

  function emitAction(action: OverviewAction) {
    window.dispatchEvent(
      new CustomEvent(DATA_OVERVIEW_ACTION_EVENT, {
        detail: {
          action,
          tableName,
          columns: columns.map((column) => column.name),
        },
      }),
    );
  }

  return (
    <motion.section
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="relative overflow-hidden rounded-[32px] border border-white/15 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.2),transparent_28%),radial-gradient(circle_at_top_right,rgba(167,139,250,0.18),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.72),rgba(248,250,252,0.68))] p-6 shadow-[0_28px_90px_-42px_rgba(15,23,42,0.75)] backdrop-blur-2xl dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.14),transparent_28%),linear-gradient(180deg,rgba(2,6,23,0.88),rgba(15,23,42,0.82))] sm:p-7"
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.18),transparent_40%,rgba(255,255,255,0.06))]" />

      <motion.div variants={cardVariants} className="relative">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700 dark:text-cyan-300">
              <Sparkles className="h-3.5 w-3.5" />
              Dataset Overview
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50 sm:text-4xl">
              {tableName}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400 sm:text-base">
              One-page readout of shape, sparsity, schema mix, column entropy, and health signals.
              This is the fastest way to understand whether the dataset is presentation-ready or still needs cleanup.
            </p>
          </div>

          <div className="rounded-[24px] border border-white/15 bg-white/60 px-4 py-3 shadow-[0_16px_48px_-32px_rgba(15,23,42,0.85)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/46">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Quality Grade
            </p>
            <div className="mt-2 flex items-end gap-3">
              <span className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                {health.loading ? "…" : health.grade}
              </span>
              <span className="pb-1 text-sm text-slate-600 dark:text-slate-400">
                {health.loading ? "Analyzing" : `${health.score}/100 overall`}
              </span>
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div
        variants={cardVariants}
        className="relative mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          label="Rows"
          value={
            snapshot ? (
              <AnimatedValue
                value={snapshot.queriedRowCount}
                formatter={(value) => formatNumber(Math.round(value))}
              />
            ) : (
              "—"
            )
          }
          helper="DuckDB verified row count"
          icon={Table2}
          tint="bg-cyan-500/12 text-cyan-700 dark:text-cyan-300"
        />
        <StatCard
          label="Columns"
          value={
            snapshot ? (
              <AnimatedValue
                value={snapshot.queriedColumnCount}
                formatter={(value) => formatNumber(Math.round(value))}
              />
            ) : (
              formatNumber(columns.length)
            )
          }
          helper="Columns profiled and ready for exploration"
          icon={Database}
          tint="bg-violet-500/12 text-violet-700 dark:text-violet-300"
        />
        <StatCard
          label="Estimated Memory"
          value={
            snapshot ? (
              <AnimatedValue
                value={snapshot.estimatedBytes}
                formatter={(value) => formatBytes(Math.round(value))}
              />
            ) : (
              "—"
            )
          }
          helper="Estimated in-browser footprint for the loaded table"
          icon={BarChart3}
          tint="bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
        />
        <StatCard
          label="Health Score"
          value={health.loading ? "…" : `${health.score}/100`}
          helper="Completeness, uniqueness, type consistency, and outlier risk"
          icon={Shield}
          tint="bg-amber-500/12 text-amber-700 dark:text-amber-300"
        />
      </motion.div>

      {error ? (
        <motion.div
          variants={cardVariants}
          className="relative mt-4 rounded-[24px] border border-rose-300/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-700 dark:border-rose-500/20 dark:text-rose-300"
        >
          {error}
        </motion.div>
      ) : null}

      <motion.div
        variants={cardVariants}
        className="relative mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3"
      >
        {quickStats.map((stat) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            helper={stat.helper}
            icon={stat.icon}
            tint={stat.tint}
          />
        ))}
      </motion.div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="relative mt-6 grid gap-5 xl:grid-cols-[1.15fr_1fr_1fr]"
      >
        <motion.article
          variants={cardVariants}
          className="rounded-[28px] border border-white/15 bg-white/58 p-5 shadow-[0_18px_54px_-36px_rgba(15,23,42,0.9)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/46"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                Type Distribution
              </p>
              <h3 className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50">
                Schema mix across the dataset
              </h3>
            </div>
            <div className="rounded-2xl bg-sky-500/12 p-3 text-sky-700 dark:text-sky-300">
              <Database className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 h-[340px]">
            <ReactECharts
              option={buildDonutOption(dark, typeDistribution)}
              notMerge
              lazyUpdate
              opts={{ renderer: "svg" }}
              style={{ height: "100%", width: "100%" }}
            />
          </div>
        </motion.article>

        <motion.article
          variants={cardVariants}
          className="rounded-[28px] border border-white/15 bg-white/58 p-5 shadow-[0_18px_54px_-36px_rgba(15,23,42,0.9)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/46"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                Missingness
              </p>
              <h3 className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50">
                Top 5 null-heavy columns
              </h3>
            </div>
            <div className="rounded-2xl bg-rose-500/12 p-3 text-rose-700 dark:text-rose-300">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 h-[340px]">
            <ReactECharts
              option={buildHorizontalBarOption(
                dark,
                snapshot?.topNullColumns ?? [],
                "#fb7185",
                (item) =>
                  `${item.label}<br/>${formatNumber(item.value)} nulls (${formatPercent(item.secondaryValue)})`,
              )}
              notMerge
              lazyUpdate
              opts={{ renderer: "svg" }}
              style={{ height: "100%", width: "100%" }}
            />
          </div>
        </motion.article>

        <motion.article
          variants={cardVariants}
          className="rounded-[28px] border border-white/15 bg-white/58 p-5 shadow-[0_18px_54px_-36px_rgba(15,23,42,0.9)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/46"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                Cardinality
              </p>
              <h3 className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50">
                Top 5 highest-cardinality columns
              </h3>
            </div>
            <div className="rounded-2xl bg-amber-500/12 p-3 text-amber-700 dark:text-amber-300">
              <Hash className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 h-[340px]">
            <ReactECharts
              option={buildHorizontalBarOption(
                dark,
                snapshot?.topCardinalityColumns ?? [],
                "#f59e0b",
                (item) =>
                  `${item.label}<br/>${formatNumber(item.value)} unique values (${formatPercent(item.secondaryValue)})`,
              )}
              notMerge
              lazyUpdate
              opts={{ renderer: "svg" }}
              style={{ height: "100%", width: "100%" }}
            />
          </div>
        </motion.article>
      </motion.div>

      <motion.div
        variants={cardVariants}
        className="relative mt-6 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]"
      >
        <div className="rounded-[28px] border border-white/15 bg-white/58 p-5 shadow-[0_18px_54px_-36px_rgba(15,23,42,0.9)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/46">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                Quick Actions
              </p>
              <h3 className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50">
                Jump from overview into the next workflow
              </h3>
            </div>
            <div className="rounded-2xl bg-cyan-500/12 p-3 text-cyan-700 dark:text-cyan-300">
              <PlayCircle className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <ActionButton
              label="Export CSV"
              description="Package the current table for spreadsheets or downstream tooling."
              icon={Download}
              onClick={() => emitAction("export-csv")}
            />
            <ActionButton
              label="Run SQL"
              description="Drop directly into an ad hoc query flow against this dataset."
              icon={TerminalSquare}
              onClick={() => emitAction("run-sql")}
            />
            <ActionButton
              label="View Dashboard"
              description="Open KPI and chart views tailored to the current schema."
              icon={BarChart3}
              onClick={() => emitAction("view-dashboard")}
            />
            <ActionButton
              label="Generate Report"
              description="Turn this overview into a report-ready narrative and deliverable."
              icon={FileText}
              onClick={() => emitAction("generate-report")}
            />
          </div>
        </div>

        <div className="rounded-[28px] border border-white/15 bg-white/58 p-5 shadow-[0_18px_54px_-36px_rgba(15,23,42,0.9)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/46">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                Health Issues
              </p>
              <h3 className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50">
                Highest-signal data risks
              </h3>
            </div>
            <div className="rounded-2xl bg-violet-500/12 p-3 text-violet-700 dark:text-violet-300">
              <Shield className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {health.issues.length === 0 && !health.loading ? (
              <div className="rounded-[24px] border border-emerald-400/20 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-700 dark:text-emerald-300">
                No material issues surfaced. The dataset looks clean enough to move straight into analysis.
              </div>
            ) : null}
            {health.loading ? (
              <div className="rounded-[24px] border border-white/15 bg-white/45 px-4 py-4 text-sm text-slate-600 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-400">
                Running health diagnostics with DuckDB…
              </div>
            ) : null}
            {health.issues.slice(0, 4).map((issue) => (
              <div
                key={`${issue.column}-${issue.metric}`}
                className="rounded-[22px] border border-white/15 bg-white/48 px-4 py-4 dark:border-white/10 dark:bg-slate-900/38"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    {issue.column}
                  </p>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                      issue.severity === "critical"
                        ? "bg-rose-500/12 text-rose-700 dark:text-rose-300"
                        : issue.severity === "warning"
                          ? "bg-amber-500/12 text-amber-700 dark:text-amber-300"
                          : "bg-sky-500/12 text-sky-700 dark:text-sky-300"
                    }`}
                  >
                    {issue.severity}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {issue.message}
                </p>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {(loading || health.loading) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="pointer-events-none absolute inset-0 rounded-[32px] bg-white/18 backdrop-blur-[2px] dark:bg-slate-950/16"
        />
      )}
    </motion.section>
  );
}
