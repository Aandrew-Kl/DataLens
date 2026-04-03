"use client";

import { startTransition, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Coins, Download, Gauge, RefreshCcw, Users } from "lucide-react";
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
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  BarChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface RfmAnalysisProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface CustomerRfmRow {
  userId: string;
  recencyDays: number;
  frequency: number;
  monetary: number;
  recencyScore: number;
  frequencyScore: number;
  monetaryScore: number;
  segment: string;
}

interface SegmentSummary {
  segment: string;
  customerCount: number;
  avgMonetary: number;
}

interface RfmResult {
  customers: CustomerRfmRow[];
  segmentSummaries: SegmentSummary[];
  scoreDistribution: Array<{ score: number; recency: number; frequency: number; monetary: number }>;
  topSegment: string | null;
  avgRecency: number;
  avgMonetary: number;
}

interface SummaryCardProps {
  icon: typeof Users;
  label: string;
  value: string;
}

const MAX_SAMPLE_ROWS = 20_000;
const SEGMENT_PALETTE = [
  "#06b6d4",
  "#22c55e",
  "#f97316",
  "#a855f7",
  "#e11d48",
  "#facc15",
] as const;

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

function buildCsv(rows: CustomerRfmRow[]): string {
  const header = [
    "user_id",
    "recency_days",
    "frequency",
    "monetary",
    "recency_score",
    "frequency_score",
    "monetary_score",
    "segment",
  ];
  const body = rows.map((row) =>
    [
      row.userId,
      row.recencyDays,
      row.frequency,
      row.monetary.toFixed(2),
      row.recencyScore,
      row.frequencyScore,
      row.monetaryScore,
      row.segment,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...body].join("\n");
}

function buildQuery(tableName: string, dateColumn: string, userColumn: string, amountColumn: string): string {
  return `
    SELECT
      CAST(${quoteIdentifier(dateColumn)} AS VARCHAR) AS __rfm_date,
      CAST(${quoteIdentifier(userColumn)} AS VARCHAR) AS __rfm_user_id,
      TRY_CAST(${quoteIdentifier(amountColumn)} AS DOUBLE) AS __rfm_amount
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(dateColumn)} IS NOT NULL
      AND ${quoteIdentifier(userColumn)} IS NOT NULL
      AND TRY_CAST(${quoteIdentifier(amountColumn)} AS DOUBLE) IS NOT NULL
    LIMIT ${MAX_SAMPLE_ROWS}
  `;
}

function quantileScore(sortedValues: number[], target: number, reverse: boolean): number {
  if (sortedValues.length === 0) {
    return 1;
  }

  let index = 0;
  for (let current = 0; current < sortedValues.length; current += 1) {
    if (sortedValues[current] <= target) {
      index = current;
    } else {
      break;
    }
  }

  const denominator = Math.max(sortedValues.length - 1, 1);
  const bucket = Math.min(4, Math.floor((index / denominator) * 5));
  return reverse ? 5 - bucket : 1 + bucket;
}

function resolveSegment(row: CustomerRfmRow): string {
  const total = row.recencyScore + row.frequencyScore + row.monetaryScore;

  if (row.recencyScore >= 4 && row.frequencyScore >= 4 && row.monetaryScore >= 4) {
    return "Champions";
  }
  if (row.frequencyScore >= 4 && row.monetaryScore >= 3) {
    return "Loyal";
  }
  if (row.monetaryScore >= 4) {
    return "Big Spenders";
  }
  if (row.recencyScore <= 2 && row.frequencyScore >= 3) {
    return "At Risk";
  }
  if (row.recencyScore <= 2 && row.frequencyScore <= 2) {
    return "Hibernating";
  }
  if (total >= 10) {
    return "Potential";
  }
  return "Emerging";
}

function buildRfmModel(rows: Record<string, unknown>[]): RfmResult {
  const grouped = new Map<string, { lastSeen: Date; frequency: number; monetary: number }>();
  let referenceDate: Date | null = null;

  for (const row of rows) {
    const userId = typeof row.__rfm_user_id === "string" ? row.__rfm_user_id.trim() : "";
    const parsedDate = toDate(row.__rfm_date);
    const amount = toNumber(row.__rfm_amount);

    if (!parsedDate || !userId || amount === null) {
      continue;
    }

    if (!referenceDate || parsedDate > referenceDate) {
      referenceDate = parsedDate;
    }

    const current = grouped.get(userId) ?? {
      lastSeen: parsedDate,
      frequency: 0,
      monetary: 0,
    };

    if (parsedDate > current.lastSeen) {
      current.lastSeen = parsedDate;
    }
    current.frequency += 1;
    current.monetary += amount;

    grouped.set(userId, current);
  }

  if (!referenceDate || grouped.size === 0) {
    throw new Error("No valid rows were available to compute RFM scores.");
  }

  const customers = [...grouped.entries()].map<CustomerRfmRow>(([userId, value]) => ({
    userId,
    recencyDays: Math.round((referenceDate.getTime() - value.lastSeen.getTime()) / (24 * 60 * 60 * 1000)),
    frequency: value.frequency,
    monetary: Number(value.monetary.toFixed(2)),
    recencyScore: 1,
    frequencyScore: 1,
    monetaryScore: 1,
    segment: "Emerging",
  }));

  const recencies = [...customers.map((row) => row.recencyDays)].sort((left, right) => left - right);
  const frequencies = [...customers.map((row) => row.frequency)].sort((left, right) => left - right);
  const monetaries = [...customers.map((row) => row.monetary)].sort((left, right) => left - right);

  const scoredCustomers = customers.map<CustomerRfmRow>((row) => {
    const recencyScore = quantileScore(recencies, row.recencyDays, true);
    const frequencyScore = quantileScore(frequencies, row.frequency, false);
    const monetaryScore = quantileScore(monetaries, row.monetary, false);
    const segment = resolveSegment({
      ...row,
      recencyScore,
      frequencyScore,
      monetaryScore,
      segment: row.segment,
    });

    return {
      ...row,
      recencyScore,
      frequencyScore,
      monetaryScore,
      segment,
    };
  });

  const segmentSummaries = [...scoredCustomers.reduce((map, row) => {
    const current = map.get(row.segment) ?? { segment: row.segment, customerCount: 0, avgMonetary: 0 };
    current.customerCount += 1;
    current.avgMonetary += row.monetary;
    map.set(row.segment, current);
    return map;
  }, new Map<string, SegmentSummary>()).values()]
    .map((summary) => ({
      ...summary,
      avgMonetary: summary.customerCount === 0 ? 0 : summary.avgMonetary / summary.customerCount,
    }))
    .sort((left, right) => right.customerCount - left.customerCount);

  const distribution = Array.from({ length: 5 }, (_, index) => index + 1).map((score) => ({
    score,
    recency: scoredCustomers.filter((row) => row.recencyScore === score).length,
    frequency: scoredCustomers.filter((row) => row.frequencyScore === score).length,
    monetary: scoredCustomers.filter((row) => row.monetaryScore === score).length,
  }));

  return {
    customers: scoredCustomers,
    segmentSummaries,
    scoreDistribution: distribution,
    topSegment: segmentSummaries[0]?.segment ?? null,
    avgRecency:
      scoredCustomers.reduce((sum, row) => sum + row.recencyDays, 0) / scoredCustomers.length,
    avgMonetary:
      scoredCustomers.reduce((sum, row) => sum + row.monetary, 0) / scoredCustomers.length,
  };
}

function buildScatterOption(result: RfmResult | null, dark: boolean): EChartsOption {
  const rows = result?.customers ?? [];
  const segments = [...new Set(rows.map((row) => row.segment))];
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";

  return {
    animationDuration: 420,
    legend: { bottom: 0, textStyle: { color: textColor } },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const point = params as {
          seriesName?: string;
          value?: [number, number, number];
          data?: { userId?: string };
        };
        return [
          point.data?.userId ?? point.seriesName ?? "Customer",
          `Recency: ${formatNumber(point.value?.[0] ?? 0)} days`,
          `Monetary: ${formatNumber(point.value?.[1] ?? 0)}`,
          `Frequency: ${formatNumber(point.value?.[2] ?? 0)}`,
        ].join("<br/>");
      },
    },
    grid: { left: 56, right: 24, top: 24, bottom: 56 },
    xAxis: {
      type: "value",
      name: "Recency (days)",
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    yAxis: {
      type: "value",
      name: "Monetary",
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: segments.map((segment, index) => ({
      name: segment,
      type: "scatter",
      symbolSize: (point: number[]) => Math.max(10, Math.min(24, (point[2] ?? 1) * 3)),
      itemStyle: {
        color: SEGMENT_PALETTE[index % SEGMENT_PALETTE.length],
        opacity: 0.8,
      },
      data: rows
        .filter((row) => row.segment === segment)
        .map((row) => ({
          value: [row.recencyDays, row.monetary, row.frequency],
          userId: row.userId,
        })),
    })),
  };
}

function buildDistributionOption(result: RfmResult | null, dark: boolean): EChartsOption {
  const rows = result?.scoreDistribution ?? [];
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";

  return {
    animationDuration: 420,
    legend: { bottom: 0, textStyle: { color: textColor } },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
    },
    grid: { left: 48, right: 24, top: 24, bottom: 56 },
    xAxis: {
      type: "category",
      data: rows.map((row) => `Score ${row.score}`),
      axisLabel: { color: textColor },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        name: "Recency",
        type: "bar",
        data: rows.map((row) => row.recency),
        itemStyle: { color: "#06b6d4" },
      },
      {
        name: "Frequency",
        type: "bar",
        data: rows.map((row) => row.frequency),
        itemStyle: { color: "#22c55e" },
      },
      {
        name: "Monetary",
        type: "bar",
        data: rows.map((row) => row.monetary),
        itemStyle: { color: "#f97316" },
      },
    ],
  };
}

