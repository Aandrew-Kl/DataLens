"use client";

import {
  useMemo,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  Activity,
  Database,
  HardDrive,
  Rows4,
} from "lucide-react";
import { useDatasetProfile, type DatasetProfileResult } from "@/hooks/use-dataset-profile";
import { formatBytes, formatNumber, formatPercent } from "@/lib/utils/formatters";
import {
  ANALYTICS_EASE,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
  toCount,
} from "@/lib/utils/advanced-analytics";
import type { ColumnProfile, ColumnType } from "@/types/dataset";

echarts.use([
  BarChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface DataProfilerLiteProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface TypeSummary {
  type: ColumnType;
  count: number;
}

interface UniqueColumnSummary {
  name: string;
  uniqueCount: number;
  uniquenessRate: number;
}

interface ProfilerLiteResult {
  rowCount: number;
  memoryEstimate: number;
  totalNulls: number;
  typeSummary: TypeSummary[];
  nullSummary: Array<{ name: string; percentage: number }>;
  uniqueColumns: UniqueColumnSummary[];
  error: string | null;
}

const MAX_UNIQUE_COLUMNS = 5;
const PIE_COLORS = ["#0f766e", "#0891b2", "#7c3aed", "#d97706", "#475569"] as const;
const TYPE_LABELS: Record<ColumnType, string> = {
  string: "String",
  number: "Number",
  date: "Date",
  boolean: "Boolean",
  unknown: "Unknown",
};

function estimateColumnBytes(column: ColumnProfile) {
  if (column.type === "number") return 8;
  if (column.type === "boolean") return 1;
  if (column.type === "date") return 8;
  if (column.type === "unknown") return 12;

  const samples = column.sampleValues
    .map((value) => (value === null ? "" : String(value)))
    .filter((value) => value.length > 0);
  const averageLength =
    samples.length > 0
      ? samples.reduce((sum, value) => sum + value.length, 0) / samples.length
      : 12;
  return Math.max(8, averageLength + 8);
}

function buildProfilerLiteSummary(
  columns: ColumnProfile[],
  profile: DatasetProfileResult,
): ProfilerLiteResult {
  const rowCount = profile.rowCount;
  const nullCountForColumn = (column: ColumnProfile) =>
    profile.nullCounts[column.name] ?? column.nullCount;
  const totalNulls = columns.reduce(
    (sum, column) => sum + Math.max(0, nullCountForColumn(column)),
    0,
  );
  const typeCounts = new Map<ColumnType, number>();

  columns.forEach((column) => {
    typeCounts.set(column.type, (typeCounts.get(column.type) ?? 0) + 1);
  });

  const typeSummary = (Object.keys(TYPE_LABELS) as ColumnType[])
    .map<TypeSummary>((type) => ({
      type,
      count: typeCounts.get(type) ?? 0,
    }))
    .filter((entry) => entry.count > 0);

  const nullSummary = columns
    .map((column) => ({
      name: column.name,
      percentage:
        rowCount > 0 ? (nullCountForColumn(column) / rowCount) * 100 : 0,
    }))
    .sort((left, right) => right.percentage - left.percentage)
    .slice(0, 8);

  const uniqueColumns = columns
    .map<UniqueColumnSummary>((column) => ({
      name: column.name,
      uniqueCount: column.uniqueCount,
      uniquenessRate:
        rowCount > 0 ? (column.uniqueCount / rowCount) * 100 : 0,
    }))
    .sort(
      (left, right) =>
        right.uniqueCount - left.uniqueCount ||
        right.uniquenessRate - left.uniquenessRate,
    )
    .slice(0, MAX_UNIQUE_COLUMNS);

  const bytesPerRow = columns.reduce(
    (sum, column) => sum + estimateColumnBytes(column),
    0,
  );

  return {
    rowCount,
    memoryEstimate: Math.round(bytesPerRow * rowCount),
    totalNulls,
    typeSummary,
    nullSummary,
    uniqueColumns,
    error: profile.error,
  };
}

function buildTypeDistributionOption(summary: TypeSummary[]): EChartsOption {
  return {
    animationDuration: 400,
    color: PIE_COLORS.slice(0, summary.length),
    tooltip: {
      trigger: "item",
      formatter: (params: unknown) => {
        const safeParams = params as unknown;
        if (!isRecord(safeParams)) return "";
        return `${String(safeParams.name ?? "")}: ${formatNumber(
          toCount(safeParams.value),
        )}`;
      },
    },
    legend: {
      bottom: 0,
      icon: "circle",
      textStyle: {
        color: "#475569",
      },
    },
    series: [
      {
        type: "pie",
        radius: ["48%", "74%"],
        center: ["50%", "42%"],
        label: {
          formatter: "{b}: {d}%",
          color: "#334155",
        },
        data: summary.map((entry) => ({
          name: TYPE_LABELS[entry.type],
          value: entry.count,
        })),
      },
    ],
  };
}

function buildNullPercentageOption(
  summary: Array<{ name: string; percentage: number }>,
): EChartsOption {
  return {
    animationDuration: 400,
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => {
        const safeParams = Array.isArray(params) ? params[0] : params;
        if (!isRecord(safeParams)) return "";
        return `${String(safeParams.name ?? "")}: ${formatPercent(
          Number(safeParams.value ?? 0),
        )}`;
      },
    },
    grid: {
      left: 16,
      right: 18,
      top: 24,
      bottom: 44,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: summary.map((entry) => entry.name),
      axisLabel: {
        color: "#64748b",
        interval: 0,
        rotate: summary.length > 4 ? 24 : 0,
      },
      axisLine: {
        lineStyle: {
          color: "#cbd5e1",
        },
      },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: "#64748b",
        formatter: (value: number) => `${value}%`,
      },
      splitLine: {
        lineStyle: {
          color: "#e2e8f0",
          type: "dashed",
        },
      },
    },
    series: [
      {
        type: "bar",
        name: "Null %",
        data: summary.map((entry) => Number(entry.percentage.toFixed(2))),
        itemStyle: {
          color: "#0ea5e9",
          borderRadius: [10, 10, 0, 0],
        },
        barMaxWidth: 34,
      },
    ],
  };
}

