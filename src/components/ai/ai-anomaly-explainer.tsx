"use client";

import { Suspense, startTransition, use, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Bot,
  Copy,
  RefreshCw,
  Sparkles,
  Target,
} from "lucide-react";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import {
  generateOllamaText,
  loadOllamaSettings,
} from "@/lib/ai/ollama-settings";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface AIAnomalyExplainerProps {
  tableName: string;
  columns: ColumnProfile[];
}

type ConfidenceLevel = "high" | "medium" | "low";

interface OutlierBounds {
  q1: number;
  q3: number;
  iqr: number;
  lowerBound: number;
  upperBound: number;
  median: number;
}

interface AnomalyCardData {
  id: string;
  columnName: string;
  metricValue: number;
  confidence: ConfidenceLevel;
  distanceFromFence: number;
  rowPreview: Record<string, unknown>;
  explanation: string;
  source: "ollama" | "fallback";
}

interface AnomalyReadyState {
  status: "ready";
  cards: AnomalyCardData[];
  warning: string | null;
}

interface AnomalyEmptyState {
  status: "empty";
  message: string;
}

interface AnomalyErrorState {
  status: "error";
  message: string;
}

type AnomalyResult = AnomalyReadyState | AnomalyEmptyState | AnomalyErrorState;

function formatUnknownValue(value: unknown) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function confidenceMeta(level: ConfidenceLevel) {
  if (level === "high") {
    return {
      label: "High confidence",
      className:
        "border-rose-400/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    };
  }

  if (level === "medium") {
    return {
      label: "Medium confidence",
      className:
        "border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }

  return {
    label: "Low confidence",
    className:
      "border-sky-400/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  };
}

function inferConfidence(metricValue: number, bounds: OutlierBounds) {
  const overLower = bounds.lowerBound - metricValue;
  const overUpper = metricValue - bounds.upperBound;
  const distanceFromFence = Math.max(overLower, overUpper, 0);
  const iqr = Math.max(bounds.iqr, 0.001);
  const ratio = distanceFromFence / iqr;

  if (ratio >= 1.25) {
    return { confidence: "high" as const, distanceFromFence };
  }

  if (ratio >= 0.5) {
    return { confidence: "medium" as const, distanceFromFence };
  }

  return { confidence: "low" as const, distanceFromFence };
}

function buildFallbackExplanation(
  tableName: string,
  columnName: string,
  metricValue: number,
  bounds: OutlierBounds,
) {
  return `Fallback explanation: ${columnName} in ${tableName} sits outside the IQR fence. The observed value ${metricValue.toFixed(2)} is beyond the expected range of ${bounds.lowerBound.toFixed(2)} to ${bounds.upperBound.toFixed(2)}. Check whether this row reflects a genuine rare event, a unit mismatch, or an upstream data-entry spike.`;
}

async function fetchBounds(
  tableName: string,
  columnName: string,
): Promise<OutlierBounds | null> {
  const sql = `
    WITH clean AS (
      SELECT CAST(${quoteIdentifier(columnName)} AS DOUBLE) AS metric
      FROM ${quoteIdentifier(tableName)}
      WHERE ${quoteIdentifier(columnName)} IS NOT NULL
    ),
    bounds AS (
      SELECT
        QUANTILE_CONT(metric, 0.25) AS q1,
        MEDIAN(metric) AS median_value,
        QUANTILE_CONT(metric, 0.75) AS q3
      FROM clean
    )
    SELECT
      q1,
      median_value,
      q3,
      q3 - q1 AS iqr,
      q1 - 1.5 * (q3 - q1) AS lower_bound,
      q3 + 1.5 * (q3 - q1) AS upper_bound
    FROM bounds
  `;

  const row = (await runQuery(sql))[0] ?? {};
  const q1 = toNumber(row.q1);
  const q3 = toNumber(row.q3);
  const iqr = toNumber(row.iqr);
  const lowerBound = toNumber(row.lower_bound);
  const upperBound = toNumber(row.upper_bound);
  const median = toNumber(row.median_value);

  if (
    q1 === null ||
    q3 === null ||
    iqr === null ||
    lowerBound === null ||
    upperBound === null ||
    median === null ||
    iqr <= 0
  ) {
    return null;
  }

  return {
    q1,
    q3,
    iqr,
    lowerBound,
    upperBound,
    median,
  };
}

async function fetchOutlierRows(
  tableName: string,
  columnName: string,
  bounds: OutlierBounds,
) {
  const sql = `
    SELECT
      *,
      CAST(${quoteIdentifier(columnName)} AS DOUBLE) AS __metric
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(columnName)} IS NOT NULL
      AND (
        CAST(${quoteIdentifier(columnName)} AS DOUBLE) < ${bounds.lowerBound}
        OR CAST(${quoteIdentifier(columnName)} AS DOUBLE) > ${bounds.upperBound}
      )
    ORDER BY ABS(CAST(${quoteIdentifier(columnName)} AS DOUBLE) - ${bounds.median}) DESC
    LIMIT 2
  `;

  return runQuery(sql);
}

function previewRow(row: Record<string, unknown>, columnName: string) {
  const entries = Object.entries(row)
    .filter(([key]) => key !== "__metric")
    .slice(0, 5);

  const preview: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    preview[key] = value;
  }

  if (!(columnName in preview) && columnName in row) {
    preview[columnName] = row[columnName];
  }

  return preview;
}

function buildPrompt(
  tableName: string,
  columnName: string,
  metricValue: number,
  bounds: OutlierBounds,
  rowPreview: Record<string, unknown>,
) {
  const rowLines = Object.entries(rowPreview)
    .map(([key, value]) => `- ${key}: ${formatUnknownValue(value)}`)
    .join("\n");

  return [
    `Explain an anomaly found in DataLens table "${tableName}".`,
    "Respond in 3 concise bullet points. Mention likely causes and one validation step.",
    `Column: ${columnName}`,
    `Observed value: ${metricValue}`,
    `Expected fence: ${bounds.lowerBound.toFixed(2)} to ${bounds.upperBound.toFixed(2)}`,
    `Quartiles: q1=${bounds.q1.toFixed(2)}, median=${bounds.median.toFixed(2)}, q3=${bounds.q3.toFixed(2)}`,
    "Row preview:",
    rowLines,
  ].join("\n");
}

async function loadAnomalies(
  tableName: string,
  columns: ColumnProfile[],
): Promise<AnomalyResult> {
  const numericColumns = columns.filter((column) => column.type === "number");
  if (numericColumns.length === 0) {
    return {
      status: "empty",
      message: "Add at least one numeric column to explain anomalies.",
    };
  }

  try {
    const settings = loadOllamaSettings();
    const cards: AnomalyCardData[] = [];
    let warning: string | null = null;

    for (const column of numericColumns.slice(0, 3)) {
      const bounds = await fetchBounds(tableName, column.name);
      if (!bounds) continue;

      const rows = await fetchOutlierRows(tableName, column.name, bounds);
      for (const row of rows) {
        const metricValue = toNumber(row.__metric);
        if (metricValue === null) continue;

        const rowPreview = previewRow(row, column.name);
        const confidenceInfo = inferConfidence(metricValue, bounds);

        try {
          const explanation = await generateOllamaText({
            baseUrl: settings.url,
            model: settings.model,
            prompt: buildPrompt(
              tableName,
              column.name,
              metricValue,
              bounds,
              rowPreview,
            ),
            systemPrompt:
              "You are DataLens AI. Explain anomalous rows without overstating certainty.",
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
          });

          cards.push({
            id: `${column.name}:${metricValue}:${cards.length}`,
            columnName: column.name,
            metricValue,
            confidence: confidenceInfo.confidence,
            distanceFromFence: confidenceInfo.distanceFromFence,
            rowPreview,
            explanation,
            source: "ollama",
          });
        } catch (error) {
          warning =
            error instanceof Error
              ? error.message
              : "At least one AI explanation failed.";

          cards.push({
            id: `${column.name}:${metricValue}:${cards.length}`,
            columnName: column.name,
            metricValue,
            confidence: confidenceInfo.confidence,
            distanceFromFence: confidenceInfo.distanceFromFence,
            rowPreview,
            explanation: buildFallbackExplanation(
              tableName,
              column.name,
              metricValue,
              bounds,
            ),
            source: "fallback",
          });
        }
      }
    }

    if (cards.length === 0) {
      return {
        status: "empty",
        message:
          "No IQR-based outliers were found in the scanned numeric columns.",
      };
    }

    return {
      status: "ready",
      cards: cards.sort(
        (left, right) =>
          right.distanceFromFence - left.distanceFromFence ||
          left.columnName.localeCompare(right.columnName),
      ),
      warning,
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Unable to build anomaly explanations.",
    };
  }
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-5`}>
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        Anomaly explainer
      </p>
      <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
        {message}
      </p>
    </div>
  );
}

function AnomalyFallback() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className={`${GLASS_CARD_CLASS} animate-pulse p-5`}>
        <div className="h-5 w-36 rounded-full bg-slate-200/80 dark:bg-slate-800/80" />
        <div className="mt-4 h-28 rounded-3xl bg-slate-200/70 dark:bg-slate-800/70" />
      </div>
      <div className={`${GLASS_CARD_CLASS} animate-pulse p-5`}>
        <div className="h-5 w-36 rounded-full bg-slate-200/80 dark:bg-slate-800/80" />
        <div className="mt-4 h-28 rounded-3xl bg-slate-200/70 dark:bg-slate-800/70" />
      </div>
    </div>
  );
}

function AnomalyBody({
  resource,
  copiedId,
  onCopy,
}: {
  resource: Promise<AnomalyResult>;
  copiedId: string | null;
  onCopy: (id: string, explanation: string) => Promise<void>;
}) {
  const report = use(resource);

  if (report.status === "empty") {
    return <EmptyState message={report.message} />;
  }

  if (report.status === "error") {
    return <EmptyState message={report.message} />;
  }

  return (
    <div className="space-y-4">
      {report.warning ? (
        <div className={`${GLASS_CARD_CLASS} p-4 text-sm text-amber-600 dark:text-amber-300`}>
          {report.warning}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {report.cards.map((card, index) => {
          const confidence = confidenceMeta(card.confidence);

          return (
            <motion.article
              key={card.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.28,
                ease: ANALYTICS_EASE,
                delay: index * 0.04,
              }}
              className={`${GLASS_CARD_CLASS} p-5`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-500">
                    {card.columnName}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                    Value {card.metricValue.toFixed(2)}
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${confidence.className}`}
                  >
                    {confidence.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => void onCopy(card.id, card.explanation)}
                    className={BUTTON_CLASS}
                  >
                    <Copy className="h-4 w-4" />
                    {copiedId === card.id ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-3xl border border-white/20 bg-white/60 p-4 dark:bg-slate-950/30">
                <p className="text-sm leading-7 text-slate-700 dark:text-slate-200">
                  {card.explanation}
                </p>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-3xl border border-white/20 bg-white/60 p-4 dark:bg-slate-950/30">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Fence distance
                  </p>
                  <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                    {card.distanceFromFence.toFixed(2)}
                  </p>
                </div>

                <div className="rounded-3xl border border-white/20 bg-white/60 p-4 dark:bg-slate-950/30">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Explanation source
                  </p>
                  <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                    {card.source === "ollama" ? "Ollama" : "Fallback"}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-3xl border border-white/20 bg-white/60 p-4 dark:bg-slate-950/30">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Row preview
                </p>
                <div className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-200">
                  {Object.entries(card.rowPreview).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between gap-4">
                      <span className="font-medium">{key}</span>
                      <span className="text-right text-slate-500 dark:text-slate-400">
                        {formatUnknownValue(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.article>
          );
        })}
      </div>
    </div>
  );
}

export default function AIAnomalyExplainer({
  tableName,
  columns,
}: AIAnomalyExplainerProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const resource = useMemo(
    () => loadAnomalies(tableName, columns),
    [columns, refreshKey, tableName],
  );

  async function handleCopy(id: string, explanation: string) {
    const clipboard =
      typeof window !== "undefined" ? window.navigator.clipboard : undefined;

    if (!clipboard || typeof clipboard.writeText !== "function") {
      return;
    }

    await clipboard.writeText(explanation);
    setCopiedId(id);
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-rose-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-rose-700 dark:text-rose-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            AI anomaly explainer
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Explain outliers with row context and likely causes
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Scan numeric columns for IQR outliers, send representative rows to
            Ollama for context, and grade the explanation confidence from how
            far each observation sits beyond the fence.
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            startTransition(() => {
              setCopiedId(null);
              setRefreshKey((value) => value + 1);
            })
          }
          className={BUTTON_CLASS}
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="mt-6">
        <Suspense fallback={<AnomalyFallback />}>
          <AnomalyBody
            resource={resource}
            copiedId={copiedId}
            onCopy={handleCopy}
          />
        </Suspense>
      </div>
    </section>
  );
}
