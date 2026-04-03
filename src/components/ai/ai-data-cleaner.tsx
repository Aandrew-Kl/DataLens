"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  CheckCircle2,
  Loader2,
  Sparkles,
  Wrench,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import {
  generateOllamaText,
  loadOllamaSettings,
} from "@/lib/ai/ollama-settings";
import { formatNumber, formatPercent, generateId } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface AIDataCleanerProps {
  tableName: string;
  columns: ColumnProfile[];
}

type IssueKind = "nulls" | "outliers" | "formats";

interface CleaningSuggestion {
  id: string;
  kind: IssueKind;
  title: string;
  detail: string;
  sql: string;
  aiNote: string;
}

function detectFormatVariance(column: ColumnProfile) {
  const patterns = new Set(
    column.sampleValues
      .map((value) => (value == null ? "" : String(value).trim()))
      .filter((value) => value.length > 0)
      .map((value) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "iso-date";
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return "slash-date";
        if (/^[A-Z0-9 _-]+$/.test(value)) return "upper";
        if (/^[a-z0-9 _-]+$/.test(value)) return "lower";
        return "mixed";
      }),
  );

  return patterns.size > 1;
}

function buildOutlierScanQuery(tableName: string, numericColumns: ColumnProfile[]) {
  if (numericColumns.length === 0) {
    return "SELECT NULL AS column_name, NULL AS outlier_count WHERE FALSE";
  }

  return `
    WITH outlier_scan AS (
      ${numericColumns
        .map(
          (column) => `
            SELECT
              '${column.name.replaceAll("'", "''")}' AS column_name,
              COUNT(*) AS outlier_count
            FROM (
              SELECT
                CAST(${quoteIdentifier(column.name)} AS DOUBLE) AS metric_value,
                ABS(
                  (
                    CAST(${quoteIdentifier(column.name)} AS DOUBLE) -
                    AVG(CAST(${quoteIdentifier(column.name)} AS DOUBLE)) OVER ()
                  ) /
                  NULLIF(STDDEV_SAMP(CAST(${quoteIdentifier(column.name)} AS DOUBLE)) OVER (), 0)
                ) AS z_score
              FROM ${quoteIdentifier(tableName)}
              WHERE ${quoteIdentifier(column.name)} IS NOT NULL
            ) scored
            WHERE z_score > 3
          `,
        )
        .join(" UNION ALL ")}
    )
    SELECT column_name, outlier_count
    FROM outlier_scan
    ORDER BY outlier_count DESC, column_name ASC
  `;
}

