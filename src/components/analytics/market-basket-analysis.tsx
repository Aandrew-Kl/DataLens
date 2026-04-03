"use client";

import { startTransition, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { GraphChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  Download,
  Loader2,
  Network,
  ShoppingBasket,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
} from "@/lib/utils/advanced-analytics";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([GraphChart, TooltipComponent, CanvasRenderer]);

interface MarketBasketAnalysisProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface PairMetric {
  left: string;
  right: string;
  pairCount: number;
  support: number;
  confidence: number;
}

interface BasketResult {
  transactionCount: number;
  pairMetrics: PairMetric[];
}

interface SummaryCardProps {
  label: string;
  value: string;
}

function SummaryCard({ label, value }: SummaryCardProps) {
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

function csvEscape(value: string | number) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function pairsToCsv(pairs: PairMetric[]) {
  return [
    "left_item,right_item,pair_count,support,confidence",
    ...pairs.map((pair) =>
      [
        csvEscape(pair.left),
        csvEscape(pair.right),
        pair.pairCount,
        pair.support.toFixed(6),
        pair.confidence.toFixed(6),
      ].join(","),
    ),
  ].join("\n");
}

function buildGraphOption(result: BasketResult | null, dark: boolean): EChartsOption {
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";
  const nodeWeights = new Map<string, number>();

  for (const pair of result?.pairMetrics ?? []) {
    nodeWeights.set(pair.left, (nodeWeights.get(pair.left) ?? 0) + pair.pairCount);
    nodeWeights.set(pair.right, (nodeWeights.get(pair.right) ?? 0) + pair.pairCount);
  }

  return {
    animationDuration: 420,
    tooltip: {
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const point = params as {
          dataType?: string;
          data?: { source?: string; target?: string; value?: number; confidence?: number };
          name?: string;
        };
        if (point.dataType === "edge") {
          return [
            `<strong>${point.data?.source ?? ""} → ${point.data?.target ?? ""}</strong>`,
            `Pair count: ${formatNumber(Number(point.data?.value ?? 0))}`,
            `Confidence: ${formatPercent(Number(point.data?.confidence ?? 0) * 100)}`,
          ].join("<br/>");
        }
        return `${point.name ?? "Item"}`;
      },
    },
    series: [
      {
        type: "graph",
        layout: "force",
        roam: true,
        label: { show: true, color: textColor },
        force: { repulsion: 220, edgeLength: [80, 160] },
        data: [...nodeWeights.entries()].map(([name, weight]) => ({
          name,
          value: weight,
          symbolSize: 16 + weight * 4,
          itemStyle: { color: "#06b6d4" },
        })),
        links: (result?.pairMetrics ?? []).map((pair) => ({
          source: pair.left,
          target: pair.right,
          value: pair.pairCount,
          confidence: pair.confidence,
          lineStyle: {
            width: Math.max(1, pair.support * 24),
            color: "#8b5cf6",
            opacity: 0.7,
          },
        })),
      },
    ],
  };
}

async function runBasketAnalysis(
  tableName: string,
  transactionColumn: string,
  itemColumn: string,
): Promise<BasketResult> {
  const rows = await runQuery(`
    SELECT
      CAST(${quoteIdentifier(transactionColumn)} AS VARCHAR) AS transaction_id,
      CAST(${quoteIdentifier(itemColumn)} AS VARCHAR) AS item_name
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(transactionColumn)} IS NOT NULL
      AND ${quoteIdentifier(itemColumn)} IS NOT NULL
    LIMIT 1000
  `);

  const baskets = new Map<string, Set<string>>();
  for (const row of rows) {
    const transactionId =
      typeof row.transaction_id === "string" ? row.transaction_id : String(row.transaction_id ?? "");
    const itemName = typeof row.item_name === "string" ? row.item_name : String(row.item_name ?? "");
    if (!transactionId || !itemName) continue;
    const bucket = baskets.get(transactionId) ?? new Set<string>();
    bucket.add(itemName);
    baskets.set(transactionId, bucket);
  }

  const itemCounts = new Map<string, number>();
  const pairCounts = new Map<string, number>();
  for (const basket of baskets.values()) {
    const items = [...basket].sort();
    for (const item of items) {
      itemCounts.set(item, (itemCounts.get(item) ?? 0) + 1);
    }
    for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
        const pairKey = `${items[leftIndex]}||${items[rightIndex]}`;
        pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1);
      }
    }
  }

  const transactionCount = baskets.size;
  const pairMetrics = [...pairCounts.entries()]
    .map<PairMetric>(([pairKey, pairCount]) => {
      const [left, right] = pairKey.split("||");
      const leftCount = itemCounts.get(left) ?? 1;
      const rightCount = itemCounts.get(right) ?? 1;
      return {
        left,
        right,
        pairCount,
        support: transactionCount === 0 ? 0 : pairCount / transactionCount,
        confidence: Math.max(pairCount / leftCount, pairCount / rightCount),
      };
    })
    .sort(
      (left, right) =>
        right.support - left.support ||
        right.confidence - left.confidence ||
        left.left.localeCompare(right.left) ||
        left.right.localeCompare(right.right),
    )
    .slice(0, 12);

  return { transactionCount, pairMetrics };
}