function ProfilerLiteLoadingState() {
  return (
    <div className={`${GLASS_PANEL_CLASS} p-6`}>
      <p className="text-sm text-slate-500 dark:text-slate-300">
        Profiling the dataset footprint…
      </p>
    </div>
  );
}

function EmptyProfilerLiteState() {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
        Data Profiler Lite
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
        Add a dataset before running quick profile diagnostics.
      </p>
    </section>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Rows4;
  label: string;
  value: string;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function UniqueColumnRow({ entry }: { entry: UniqueColumnSummary }) {
  return (
    <li className="flex items-center justify-between gap-4 rounded-2xl border border-white/20 bg-white/55 px-4 py-3 dark:bg-slate-900/35">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
          {entry.name}
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {formatPercent(entry.uniquenessRate)}
        </p>
      </div>
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        {formatNumber(entry.uniqueCount)}
      </span>
    </li>
  );
}

function ProfilerLitePanel({ summary }: { summary: ProfilerLiteResult }) {
  const typeDistributionOption = buildTypeDistributionOption(summary.typeSummary);
  const nullPercentageOption = buildNullPercentageOption(summary.nullSummary);

  return (
    <div className="space-y-5">
      {summary.error ? (
        <div className={`${GLASS_PANEL_CLASS} border-rose-200/70 p-4 dark:border-rose-400/20`}>
          <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
            {summary.error}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={Rows4}
          label="Row Count"
          value={formatNumber(summary.rowCount)}
        />
        <SummaryCard
          icon={Database}
          label="Column Count"
          value={formatNumber(summary.typeSummary.reduce((sum, entry) => sum + entry.count, 0))}
        />
        <SummaryCard
          icon={HardDrive}
          label="Memory Estimate"
          value={formatBytes(summary.memoryEstimate)}
        />
        <SummaryCard
          icon={Activity}
          label="Null Cells"
          value={formatNumber(summary.totalNulls)}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
          className={`${GLASS_PANEL_CLASS} p-5`}
        >
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            Column Type Distribution
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            A quick split of the semantic types inferred for the current dataset.
          </p>
          <div className="mt-4">
            <ReactEChartsCore
              echarts={echarts}
              option={typeDistributionOption}
              notMerge
              lazyUpdate
              style={{ height: 320 }}
            />
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.04, ease: ANALYTICS_EASE }}
          className={`${GLASS_PANEL_CLASS} p-5`}
        >
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            Null Percentage by Column
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            The columns with the highest missingness surface first.
          </p>
          <div className="mt-4">
            <ReactEChartsCore
              echarts={echarts}
              option={nullPercentageOption}
              notMerge
              lazyUpdate
              style={{ height: 320 }}
            />
          </div>
        </motion.section>
      </div>

      <section className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
              Top 5 Most Unique Columns
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Use these fields first for IDs, dimensional keys, or grouping candidates.
            </p>
          </div>
        </div>
        <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {summary.uniqueColumns.map((entry) => (
            <UniqueColumnRow key={entry.name} entry={entry} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function DataProfilerLiteBody({
  tableName,
  columns,
}: DataProfilerLiteProps) {
  const profile = useDatasetProfile(tableName);
  const summary = useMemo(
    () => buildProfilerLiteSummary(columns, profile),
    [columns, profile],
  );

  if (columns.length === 0) {
    return <EmptyProfilerLiteState />;
  }

  return (
    <section className="space-y-5">
      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
          Quick Profile
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
          Data Profiler Lite
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          A compact diagnostic pass for {tableName} with row scale, memory cost,
          type balance, and the most distinctive columns at a glance.
        </p>
      </div>

      {profile.loading ? (
        <ProfilerLiteLoadingState />
      ) : (
        <ProfilerLitePanel summary={summary} />
      )}
    </section>
  );
}

export default function DataProfilerLite({
  tableName,
  columns,
}: DataProfilerLiteProps) {
  if (columns.length === 0) {
    return <EmptyProfilerLiteState />;
  }

  return <DataProfilerLiteBody tableName={tableName} columns={columns} />;
}
