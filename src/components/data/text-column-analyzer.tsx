"use client";

import {
  Suspense,
  startTransition,
  use,
  useMemo,
  useState,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  Binary,
  CaseSensitive,
  Download,
  Hash,
  ScanSearch,
  Type,
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
  toCount,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface TextColumnAnalyzerProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface TopValue {
  value: string;
  count: number;
}

interface PatternSummary {
  emails: number;
  urls: number;
  phones: number;
  dates: number;
}

interface TextAnalysisResult {
  totalRows: number;
  nonNullRows: number;
  emptyRows: number;
  uniqueValues: number;
  wordFrequency: Array<{ word: string; count: number }>;
  lengthDistribution: Array<{ label: string; count: number }>;
  patternSummary: PatternSummary;
  asciiRows: number;
  utfRows: number;
  suggestedType: string;
  topValues: TopValue[];
  error: string | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const PHONE_PATTERN = /^\+?[0-9(). -]{7,}$/;
const DATE_PATTERN =
  /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/;
const BOOLEAN_PATTERN = /^(true|false|yes|no|y|n|0|1)$/i;
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
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

function TextAnalyzerLoading() {
  return (
    <div
      className={`${GLASS_PANEL_CLASS} flex min-h-[30rem] items-center justify-center`}
    >
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Loading text analysis…
      </div>
    </div>
  );
}

function tokenizeText(value: string) {
  return value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu) ?? [];
}

function histogramLengths(values: string[]) {
  if (values.length === 0) return [];
  const lengths = values.map((value) => value.length);
  const max = Math.max(...lengths);
  const step = Math.max(1, Math.ceil(max / 10));
  const bins = Array.from({ length: Math.max(1, Math.ceil((max + 1) / step)) }, (_, index) => ({
    start: index * step,
    end: index * step + step - 1,
    count: 0,
  }));

  for (const length of lengths) {
    const index = Math.min(bins.length - 1, Math.floor(length / step));
    bins[index].count += 1;
  }

  return bins.map((bin) => ({
    label: `${bin.start}-${bin.end}`,
    count: bin.count,
  }));
}

function detectPatterns(values: string[]): PatternSummary {
  return values.reduce<PatternSummary>(
    (summary, value) => ({
      emails: summary.emails + (EMAIL_PATTERN.test(value) ? 1 : 0),
      urls: summary.urls + (URL_PATTERN.test(value) ? 1 : 0),
      phones: summary.phones + (PHONE_PATTERN.test(value) ? 1 : 0),
      dates: summary.dates + (DATE_PATTERN.test(value) ? 1 : 0),
    }),
    { emails: 0, urls: 0, phones: 0, dates: 0 },
  );
}

function suggestedType(values: string[]) {
  if (values.length === 0) return "free-text";
  const ratios = {
    date: values.filter((value) => DATE_PATTERN.test(value)).length / values.length,
    number: values.filter((value) => NUMBER_PATTERN.test(value)).length / values.length,
    boolean:
      values.filter((value) => BOOLEAN_PATTERN.test(value)).length / values.length,
  };

  if (ratios.date >= 0.75) return "date-like";
  if (ratios.number >= 0.85) return "numeric-like";
  if (ratios.boolean >= 0.85) return "boolean-like";
  return "free-text";
}

function buildBarOption(
  labels: string[],
  values: number[],
  dark: boolean,
  color: string,
): EChartsOption {
  return {
    animationDuration: 480,
    grid: { left: 54, right: 20, top: 20, bottom: 30 },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: {
        color: dark ? "#cbd5e1" : "#475569",
        rotate: labels.length > 6 ? 28 : 0,
      },
      axisLine: { lineStyle: { color: dark ? "#334155" : "#cbd5e1" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: dark ? "#cbd5e1" : "#475569" },
      splitLine: {
        lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" },
      },
    },
    series: [
      {
        type: "bar",
        data: values,
        itemStyle: { color, borderRadius: [8, 8, 0, 0] },
      },
    ],
  };
}

async function loadTextAnalysis(
  tableName: string,
  columnName: string,
): Promise<TextAnalysisResult> {
  if (!columnName) {
    return {
      totalRows: 0,
      nonNullRows: 0,
      emptyRows: 0,
      uniqueValues: 0,
      wordFrequency: [],
      lengthDistribution: [],
      patternSummary: { emails: 0, urls: 0, phones: 0, dates: 0 },
      asciiRows: 0,
      utfRows: 0,
      suggestedType: "free-text",
      topValues: [],
      error: "Choose a text column to analyze.",
    };
  }

  const safeTable = quoteIdentifier(tableName);
  const safeColumn = quoteIdentifier(columnName);
  const [summaryRows, topValueRows, sampleRows] = await Promise.all([
    runQuery(`
      SELECT
        COUNT(*) AS total_rows,
        COUNT(${safeColumn}) AS non_null_rows,
        COUNT(*) FILTER (
          WHERE ${safeColumn} IS NOT NULL
            AND TRIM(CAST(${safeColumn} AS VARCHAR)) = ''
        ) AS empty_rows,
        COUNT(DISTINCT ${safeColumn}) AS unique_values
      FROM ${safeTable}
    `),
    runQuery(`
      SELECT
        CAST(${safeColumn} AS VARCHAR) AS value,
        COUNT(*) AS value_count
      FROM ${safeTable}
      WHERE ${safeColumn} IS NOT NULL
      GROUP BY 1
      ORDER BY value_count DESC, value
      LIMIT 5
    `),
    runQuery(`
      SELECT CAST(${safeColumn} AS VARCHAR) AS value
      FROM ${safeTable}
      WHERE ${safeColumn} IS NOT NULL
      LIMIT 2000
    `),
  ]);

  const summary = summaryRows[0] ?? {};
  const sampledValues = sampleRows
    .map((row) => String(row.value ?? "").trim())
    .filter((value) => value.length > 0);

  const words = new Map<string, number>();
  for (const value of sampledValues) {
    for (const token of tokenizeText(value)) {
      if (token.length < 2) continue;
      words.set(token, (words.get(token) ?? 0) + 1);
    }
  }

  const wordFrequency = [...words.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 20)
    .map(([word, count]) => ({ word, count }));

  const asciiRows = sampledValues.filter((value) =>
    [...value].every((character) => character.charCodeAt(0) <= 127),
  ).length;

  return {
    totalRows: toCount(summary.total_rows),
    nonNullRows: toCount(summary.non_null_rows),
    emptyRows: toCount(summary.empty_rows),
    uniqueValues: toCount(summary.unique_values),
    wordFrequency,
    lengthDistribution: histogramLengths(sampledValues),
    patternSummary: detectPatterns(sampledValues),
    asciiRows,
    utfRows: Math.max(sampledValues.length - asciiRows, 0),
    suggestedType: suggestedType(sampledValues),
    topValues: topValueRows.map((row) => ({
      value: String(row.value ?? ""),
      count: toCount(row.value_count),
    })),
    error: null,
  };
}

function TextColumnAnalyzerReady({
  tableName,
  columns,
}: TextColumnAnalyzerProps) {
  const dark = useDarkMode();
  const textColumns = useMemo(
    () =>
      columns.filter(
        (column) => column.type === "string" || column.type === "unknown",
      ),
    [columns],
  );
  const [columnName, setColumnName] = useState(textColumns[0]?.name ?? "");

  const safeColumn = textColumns.some((column) => column.name === columnName)
    ? columnName
    : textColumns[0]?.name ?? "";

  const resultPromise = useMemo(
    () =>
      loadTextAnalysis(tableName, safeColumn).catch((error) => ({
        totalRows: 0,
        nonNullRows: 0,
        emptyRows: 0,
        uniqueValues: 0,
        wordFrequency: [],
        lengthDistribution: [],
        patternSummary: { emails: 0, urls: 0, phones: 0, dates: 0 },
        asciiRows: 0,
        utfRows: 0,
        suggestedType: "free-text",
        topValues: [],
        error:
          error instanceof Error ? error.message : "Unable to analyze the text column.",
      })),
    [safeColumn, tableName],
  );

  const result = use(resultPromise);

  function exportFindings() {
    if (result.error) return;
    const csv = [
      "metric,value",
      `column,"${safeColumn}"`,
      `total_rows,${result.totalRows}`,
      `non_null_rows,${result.nonNullRows}`,
      `empty_rows,${result.emptyRows}`,
      `unique_values,${result.uniqueValues}`,
      `null_pct,${(
        ((result.totalRows - result.nonNullRows) / Math.max(result.totalRows, 1)) *
        100
      ).toFixed(2)}`,
      `suggested_type,"${result.suggestedType}"`,
      `emails,${result.patternSummary.emails}`,
      `urls,${result.patternSummary.urls}`,
      `phones,${result.patternSummary.phones}`,
      `dates,${result.patternSummary.dates}`,
      `ascii_rows,${result.asciiRows}`,
      `utf_rows,${result.utfRows}`,
      ...result.topValues.map(
        (item, index) => `top_value_${index + 1},"${item.value}" (${item.count})`,
      ),
    ].join("\n");

    downloadFile(
      csv,
      `${tableName}-${safeColumn}-text-findings.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
              <Type className="h-4 w-4" />
              Text Column Deep Dive
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Profile words, patterns, cardinality, and encoding signals
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              The analyzer samples real values to surface repeated phrases,
              regex-like structure, value concentration, and type-casting hints.
            </p>
          </div>
          <button type="button" onClick={exportFindings} className={BUTTON_CLASS}>
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Text column
            </label>
            <select
              value={safeColumn}
              onChange={(event) =>
                startTransition(() => setColumnName(event.target.value))
              }
              className={FIELD_CLASS}
            >
              {textColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </div>
          <SummaryCard
            label="Suggested type"
            value={result.suggestedType}
          />
          <SummaryCard
            label="Null or empty"
            value={formatPercent(
              ((result.totalRows - result.nonNullRows + result.emptyRows) /
                Math.max(result.totalRows, 1)) *
                100,
            )}
          />
        </div>

        {result.error ? (
          <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-5 text-sm text-rose-700 dark:text-rose-300">
            {result.error}
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label="Unique values" value={formatNumber(result.uniqueValues)} />
              <SummaryCard
                label="ASCII rows"
                value={formatNumber(result.asciiRows)}
              />
              <SummaryCard label="UTF rows" value={formatNumber(result.utfRows)} />
              <SummaryCard
                label="Non-null rows"
                value={formatNumber(result.nonNullRows)}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className={`${GLASS_CARD_CLASS} p-4`}>
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  <CaseSensitive className="h-4 w-4" />
                  Top 20 words
                </div>
                <ReactEChartsCore
                  echarts={echarts}
                  option={buildBarOption(
                    result.wordFrequency.map((item) => item.word),
                    result.wordFrequency.map((item) => item.count),
                    dark,
                    "#38bdf8",
                  )}
                  notMerge
                  lazyUpdate
                  style={{ height: 320 }}
                />
              </div>
              <div className={`${GLASS_CARD_CLASS} p-4`}>
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  <Hash className="h-4 w-4" />
                  Character length distribution
                </div>
                <ReactEChartsCore
                  echarts={echarts}
                  option={buildBarOption(
                    result.lengthDistribution.map((item) => item.label),
                    result.lengthDistribution.map((item) => item.count),
                    dark,
                    "#22c55e",
                  )}
                  notMerge
                  lazyUpdate
                  style={{ height: 320 }}
                />
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className={`${GLASS_CARD_CLASS} p-5`}>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  <ScanSearch className="h-4 w-4" />
                  Pattern detection
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <SummaryCard
                    label="Email-like"
                    value={formatNumber(result.patternSummary.emails)}
                  />
                  <SummaryCard
                    label="URL-like"
                    value={formatNumber(result.patternSummary.urls)}
                  />
                  <SummaryCard
                    label="Phone-like"
                    value={formatNumber(result.patternSummary.phones)}
                  />
                  <SummaryCard
                    label="Date-like"
                    value={formatNumber(result.patternSummary.dates)}
                  />
                </div>
              </div>

              <div className={`${GLASS_CARD_CLASS} p-5`}>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  <Binary className="h-4 w-4" />
                  Cardinality breakdown
                </div>
                <div className="mt-4 space-y-3">
                  {result.topValues.length > 0 ? (
                    result.topValues.map((item) => (
                      <div
                        key={`${item.value}-${item.count}`}
                        className="flex items-center justify-between rounded-2xl border border-white/15 bg-white/50 px-4 py-3 dark:border-white/10 dark:bg-slate-950/35"
                      >
                        <span className="truncate text-sm text-slate-700 dark:text-slate-200">
                          {item.value || "(empty string)"}
                        </span>
                        <span className="ml-3 text-sm font-semibold text-slate-950 dark:text-white">
                          {formatNumber(item.count)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/20 px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                      No repeated values were returned for this text column.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </motion.section>
  );
}

export default function TextColumnAnalyzer(props: TextColumnAnalyzerProps) {
  return (
    <Suspense fallback={<TextAnalyzerLoading />}>
      <TextColumnAnalyzerReady {...props} />
    </Suspense>
  );
}
