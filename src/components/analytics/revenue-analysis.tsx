"use client";

import { startTransition, useMemo, useState } from "react";
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
import {
  BarChart3,
  DollarSign,
  Download,
  Loader2,
  TrendingUp,
  Users,
} from "lucide-react";
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

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface RevenueAnalysisProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface SegmentRevenue {
  segment: string;
  revenue: number;
}

interface GrowthPeriod {
  label: string;
  revenue: number;
  growthRate: number;
}

interface RevenueResult {
  totalRevenue: number;
  arpu: number;
  mrr: number;
  uniqueUsers: number;
  segments: SegmentRevenue[];
  growth: GrowthPeriod[];
  topSources: SegmentRevenue[];
}

interface SummaryCardProps {
  icon: typeof DollarSign;
  label: string;
  value: string;
}

const MAX_SAMPLE_ROWS = 10_000;
const MAX_SEGMENTS = 20;

function SummaryCard({ icon: Icon, label, value }: SummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-emerald-500/10 p-3 text-emerald-600 dark:text-emerald-300">
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

function buildCsv(result: RevenueResult): string {
  const header = ["metric", "value"];
  const summary = [
    ["Total Revenue", result.totalRevenue.toFixed(2)],
    ["ARPU", result.arpu.toFixed(2)],
    ["MRR", result.mrr.toFixed(2)],
    ["Unique Users", String(result.uniqueUsers)],
  ];

  const segHeader = "\n\nsegment,revenue";
  const segRows = result.segments
    .map((s) => [s.segment, s.revenue.toFixed(2)].map(csvEscape).join(","))
    .join("\n");

  const growthHeader = "\n\nperiod,revenue,growth_rate";
  const growthRows = result.growth
    .map((g) => [g.label, g.revenue.toFixed(2), g.growthRate.toFixed(2)].map(csvEscape).join(","))
    .join("\n");

  return (
    [header.join(","), ...summary.map((r) => r.map(csvEscape).join(","))].join("\n") +
    segHeader +
    "\n" +
    segRows +
    growthHeader +
    "\n" +
    growthRows
  );
}

function buildQuery(
  tableName: string,
  revenueCol: string,
  segmentCol: string | null,
  dateCol: string | null,
  userCol: string | null,
): string {
  const cols = [quoteIdentifier(revenueCol)];
  if (segmentCol) cols.push(quoteIdentifier(segmentCol));
  if (dateCol) cols.push(quoteIdentifier(dateCol));
  if (userCol) cols.push(quoteIdentifier(userCol));
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

function computeRevenue(
  rows: Record<string, unknown>[],
  revenueCol: string,
  segmentCol: string | null,
  dateCol: string | null,
  userCol: string | null,
): RevenueResult {
  if (rows.length === 0) {
    throw new Error("DuckDB returned no rows for the revenue analysis.");
  }

  let totalRevenue = 0;
  const userSet = new Set<string>();
  const segmentMap = new Map<string, number>();
  const periodMap = new Map<string, number>();

  for (const row of rows) {
    const rev = toNumber(row[revenueCol]);
    if (rev === null) continue;

    totalRevenue += rev;

    if (userCol) {
      const userId = String(row[userCol] ?? "");
      if (userId) userSet.add(userId);
    }

    if (segmentCol) {
      const seg = String(row[segmentCol] ?? "other");
      segmentMap.set(seg, (segmentMap.get(seg) ?? 0) + rev);
    }

    if (dateCol) {
      const date = parseDateValue(row[dateCol]);
      if (date) {
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        periodMap.set(key, (periodMap.get(key) ?? 0) + rev);
      }
    }
  }

  const uniqueUsers = userCol ? Math.max(userSet.size, 1) : rows.length;
  const arpu = totalRevenue / uniqueUsers;

  const periodKeys = [...periodMap.keys()].sort();
  const monthCount = Math.max(periodKeys.length, 1);
  const mrr = totalRevenue / monthCount;

  const segments: SegmentRevenue[] = [...segmentMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SEGMENTS)
    .map(([segment, revenue]) => ({ segment, revenue }));

  const growth: GrowthPeriod[] = periodKeys.map((key, index) => {
    const revenue = periodMap.get(key) ?? 0;
    const prevRevenue = index > 0 ? (periodMap.get(periodKeys[index - 1] ?? "") ?? 0) : 0;
    const growthRate = index === 0 || prevRevenue === 0 ? 0 : ((revenue - prevRevenue) / prevRevenue) * 100;
    return { label: key, revenue, growthRate };
  });

  const topSources = segments.slice(0, 10);

  return { totalRevenue, arpu, mrr, uniqueUsers, segments, growth, topSources };
}

function buildBarOption(result: RevenueResult | null, dark: boolean): EChartsOption {
  const segments = result?.segments ?? [];
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
          value?: number;
          marker?: string;
        }>;
        if (!Array.isArray(list) || list.length === 0) return "";
        return `${list[0]?.axisValueLabel ?? ""}<br/>${list[0]?.marker ?? ""} Revenue: $${formatNumber(list[0]?.value ?? 0)}`;
      },
    },
    grid: { left: "6%", right: "4%", bottom: "12%", top: "6%", containLabel: true },
    xAxis: {
      type: "category",
      data: segments.map((s) => s.segment),
      axisLabel: { color: textColor, rotate: 30 },
      axisLine: { lineStyle: { color: borderColor } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0" } },
    },
    series: [
      {
        name: "Revenue",
        type: "bar",
        data: segments.map((s) => Number(s.revenue.toFixed(2))),
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "#10b981" },
            { offset: 1, color: "#059669" },
          ]),
          borderRadius: [8, 8, 0, 0],
        },
      },
    ],
  };
}

