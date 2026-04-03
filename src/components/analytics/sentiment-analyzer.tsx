"use client";

import { useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { PieChart } from "echarts/charts";
import { LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Download, MessageSquareHeart, SmilePlus, Tags } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { sentiment } from "@/lib/api/ai";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([PieChart, LegendComponent, TooltipComponent, CanvasRenderer]);

interface SentimentAnalyzerProps {
  tableName: string;
  columns: ColumnProfile[];
}

type SentimentLabel = "Positive" | "Negative" | "Neutral";

interface SentimentRow {
  text: string;
  score: number;
  label: SentimentLabel;
}

interface SentimentWord {
  word: string;
  count: number;
  tone: "positive" | "negative";
}

interface LocalSentimentResult {
  rows: SentimentRow[];
  counts: {
    positive: number;
    negative: number;
    neutral: number;
  };
  topWords: SentimentWord[];
}

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv(rows: SentimentRow[]): string {
  const header = "text,score,label";
  const body = rows.map((row) => [row.text, row.score, row.label].map(escapeCsv).join(","));
  return [header, ...body].join("\n");
}

function buildChartOption(result: LocalSentimentResult | null, dark: boolean): EChartsOption {
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";

  return {
    animationDuration: 420,
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const point = params as { name?: string; value?: number };
        return `${point.name ?? "Tone"}: ${formatNumber(point.value ?? 0)}`;
      },
    },
    legend: {
      bottom: 0,
      textStyle: { color: textColor },
    },
    series: [
      {
        type: "pie",
        radius: ["48%", "72%"],
        label: { color: dark ? "#f8fafc" : "#0f172a" },
        data: result
          ? [
              { name: "Positive", value: result.counts.positive, itemStyle: { color: "#22c55e" } },
              { name: "Neutral", value: result.counts.neutral, itemStyle: { color: "#94a3b8" } },
              { name: "Negative", value: result.counts.negative, itemStyle: { color: "#ef4444" } },
            ]
          : [],
      },
    ],
  };
}

