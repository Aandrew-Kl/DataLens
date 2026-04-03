"use client";

import { startTransition, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  BarChart3,
  LineChart as LineChartIcon,
  Loader2,
  PieChart as PieChartIcon,
  ScatterChart as ScatterChartIcon,
  Sparkles,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
} from "@/lib/utils/advanced-analytics";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface AIChartRecommenderProps {
  tableName: string;
  columns: ColumnProfile[];
}

type RecommendationType = "bar" | "line" | "pie" | "scatter";

interface Recommendation {
  id: string;
  type: RecommendationType;
  title: string;
  reason: string;
  sql: string;
}

interface RecommendationCardProps {
  recommendation: Recommendation;
  active: boolean;
  loading: boolean;
  onPreview: () => void;
}

const PALETTE = ["#0ea5e9", "#14b8a6", "#22c55e", "#f59e0b", "#f97316"] as const;

function RecommendationCard({
  recommendation,
  active,
  loading,
  onPreview,
}: RecommendationCardProps) {
  const icon =
    recommendation.type === "line"
      ? LineChartIcon
      : recommendation.type === "pie"
        ? PieChartIcon
        : recommendation.type === "scatter"
          ? ScatterChartIcon
          : BarChart3;

  const Icon = icon;

  return (
    <button
      type="button"
      onClick={onPreview}
      className={`${GLASS_CARD_CLASS} block w-full p-4 text-left transition ${
        active ? "ring-2 ring-cyan-400/50" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-50">
          <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
          {recommendation.title}
        </div>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-500" /> : null}
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
        {recommendation.reason}
      </p>
      <p className="mt-3 font-mono text-xs text-slate-500 dark:text-slate-400">{recommendation.sql}</p>
    </button>
  );
}

function buildRecommendations(tableName: string, columns: ColumnProfile[]) {
  const numeric = columns.filter((column) => column.type === "number");
  const dates = columns.filter((column) => column.type === "date");
  const categorical = columns.filter(
    (column) => column.type === "string" || column.type === "boolean",
  );
  const table = quoteIdentifier(tableName);

  const nextRecommendations: Recommendation[] = [];

  if (dates[0] && numeric[0]) {
    nextRecommendations.push({
      id: "line",
      type: "line",
      title: `${numeric[0].name} over ${dates[0].name}`,
      reason: `A line chart fits because ${dates[0].name} is temporal and ${numeric[0].name} is the clearest numeric measure for trend analysis.`,
      sql: `SELECT ${quoteIdentifier(dates[0].name)} AS label, AVG(${quoteIdentifier(numeric[0].name)}) AS value FROM ${table} WHERE ${quoteIdentifier(dates[0].name)} IS NOT NULL AND ${quoteIdentifier(numeric[0].name)} IS NOT NULL GROUP BY 1 ORDER BY 1 ASC LIMIT 120`,
    });
  }

  if (categorical[0] && numeric[0]) {
    nextRecommendations.push({
      id: "bar",
      type: "bar",
      title: `${numeric[0].name} by ${categorical[0].name}`,
      reason: `A bar chart compares grouped values well because ${categorical[0].name} is categorical while ${numeric[0].name} can be aggregated.`,
      sql: `SELECT ${quoteIdentifier(categorical[0].name)} AS label, AVG(${quoteIdentifier(numeric[0].name)}) AS value FROM ${table} WHERE ${quoteIdentifier(categorical[0].name)} IS NOT NULL AND ${quoteIdentifier(numeric[0].name)} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
    });
  }

  if (categorical[0] && categorical[0].uniqueCount <= 8) {
    nextRecommendations.push({
      id: "pie",
      type: "pie",
      title: `${categorical[0].name} composition`,
      reason: `${categorical[0].name} has low cardinality, so a pie chart can communicate part-to-whole share without overcrowding the view.`,
      sql: `SELECT ${quoteIdentifier(categorical[0].name)} AS label, COUNT(*) AS value FROM ${table} WHERE ${quoteIdentifier(categorical[0].name)} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
    });
  }

  if (numeric.length >= 2) {
    nextRecommendations.push({
      id: "scatter",
      type: "scatter",
      title: `${numeric[0].name} vs ${numeric[1].name}`,
      reason: `A scatter plot is the best diagnostic when you have two numeric columns and want to inspect correlation, clusters, or outliers.`,
      sql: `SELECT ${quoteIdentifier(numeric[0].name)} AS x, ${quoteIdentifier(numeric[1].name)} AS y FROM ${table} WHERE ${quoteIdentifier(numeric[0].name)} IS NOT NULL AND ${quoteIdentifier(numeric[1].name)} IS NOT NULL LIMIT 240`,
    });
  }

  return nextRecommendations;
}

function buildPreviewOption(
  recommendation: Recommendation,
  rows: Record<string, unknown>[],
  dark: boolean,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#334155";
  const borderColor = dark ? "#1e293b" : "#e2e8f0";

  if (recommendation.type === "pie") {
    return {
      tooltip: {
        trigger: "item",
        backgroundColor: dark ? "#020617ee" : "#ffffffee",
        textStyle: { color: textColor },
      },
      legend: { bottom: 0, textStyle: { color: textColor } },
      series: [
        {
          type: "pie",
          radius: ["38%", "72%"],
          data: rows.map((row) => ({
            name: String(row.label ?? ""),
            value: Number(row.value ?? 0),
          })),
          itemStyle: {
            borderColor: dark ? "#020617" : "#ffffff",
            borderWidth: 2,
          },
        },
      ],
    };
  }

  if (recommendation.type === "scatter") {
    return {
      tooltip: {
        trigger: "item",
        backgroundColor: dark ? "#020617ee" : "#ffffffee",
        textStyle: { color: textColor },
      },
      grid: { top: 24, right: 20, bottom: 40, left: 48 },
      xAxis: {
        type: "value",
        axisLabel: { color: textColor },
        splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: textColor },
        splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
      },
      series: [
        {
          type: "scatter",
          data: rows.map((row) => [Number(row.x ?? 0), Number(row.y ?? 0)]),
          itemStyle: {
            color: PALETTE[3],
            opacity: 0.8,
          },
          symbolSize: 10,
        },
      ],
    };
  }

  const labels = rows.map((row) => String(row.label ?? ""));
  const values = rows.map((row) => Number(row.value ?? 0));

  return {
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      textStyle: { color: textColor },
    },
    grid: { top: 24, right: 20, bottom: 48, left: 48 },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { color: textColor, rotate: labels.length > 8 ? 24 : 0 },
      axisLine: { lineStyle: { color: borderColor } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        type: recommendation.type === "line" ? "line" : "bar",
        data: values,
        smooth: recommendation.type === "line",
        color: recommendation.type === "line" ? PALETTE[1] : PALETTE[0],
        areaStyle: recommendation.type === "line" ? { opacity: 0.08 } : undefined,
        itemStyle: recommendation.type === "bar" ? { borderRadius: [8, 8, 0, 0] } : undefined,
      },
    ],
  };
}

export default function AIChartRecommender({
  tableName,
  columns,
}: AIChartRecommenderProps) {
  const dark = useDarkMode();
  const generatedRecommendations = useMemo(
    () => buildRecommendations(tableName, columns),
    [columns, tableName],
  );

  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [activeRecommendation, setActiveRecommendation] = useState<Recommendation | null>(null);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleGenerate() {
    startTransition(() => {
      setRecommendations(generatedRecommendations);
      setActiveRecommendation(null);
      setPreviewRows([]);
      setError(
        generatedRecommendations.length > 0
          ? null
          : "No compatible chart recommendations were found for the current schema.",
      );
    });
  }

  async function handlePreview(recommendation: Recommendation) {
    setLoadingId(recommendation.id);
    setError(null);

    try {
      const rows = await runQuery(recommendation.sql);
      setActiveRecommendation(recommendation);
      setPreviewRows(rows);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Preview query failed.");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Sparkles className="h-6 w-6 text-cyan-600 dark:text-cyan-300" />
            <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-50">
              Recommend the best chart based on schema signals
            </h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Analyze available column types and cardinality, then preview chart recommendations with
            reasoning and sample query output.
          </p>
        </div>

        <button type="button" onClick={handleGenerate} className={BUTTON_CLASS}>
          <Sparkles className="h-4 w-4" />
          Generate recommendations
        </button>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          {recommendations.length > 0 ? (
            recommendations.map((recommendation) => (
              <RecommendationCard
                key={recommendation.id}
                recommendation={recommendation}
                active={activeRecommendation?.id === recommendation.id}
                loading={loadingId === recommendation.id}
                onPreview={() => void handlePreview(recommendation)}
              />
            ))
          ) : (
            <div className={`${GLASS_CARD_CLASS} p-4 text-sm text-slate-600 dark:text-slate-300`}>
              Click “Generate recommendations” to inspect candidate chart types.
            </div>
          )}

          {error ? (
            <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          ) : null}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
          className={`${GLASS_CARD_CLASS} p-4`}
        >
          <h3 className="text-base font-semibold text-slate-950 dark:text-slate-50">
            Recommendation preview
          </h3>
          {activeRecommendation ? (
            <>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Previewing {activeRecommendation.type} chart using {formatNumber(previewRows.length)} sampled rows.
              </p>
              <div className="mt-4">
                <ReactEChartsCore
                  echarts={echarts}
                  option={buildPreviewOption(activeRecommendation, previewRows, dark)}
                  style={{ height: 320 }}
                />
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Choose a recommendation card to load a preview query and render the suggested chart.
            </p>
          )}
        </motion.div>
      </div>
    </section>
  );
}