export default function RfmAnalysis({ tableName, columns }: RfmAnalysisProps) {
  const dark = useDarkMode();
  const dateColumns = useMemo(
    () => columns.filter((column) => column.type === "date"),
    [columns],
  );
  const idColumns = useMemo(
    () => columns.filter((column) => column.type !== "date"),
    [columns],
  );
  const amountColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [dateColumn, setDateColumn] = useState(dateColumns[0]?.name ?? "");
  const [userColumn, setUserColumn] = useState(idColumns[0]?.name ?? "");
  const [amountColumn, setAmountColumn] = useState(amountColumns[0]?.name ?? "");
  const [result, setResult] = useState<RfmResult | null>(null);
  const [status, setStatus] = useState("Choose a date, user, and amount column to score customers.");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const scatterOption = useMemo(() => buildScatterOption(result, dark), [dark, result]);
  const distributionOption = useMemo(
    () => buildDistributionOption(result, dark),
    [dark, result],
  );

  async function handleRun() {
    if (!dateColumn || !userColumn || !amountColumn) {
      setError("Select a date column, user identifier, and monetary amount column.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(buildQuery(tableName, dateColumn, userColumn, amountColumn));
      const nextResult = buildRfmModel(rows);

      startTransition(() => {
        setResult(nextResult);
        setStatus(
          `Scored ${formatNumber(nextResult.customers.length)} customers into ${formatNumber(nextResult.segmentSummaries.length)} segments.`,
        );
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to build RFM analysis.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result || result.customers.length === 0) {
      return;
    }

    downloadFile(
      buildCsv(result.customers),
      `${tableName}-rfm-analysis.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-fuchsia-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-700 dark:text-fuchsia-300">
            <RefreshCcw className="h-3.5 w-3.5" />
            RFM analysis
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Recency, frequency, and monetary scoring
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Rank customers by freshness, purchase cadence, and spend to identify champions, at-risk
            customers, and high-value segments.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExport}
          disabled={!result || result.customers.length === 0}
          className={BUTTON_CLASS}
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-4">
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
            {idColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Amount column
          </span>
          <select
            aria-label="Amount column"
            value={amountColumn}
            onChange={(event) => setAmountColumn(event.target.value)}
            className={FIELD_CLASS}
          >
            {amountColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end">
          <button
            type="button"
            onClick={handleRun}
            disabled={loading}
            className={`${BUTTON_CLASS} w-full`}
          >
            <Gauge className="h-4 w-4" />
            {loading ? "Scoring customers..." : "Score customers"}
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
          icon={Users}
          label="Customers"
          value={result ? formatNumber(result.customers.length) : "0"}
        />
        <SummaryCard
          icon={Gauge}
          label="Top segment"
          value={result?.topSegment ?? "Not run"}
        />
        <SummaryCard
          icon={RefreshCcw}
          label="Avg recency"
          value={result ? `${formatNumber(result.avgRecency)} days` : "0 days"}
        />
        <SummaryCard
          icon={Coins}
          label="Avg monetary"
          value={result ? formatNumber(result.avgMonetary) : "0"}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
          className={`${GLASS_CARD_CLASS} p-4`}
        >
          {result ? (
            <ReactEChartsCore
              echarts={echarts}
              option={scatterOption}
              notMerge
              style={{ height: 360 }}
            />
          ) : (
            <div className="flex min-h-[18rem] items-center justify-center rounded-[1.5rem] border border-dashed border-white/20 text-center text-sm text-slate-500 dark:text-slate-400">
              Choose a date, user, and amount column to score customers.
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
          className={`${GLASS_CARD_CLASS} p-4`}
        >
          {result ? (
            <ReactEChartsCore
              echarts={echarts}
              option={distributionOption}
              notMerge
              style={{ height: 360 }}
            />
          ) : (
            <div className="flex min-h-[18rem] items-center justify-center rounded-[1.5rem] border border-dashed border-white/20 text-center text-sm text-slate-500 dark:text-slate-400">
              Score customers to compare recency, frequency, and monetary distributions.
            </div>
          )}
        </motion.div>
      </div>

      <div className={`${GLASS_CARD_CLASS} mt-6 overflow-hidden`}>
        <div className="border-b border-white/15 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">Segment summary</h3>
        </div>

        {result ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-white/60 dark:bg-slate-900/60">
                <tr>
                  <th className="px-5 py-3 font-semibold text-slate-700 dark:text-slate-200">Segment</th>
                  <th className="px-5 py-3 font-semibold text-slate-700 dark:text-slate-200">Customers</th>
                  <th className="px-5 py-3 font-semibold text-slate-700 dark:text-slate-200">Avg monetary</th>
                </tr>
              </thead>
              <tbody>
                {result.segmentSummaries.map((summary) => (
                  <tr key={summary.segment} className="border-t border-white/10">
                    <td className="px-5 py-3 text-slate-700 dark:text-slate-200">{summary.segment}</td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{summary.customerCount}</td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                      {formatNumber(summary.avgMonetary)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-sm text-slate-600 dark:text-slate-300">
            Run the model to see how customers split across RFM segments.
          </div>
        )}
      </div>
    </section>
  );
}
