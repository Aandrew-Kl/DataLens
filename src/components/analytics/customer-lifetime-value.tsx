"use client";

import { startTransition, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Crown, Download, Loader2, Sparkles, Wallet } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toDate,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface CustomerLifetimeValueProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface ClvRow {
  userId: string;
  totalRevenue: number;
  orderCount: number;
  averageOrderValue: number;
  clv: number;
  tier: string;
}

interface ClvSnapshot {
  rows: ClvRow[];
  distribution: Array<{ tier: string; count: number }>;
  topCustomer: string | null;
  averageClv: number;
}

interface SummaryCardProps {
  icon: typeof Wallet;
  label: string;
  value: string;
}

const SAMPLE_LIMIT = 6_000;
const TIERS = ["Core", "Growth", "High Value", "VIP"] as const;

function SummaryCard({ icon: Icon, label, value }: SummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-cyan-500/10 p-3 text-cyan-700 dark:text-cyan-300">
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

function buildQuery(tableName: string, userColumn: string, dateColumn: string, revenueColumn: string) {
  return `
    SELECT
      CAST(${quoteIdentifier(userColumn)} AS VARCHAR) AS user_id,
      CAST(${quoteIdentifier(dateColumn)} AS VARCHAR) AS order_date,
      TRY_CAST(${quoteIdentifier(revenueColumn)} AS DOUBLE) AS revenue_value
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(userColumn)} IS NOT NULL
      AND ${quoteIdentifier(dateColumn)} IS NOT NULL
      AND TRY_CAST(${quoteIdentifier(revenueColumn)} AS DOUBLE) IS NOT NULL
    LIMIT ${SAMPLE_LIMIT}
  `;
}

function tierForClv(clv: number) {
  if (clv >= 2_500) return "VIP";
  if (clv >= 1_500) return "High Value";
  if (clv >= 700) return "Growth";
  return "Core";
}

function computeClvSnapshot(rows: Record<string, unknown>[]): ClvSnapshot {
  const grouped = new Map<
    string,
    { totalRevenue: number; orderCount: number; firstDate: Date; lastDate: Date }
  >();

  for (const row of rows) {
    const userId = typeof row.user_id === "string" ? row.user_id : "";
    const orderDate = toDate(row.order_date);
    const revenueValue = toNumber(row.revenue_value);

    if (!userId || !orderDate || revenueValue === null) {
      continue;
    }

    const current = grouped.get(userId) ?? {
      totalRevenue: 0,
      orderCount: 0,
      firstDate: orderDate,
      lastDate: orderDate,
    };

    current.totalRevenue += revenueValue;
    current.orderCount += 1;
    if (orderDate < current.firstDate) current.firstDate = orderDate;
    if (orderDate > current.lastDate) current.lastDate = orderDate;
    grouped.set(userId, current);
  }

  const rowsWithClv = Array.from(grouped.entries())
    .map<ClvRow>(([userId, stats]) => {
      const spanDays = Math.max(
        30,
        Math.round((stats.lastDate.getTime() - stats.firstDate.getTime()) / 86_400_000) + 1,
      );
      const monthsObserved = Math.max(1, spanDays / 30);
      const averageOrderValue = stats.totalRevenue / Math.max(stats.orderCount, 1);
      const purchaseFrequency = stats.orderCount / monthsObserved;
      const retentionMultiplier = Math.min(18, Math.max(6, monthsObserved * 4));
      const clv = averageOrderValue * purchaseFrequency * retentionMultiplier;

      return {
        userId,
        totalRevenue: stats.totalRevenue,
        orderCount: stats.orderCount,
        averageOrderValue,
        clv,
        tier: tierForClv(clv),
      };
    })
    .sort((left, right) => right.clv - left.clv);

  return {
    rows: rowsWithClv,
    distribution: TIERS.map((tier) => ({
      tier,
      count: rowsWithClv.filter((row) => row.tier === tier).length,
    })),
    topCustomer: rowsWithClv[0]?.userId ?? null,
    averageClv:
      rowsWithClv.reduce((sum, row) => sum + row.clv, 0) / Math.max(rowsWithClv.length, 1),
  };
}

function buildDistributionOption(snapshot: ClvSnapshot | null, dark: boolean): EChartsOption {
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";
  const distribution = snapshot?.distribution ?? [];

  return {
    animationDuration: 420,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const items = Array.isArray(params)
          ? (params as Array<{ axisValueLabel?: string; value?: number }>)
          : [params as { axisValueLabel?: string; value?: number }];
        const item = items[0];
        return `${item?.axisValueLabel ?? "Tier"}: ${formatNumber(Number(item?.value ?? 0))}`;
      },
    },
    grid: {
      left: 36,
      right: 24,
      top: 20,
      bottom: 28,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: distribution.map((entry) => entry.tier),
      axisLabel: { color: textColor },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        type: "bar",
        data: distribution.map((entry) => entry.count),
        itemStyle: {
          color: "#14b8a6",
          borderRadius: [10, 10, 0, 0] as const,
        },
      },
    ],
  };
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildClvCsv(rows: ClvRow[]) {
  const header = [
    "user_id",
    "total_revenue",
    "order_count",
    "average_order_value",
    "clv",
    "tier",
  ];
  const body = rows.map((row) =>
    [row.userId, row.totalRevenue, row.orderCount, row.averageOrderValue, row.clv, row.tier]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...body].join("\n");
}

