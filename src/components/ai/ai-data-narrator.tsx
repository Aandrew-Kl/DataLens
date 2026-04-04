"use client";

import { Suspense, startTransition, use, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  Copy,
  Database,
  FileText,
  RefreshCw,
  Sigma,
  TrendingUp,
} from "lucide-react";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
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

interface AIDataNarratorProps {
  tableName: string;
  columns: ColumnProfile[];
}

type NarrationTone = "technical" | "executive" | "casual";

interface NullInsight {
  name: string;
  nullCount: number;
  nullRate: number;
}

interface CorrelationInsight {
  left: string;
  right: string;
  correlation: number;
  pairCount: number;
}

interface NarrationSnapshot {
  rowCount: number;
  columnCount: number;
  overallNullRate: number;
  topNullColumns: NullInsight[];
  topCorrelations: CorrelationInsight[];
}

interface NarrationReadyState {
  status: "ready";
  source: "ollama" | "fallback";
  tone: NarrationTone;
  warning: string | null;
  snapshot: NarrationSnapshot;
  narrative: string;
}

interface NarrationErrorState {
  status: "error";
  message: string;
}

type NarrationResult = NarrationReadyState | NarrationErrorState;

const TONE_OPTIONS = [
  {
    value: "technical",
    label: "Technical",
    description: "Precise wording with statistical emphasis.",
  },
  {
    value: "executive",
    label: "Executive",
    description: "Condensed framing for decision-makers.",
  },
  {
    value: "casual",
    label: "Casual",
    description: "Plain-language recap of the dataset shape.",
  },
] as const;

function strongestCorrelationLabel(correlations: CorrelationInsight[]) {
  const strongest = correlations[0];
  if (!strongest) return "No correlation pairs";
  return `${strongest.left} × ${strongest.right}`;
}

function formatMetricValue(value: number) {
  return Math.abs(value) >= 1 ? value.toFixed(2) : value.toFixed(3);
}

function buildFallbackNarrative(
  tone: NarrationTone,
  snapshot: NarrationSnapshot,
): string {
  const nullSummary = snapshot.topNullColumns.length
    ? snapshot.topNullColumns
        .map(
          (column) =>
            `${column.name} (${formatPercent(column.nullRate, 1)} null)`,
        )
        .join(", ")
    : "no columns with missing values";

  const correlationSummary = snapshot.topCorrelations.length
    ? snapshot.topCorrelations
        .map(
          (pair) =>
            `${pair.left} and ${pair.right} (${formatMetricValue(pair.correlation)})`,
        )
        .join(", ")
    : "no strong numeric correlations";

  if (tone === "executive") {
    return `Fallback summary: ${formatNumber(snapshot.rowCount)} rows across ${formatNumber(snapshot.columnCount)} columns. Missingness is ${formatPercent(snapshot.overallNullRate, 1)} overall, concentrated in ${nullSummary}. The strongest numeric signals are ${correlationSummary}.`;
  }

  if (tone === "casual") {
    return `Fallback summary: this table has ${formatNumber(snapshot.rowCount)} rows and ${formatNumber(snapshot.columnCount)} columns. Missing data is running at ${formatPercent(snapshot.overallNullRate, 1)} overall. The main gaps are ${nullSummary}, and the clearest numeric relationships are ${correlationSummary}.`;
  }

  return `Fallback summary: the profiled dataset contains ${formatNumber(snapshot.rowCount)} rows and ${formatNumber(snapshot.columnCount)} columns. Aggregate null density is ${formatPercent(snapshot.overallNullRate, 1)}, with the highest missingness in ${nullSummary}. The top correlation signals are ${correlationSummary}.`;
}

function toneInstruction(tone: NarrationTone) {
  if (tone === "executive") {
    return "Write in an executive tone with concise, outcome-focused language.";
  }

  if (tone === "casual") {
    return "Write in a casual tone with direct, plain-language explanations.";
  }

  return "Write in a technical tone and mention statistical risk clearly.";
}

function buildNarrationPrompt(
  tableName: string,
  tone: NarrationTone,
  snapshot: NarrationSnapshot,
) {
  const correlationLines = snapshot.topCorrelations.length
    ? snapshot.topCorrelations
        .map(
          (pair) =>
            `- ${pair.left} vs ${pair.right}: corr=${formatMetricValue(pair.correlation)}, pairs=${formatNumber(pair.pairCount)}`,
        )
        .join("\n")
    : "- No correlation pairs available";

  const nullLines = snapshot.topNullColumns.length
    ? snapshot.topNullColumns
        .map(
          (column) =>
            `- ${column.name}: ${formatNumber(column.nullCount)} nulls (${formatPercent(column.nullRate, 1)})`,
        )
        .join("\n")
    : "- No null-heavy columns";

  return [
    `You are narrating the DataLens dataset "${tableName}".`,
    toneInstruction(tone),
    "Write 2 short paragraphs followed by 3 bullet recommendations.",
    "Reference row count, column count, missingness, and correlation structure.",
    "",
    `Rows: ${snapshot.rowCount}`,
    `Columns: ${snapshot.columnCount}`,
    `Overall null rate: ${snapshot.overallNullRate.toFixed(2)}%`,
    "Top null-heavy columns:",
    nullLines,
    "Top correlations:",
    correlationLines,
  ].join("\n");
}

