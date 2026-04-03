"use client";

import { startTransition, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { AlertTriangle, Download, Loader2, ShieldAlert, Users } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { churnPredict } from "@/lib/api/analytics";
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

interface ChurnPredictorProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface ChurnUserRow {
  userId: string;
  recencyDays: number;
  averageEngagement: number;
  activityCount: number;
  riskScore: number;
  band: string;
  churnIndicator: "yes" | "no";
}

interface ChurnSnapshot {
  users: ChurnUserRow[];
  distribution: Array<{ band: string; count: number }>;
  atRiskCount: number;
  averageRisk: number;
}

interface SummaryCardProps {
  icon: typeof Users;
  label: string;
  value: string;
}

const SAMPLE_LIMIT = 6_000;
const RISK_BANDS = ["Low", "Medium", "High", "Critical"] as const;

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

function buildQuery(
  tableName: string,
  userColumn: string,
  activityDateColumn: string,
  engagementColumn: string,
) {
  return `
    SELECT
      CAST(${quoteIdentifier(userColumn)} AS VARCHAR) AS user_id,
      CAST(${quoteIdentifier(activityDateColumn)} AS VARCHAR) AS activity_date,
      TRY_CAST(${quoteIdentifier(engagementColumn)} AS DOUBLE) AS engagement_value
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(userColumn)} IS NOT NULL
      AND ${quoteIdentifier(activityDateColumn)} IS NOT NULL
      AND TRY_CAST(${quoteIdentifier(engagementColumn)} AS DOUBLE) IS NOT NULL
    LIMIT ${SAMPLE_LIMIT}
  `;
}

function bandForRisk(score: number) {
  if (score >= 80) return "Critical";
  if (score >= 60) return "High";
  if (score >= 35) return "Medium";
  return "Low";
}

function aggregateUserFeatures(rows: Record<string, unknown>[]) {
  const grouped = new Map<string, { lastSeen: Date; activityCount: number; engagementTotal: number }>();
  let referenceDate: Date | null = null;

  for (const row of rows) {
    const userId = typeof row.user_id === "string" ? row.user_id : "";
    const activityDate = toDate(row.activity_date);
    const engagementValue = toNumber(row.engagement_value);

    if (!userId || !activityDate || engagementValue === null) {
      continue;
    }

    if (!referenceDate || activityDate > referenceDate) {
      referenceDate = activityDate;
    }

    const current = grouped.get(userId) ?? {
      lastSeen: activityDate,
      activityCount: 0,
      engagementTotal: 0,
    };

    if (activityDate > current.lastSeen) {
      current.lastSeen = activityDate;
    }
    current.activityCount += 1;
    current.engagementTotal += engagementValue;
    grouped.set(userId, current);
  }

  if (!referenceDate) {
    return { userRecords: [] as Array<{ userId: string; recency_days: number; avg_engagement: number; activity_count: number }>, featureData: [] as Record<string, unknown>[] };
  }

  const userRecords = Array.from(grouped.entries()).map(([userId, stats]) => {
    const recencyDays = Math.max(
      0,
      Math.round((referenceDate.getTime() - stats.lastSeen.getTime()) / 86_400_000),
    );
    const avgEngagement = stats.engagementTotal / Math.max(stats.activityCount, 1);
    return {
      userId,
      recency_days: recencyDays,
      avg_engagement: avgEngagement,
      activity_count: stats.activityCount,
    };
  });

  const featureData = userRecords.map((record) => ({
    recency_days: record.recency_days,
    avg_engagement: record.avg_engagement,
    activity_count: record.activity_count,
  }));

  return { userRecords, featureData };
}

async function computeChurnSnapshot(rows: Record<string, unknown>[]): Promise<ChurnSnapshot> {
  const { userRecords, featureData } = aggregateUserFeatures(rows);

  if (userRecords.length === 0) {
    return {
      users: [],
      distribution: RISK_BANDS.map((band) => ({ band, count: 0 })),
      atRiskCount: 0,
      averageRisk: 0,
    };
  }

  const features = ["recency_days", "avg_engagement", "activity_count"];

  // Call the Python backend for real ML-based churn prediction
  const apiResult = await churnPredict(featureData, features, "recency_days");

  const users = userRecords
    .map<ChurnUserRow>((record, index) => {
      const riskScore = Math.round(
        Math.min(100, Math.max(0, (apiResult.risk_scores[index] ?? 0) * 100)),
      );
      const band = bandForRisk(riskScore);

      return {
        userId: record.userId,
        recencyDays: record.recency_days,
        averageEngagement: record.avg_engagement,
        activityCount: record.activity_count,
        riskScore,
        band,
        churnIndicator: riskScore >= 60 ? "yes" : "no",
      };
    })
    .sort((left, right) => right.riskScore - left.riskScore);

  const distribution = RISK_BANDS.map((band) => ({
    band,
    count: users.filter((user) => user.band === band).length,
  }));

  return {
    users,
    distribution,
    atRiskCount: users.filter((user) => user.riskScore >= 60).length,
    averageRisk:
      users.reduce((sum, user) => sum + user.riskScore, 0) / Math.max(users.length, 1),
  };
}

function buildDistributionOption(snapshot: ChurnSnapshot | null, dark: boolean): EChartsOption {
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
        return `${item?.axisValueLabel ?? "Band"}: ${formatNumber(Number(item?.value ?? 0))}`;
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
      data: distribution.map((entry) => entry.band),
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
          color: "#06b6d4",
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

function buildChurnCsv(rows: ChurnUserRow[]) {
  const header = [
    "user_id",
    "recency_days",
    "average_engagement",
    "activity_count",
    "risk_score",
    "band",
    "churn_indicator",
  ];
  const body = rows.map((row) =>
    [
      row.userId,
      row.recencyDays,
      row.averageEngagement,
      row.activityCount,
      row.riskScore,
      row.band,
      row.churnIndicator,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...body].join("\n");
}

export default function ChurnPredictor({ tableName, columns }: ChurnPredictorProps) {
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
  const [activityDateColumn, setActivityDateColumn] = useState(dateColumns[0]?.name ?? "");
  const [engagementColumn, setEngagementColumn] = useState(numericColumns[0]?.name ?? "");
  const [snapshot, setSnapshot] = useState<ChurnSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState(
    "Choose an account id, activity date, and engagement metric to score churn risk.",
  );

  const chartOption = useMemo(
    () => buildDistributionOption(snapshot, dark),
    [dark, snapshot],
  );

  async function handleAnalyze() {
    if (!userColumn || !activityDateColumn || !engagementColumn) {
      setStatus("Select a user column, activity date, and engagement metric before scoring.");
      return;
    }

    setIsLoading(true);

    try {
      const rows = await runQuery(
        buildQuery(tableName, userColumn, activityDateColumn, engagementColumn),
      );
      const nextSnapshot = await computeChurnSnapshot(rows);

      startTransition(() => {
        setSnapshot(nextSnapshot);
        setStatus(
          `Flagged ${nextSnapshot.atRiskCount} at-risk users from ${nextSnapshot.users.length} accounts.`,
        );
      });
    } catch (analysisError) {
      if (
        analysisError instanceof Error &&
        (analysisError.message.includes("fetch") ||
          analysisError.message.includes("Failed") ||
          analysisError.message.includes("ECONNREFUSED") ||
          analysisError.message.includes("NetworkError"))
      ) {
        setStatus(
          "Could not reach the AI backend. Make sure the Python API server is running.",
        );
      } else {
        setStatus("Churn scoring failed. Verify the selected identifier and metrics.");
      }
    } finally {
      setIsLoading(false);
    }
  }

  function handleExport() {
    if (!snapshot || snapshot.users.length === 0) return;

    downloadFile(
      buildChurnCsv(snapshot.users),
      `${tableName}-churn-prediction.csv`,
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
            <ShieldAlert className="h-3.5 w-3.5" />
            Churn risk
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Score churn risk from activity decay and engagement drops
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Build a quick churn proxy from inactivity, engagement decline, and low user activity
            volume directly in the browser.
          </p>
        </div>

        <div className={`${GLASS_CARD_CLASS} max-w-md p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Latest scorecard
          </p>
          <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
            {snapshot ? `${snapshot.atRiskCount} users above risk threshold` : "Awaiting analysis"}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{status}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                User id column
              </span>
              <select
                value={userColumn}
                onChange={(event) => setUserColumn(event.target.value)}
                className={FIELD_CLASS}
                aria-label="User id column"
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
                Activity date column
              </span>
              <select
                value={activityDateColumn}
                onChange={(event) => setActivityDateColumn(event.target.value)}
                className={FIELD_CLASS}
                aria-label="Activity date column"
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
                Engagement column
              </span>
              <select
                value={engagementColumn}
                onChange={(event) => setEngagementColumn(event.target.value)}
                className={FIELD_CLASS}
                aria-label="Engagement column"
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
              onClick={() => void handleAnalyze()}
              className={BUTTON_CLASS}
              disabled={!hasColumns || isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )}
              Compute risk
            </button>
            <button
              type="button"
              onClick={handleExport}
              className={BUTTON_CLASS}
              disabled={!snapshot || snapshot.users.length === 0}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>

        <div className="grid gap-4">
          <SummaryCard
            icon={Users}
            label="Accounts scored"
            value={snapshot ? snapshot.users.length.toString() : "0"}
          />
          <SummaryCard
            icon={ShieldAlert}
            label="At-risk users"
            value={snapshot ? snapshot.atRiskCount.toString() : "0"}
          />
          <SummaryCard
            icon={AlertTriangle}
            label="Average risk"
            value={snapshot ? `${snapshot.averageRisk.toFixed(1)} / 100` : "0 / 100"}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-950 dark:text-white">
              Risk distribution
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
            At-risk users
          </h3>
          {!hasColumns ? (
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
              Add user, date, and engagement columns to compute churn risk.
            </p>
          ) : !snapshot || snapshot.users.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
              Run the analysis to see who is trending toward churn.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-white/20 text-sm">
                <thead>
                  <tr className="text-left text-slate-500 dark:text-slate-400">
                    <th className="px-3 py-2 font-medium">User</th>
                    <th className="px-3 py-2 font-medium">Recency</th>
                    <th className="px-3 py-2 font-medium">Engagement</th>
                    <th className="px-3 py-2 font-medium">Risk</th>
                    <th className="px-3 py-2 font-medium">Band</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.users.slice(0, 8).map((row) => (
                    <tr key={row.userId} className="border-t border-white/10">
                      <td className="px-3 py-2 font-medium text-slate-950 dark:text-white">
                        {row.userId}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {row.recencyDays} days
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {row.averageEngagement.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {row.riskScore}
                      </td>
                      <td className="px-3 py-2 text-cyan-700 dark:text-cyan-300">{row.band}</td>
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