export default function SentimentAnalyzer({ tableName, columns }: SentimentAnalyzerProps) {
  const dark = useDarkMode();
  const textColumns = useMemo(
    () => columns.filter((column) => column.type === "string"),
    [columns],
  );
  const [selectedColumn, setSelectedColumn] = useState(textColumns[0]?.name ?? "");
  const [result, setResult] = useState<LocalSentimentResult | null>(null);
  const [status, setStatus] = useState("Pick a text column to score sentiment via the AI backend.");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (textColumns.length === 0) {
    return (
      <section className={`${GLASS_PANEL_CLASS} p-6`}>
        <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Sentiment analyzer</h2>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          Sentiment analysis requires at least one profiled string column.
        </p>
      </section>
    );
  }

  async function handleAnalyze(): Promise<void> {
    if (!selectedColumn) {
      setError("Choose a text column before analyzing sentiment.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(`
        SELECT CAST(${quoteIdentifier(selectedColumn)} AS VARCHAR) AS text_value
        FROM ${quoteIdentifier(tableName)}
        WHERE ${quoteIdentifier(selectedColumn)} IS NOT NULL
      `);

      const values = rows
        .map((row) => String(row.text_value ?? "").trim())
        .filter((value) => value.length > 0);

      if (values.length === 0) {
        throw new Error("The selected text column does not contain usable values.");
      }

      const apiResult = await sentiment(values);

      const sentimentRows: SentimentRow[] = apiResult.results.map((item) => ({
        text: item.text,
        score: item.polarity,
        label:
          item.label === "positive"
            ? "Positive"
            : item.label === "negative"
              ? "Negative"
              : "Neutral",
      }));

      const counts = {
        positive: sentimentRows.filter((row) => row.label === "Positive").length,
        negative: sentimentRows.filter((row) => row.label === "Negative").length,
        neutral: sentimentRows.filter((row) => row.label === "Neutral").length,
      };

      // Extract top sentiment words from the analyzed texts by frequency
      const wordCounts = new Map<string, SentimentWord>();
      for (const item of apiResult.results) {
        if (item.label === "positive" || item.label === "negative") {
          const tone = item.label as "positive" | "negative";
          const tokens = item.text
            .toLowerCase()
            .replace(/[^a-z0-9\s]+/g, " ")
            .split(/\s+/)
            .filter((token) => token.length > 2);
          for (const token of tokens) {
            const existing = wordCounts.get(token);
            if (!existing) {
              wordCounts.set(token, { word: token, count: 1, tone });
            } else {
              existing.count += 1;
            }
          }
        }
      }

      const topWords = [...wordCounts.values()]
        .sort((left, right) => right.count - left.count || left.word.localeCompare(right.word))
        .slice(0, 8);

      const nextResult: LocalSentimentResult = { rows: sentimentRows, counts, topWords };
      setResult(nextResult);
      setStatus(
        `Scored ${formatNumber(nextResult.rows.length)} text rows across positive, neutral, and negative tones (avg polarity: ${apiResult.avg_polarity.toFixed(2)}).`,
      );
    } catch (analysisError) {
      if (
        analysisError instanceof Error &&
        (analysisError.message.includes("fetch") ||
          analysisError.message.includes("Failed") ||
          analysisError.message.includes("ECONNREFUSED") ||
          analysisError.message.includes("NetworkError"))
      ) {
        setError(
          "Could not reach the AI backend. Make sure the Python API server is running.",
        );
      } else {
        setError(
          analysisError instanceof Error
            ? analysisError.message
            : "Unable to analyze sentiment.",
        );
      }
    } finally {
      setLoading(false);
    }
  }

  function handleExport(): void {
    if (!result) {
      setError("Analyze sentiment before exporting.");
      return;
    }

    downloadFile(
      buildCsv(result.rows),
      `${tableName}-${selectedColumn}-sentiment.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <motion.section
      className={`${GLASS_PANEL_CLASS} space-y-6 p-6`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: ANALYTICS_EASE }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
            <MessageSquareHeart className="h-3.5 w-3.5" />
            Text analytics
          </div>
          <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
            Score sentiment and surface the strongest signal words
          </h2>
          <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">{status}</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button className={BUTTON_CLASS} disabled={loading} onClick={() => void handleAnalyze()} type="button">
            <SmilePlus className="h-4 w-4" />
            {loading ? "Analyzing…" : "Analyze text"}
          </button>
          <button className={BUTTON_CLASS} disabled={!result} onClick={handleExport} type="button">
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} space-y-4 p-4`}>
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Text column</p>
              <div className="mt-3 space-y-2">
                {textColumns.map((column) => (
                  <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200" key={column.name}>
                    <input checked={selectedColumn === column.name} name="sentiment-column" onChange={() => setSelectedColumn(column.name)} type="radio" />
                    <span>{column.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {result ? (
            <div className={`${GLASS_CARD_CLASS} grid gap-3 p-4`}>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Positive</p>
                <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{formatNumber(result.counts.positive)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Neutral</p>
                <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{formatNumber(result.counts.neutral)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Negative</p>
                <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{formatNumber(result.counts.negative)}</p>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          ) : null}
        </aside>

        <div className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <ReactEChartsCore option={buildChartOption(result, dark)} style={{ height: 320 }} />
          </div>

          {result ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
                <div className="border-b border-white/10 px-4 py-3">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Top sentiment words
                  </h3>
                </div>

                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-950/[0.03] dark:bg-white/[0.03]">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Word</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Tone</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.topWords.map((word) => (
                      <tr className="border-t border-white/10" key={word.word}>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{word.word}</td>
                        <td className="px-4 py-3 text-slate-600 capitalize dark:text-slate-300">{word.tone}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{word.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
                <div className="border-b border-white/10 px-4 py-3">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Sample scores
                  </h3>
                </div>

                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-950/[0.03] dark:bg-white/[0.03]">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Label</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, 8).map((row, index) => (
                      <tr className="border-t border-white/10" key={`${row.label}-${index}`}>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.label}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </motion.section>
  );
}