function buildGrowthOption(result: RevenueResult | null, dark: boolean): EChartsOption {
  const growth = result?.growth ?? [];
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
          (item) => `${item.marker ?? ""} ${item.seriesName ?? ""}: ${formatNumber(item.value ?? 0)}%`,
        );
        return [header, ...lines].join("<br/>");
      },
    },
    grid: { left: "6%", right: "4%", bottom: "12%", top: "6%", containLabel: true },
    xAxis: {
      type: "category",
      data: growth.map((g) => g.label),
      axisLabel: { color: textColor },
      axisLine: { lineStyle: { color: borderColor } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor, formatter: "{value}%" },
      splitLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0" } },
    },
    series: [
      {
        name: "Growth Rate",
        type: "line",
        smooth: true,
        data: growth.map((g) => Number(g.growthRate.toFixed(2))),
        lineStyle: { width: 3, color: "#10b981" },
        itemStyle: { color: "#10b981" },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: dark ? "rgba(16,185,129,0.35)" : "rgba(16,185,129,0.25)" },
            { offset: 1, color: "rgba(16,185,129,0)" },
          ]),
        },
      },
    ],
  };
}

export default function RevenueAnalysis({ tableName, columns }: RevenueAnalysisProps) {
  const dark = useDarkMode();

  const numericColumns = useMemo(() => columns.filter((c) => c.type === "number"), [columns]);
  const dateColumns = useMemo(() => columns.filter((c) => c.type === "date"), [columns]);
  const stringColumns = useMemo(
    () => columns.filter((c) => c.type === "string" || c.type === "number"),
    [columns],
  );

  const [revenueCol, setRevenueCol] = useState(() => numericColumns[0]?.name ?? "");
  const [segmentCol, setSegmentCol] = useState("");
  const [dateCol, setDateCol] = useState(() => dateColumns[0]?.name ?? "");
  const [userCol, setUserCol] = useState("");

  const [result, setResult] = useState<RevenueResult | null>(null);
  const [status, setStatus] = useState("Select a revenue column and run the analysis.");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const barOption = useMemo(() => buildBarOption(result, dark), [dark, result]);
  const growthOption = useMemo(() => buildGrowthOption(result, dark), [dark, result]);

  async function handleAnalyze() {
    if (!revenueCol) {
      setError("A revenue column is required.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(
        buildQuery(tableName, revenueCol, segmentCol || null, dateCol || null, userCol || null),
      );
      const nextResult = computeRevenue(rows, revenueCol, segmentCol || null, dateCol || null, userCol || null);

      startTransition(() => {
        setResult(nextResult);
        setStatus(
          `Total revenue $${formatNumber(nextResult.totalRevenue)} — ARPU $${formatNumber(nextResult.arpu)}, MRR $${formatNumber(nextResult.mrr)}.`,
        );
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to compute revenue analysis.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;
    downloadFile(buildCsv(result), `${tableName}-revenue-analysis.csv`, "text/csv;charset=utf-8;");
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
            <DollarSign className="h-3.5 w-3.5" />
            Revenue analysis
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Revenue analysis dashboard
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Analyze total revenue, ARPU, and MRR. Break revenue down by segment,
            visualize growth trends, and identify top revenue sources.
          </p>
        </div>

        <button type="button" onClick={handleExport} disabled={!result} className={BUTTON_CLASS}>
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Revenue column
          </span>
          <select
            value={revenueCol}
            onChange={(e) => setRevenueCol(e.target.value)}
            className={`${FIELD_CLASS} mt-2`}
          >
            <option value="">Select column</option>
            {numericColumns.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Segment column (optional)
          </span>
          <select
            value={segmentCol}
            onChange={(e) => setSegmentCol(e.target.value)}
            className={`${FIELD_CLASS} mt-2`}
          >
            <option value="">None</option>
            {stringColumns.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Date column (optional)
          </span>
          <select
            value={dateCol}
            onChange={(e) => setDateCol(e.target.value)}
            className={`${FIELD_CLASS} mt-2`}
          >
            <option value="">None</option>
            {dateColumns.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            User column (optional)
          </span>
          <select
            value={userCol}
            onChange={(e) => setUserCol(e.target.value)}
            className={`${FIELD_CLASS} mt-2`}
          >
            <option value="">None</option>
            {stringColumns.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-600 dark:text-slate-300">{status}</div>
        <button type="button" onClick={handleAnalyze} disabled={loading} className={BUTTON_CLASS}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
          {loading ? "Analyzing..." : "Analyze revenue"}
        </button>
      </div>

      {error ? (
        <div className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <SummaryCard
          icon={DollarSign}
          label="Total revenue"
          value={result ? `$${formatNumber(result.totalRevenue)}` : "$0"}
        />
        <SummaryCard
          icon={Users}
          label="ARPU"
          value={result ? `$${formatNumber(result.arpu)}` : "$0"}
        />
        <SummaryCard
          icon={TrendingUp}
          label="MRR"
          value={result ? `$${formatNumber(result.mrr)}` : "$0"}
        />
        <SummaryCard
          icon={Users}
          label="Unique users"
          value={result ? formatNumber(result.uniqueUsers) : "0"}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
          className={`${GLASS_CARD_CLASS} p-4`}
        >
          <p className="mb-3 text-sm font-semibold text-slate-950 dark:text-white">
            Revenue by segment
          </p>
          {result && result.segments.length > 0 ? (
            <ReactEChartsCore echarts={echarts} option={barOption} notMerge style={{ height: 340 }} />
          ) : (
            <div className="flex min-h-[14rem] items-center justify-center rounded-[1.5rem] border border-dashed border-white/20 text-center text-sm text-slate-500 dark:text-slate-400">
              Run the analysis to see segment data.
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, delay: 0.06, ease: ANALYTICS_EASE }}
          className={`${GLASS_CARD_CLASS} p-4`}
        >
          <p className="mb-3 text-sm font-semibold text-slate-950 dark:text-white">
            Revenue growth trend
          </p>
          {result && result.growth.length > 0 ? (
            <ReactEChartsCore echarts={echarts} option={growthOption} notMerge style={{ height: 340 }} />
          ) : (
            <div className="flex min-h-[14rem] items-center justify-center rounded-[1.5rem] border border-dashed border-white/20 text-center text-sm text-slate-500 dark:text-slate-400">
              Add a date column to see growth trends.
            </div>
          )}
        </motion.div>
      </div>

      {result && result.topSources.length > 0 ? (
        <div className="mt-6 overflow-x-auto">
          <p className="mb-3 text-sm font-semibold text-slate-950 dark:text-white">
            Top revenue sources
          </p>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3">Rank</th>
                <th className="px-4 py-3">Segment</th>
                <th className="px-4 py-3">Revenue</th>
                <th className="px-4 py-3">Share</th>
              </tr>
            </thead>
            <tbody>
              {result.topSources.map((source, index) => (
                <tr
                  key={source.segment}
                  className="border-b border-white/5 text-slate-700 dark:text-slate-200"
                >
                  <td className="px-4 py-3 font-medium">{index + 1}</td>
                  <td className="px-4 py-3">{source.segment}</td>
                  <td className="px-4 py-3">${formatNumber(source.revenue)}</td>
                  <td className="px-4 py-3">
                    {result.totalRevenue > 0
                      ? formatPercent((source.revenue / result.totalRevenue) * 100)
                      : "0.0%"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
