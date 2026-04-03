"use client";

import { useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { CalendarRange, Download, LineChartIcon, Waves } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toCount,
  toIsoDate,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface DateAnalyzerProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface DailyPoint {
  isoDate: string;
  count: number;
}

interface DateAnalysisResult {
  minDate: string | null;
  maxDate: string | null;
  weekdayCounts: Array<{ label: string; count: number }>;
  monthlyTrend: Array<{ label: string; count: number }>;
  missingDates: string[];
  totalBuckets: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function parseIsoDate(isoDate: string) {
  return new Date(`${isoDate}T12:00:00Z`);
}

function formatDateLabel(isoDate: string | null) {
  if (!isoDate) return "—";
  return parseIsoDate(isoDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildDateAnalysis(points: DailyPoint[]): DateAnalysisResult {
  const weekdayCounts = WEEKDAYS.map((label) => ({ label, count: 0 }));
  const monthMap = new Map<string, number>();

  points.forEach((point) => {
    const parsed = parseIsoDate(point.isoDate);
    weekdayCounts[parsed.getUTCDay()].count += point.count;
    const monthLabel = parsed.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
    monthMap.set(monthLabel, (monthMap.get(monthLabel) ?? 0) + point.count);
  });

  const missingDates: string[] = [];
  const minDate = points[0]?.isoDate ?? null;
  const maxDate = points[points.length - 1]?.isoDate ?? null;

  if (minDate && maxDate) {
    const observed = new Set(points.map((point) => point.isoDate));
    const cursor = parseIsoDate(minDate);
    const end = parseIsoDate(maxDate);

    while (cursor <= end) {
      const isoDate = cursor.toISOString().slice(0, 10);
      if (!observed.has(isoDate)) {
        missingDates.push(isoDate);
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return {
    minDate,
    maxDate,
    weekdayCounts,
    monthlyTrend: [...monthMap.entries()].map(([label, count]) => ({ label, count })),
    missingDates,
    totalBuckets: points.length,
  };
}

function buildWeekdayOption(
  points: Array<{ label: string; count: number }>,
  dark: boolean,
): EChartsOption {
  return {
    animationDuration: 420,
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617f2" : "#ffffffee",
      borderColor: dark ? "#1e293b" : "#e2e8f0",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    grid: { left: 18, right: 20, top: 16, bottom: 28, containLabel: true },
    xAxis: {
      type: "category",
      data: points.map((point) => point.label),
      axisLabel: { color: dark ? "#cbd5e1" : "#64748b" },
      axisLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: dark ? "#cbd5e1" : "#64748b" },
      splitLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" } },
    },
    series: [
      {
        type: "bar",
        data: points.map((point) => point.count),
        itemStyle: { color: "#06b6d4", borderRadius: [10, 10, 0, 0] },
        barMaxWidth: 36,
      },
    ],
  };
}

function buildMonthlyOption(
  points: Array<{ label: string; count: number }>,
  dark: boolean,
): EChartsOption {
  return {
    animationDuration: 420,
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617f2" : "#ffffffee",
      borderColor: dark ? "#1e293b" : "#e2e8f0",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    grid: { left: 18, right: 20, top: 16, bottom: 28, containLabel: true },
    xAxis: {
      type: "category",
      data: points.map((point) => point.label),
      boundaryGap: false,
      axisLabel: { color: dark ? "#cbd5e1" : "#64748b", rotate: points.length > 6 ? 18 : 0 },
      axisLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: dark ? "#cbd5e1" : "#64748b" },
      splitLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" } },
    },
    series: [
      {
        type: "line",
        data: points.map((point) => point.count),
        smooth: true,
        lineStyle: { width: 3, color: "#f97316" },
        areaStyle: { color: "rgba(249, 115, 22, 0.12)" },
      },
    ],
  };
}

function buildCsv(result: DateAnalysisResult) {
  return [
    "metric,value",
    `min_date,${result.minDate ?? ""}`,
    `max_date,${result.maxDate ?? ""}`,
    `total_buckets,${result.totalBuckets}`,
    `missing_dates,${result.missingDates.length}`,
    "",
    "missing_date",
    ...result.missingDates.map((value) => value),
  ].join("\n");
}

function MetricCard({
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

export default function DateAnalyzer({ tableName, columns }: DateAnalyzerProps) {
  const dark = useDarkMode();
  const dateColumns = useMemo(
    () => columns.filter((column) => column.type === "date"),
    [columns],
  );
  const [columnName, setColumnName] = useState("");
  const [result, setResult] = useState<DateAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeColumn =
    dateColumns.find((column) => column.name === columnName)?.name ??
    dateColumns[0]?.name ??
    "";

  async function handleAnalyze() {
    if (!activeColumn) {
      setResult(null);
      setError("Choose a date column to analyze.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(`
        WITH parsed AS (
          SELECT TRY_CAST(${quoteIdentifier(activeColumn)} AS TIMESTAMP) AS ts
          FROM ${quoteIdentifier(tableName)}
        )
        SELECT
          CAST(DATE_TRUNC('day', ts) AS DATE) AS bucket_date,
          COUNT(*) AS row_count
        FROM parsed
        WHERE ts IS NOT NULL
        GROUP BY 1
        ORDER BY 1
      `);

      const points = rows.flatMap<DailyPoint>((row) => {
        const isoDate = toIsoDate(row.bucket_date);
        if (!isoDate) return [];
        return [{ isoDate, count: toCount(row.row_count) }];
      });

      if (!points.length) {
        setResult(null);
        setError("No valid dates were parsed from the selected column.");
        return;
      }

      setResult(buildDateAnalysis(points));
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : "Date analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;
    downloadFile(
      buildCsv(result),
      `${tableName}-${activeColumn}-date-analysis.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} p-6`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
            <CalendarRange className="h-4 w-4" />
            Date Analyzer
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            Profile temporal coverage and missing dates
          </h2>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={!result}
          className={BUTTON_CLASS}
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <label className="text-sm text-slate-600 dark:text-slate-300">
          <span className="mb-2 block">Date column</span>
          <select
            aria-label="Date column"
            value={activeColumn}
            onChange={(event) => setColumnName(event.target.value)}
            className={FIELD_CLASS}
          >
            {dateColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={loading || !activeColumn}
          className={`${BUTTON_CLASS} self-end`}
        >
          {loading ? "Analyzing…" : "Analyze dates"}
        </button>
      </div>

      {!dateColumns.length ? (
        <div className="mt-6 rounded-3xl border border-dashed border-white/25 px-4 py-6 text-sm text-slate-600 dark:text-slate-300">
          Choose a date column to analyze.
        </div>
      ) : null}

      {error ? (
        <div className="mt-6 rounded-3xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Min date" value={result ? formatDateLabel(result.minDate) : "—"} />
        <MetricCard label="Max date" value={result ? formatDateLabel(result.maxDate) : "—"} />
        <MetricCard label="Buckets" value={result ? formatNumber(result.totalBuckets) : "—"} />
        <MetricCard
          label="Missing dates"
          value={result ? formatNumber(result.missingDates.length) : "—"}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <Waves className="h-4 w-4" />
            Day-of-week distribution
          </h3>
          <ReactEChartsCore
            echarts={echarts}
            option={buildWeekdayOption(result?.weekdayCounts ?? [], dark)}
            style={{ height: 280 }}
          />
        </div>
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <LineChartIcon className="h-4 w-4" />
            Monthly trend
          </h3>
          <ReactEChartsCore
            echarts={echarts}
            option={buildMonthlyOption(result?.monthlyTrend ?? [], dark)}
            style={{ height: 280 }}
          />
        </div>
      </div>

      <div className={`${GLASS_CARD_CLASS} mt-6 p-4`}>
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          Gap detection
        </h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {result
            ? `${result.missingDates.length} missing dates between ${formatDateLabel(result.minDate)} and ${formatDateLabel(result.maxDate)}.`
            : "Run the analyzer to identify missing dates in the timeline."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {(result?.missingDates ?? []).slice(0, 12).map((isoDate) => (
            <span
              key={isoDate}
              className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200"
            >
              {formatDateLabel(isoDate)}
            </span>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