function buildSuggestions(
  tableName: string,
  columns: ColumnProfile[],
  outlierCounts: Map<string, number>,
  aiNarratives: string[],
) {
  const suggestions: CleaningSuggestion[] = [];

  columns.forEach((column) => {
    if (column.nullCount > 0 && column.type === "number") {
      const fallbackValue =
        typeof column.median === "number"
          ? column.median
          : typeof column.mean === "number"
            ? column.mean
            : 0;
      suggestions.push({
        id: generateId(),
        kind: "nulls",
        title: `Fill missing values in ${column.name}`,
        detail: `${formatNumber(column.nullCount)} null rows can be backfilled with ${fallbackValue.toFixed(
          2,
        )}.`,
        sql: `UPDATE ${quoteIdentifier(tableName)} SET ${quoteIdentifier(
          column.name,
        )} = ${fallbackValue} WHERE ${quoteIdentifier(column.name)} IS NULL`,
        aiNote: aiNarratives.shift() ?? "Backfill missing numeric values before downstream scoring.",
      });
    }

    if (column.type === "string" && column.nullCount > 0) {
      suggestions.push({
        id: generateId(),
        kind: "nulls",
        title: `Normalize blanks in ${column.name}`,
        detail: `${formatNumber(column.nullCount)} missing text values can be standardized.`,
        sql: `UPDATE ${quoteIdentifier(tableName)} SET ${quoteIdentifier(
          column.name,
        )} = 'Unknown' WHERE ${quoteIdentifier(column.name)} IS NULL`,
        aiNote: aiNarratives.shift() ?? "Standardize empty text values so segment labels stay consistent.",
      });
    }

    if ((outlierCounts.get(column.name) ?? 0) > 0 && column.type === "number") {
      suggestions.push({
        id: generateId(),
        kind: "outliers",
        title: `Cap extreme values in ${column.name}`,
        detail: `${formatNumber(outlierCounts.get(column.name) ?? 0)} z-score outliers were detected.`,
        sql: `UPDATE ${quoteIdentifier(tableName)} SET ${quoteIdentifier(
          column.name,
        )} = CASE
          WHEN CAST(${quoteIdentifier(column.name)} AS DOUBLE) > (
            SELECT AVG(CAST(${quoteIdentifier(column.name)} AS DOUBLE)) + 3 * STDDEV_SAMP(CAST(${quoteIdentifier(column.name)} AS DOUBLE))
            FROM ${quoteIdentifier(tableName)}
            WHERE ${quoteIdentifier(column.name)} IS NOT NULL
          ) THEN (
            SELECT AVG(CAST(${quoteIdentifier(column.name)} AS DOUBLE)) + 3 * STDDEV_SAMP(CAST(${quoteIdentifier(column.name)} AS DOUBLE))
            FROM ${quoteIdentifier(tableName)}
            WHERE ${quoteIdentifier(column.name)} IS NOT NULL
          )
          WHEN CAST(${quoteIdentifier(column.name)} AS DOUBLE) < (
            SELECT AVG(CAST(${quoteIdentifier(column.name)} AS DOUBLE)) - 3 * STDDEV_SAMP(CAST(${quoteIdentifier(column.name)} AS DOUBLE))
            FROM ${quoteIdentifier(tableName)}
            WHERE ${quoteIdentifier(column.name)} IS NOT NULL
          ) THEN (
            SELECT AVG(CAST(${quoteIdentifier(column.name)} AS DOUBLE)) - 3 * STDDEV_SAMP(CAST(${quoteIdentifier(column.name)} AS DOUBLE))
            FROM ${quoteIdentifier(tableName)}
            WHERE ${quoteIdentifier(column.name)} IS NOT NULL
          )
          ELSE CAST(${quoteIdentifier(column.name)} AS DOUBLE)
        END
        WHERE ${quoteIdentifier(column.name)} IS NOT NULL`,
        aiNote: aiNarratives.shift() ?? "Cap outliers to stabilize AI prompts and chart scales.",
      });
    }

    if (column.type === "string" && detectFormatVariance(column)) {
      suggestions.push({
        id: generateId(),
        kind: "formats",
        title: `Trim and normalize ${column.name}`,
        detail: "Sample values show mixed casing or inconsistent date-like formatting.",
        sql: `UPDATE ${quoteIdentifier(tableName)} SET ${quoteIdentifier(
          column.name,
        )} = NULLIF(TRIM(CAST(${quoteIdentifier(column.name)} AS VARCHAR)), '')
        WHERE ${quoteIdentifier(column.name)} IS NOT NULL`,
        aiNote: aiNarratives.shift() ?? "Normalize string formats before joins, grouping, or AI reasoning.",
      });
    }
  });

  return suggestions;
}

function parseAiNarratives(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

function SuggestionCard({
  suggestion,
  applying,
  applied,
  onApply,
}: {
  suggestion: CleaningSuggestion;
  applying: boolean;
  applied: boolean;
  onApply: (suggestion: CleaningSuggestion) => Promise<void>;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-slate-950 dark:text-white">
            {suggestion.title}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {suggestion.detail}
          </p>
        </div>
        <span className="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 dark:bg-white/10 dark:text-slate-300">
          {suggestion.kind}
        </span>
      </div>

      <p className="mt-3 rounded-2xl border border-cyan-400/15 bg-cyan-500/10 px-4 py-3 text-sm leading-6 text-cyan-700 dark:text-cyan-300">
        {suggestion.aiNote}
      </p>

      <pre className="mt-3 overflow-x-auto rounded-2xl bg-slate-950 px-4 py-3 text-xs leading-6 text-slate-100">
        {suggestion.sql}
      </pre>

      <button
        type="button"
        onClick={() => void onApply(suggestion)}
        disabled={applying || applied}
        className={`${BUTTON_CLASS} mt-4`}
      >
        {applying ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : applied ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <Wrench className="h-4 w-4" />
        )}
        {applied ? "Applied" : "Apply via DuckDB"}
      </button>
    </div>
  );
}

