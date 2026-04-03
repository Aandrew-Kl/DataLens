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
import { BarChart, HeatmapChart, LineChart } from "echarts/charts";
import {
  CalendarComponent,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  CalendarDays,
  Clock3,
  Download,
  LineChart as LineChartIcon,
  Waves,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  dataUrlToBytes,
  quoteIdentifier,
  toCount,
  toIsoDate,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  BarChart,
  HeatmapChart,
  LineChart,
  CalendarComponent,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

interface DateExplorerProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface DailyPoint {
  day: string;
  count: number;
}

interface DateExplorerResult {
  dailyPoints: DailyPoint[];
  weekdayPoints: Array<{ label: string; count: number }>;
  hourlyPoints: Array<{ label: string; count: number }>;
  monthlyPoints: Array<{ label: string; count: number }>;
  distinctDates: number;
  minDate: string | null;
  maxDate: string | null;
  spanDays: number;
  missingDates: string[];
  seasonalityLabel: string;
  error: string | null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
});

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

function DateExplorerLoading() {
  return (
    <div
      className={`${GLASS_PANEL_CLASS} flex min-h-[30rem] items-center justify-center`}
    >
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Loading date explorer…
      </div>
    </div>
  );
}

function parseIso(isoDate: string) {
  return new Date(`${isoDate}T12:00:00Z`);
}

