"use client";

import { startTransition, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { HeatmapChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { CalendarRange, Download, Flame, RefreshCcw, UsersRound } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toDate,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  HeatmapChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

interface CohortRetentionProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface CohortRow {
  cohortMonth: string;
  monthOffset: number;
  cohortSize: number;
  retainedUsers: number;
  retentionRate: number;
}

interface DropOffPoint {
  cohortMonth: string;
  monthOffset: number;
  retentionRate: number;
}

interface CohortSummary {
  cohortMonth: string;
  cohortSize: number;
  monthOneRetention: number | null;
  lastObservedOffset: number;
  dropOffOffset: number | null;
}

interface CohortResult {
  rows: CohortRow[];
  summaries: CohortSummary[];
  totalUsers: number;
  averageMonthOneRetention: number;
  bestCohortMonth: string | null;
  dropOffs: DropOffPoint[];
  maxOffset: number;
}

interface SummaryCardProps {
  icon: typeof CalendarRange;
  label: string;
  value: string;
}

const MAX_SAMPLE_ROWS = 20_000;

function SummaryCard({ icon: Icon, label, value }: SummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-cyan-500/10 p-3 text-cyan-600 dark:text-cyan-300">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv(rows: CohortRow[]): string {
  const header = ["cohort_month", "month_offset", "cohort_size", "retained_users", "retention_rate"];
  const body = rows.map((row) =>
    [
      row.cohortMonth,
      row.monthOffset,
      row.cohortSize,
      row.retainedUsers,
      row.retentionRate.toFixed(2),
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...body].join("\n");
}

function toMonthKey(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function toMonthIndex(value: string): number {
  const [year, month] = value.split("-").map(Number);
  return year * 12 + (month - 1);
}

function monthOffset(startMonth: string, currentMonth: string): number {
  return toMonthIndex(currentMonth) - toMonthIndex(startMonth);
}

function buildQuery(tableName: string, dateColumn: string, userColumn: string): string {
  const safeDate = quoteIdentifier(dateColumn);
  const safeUser = quoteIdentifier(userColumn);

  return `
    SELECT
      CAST(${safeDate} AS VARCHAR) AS __event_date,
      CAST(${safeUser} AS VARCHAR) AS __user_id
    FROM ${quoteIdentifier(tableName)}
    WHERE ${safeDate} IS NOT NULL AND ${safeUser} IS NOT NULL
    LIMIT ${MAX_SAMPLE_ROWS}
  `;
}

function buildCohortModel(rows: Record<string, unknown>[]): CohortResult {
  const users = new Map<string, { cohortMonth: string; activeMonths: Set<string> }>();

  for (const row of rows) {
    const rawUserId = row.__user_id;
    const rawDate = row.__event_date;
    const parsedDate = toDate(rawDate);
    const userId = typeof rawUserId === "string" ? rawUserId.trim() : String(rawUserId ?? "").trim();

    if (!parsedDate || userId.length === 0) {
      continue;
    }

    const eventMonth = toMonthKey(parsedDate);
    const current = users.get(userId);

    if (!current) {
      users.set(userId, {
        cohortMonth: eventMonth,
        activeMonths: new Set([eventMonth]),
      });
      continue;
    }

    current.activeMonths.add(eventMonth);
    if (toMonthIndex(eventMonth) < toMonthIndex(current.cohortMonth)) {
      current.cohortMonth = eventMonth;
    }
  }

  if (users.size === 0) {
    throw new Error("No valid date and user rows were available for cohort retention.");
  }

  const cohorts = new Map<string, { users: Set<string>; retainedByOffset: Map<number, Set<string>> }>();

  for (const [userId, value] of users.entries()) {
    const cohort = cohorts.get(value.cohortMonth) ?? {
      users: new Set<string>(),
      retainedByOffset: new Map<number, Set<string>>(),
    };
    cohort.users.add(userId);

    for (const activeMonth of value.activeMonths) {
      const offset = monthOffset(value.cohortMonth, activeMonth);
      const offsetUsers = cohort.retainedByOffset.get(offset) ?? new Set<string>();
      offsetUsers.add(userId);
      cohort.retainedByOffset.set(offset, offsetUsers);
    }

    cohorts.set(value.cohortMonth, cohort);
  }

  const orderedCohorts = [...cohorts.keys()].sort((left, right) => toMonthIndex(left) - toMonthIndex(right));
  const summaries: CohortSummary[] = [];
  const retentionRows: CohortRow[] = [];
  const dropOffs: DropOffPoint[] = [];

  for (const cohortMonth of orderedCohorts) {
    const cohort = cohorts.get(cohortMonth);
    if (!cohort) {
      continue;
    }

    const cohortSize = cohort.users.size;
    const offsets = [...cohort.retainedByOffset.keys()].sort((left, right) => left - right);
    const lastObservedOffset = offsets.at(-1) ?? 0;
    let previousRate = 100;
    let dropOffOffset: number | null = null;

    for (let offset = 0; offset <= lastObservedOffset; offset += 1) {
      const retainedUsers = cohort.retainedByOffset.get(offset)?.size ?? 0;
      const retentionRate = cohortSize === 0 ? 0 : (retainedUsers / cohortSize) * 100;

      retentionRows.push({
        cohortMonth,
        monthOffset: offset,
        cohortSize,
        retainedUsers,
        retentionRate,
      });

      if (
        offset > 0 &&
        dropOffOffset === null &&
        previousRate - retentionRate >= 20
      ) {
        dropOffOffset = offset;
        dropOffs.push({ cohortMonth, monthOffset: offset, retentionRate });
      }

      previousRate = retentionRate;
    }

    const monthOne = retentionRows.find(
      (row) => row.cohortMonth === cohortMonth && row.monthOffset === 1,
    );

    summaries.push({
      cohortMonth,
      cohortSize,
      monthOneRetention: monthOne ? monthOne.retentionRate : null,
      lastObservedOffset,
      dropOffOffset,
    });
  }

  const monthOneRates = summaries
    .map((summary) => summary.monthOneRetention)
    .filter((value): value is number => value !== null);

  const bestSummary = summaries.reduce<CohortSummary | null>((best, current) => {
    if (current.monthOneRetention === null) {
      return best;
    }
    if (!best || (best.monthOneRetention ?? -1) < current.monthOneRetention) {
      return current;
    }
    return best;
  }, null);

  return {
    rows: retentionRows,
    summaries,
    totalUsers: users.size,
    averageMonthOneRetention:
      monthOneRates.length === 0
        ? 0
        : monthOneRates.reduce((sum, value) => sum + value, 0) / monthOneRates.length,
    bestCohortMonth: bestSummary?.cohortMonth ?? null,
    dropOffs,
    maxOffset: retentionRows.reduce(
      (largest, row) => Math.max(largest, row.monthOffset),
      0,
    ),
  };
}

function buildChartOption(result: CohortResult | null, dark: boolean): EChartsOption {
  const rows = result?.rows ?? [];
  const orderedCohorts = [...new Set(rows.map((row) => row.cohortMonth))];
  const offsets = Array.from({ length: (result?.maxOffset ?? 0) + 1 }, (_, index) => `M${index}`);
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";

  return {
    animationDuration: 420,
    tooltip: {
      position: "top",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const point = params as {
          seriesName?: string;
          value?: [number, number, number];
        };
        const value = point.value ?? [0, 0, 0];
        const cohortLabel = orderedCohorts[value[1] ?? 0] ?? "Unknown";
        const monthLabel = offsets[value[0] ?? 0] ?? "M0";
        return `${point.seriesName ?? "Retention"}<br/>${cohortLabel}<br/>${monthLabel}: ${formatPercent(value[2] ?? 0)}`;
      },
    },
    legend: {
      bottom: 0,
      textStyle: { color: textColor },
    },
    grid: {
      left: 88,
      right: 28,
      top: 24,
      bottom: 64,
    },
    xAxis: {
      type: "category",
      data: offsets,
      axisLabel: { color: textColor },
      splitArea: { show: true },
    },
    yAxis: {
      type: "category",
      data: orderedCohorts,
      axisLabel: { color: textColor },
      splitArea: { show: true },
    },
    visualMap: {
      min: 0,
      max: 100,
      calculable: true,
      orient: "horizontal",
      left: "center",
      top: 0,
      inRange: {
        color: ["#0f172a", "#0369a1", "#38bdf8", "#facc15"],
      },
      textStyle: { color: textColor },
    },
    series: [
      {
        name: "Retention",
        type: "heatmap",
        data: rows.map((row) => [
          row.monthOffset,
          orderedCohorts.indexOf(row.cohortMonth),
          Number(row.retentionRate.toFixed(2)),
        ]),
        label: {
          show: true,
          color: dark ? "#e2e8f0" : "#0f172a",
          formatter: (params: unknown) => {
            const point = params as { value?: [number, number, number] };
            return `${Math.round(point.value?.[2] ?? 0)}%`;
          },
        },
      },
      {
        name: "Drop-off",
        type: "scatter",
        symbol: "diamond",
        symbolSize: 18,
        itemStyle: {
          color: "#f97316",
          borderColor: dark ? "#fff7ed" : "#9a3412",
          borderWidth: 1,
        },
        data: (result?.dropOffs ?? []).map((drop) => [
          drop.monthOffset,
          orderedCohorts.indexOf(drop.cohortMonth),
          Number(drop.retentionRate.toFixed(2)),
        ]),
      },
    ],
  };
}

export default function CohortRetention({ tableName, columns }: CohortRetentionProps) {
  const dark = useDarkMode();
  const dateColumns = useMemo(
    () => columns.filter((column) => column.type === "date"),
    [columns],
  );
  const userColumns = useMemo(
    () => columns.filter((column) => column.type !== "date"),
    [columns],
  );
  const [dateColumn, setDateColumn] = useState(dateColumns[0]?.name ?? "");
  const [userColumn, setUserColumn] = useState(userColumns[0]?.name ?? "");
  const [result, setResult] = useState<CohortResult | null>(null);
  const [status, setStatus] = useState("Build monthly cohorts to map retention and reveal drop-off points.");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const chartOption = useMemo(() => buildChartOption(result, dark), [dark, result]);

  async function handleBuild() {
    if (!dateColumn || !userColumn) {
      setError("Select one date column and one user identifier column.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(buildQuery(tableName, dateColumn, userColumn));
      const nextResult = buildCohortModel(rows);

      startTransition(() => {
        setResult(nextResult);
        setStatus(
          `Processed ${formatNumber(nextResult.totalUsers)} users across ${formatNumber(nextResult.summaries.length)} cohorts.`,
        );
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to compute cohort retention.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result || result.rows.length === 0) {
      return;
    }

    downloadFile(
      buildCsv(result.rows),
      `${tableName}-${dateColumn}-cohort-retention.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <RefreshCcw className="h-3.5 w-3.5" />
            Cohort retention
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Monthly cohort retention
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Group users by their first active month, compare follow-on retention, and surface the
            sharpest drop-off points in the lifecycle.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExport}
          disabled={!result || result.rows.length === 0}
          className={BUTTON_CLASS}
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Date column
          </span>
          <select
            aria-label="Date column"
            value={dateColumn}
            onChange={(event) => setDateColumn(event.target.value)}
            className={FIELD_CLASS}
          >
            {dateColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            User column
          </span>
          <select
            aria-label="User column"
            value={userColumn}
            onChange={(event) => setUserColumn(event.target.value)}
            className={FIELD_CLASS}
          >
            {userColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end">
          <button
            type="button"
            onClick={handleBuild}
            disabled={loading || !dateColumn || !userColumn}
            className={`${BUTTON_CLASS} w-full`}
          >
            <CalendarRange className="h-4 w-4" />
            {loading ? "Building cohorts..." : "Build cohorts"}
          </button>
        </div>
      </div>

      <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">{status}</div>
      {error ? (
        <div className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={CalendarRange}
          label="Total cohorts"
          value={result ? String(result.summaries.length) : "0"}
        />
        <SummaryCard
          icon={UsersRound}
          label="Tracked users"
          value={result ? formatNumber(result.totalUsers) : "0"}
        />
        <SummaryCard
          icon={RefreshCcw}
          label="Avg M1 retention"
          value={result ? formatPercent(result.averageMonthOneRetention) : "0.0%"}
        />
        <SummaryCard
          icon={Flame}
          label="Best cohort"
          value={result?.bestCohortMonth ?? "Not run"}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
        className={`${GLASS_CARD_CLASS} mt-6 p-4`}
      >
        {result ? (
          <ReactEChartsCore
            echarts={echarts}
            option={chartOption}
            notMerge
            style={{ height: 420 }}
          />
        ) : (
          <div className="flex min-h-[22rem] items-center justify-center rounded-[1.5rem] border border-dashed border-white/20 text-center text-sm text-slate-500 dark:text-slate-400">
            Build monthly cohorts to map retention and reveal drop-off points.
          </div>
        )}
      </motion.div>

      <div className={`${GLASS_CARD_CLASS} mt-6 overflow-hidden`}>
        <div className="border-b border-white/15 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">Cohort summary</h3>
        </div>

        {result ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-white/60 dark:bg-slate-900/60">
                <tr>
                  <th className="px-5 py-3 font-semibold text-slate-700 dark:text-slate-200">Cohort</th>
                  <th className="px-5 py-3 font-semibold text-slate-700 dark:text-slate-200">Users</th>
                  <th className="px-5 py-3 font-semibold text-slate-700 dark:text-slate-200">Month 1</th>
                  <th className="px-5 py-3 font-semibold text-slate-700 dark:text-slate-200">Last offset</th>
                  <th className="px-5 py-3 font-semibold text-slate-700 dark:text-slate-200">Drop-off</th>
                </tr>
              </thead>
              <tbody>
                {result.summaries.map((summary) => (
                  <tr key={summary.cohortMonth} className="border-t border-white/10">
                    <td className="px-5 py-3 text-slate-700 dark:text-slate-200">{summary.cohortMonth}</td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{summary.cohortSize}</td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                      {summary.monthOneRetention === null
                        ? "n/a"
                        : formatPercent(summary.monthOneRetention)}
                    </td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-300">M{summary.lastObservedOffset}</td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                      {summary.dropOffOffset === null ? "None" : `M${summary.dropOffOffset}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-sm text-slate-600 dark:text-slate-300">
            Run the cohort model to inspect cohort sizes, retention, and drop-off markers.
          </div>
        )}
      </div>
    </section>
  );
}