export default function MarketBasketAnalysis({
  tableName,
  columns,
}: MarketBasketAnalysisProps) {
  const dark = useDarkMode();
  const [transactionColumn, setTransactionColumn] = useState(columns[0]?.name ?? "");
  const [itemColumn, setItemColumn] = useState(columns[1]?.name ?? columns[0]?.name ?? "");
  const [result, setResult] = useState<BasketResult | null>(null);
  const [status, setStatus] = useState(
    "Pick a transaction identifier and item column to compute item-pair co-occurrence.",
  );
  const [loading, setLoading] = useState(false);

  const option = useMemo(
    () => buildGraphOption(result, dark),
    [dark, result],
  );

  async function handleAnalyze() {
    if (!transactionColumn || !itemColumn) {
      setStatus("Choose both a transaction column and an item column.");
      return;
    }

    setLoading(true);
    setStatus("Computing item co-occurrence...");

    try {
      const nextResult = await runBasketAnalysis(tableName, transactionColumn, itemColumn);
      startTransition(() => {
        setResult(nextResult);
        setStatus(
          `Analyzed ${formatNumber(nextResult.transactionCount)} transactions and ranked ${formatNumber(nextResult.pairMetrics.length)} item pairs.`,
        );
      });
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to compute market basket metrics.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;
    downloadFile(
      pairsToCsv(result.pairMetrics),
      `${tableName}-market-basket.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-4 border-b border-white/20 pb-5 dark:border-white/10 xl:flex-row xl:items-center xl:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">
            <ShoppingBasket className="h-3.5 w-3.5" />
            Market Basket
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
              Surface frequent item pairs and their association strength
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Measure support and confidence for the most common co-occurring
              items, then explore the association network.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <select
            aria-label="Transaction column"
            value={transactionColumn}
            onChange={(event) => setTransactionColumn(event.currentTarget.value)}
            className={FIELD_CLASS}
          >
            {columns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Item column"
            value={itemColumn}
            onChange={(event) => setItemColumn(event.currentTarget.value)}
            className={FIELD_CLASS}
          >
            {columns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              void handleAnalyze();
            }}
            disabled={loading}
            className={`${BUTTON_CLASS} bg-emerald-600 text-white hover:bg-emerald-500 dark:bg-emerald-600 dark:text-white`}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Network className="h-4 w-4" />
            )}
            Analyze baskets
          </button>
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
      </div>

      <div className="mt-4 rounded-2xl bg-white/60 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
        {status}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <SummaryCard
              label="Transactions"
              value={result ? formatNumber(result.transactionCount) : "0"}
            />
            <SummaryCard
              label="Top Pairs"
              value={result ? formatNumber(result.pairMetrics.length) : "0"}
            />
          </div>

          <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
            <div className="border-b border-white/15 px-5 py-4 font-semibold text-slate-950 dark:text-white">
              Top item pairs
            </div>
            {result ? (
              <table className="min-w-full text-left text-sm">
                <thead className="bg-white/50 dark:bg-slate-950/20">
                  <tr className="text-slate-500 dark:text-slate-400">
                    <th className="px-5 py-3 font-medium">Pair</th>
                    <th className="px-5 py-3 font-medium">Support</th>
                    <th className="px-5 py-3 font-medium">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {result.pairMetrics.map((pair) => (
                    <tr key={`${pair.left}-${pair.right}`} className="border-t border-white/10 text-slate-700 dark:text-slate-200">
                      <td className="px-5 py-3">{pair.left} + {pair.right}</td>
                      <td className="px-5 py-3">{formatPercent(pair.support * 100)}</td>
                      <td className="px-5 py-3">{formatPercent(pair.confidence * 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-5 py-10 text-sm text-slate-500 dark:text-slate-400">
                Run the analysis to see the strongest item-pair candidates.
              </div>
            )}
          </div>
        </div>

        <div className={`${GLASS_CARD_CLASS} overflow-hidden p-4`}>
          <ReactEChartsCore
            echarts={echarts}
            option={option}
            notMerge
            lazyUpdate
            style={{ height: 420 }}
          />
        </div>
      </div>
    </motion.section>
  );
}
