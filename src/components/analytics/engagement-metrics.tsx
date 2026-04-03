"use client";

import { startTransition, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Activity, Clock, Download, Loader2, Users, UserX } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface EngagementMetricsProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface PeriodBucket {
  label: string;
  activeUsers: number;
  engagementRate: number;
}

interface EngagementResult {
  dau: number;
  wau: number;
  mau: number;
  avgSessionDuration: number;
  activeUsers: number;
  inactiveUsers: number;
  totalUsers: number;
  trend: PeriodBucket[];
}

interface SummaryCardProps {
  icon: typeof Activity;
  label: string;
  value: string;
}

const MAX_SAMPLE_ROWS = 10_000;

function SummaryCard({ icon: Icon, label, value }: SummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-violet-500/10 p-3 text-violet-600 dark:text-violet-300">
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

function buildCsv(result: EngagementResult): string {
  const header = ["metric", "value"];
  const rows = [
    ["DAU", String(result.dau)],
    ["WAU", String(result.wau)],
    ["MAU", String(result.mau)],
    ["Avg Session Duration (s)", result.avgSessionDuration.toFixed(2)],
    ["Active Users", String(result.activeUsers)],
    ["Inactive Users", String(result.inactiveUsers)],
    ["Total Users", String(result.totalUsers)],
  ];

  const trendHeader = "\n\nperiod,active_users,engagement_rate";
  const trendRows = result.trend
    .map((b) => [b.label, String(b.activeUsers), b.engagementRate.toFixed(2)].map(csvEscape).join(","))
    .join("\n");

  return [header.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n") + trendHeader + "\n" + trendRows;
}

function buildQuery(tableName: string, userCol: string, dateCol: string, sessionCol: string | null): string {
  const cols = [quoteIdentifier(userCol), quoteIdentifier(dateCol)];
  if (sessionCol) cols.push(quoteIdentifier(sessionCol));
  return `SELECT ${cols.join(", ")} FROM ${quoteIdentifier(tableName)} LIMIT ${MAX_SAMPLE_ROWS}`;
}

function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function parseDateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (isValidDateString(value)) return new Date(value);
  return null;
}

function computeEngagement(
  rows: Record<string, unknown>[],
  userCol: string,
  dateCol: string,
  sessionCol: string | null,
): EngagementResult {
  if (rows.length === 0) {
    throw new Error("DuckDB returned no rows for the engagement analysis.");
  }

  const now = new Date();
  const dayMs = 86_400_000;
  const weekMs = 7 * dayMs;
  const monthMs = 30 * dayMs;

  const userDates = new Map<string, Date[]>();

  for (const row of rows) {
    const userId = String(row[userCol] ?? "");
    const date = parseDateValue(row[dateCol]);
    if (!userId || !date) continue;
    const existing = userDates.get(userId);
    if (existing) {
      existing.push(date);
    } else {
      userDates.set(userId, [date]);
    }
  }

  const totalUsers = userDates.size;
  if (totalUsers === 0) {
    throw new Error("No valid user records found for engagement analysis.");
  }

  let dauSet = 0;
  let wauSet = 0;
  let mauSet = 0;
  let activeCount = 0;

  for (const [, dates] of userDates) {
    const latest = dates.reduce((a, b) => (a > b ? a : b));
    const diff = now.getTime() - latest.getTime();

    if (diff <= dayMs) dauSet++;
    if (diff <= weekMs) wauSet++;
    if (diff <= monthMs) {
      mauSet++;
      activeCount++;
    }
  }

  let totalSessionDuration = 0;
  let sessionCount = 0;

  if (sessionCol) {
    for (const row of rows) {
      const duration = toNumber(row[sessionCol]);
      if (duration !== null && duration > 0) {
        totalSessionDuration += duration;
        sessionCount++;
      }
    }
  }

  const avgSessionDuration = sessionCount > 0 ? totalSessionDuration / sessionCount : 0;
  const inactiveUsers = totalUsers - activeCount;

  const bucketMap = new Map<string, Set<string>>();

  for (const [userId, dates] of userDates) {
    for (const date of dates) {
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const bucket = bucketMap.get(key);
      if (bucket) {
        bucket.add(userId);
      } else {
        bucketMap.set(key, new Set([userId]));
      }
    }
  }

  const sortedKeys = [...bucketMap.keys()].sort();
  const trend: PeriodBucket[] = sortedKeys.map((key) => {
    const active = bucketMap.get(key)?.size ?? 0;
    return {
      label: key,
      activeUsers: active,
      engagementRate: totalUsers > 0 ? (active / totalUsers) * 100 : 0,
    };
  });

  return {
    dau: dauSet,
    wau: wauSet,
    mau: mauSet,
    avgSessionDuration,
    activeUsers: activeCount,
    inactiveUsers,
    totalUsers,
    trend,
  };
}

function buildChartOption(result: EngagementResult | null, dark: boolean): EChartsOption {
  const trend = result?.trend ?? [];
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";

  return {
    animationDuration: 420,
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const list = params as Array<{
          axisValueLabel?: string;
          seriesName?: string;
          value?: number;
          marker?: string;
        }>;
        if (!Array.isArray(list) || list.length === 0) return "";
        const header = list[0]?.axisValueLabel ?? "";
        const lines = list.map(
          (item) => `${item.marker ?? ""} ${item.seriesName ?? ""}: ${formatNumber(item.value ?? 0)}`,
        );
        return [header, ...lines].join("<br/>");
      },
    },
    legend: {
      bottom: 0,
      textStyle: { color: textColor },
    },
    grid: { left: "6%", right: "4%", bottom: "12%", top: "6%", containLabel: true },
    xAxis: {
      type: "category",
      data: trend.map((b) => b.label),
      axisLabel: { color: textColor },
      axisLine: { lineStyle: { color: borderColor } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0" } },
    },
    series: [
      {
        name: "Engagement Rate %",
        type: "line",
        smooth: true,
        data: trend.map((b) => Number(b.engagementRate.toFixed(2))),
        lineStyle: { width: 3, color: "#8b5cf6" },
        itemStyle: { color: "#8b5cf6" },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: dark ? "rgba(139,92,246,0.35)" : "rgba(139,92,246,0.25)" },
            { offset: 1, color: "rgba(139,92,246,0)" },
          ]),
        },
      },
    ],
  };
}