export default function CustomerLifetimeValue({
  tableName,
  columns,
}: CustomerLifetimeValueProps) {
  const userColumns = useMemo(
    () => columns.filter((column) => column.type === "string"),
    [columns],
  );
  const dateColumns = useMemo(
    () => columns.filter((column) => column.type === "date"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const dark = useDarkMode();

  const [userColumn, setUserColumn] = useState(userColumns[0]?.name ?? "");
  const [dateColumn, setDateColumn] = useState(dateColumns[0]?.name ?? "");
  const [revenueColumn, setRevenueColumn] = useState(numericColumns[0]?.name ?? "");
  const [snapshot, setSnapshot] = useState<ClvSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState(
    "Choose a customer id, order date, and revenue column to estimate CLV.",
  );

  const chartOption = useMemo(
    () => buildDistributionOption(snapshot, dark),
    [dark, snapshot],
  );

  async function handleCalculate() {
    if (!userColumn || !dateColumn || !revenueColumn) {
      setStatus("Select customer, date, and revenue columns before calculating CLV.");
      return;
    }

    setIsLoading(true);

    try {
      const rows = await runQuery(buildQuery(tableName, userColumn, dateColumn, revenueColumn));
      const nextSnapshot = computeClvSnapshot(rows);

      startTransition(() => {
        setSnapshot(nextSnapshot);
        setStatus(
          `Calculated CLV for ${nextSnapshot.rows.length} customers across ${nextSnapshot.distribution.filter((entry) => entry.count > 0).length} tiers.`,
        );
      });
    } catch {
      setStatus("CLV calculation failed. Verify the selected customer and revenue fields.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleExport() {
    if (!snapshot || snapshot.rows.length === 0) return;

    downloadFile(
      buildClvCsv(snapshot.rows),
      `${tableName}-customer-lifetime-value.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  const hasColumns =
    userColumns.length > 0 && dateColumns.length > 0 && numericColumns.length > 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Sparkles className="h-3.5 w-3.5" />
            Customer value
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Estimate customer lifetime value from observed revenue
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Calculate an operational CLV proxy using observed revenue, purchase frequency, and a
            retained lifetime multiplier.
          </p>
        </div>

        <div className={`${GLASS_CARD_CLASS} max-w-md p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Top customer
          </p>
          <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
            {snapshot?.topCustomer ?? "Awaiting calculation"}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{status}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Customer column
              </span>
              <select
                value={userColumn}
                onChange={(event) => setUserColumn(event.target.value)}
                className={FIELD_CLASS}
                aria-label="Customer column"
              >
                {userColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Date column
              </span>
              <select
                value={dateColumn}
                onChange={(event) => setDateColumn(event.target.value)}
                className={FIELD_CLASS}
                aria-label="Date column"
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
                Revenue column
              </span>
              <select
                value={revenueColumn}
                onChange={(event) => setRevenueColumn(event.target.value)}
                className={FIELD_CLASS}
                aria-label="Revenue column"
              >
                {numericColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleCalculate()}
              className={BUTTON_CLASS}
              disabled={!hasColumns || isLoading}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
              Calculate CLV
            </button>
            <button
              type="button"
              onClick={handleExport}
              className={BUTTON_CLASS}
              disabled={!snapshot || snapshot.rows.length === 0}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>

        <div className="grid gap-4">
          <SummaryCard
            icon={Wallet}
            label="Customers scored"
            value={snapshot ? snapshot.rows.length.toString() : "0"}
          />
          <SummaryCard
            icon={Crown}
            label="Average CLV"
            value={snapshot ? formatNumber(snapshot.averageClv) : "0"}
          />
          <SummaryCard
            icon={Sparkles}
            label="Populated tiers"
            value={
              snapshot
                ? snapshot.distribution.filter((entry) => entry.count > 0).length.toString()
                : "0"
            }
          />
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-950 dark:text-white">
              CLV tier distribution
            </h3>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              ECharts
            </p>
          </div>
          <ReactEChartsCore
            echarts={echarts}
            option={chartOption}
            notMerge
            lazyUpdate
            style={{ height: 300 }}
          />
        </div>

        <div className={`${GLASS_CARD_CLASS} overflow-hidden p-5`}>
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">
            Top customers
          </h3>
          {!hasColumns ? (
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
              Add customer, date, and revenue columns to estimate lifetime value.
            </p>
          ) : !snapshot || snapshot.rows.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
              Calculate CLV to rank the highest-value customers.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-white/20 text-sm">
                <thead>
                  <tr className="text-left text-slate-500 dark:text-slate-400">
                    <th className="px-3 py-2 font-medium">Customer</th>
                    <th className="px-3 py-2 font-medium">Revenue</th>
                    <th className="px-3 py-2 font-medium">Orders</th>
                    <th className="px-3 py-2 font-medium">CLV</th>
                    <th className="px-3 py-2 font-medium">Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.rows.slice(0, 8).map((row) => (
                    <tr key={row.userId} className="border-t border-white/10">
                      <td className="px-3 py-2 font-medium text-slate-950 dark:text-white">
                        {row.userId}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {formatNumber(row.totalRevenue)}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {row.orderCount}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {formatNumber(row.clv)}
                      </td>
                      <td className="px-3 py-2 text-cyan-700 dark:text-cyan-300">{row.tier}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}