function formatIso(isoDate: string | null) {
  if (!isoDate) return "—";
  return parseIso(isoDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildGapList(minDate: string | null, maxDate: string | null, points: DailyPoint[]) {
  if (!minDate || !maxDate) return [];
  const observed = new Set(points.map((point) => point.day));
  const cursor = parseIso(minDate);
  const end = parseIso(maxDate);
  const gaps: string[] = [];

  while (cursor <= end) {
    const iso = cursor.toISOString().slice(0, 10);
    if (!observed.has(iso)) {
      gaps.push(iso);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return gaps;
}

function buildSeasonalityLabel(weekdayPoints: Array<{ label: string; count: number }>) {
  const counts = weekdayPoints.map((point) => point.count).filter((count) => count > 0);
  if (counts.length < 2) return "Insufficient signal";
  const average = counts.reduce((sum, value) => sum + value, 0) / counts.length;
  const peak = Math.max(...counts);
  const trough = Math.min(...counts);
  const lift = average === 0 ? 0 : (peak - trough) / average;
  if (lift >= 0.55) return "Strong weekly seasonality";
  if (lift >= 0.25) return "Moderate weekly seasonality";
  return "Low weekly seasonality";
}

async function loadDateExplorer(
  tableName: string,
  columnName: string,
): Promise<DateExplorerResult> {
  if (!columnName) {
    return {
      dailyPoints: [],
      weekdayPoints: [],
      hourlyPoints: [],
      monthlyPoints: [],
      distinctDates: 0,
      minDate: null,
      maxDate: null,
      spanDays: 0,
      missingDates: [],
      seasonalityLabel: "Insufficient signal",
      error: "Choose a date column to explore temporal activity.",
    };
  }

  const safeTable = quoteIdentifier(tableName);
  const safeColumn = quoteIdentifier(columnName);
  const [dailyRows, hourRows] = await Promise.all([
    runQuery(`
      WITH parsed AS (
        SELECT TRY_CAST(${safeColumn} AS TIMESTAMP) AS ts
        FROM ${safeTable}
        WHERE ${safeColumn} IS NOT NULL
      )
      SELECT
        CAST(DATE_TRUNC('day', ts) AS DATE) AS day_bucket,
        COUNT(*) AS row_count
      FROM parsed
      WHERE ts IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `),
    runQuery(`
      WITH parsed AS (
        SELECT TRY_CAST(${safeColumn} AS TIMESTAMP) AS ts
        FROM ${safeTable}
        WHERE ${safeColumn} IS NOT NULL
      )
      SELECT
        EXTRACT('hour' FROM ts) AS hour_of_day,
        COUNT(*) AS row_count
      FROM parsed
      WHERE ts IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `),
  ]);

  const dailyPoints = dailyRows.flatMap<DailyPoint>((row) => {
    const day = toIsoDate(row.day_bucket);
    if (!day) return [];
    return [{ day, count: toCount(row.row_count) }];
  });

  if (dailyPoints.length === 0) {
    return {
      dailyPoints: [],
      weekdayPoints: [],
      hourlyPoints: [],
      monthlyPoints: [],
      distinctDates: 0,
      minDate: null,
      maxDate: null,
      spanDays: 0,
      missingDates: [],
      seasonalityLabel: "Insufficient signal",
      error:
        "No valid dates were parsed from the selected column. Try a cleaner timestamp field.",
    };
  }

  const weekdayCounts = Array.from({ length: 7 }, (_, index) => ({
    label: WEEKDAYS[index],
    count: 0,
  }));
  const monthCounts = new Map<string, number>();

  for (const point of dailyPoints) {
    const parsed = parseIso(point.day);
    weekdayCounts[parsed.getUTCDay()].count += point.count;
    const monthLabel = MONTH_FORMAT.format(parsed);
    monthCounts.set(monthLabel, (monthCounts.get(monthLabel) ?? 0) + point.count);
  }

  const hourlyPoints = hourRows
    .map((row) => ({
      label: `${String(toCount(row.hour_of_day)).padStart(2, "0")}:00`,
      count: toCount(row.row_count),
    }))
    .filter((point) => point.count > 0);

  const minDate = dailyPoints[0]?.day ?? null;
  const maxDate = dailyPoints[dailyPoints.length - 1]?.day ?? null;
  const spanDays =
    minDate && maxDate
      ? Math.round((parseIso(maxDate).getTime() - parseIso(minDate).getTime()) / 86_400_000)
      : 0;

  return {
    dailyPoints,
    weekdayPoints: weekdayCounts,
    hourlyPoints,
    monthlyPoints: [...monthCounts.entries()].map(([label, count]) => ({
      label,
      count,
    })),
    distinctDates: dailyPoints.length,
    minDate,
    maxDate,
    spanDays,
    missingDates: buildGapList(minDate, maxDate, dailyPoints),
    seasonalityLabel: buildSeasonalityLabel(weekdayCounts),
    error: null,
  };
}

function buildCalendarOption(
  result: DateExplorerResult,
  dark: boolean,
): EChartsOption {
  return {
    animationDuration: 520,
    tooltip: {
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params;
        const data = item as { value?: [string, number] };
        return `${String(data.value?.[0] ?? "")}: ${formatNumber(Number(data.value?.[1] ?? 0))} rows`;
      },
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    visualMap: {
      min: 0,
      max: Math.max(...result.dailyPoints.map((point) => point.count), 1),
      orient: "horizontal",
      left: "center",
      bottom: 8,
      textStyle: { color: dark ? "#cbd5e1" : "#475569" },
      inRange: { color: ["#dbeafe", "#60a5fa", "#2563eb", "#0f172a"] },
    },
    calendar: {
      top: 18,
      left: 30,
      right: 20,
      cellSize: ["auto", 18],
      range: [result.minDate ?? "", result.maxDate ?? ""],
      yearLabel: { color: dark ? "#cbd5e1" : "#475569" },
      monthLabel: { color: dark ? "#cbd5e1" : "#475569" },
      dayLabel: { color: dark ? "#cbd5e1" : "#475569" },
      itemStyle: {
        borderColor: dark ? "#0f172a" : "#ffffff",
        borderWidth: 1,
      },
    },
    series: [
      {
        type: "heatmap",
        coordinateSystem: "calendar",
        data: result.dailyPoints.map((point) => [point.day, point.count]),
      },
    ],
  };
}

function buildBarOption(
  labels: string[],
  values: number[],
  dark: boolean,
  color: string,
): EChartsOption {
  return {
    animationDuration: 480,
    grid: { left: 48, right: 16, top: 20, bottom: 24 },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    xAxis: {
      type: "category",
      data: labels,
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
        data: values,
        itemStyle: { color, borderRadius: [8, 8, 0, 0] },
      },
    ],
  };
}

function buildTrendOption(result: DateExplorerResult, dark: boolean): EChartsOption {
  return {
    animationDuration: 500,
    grid: { left: 48, right: 16, top: 24, bottom: 28 },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    xAxis: {
      type: "category",
      data: result.monthlyPoints.map((point) => point.label),
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
        type: "line",
        smooth: true,
        symbolSize: 8,
        data: result.monthlyPoints.map((point) => point.count),
        lineStyle: { color: "#38bdf8", width: 3 },
        itemStyle: { color: "#38bdf8" },
        areaStyle: { color: "rgba(56, 189, 248, 0.14)" },
      },
    ],
  };
}

function DateExplorerReady({ tableName, columns }: DateExplorerProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const dateColumns = useMemo(
    () => columns.filter((column) => column.type === "date"),
    [columns],
  );
  const [columnName, setColumnName] = useState(dateColumns[0]?.name ?? "");

  const safeColumn = dateColumns.some((column) => column.name === columnName)
    ? columnName
    : dateColumns[0]?.name ?? "";

  const resultPromise = useMemo(
    () =>
      loadDateExplorer(tableName, safeColumn).catch((error) => ({
        dailyPoints: [],
        weekdayPoints: [],
        hourlyPoints: [],
        monthlyPoints: [],
        distinctDates: 0,
        minDate: null,
        maxDate: null,
        spanDays: 0,
        missingDates: [],
        seasonalityLabel: "Insufficient signal",
        error:
          error instanceof Error ? error.message : "Unable to explore dates.",
      })),
    [safeColumn, tableName],
  );

  const result = use(resultPromise);

  function exportPng() {
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance || result.error) return;
    const { bytes, mimeType } = dataUrlToBytes(
      instance.getDataURL({
        type: "png",
        pixelRatio: 2,
        backgroundColor: dark ? "#020617" : "#f8fafc",
      }),
    );
    downloadFile(bytes, `${tableName}-${safeColumn}-calendar.png`, mimeType);
  }

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
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700 dark:text-sky-300">
              <CalendarDays className="h-4 w-4" />
              Time-Based Exploration
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Inspect cadence, gaps, range, and calendar intensity
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              The explorer rolls day-level activity into a calendar heatmap,
              weekday and hour distributions, plus a month-over-month trend line.
            </p>
          </div>
          <button type="button" onClick={exportPng} className={BUTTON_CLASS}>
            <Download className="h-4 w-4" />
            Export PNG
          </button>
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Date column
            </label>
            <select
              aria-label="Date column"
              value={safeColumn}
              onChange={(event) =>
                startTransition(() => setColumnName(event.target.value))
              }
              className={FIELD_CLASS}
            >
              {dateColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </div>
          <SummaryCard label="Seasonality" value={result.seasonalityLabel} />
          <SummaryCard label="Gap count" value={formatNumber(result.missingDates.length)} />
        </div>

        {result.error ? (
          <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-5 text-sm text-rose-700 dark:text-rose-300">
            {result.error}
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label="Min date" value={formatIso(result.minDate)} />
              <SummaryCard label="Max date" value={formatIso(result.maxDate)} />
              <SummaryCard label="Span" value={`${formatNumber(result.spanDays)} days`} />
              <SummaryCard
                label="Distinct dates"
                value={formatNumber(result.distinctDates)}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
              <div className={`${GLASS_CARD_CLASS} p-4`}>
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  <CalendarDays className="h-4 w-4" />
                  Calendar heatmap
                </div>
                <ReactEChartsCore
                  ref={chartRef}
                  echarts={echarts}
                  option={buildCalendarOption(result, dark)}
                  notMerge
                  lazyUpdate
                  style={{ height: 360 }}
                />
              </div>
              <div className="grid gap-4">
                <div className={`${GLASS_CARD_CLASS} p-4`}>
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    <Waves className="h-4 w-4" />
                    Day-of-week distribution
                  </div>
                  <ReactEChartsCore
                    echarts={echarts}
                    option={buildBarOption(
                      result.weekdayPoints.map((point) => point.label),
                      result.weekdayPoints.map((point) => point.count),
                      dark,
                      "#38bdf8",
                    )}
                    notMerge
                    lazyUpdate
                    style={{ height: 220 }}
                  />
                </div>
                <div className={`${GLASS_CARD_CLASS} p-4`}>
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    <Clock3 className="h-4 w-4" />
                    Hour-of-day distribution
                  </div>
                  {result.hourlyPoints.length > 1 ? (
                    <ReactEChartsCore
                      echarts={echarts}
                      option={buildBarOption(
                        result.hourlyPoints.map((point) => point.label),
                        result.hourlyPoints.map((point) => point.count),
                        dark,
                        "#22c55e",
                      )}
                      notMerge
                      lazyUpdate
                      style={{ height: 220 }}
                    />
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/20 px-4 py-10 text-sm text-slate-500 dark:text-slate-400">
                      No hour-level variation was detected in the parsed timestamps.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.5fr_0.9fr]">
              <div className={`${GLASS_CARD_CLASS} p-4`}>
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  <LineChartIcon className="h-4 w-4" />
                  Month-over-month trend
                </div>
                <ReactEChartsCore
                  echarts={echarts}
                  option={buildTrendOption(result, dark)}
                  notMerge
                  lazyUpdate
                  style={{ height: 260 }}
                />
              </div>
              <div className={`${GLASS_CARD_CLASS} p-5`}>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Gap detection
                </div>
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                  Missing days between the observed start and end range can signal
                  ingestion pauses, quiet business periods, or source-system
                  outages.
                </p>
                <div className="mt-4 space-y-2">
                  {result.missingDates.length > 0 ? (
                    result.missingDates.slice(0, 6).map((gap) => (
                      <div
                        key={gap}
                        className="rounded-2xl border border-white/15 bg-white/50 px-4 py-3 text-sm text-slate-700 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-200"
                      >
                        {formatIso(gap)}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/20 px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                      No gaps were detected in the daily sequence.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </motion.section>
  );
}

export default function DateExplorer(props: DateExplorerProps) {
  return (
    <Suspense fallback={<DateExplorerLoading />}>
      <DateExplorerReady {...props} />
    </Suspense>
  );
}