export default function EngagementMetrics({ tableName, columns }: EngagementMetricsProps) {
  const dark = useDarkMode();

  const dateColumns = useMemo(() => columns.filter((c) => c.type === "date"), [columns]);
  const stringColumns = useMemo(() => columns.filter((c) => c.type === "string" || c.type === "number"), [columns]);
  const numericColumns = useMemo(() => columns.filter((c) => c.type === "number"), [columns]);

  const [userCol, setUserCol] = useState(() => stringColumns[0]?.name ?? "");
  const [dateCol, setDateCol] = useState(() => dateColumns[0]?.name ?? "");
  const [sessionCol, setSessionCol] = useState("");

  const [result, setResult] = useState<EngagementResult | null>(null);
  const [status, setStatus] = useState("Select user and date columns to analyze engagement.");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const chartOption = useMemo(() => buildChartOption(result, dark), [dark, result]);

  async function handleAnalyze() {
    if (!userCol || !dateCol) {
      setError("Both user and date columns are required.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(buildQuery(tableName, userCol, dateCol, sessionCol || null));
      const nextResult = computeEngagement(rows, userCol, dateCol, sessionCol || null);

      startTransition(() => {
        setResult(nextResult);
        setStatus(
          `Analyzed ${formatNumber(nextResult.totalUsers)} users — DAU ${formatNumber(nextResult.dau)}, WAU ${formatNumber(nextResult.wau)}, MAU ${formatNumber(nextResult.mau)}.`,
        );
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to compute engagement metrics.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;
    downloadFile(buildCsv(result), `${tableName}-engagement-metrics.csv`, "text/csv;charset=utf-8;");
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
            <Activity className="h-3.5 w-3.5" />
            Engagement metrics
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            User engagement analysis
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Calculate DAU, WAU, MAU and engagement rate trends. Identify active versus inactive users
            and export the full breakdown.
          </p>
        </div>

        <button type="button" onClick={handleExport} disabled={!result} className={BUTTON_CLASS}>
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            User column
          </span>
          <select
            value={userCol}
            onChange={(e) => setUserCol(e.target.value)}
            className={`${FIELD_CLASS} mt-2`}
          >
            <option value="">Select column</option>
            {stringColumns.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Date column
          </span>
          <select
            value={dateCol}
            onChange={(e) => setDateCol(e.target.value)}
            className={`${FIELD_CLASS} mt-2`}
          >
            <option value="">Select column</option>
            {dateColumns.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Session duration column (optional)
          </span>
          <select
            value={sessionCol}
            onChange={(e) => setSessionCol(e.target.value)}
            className={`${FIELD_CLASS} mt-2`}
          >
            <option value="">None</option>
            {numericColumns.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-600 dark:text-slate-300">{status}</div>
        <button type="button" onClick={handleAnalyze} disabled={loading} className={BUTTON_CLASS}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
          {loading ? "Analyzing..." : "Analyze engagement"}
        </button>
      </div>

      {error ? (
        <div className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <SummaryCard icon={Users} label="DAU" value={result ? formatNumber(result.dau) : "0"} />
        <SummaryCard icon={Users} label="WAU" value={result ? formatNumber(result.wau) : "0"} />
        <SummaryCard icon={Users} label="MAU" value={result ? formatNumber(result.mau) : "0"} />
        <SummaryCard
          icon={Clock}
          label="Avg session (s)"
          value={result ? result.avgSessionDuration.toFixed(1) : "0.0"}
        />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <SummaryCard
          icon={Users}
          label="Active users"
          value={result ? formatNumber(result.activeUsers) : "0"}
        />
        <SummaryCard
          icon={UserX}
          label="Inactive users"
          value={result ? formatNumber(result.inactiveUsers) : "0"}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
        className={`${GLASS_CARD_CLASS} mt-6 p-4`}
      >
        {result ? (
          <ReactEChartsCore echarts={echarts} option={chartOption} notMerge style={{ height: 380 }} />
        ) : (
          <div className="flex min-h-[20rem] items-center justify-center rounded-[1.5rem] border border-dashed border-white/20 text-center text-sm text-slate-500 dark:text-slate-400">
            Select user and date columns, then analyze engagement.
          </div>
        )}
      </motion.div>

      {result && result.trend.length > 0 ? (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Active users</th>
                <th className="px-4 py-3">Engagement rate</th>
              </tr>
            </thead>
            <tbody>
              {result.trend.map((bucket) => (
                <tr
                  key={bucket.label}
                  className="border-b border-white/5 text-slate-700 dark:text-slate-200"
                >
                  <td className="px-4 py-3 font-medium">{bucket.label}</td>
                  <td className="px-4 py-3">{formatNumber(bucket.activeUsers)}</td>
                  <td className="px-4 py-3">{formatPercent(bucket.engagementRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