export default function AIDataCleaner({
  tableName,
  columns,
}: AIDataCleanerProps) {
  const [suggestions, setSuggestions] = useState<CleaningSuggestion[]>([]);
  const [appliedIds, setAppliedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const totalNulls = useMemo(
    () => columns.reduce((sum, column) => sum + column.nullCount, 0),
    [columns],
  );

  async function handleScan() {
    setLoading(true);
    setStatus(null);

    try {
      const numericColumns = columns.filter((column) => column.type === "number");
      const outlierRows = await runQuery(buildOutlierScanQuery(tableName, numericColumns));
      const outlierCounts = new Map<string, number>();

      outlierRows.forEach((row) => {
        if (!isRecord(row) || typeof row.column_name !== "string") return;
        const count = toNumber(row.outlier_count);
        outlierCounts.set(row.column_name, count ?? 0);
      });

      const settings = loadOllamaSettings();
      const aiResponse = await generateOllamaText({
        baseUrl: settings.url,
        model: settings.model,
        systemPrompt: settings.systemPrompt,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        prompt: [
          "Create short, actionable bullet points for data cleaning suggestions.",
          `Dataset: ${tableName}`,
          `Columns: ${columns.length}`,
          `Total nulls: ${totalNulls}`,
          `Outlier columns: ${Array.from(outlierCounts.entries())
            .map(([name, count]) => `${name}=${count}`)
            .join(", ") || "none"}`,
          "Return 6 bullets max.",
        ].join("\n"),
      });

      const nextSuggestions = buildSuggestions(
        tableName,
        columns,
        outlierCounts,
        parseAiNarratives(aiResponse),
      );

      startTransition(() => {
        setSuggestions(nextSuggestions);
        setAppliedIds([]);
      });
      setStatus(`Generated ${formatNumber(nextSuggestions.length)} cleaning steps.`);
    } catch (error) {
      setSuggestions([]);
      setAppliedIds([]);
      setStatus(
        error instanceof Error ? error.message : "Quality scan failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleApplySuggestion(suggestion: CleaningSuggestion) {
    setApplyingId(suggestion.id);
    setStatus(null);

    try {
      await runQuery(suggestion.sql);
      setAppliedIds((current) => [...current, suggestion.id]);
      setStatus(`Applied: ${suggestion.title}`);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Applying the suggestion failed.",
      );
    } finally {
      setApplyingId(null);
    }
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Bot className="h-3.5 w-3.5" />
            AI data cleaner
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Detect data quality issues and apply local cleaning actions
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Scan nulls, outliers, and inconsistent sample formats, then ask
            Ollama for guidance while keeping every data fix inside DuckDB.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleScan()}
          disabled={loading}
          className={BUTTON_CLASS}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Detect quality issues
        </button>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Profiled columns
          </p>
          <p className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
            {formatNumber(columns.length)}
          </p>
        </div>
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Null cells
          </p>
          <p className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
            {formatNumber(totalNulls)}
          </p>
        </div>
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Suggested actions
          </p>
          <p className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
            {formatNumber(suggestions.length)}
          </p>
        </div>
      </div>

      {status ? (
        <p className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-700 dark:text-cyan-300">
          {status}
        </p>
      ) : null}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
        className="mt-6 grid gap-4 lg:grid-cols-2"
      >
        {suggestions.length === 0 ? (
          <div className={`${GLASS_CARD_CLASS} lg:col-span-2 p-6 text-sm text-slate-600 dark:text-slate-300`}>
            Run the scan to generate cleaning suggestions and DuckDB update
            statements.
          </div>
        ) : (
          suggestions.map((suggestion) => (
            <SuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              applying={applyingId === suggestion.id}
              applied={appliedIds.includes(suggestion.id)}
              onApply={handleApplySuggestion}
            />
          ))
        )}
      </motion.div>
    </section>
  );
}