async function queryRowCount(tableName: string) {
  const rows = await runQuery(
    `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tableName)}`,
  );
  return Math.max(0, Math.round(toNumber(rows[0]?.row_count) ?? 0));
}

async function queryCorrelations(
  tableName: string,
  columns: ColumnProfile[],
): Promise<CorrelationInsight[]> {
  const numericColumns = columns.filter((column) => column.type === "number");
  const pairs: Array<[ColumnProfile, ColumnProfile]> = [];

  for (let leftIndex = 0; leftIndex < numericColumns.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < numericColumns.length;
      rightIndex += 1
    ) {
      pairs.push([numericColumns[leftIndex], numericColumns[rightIndex]]);
    }
  }

  const responses = await Promise.all(
    pairs.slice(0, 8).map(async ([left, right]) => {
      const sql = `
        SELECT
          corr(TRY_CAST(${quoteIdentifier(left.name)} AS DOUBLE), TRY_CAST(${quoteIdentifier(right.name)} AS DOUBLE)) AS correlation_value,
          COUNT(*) FILTER (
            WHERE ${quoteIdentifier(left.name)} IS NOT NULL
              AND ${quoteIdentifier(right.name)} IS NOT NULL
          ) AS pair_count
        FROM ${quoteIdentifier(tableName)}
      `;
      const row = (await runQuery(sql))[0] ?? {};
      const correlation = toNumber(row.correlation_value);
      const pairCount = Math.max(0, Math.round(toNumber(row.pair_count) ?? 0));

      if (correlation === null || pairCount < 3) {
        return null;
      }

      return {
        left: left.name,
        right: right.name,
        correlation,
        pairCount,
      } satisfies CorrelationInsight;
    }),
  );

  return responses
    .filter((pair): pair is CorrelationInsight => pair !== null)
    .sort(
      (left, right) =>
        Math.abs(right.correlation) - Math.abs(left.correlation) ||
        left.left.localeCompare(right.left),
    )
    .slice(0, 3);
}

async function loadNarration(
  tableName: string,
  columns: ColumnProfile[],
  tone: NarrationTone,
): Promise<NarrationResult> {
  try {
    const rowCount = await queryRowCount(tableName);
    const totalCells = Math.max(rowCount * Math.max(columns.length, 1), 1);
    const totalNulls = columns.reduce((sum, column) => sum + column.nullCount, 0);
    const topNullColumns = [...columns]
      .map((column) => ({
        name: column.name,
        nullCount: column.nullCount,
        nullRate: rowCount > 0 ? (column.nullCount / rowCount) * 100 : 0,
      }))
      .filter((column) => column.nullCount > 0)
      .sort(
        (left, right) =>
          right.nullRate - left.nullRate || left.name.localeCompare(right.name),
      )
      .slice(0, 3);

    const topCorrelations = await queryCorrelations(tableName, columns);
    const snapshot: NarrationSnapshot = {
      rowCount,
      columnCount: columns.length,
      overallNullRate: (totalNulls / totalCells) * 100,
      topNullColumns,
      topCorrelations,
    };

    try {
      const settings = loadOllamaSettings();
      const narrative = await generateOllamaText({
        baseUrl: settings.url,
        model: settings.model,
        prompt: buildNarrationPrompt(tableName, tone, snapshot),
        systemPrompt:
          "You are DataLens AI. Summarize the dataset with analytical clarity and actionable next steps.",
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
      });

      return {
        status: "ready",
        source: "ollama",
        tone,
        warning: null,
        snapshot,
        narrative,
      };
    } catch (error) {
      return {
        status: "ready",
        source: "fallback",
        tone,
        warning:
          error instanceof Error
            ? error.message
            : "Ollama narration failed. Showing fallback summary.",
        snapshot,
        narrative: buildFallbackNarrative(tone, snapshot),
      };
    }
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Unable to profile the dataset for narration.",
    };
  }
}

function NarratorFallback() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
      <div className={`${GLASS_CARD_CLASS} animate-pulse p-5`}>
        <div className="h-4 w-28 rounded-full bg-slate-200/80 dark:bg-slate-800/80" />
        <div className="mt-4 h-28 rounded-3xl bg-slate-200/70 dark:bg-slate-800/70" />
      </div>
      <div className={`${GLASS_CARD_CLASS} animate-pulse p-5`}>
        <div className="grid gap-3">
          <div className="h-20 rounded-3xl bg-slate-200/70 dark:bg-slate-800/70" />
          <div className="h-20 rounded-3xl bg-slate-200/70 dark:bg-slate-800/70" />
          <div className="h-20 rounded-3xl bg-slate-200/70 dark:bg-slate-800/70" />
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Database;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4 text-cyan-500" />
        {label}
      </div>
      <p className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function NarratorBody({
  resource,
  copied,
  onCopy,
}: {
  resource: Promise<NarrationResult>;
  copied: boolean;
  onCopy: (value: string) => Promise<void>;
}) {
  const report = use(resource);

  if (report.status === "error") {
    return (
      <div className={`${GLASS_CARD_CLASS} p-5`}>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-500">
          Narration unavailable
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
          {report.message}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Rows"
          value={formatNumber(report.snapshot.rowCount)}
          icon={Database}
        />
        <MetricCard
          label="Columns"
          value={formatNumber(report.snapshot.columnCount)}
          icon={Sigma}
        />
        <MetricCard
          label="Overall nulls"
          value={formatPercent(report.snapshot.overallNullRate, 1)}
          icon={FileText}
        />
        <MetricCard
          label="Top correlation"
          value={strongestCorrelationLabel(report.snapshot.topCorrelations)}
          icon={TrendingUp}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr,0.85fr]">
        <motion.article
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
          className={`${GLASS_CARD_CLASS} p-5`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
                AI narration
              </p>
              <h3 className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                {report.source === "ollama"
                  ? "Generated summary"
                  : "Fallback summary"}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => void onCopy(report.narrative)}
              className={BUTTON_CLASS}
            >
              <Copy className="h-4 w-4" />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="mt-4 whitespace-pre-wrap rounded-3xl border border-white/20 bg-white/60 p-4 text-sm leading-7 text-slate-700 dark:bg-slate-950/30 dark:text-slate-200">
            {report.narrative}
          </div>
          {report.warning ? (
            <p className="mt-3 text-sm text-amber-600 dark:text-amber-300">
              {report.warning}
            </p>
          ) : null}
        </motion.article>

        <motion.aside
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: ANALYTICS_EASE, delay: 0.04 }}
          className="grid gap-4"
        >
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Null hotspots
            </p>
            <div className="mt-3 space-y-3">
              {report.snapshot.topNullColumns.length ? (
                report.snapshot.topNullColumns.map((column) => (
                  <div
                    key={column.name}
                    className="rounded-3xl border border-white/20 bg-white/60 p-4 dark:bg-slate-950/30"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-slate-950 dark:text-white">
                        {column.name}
                      </p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {formatPercent(column.nullRate, 1)}
                      </p>
                    </div>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      {formatNumber(column.nullCount)} null values detected.
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  No missing-value concentrations were detected from the current
                  profile.
                </p>
              )}
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Correlation watchlist
            </p>
            <div className="mt-3 space-y-3">
              {report.snapshot.topCorrelations.length ? (
                report.snapshot.topCorrelations.map((pair) => (
                  <div
                    key={`${pair.left}:${pair.right}`}
                    className="rounded-3xl border border-white/20 bg-white/60 p-4 dark:bg-slate-950/30"
                  >
                    <p className="font-medium text-slate-950 dark:text-white">
                      {pair.left} × {pair.right}
                    </p>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      Correlation {formatMetricValue(pair.correlation)} across{" "}
                      {formatNumber(pair.pairCount)} paired rows.
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Numeric columns were not sufficient to compute paired
                  correlation signals.
                </p>
              )}
            </div>
          </div>
        </motion.aside>
      </div>
    </div>
  );
}

export default function AIDataNarrator({
  tableName,
  columns,
}: AIDataNarratorProps) {
  const [tone, setTone] = useState<NarrationTone>("technical");
  const [refreshKey, setRefreshKey] = useState(0);
  const [copied, setCopied] = useState(false);

  const resource = useMemo(
    () => {
      void refreshKey;
      return loadNarration(tableName, columns, tone);
    },
    [columns, refreshKey, tableName, tone],
  );

  async function handleCopy(value: string) {
    const clipboard =
      typeof window !== "undefined" ? window.navigator.clipboard : undefined;

    if (!clipboard || typeof clipboard.writeText !== "function") {
      return;
    }

    await clipboard.writeText(value);
    setCopied(true);
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Bot className="h-3.5 w-3.5" />
            AI data narrator
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Natural-language recap of dataset health and structure
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Build a short narrative from live DuckDB counts, missing-value
            rates, and top numeric correlations, then route the context through
            Ollama in the tone you need.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {TONE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={tone === option.value}
              onClick={() => {
                setCopied(false);
                startTransition(() => setTone(option.value));
              }}
              className={
                tone === option.value
                  ? "rounded-2xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-2.5 text-sm font-medium text-cyan-700 dark:text-cyan-300"
                  : BUTTON_CLASS
              }
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setCopied(false);
              startTransition(() => setRefreshKey((value) => value + 1));
            }}
            className={BUTTON_CLASS}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-5">
        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Selected tone
          </span>
          <input
            readOnly
            value={
              TONE_OPTIONS.find((option) => option.value === tone)?.description ?? ""
            }
            className={FIELD_CLASS}
          />
        </label>
      </div>

      <div className="mt-6">
        <Suspense fallback={<NarratorFallback />}>
          <NarratorBody
            resource={resource}
            copied={copied}
            onCopy={handleCopy}
          />
        </Suspense>
      </div>
    </section>
  );
}
