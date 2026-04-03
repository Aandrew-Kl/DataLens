"use client";

import { useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Download, Hash, Link2, Mail, Phone, Type } from "lucide-react";
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
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface StringAnalyzerProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface LengthBin {
  label: string;
  count: number;
}

interface PatternResult {
  emails: number;
  urls: number;
  phones: number;
}

interface TopValue {
  value: string;
  count: number;
}

interface StringAnalysisResult {
  totalRows: number;
  nonNullRows: number;
  emptyRows: number;
  uniqueRows: number;
  duplicateRows: number;
  patterns: PatternResult;
  lengthBins: LengthBin[];
  topValues: TopValue[];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const PHONE_PATTERN = /^\+?[0-9(). -]{7,}$/;

function buildLengthBins(values: string[]) {
  if (values.length === 0) return [];
  const maxLength = Math.max(...values.map((value) => value.length));
  const step = Math.max(1, Math.ceil(maxLength / 8));
  const bins = Array.from({ length: Math.max(1, Math.ceil((maxLength + 1) / step)) }, (_, index) => ({
    start: index * step,
    end: index * step + step - 1,
    count: 0,
  }));

  values.forEach((value) => {
    const index = Math.min(bins.length - 1, Math.floor(value.length / step));
    bins[index].count += 1;
  });

  return bins.map((bin) => ({
    label: `${bin.start}-${bin.end}`,
    count: bin.count,
  }));
}

function buildChartOption(bins: LengthBin[], dark: boolean): EChartsOption {
  return {
    animationDuration: 420,
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617f2" : "#ffffffee",
      borderColor: dark ? "#1e293b" : "#e2e8f0",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    grid: { left: 18, right: 20, top: 18, bottom: 28, containLabel: true },
    xAxis: {
      type: "category",
      data: bins.map((bin) => bin.label),
      axisLabel: { color: dark ? "#cbd5e1" : "#64748b" },
      axisLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: dark ? "#cbd5e1" : "#64748b" },
      splitLine: {
        lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" },
      },
    },
    series: [
      {
        type: "bar",
        data: bins.map((bin) => bin.count),
        itemStyle: { color: "#14b8a6", borderRadius: [10, 10, 0, 0] },
        barMaxWidth: 36,
      },
    ],
  };
}

function buildCsv(result: StringAnalysisResult) {
  return [
    "metric,value",
    `total_rows,${result.totalRows}`,
    `non_null_rows,${result.nonNullRows}`,
    `empty_rows,${result.emptyRows}`,
    `unique_rows,${result.uniqueRows}`,
    `duplicate_rows,${result.duplicateRows}`,
    `email_matches,${result.patterns.emails}`,
    `url_matches,${result.patterns.urls}`,
    `phone_matches,${result.patterns.phones}`,
    "",
    "length_bin,count",
    ...result.lengthBins.map((bin) => `${bin.label},${bin.count}`),
  ].join("\n");
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Hash;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
        {value}
      </div>
    </div>
  );
}

export default function StringAnalyzer({
  tableName,
  columns,
}: StringAnalyzerProps) {
  const dark = useDarkMode();
  const stringColumns = useMemo(
    () => columns.filter((column) => column.type === "string"),
    [columns],
  );
  const [columnName, setColumnName] = useState("");
  const [result, setResult] = useState<StringAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeColumn =
    stringColumns.find((column) => column.name === columnName)?.name ??
    stringColumns[0]?.name ??
    "";

  async function handleAnalyze() {
    if (!activeColumn) {
      setResult(null);
      setError("Choose a string column to analyze.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const safeTable = quoteIdentifier(tableName);
      const safeColumn = quoteIdentifier(activeColumn);

      const [summaryRows, topValueRows, sampleRows] = await Promise.all([
        runQuery(`
          SELECT
            COUNT(*) AS total_rows,
            COUNT(${safeColumn}) AS non_null_rows,
            COUNT(*) FILTER (
              WHERE ${safeColumn} IS NOT NULL
                AND TRIM(CAST(${safeColumn} AS VARCHAR)) = ''
            ) AS empty_rows,
            COUNT(DISTINCT ${safeColumn}) AS unique_rows
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
      const sampleValues = sampleRows
        .map((row) => row.value)
        .filter((value): value is string => typeof value === "string");

      const patterns = sampleValues.reduce<PatternResult>(
        (accumulator, value) => ({
          emails: accumulator.emails + (EMAIL_PATTERN.test(value) ? 1 : 0),
          urls: accumulator.urls + (URL_PATTERN.test(value) ? 1 : 0),
          phones: accumulator.phones + (PHONE_PATTERN.test(value) ? 1 : 0),
        }),
        { emails: 0, urls: 0, phones: 0 },
      );

      const uniqueRows = toCount(summary.unique_rows);
      const nonNullRows = toCount(summary.non_null_rows);

      setResult({
        totalRows: toCount(summary.total_rows),
        nonNullRows,
        emptyRows: toCount(summary.empty_rows),
        uniqueRows,
        duplicateRows: Math.max(0, nonNullRows - uniqueRows),
        patterns,
        lengthBins: buildLengthBins(sampleValues),
        topValues: topValueRows.map((row) => ({
          value: typeof row.value === "string" ? row.value : "null",
          count: toCount(row.value_count),
        })),
      });
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : "String analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;
    downloadFile(
      buildCsv(result),
      `${tableName}-${activeColumn}-string-analysis.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} p-6`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
            <Type className="h-4 w-4" />
            String Analyzer
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            Inspect free-form text quality and patterns
          </h2>
        </div>
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

      <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <label className="text-sm text-slate-600 dark:text-slate-300">
          <span className="mb-2 block">String column</span>
          <select
            aria-label="String column"
            value={activeColumn}
            onChange={(event) => setColumnName(event.target.value)}
            className={FIELD_CLASS}
          >
            {stringColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={loading || !activeColumn}
          className={`${BUTTON_CLASS} self-end`}
        >
          {loading ? "Analyzing…" : "Analyze strings"}
        </button>
      </div>

      {!stringColumns.length ? (
        <div className="mt-6 rounded-3xl border border-dashed border-white/25 px-4 py-6 text-sm text-slate-600 dark:text-slate-300">
          Choose a string column to analyze.
        </div>
      ) : null}

      {error ? (
        <div className="mt-6 rounded-3xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Unique values"
          value={result ? formatNumber(result.uniqueRows) : "—"}
          icon={Hash}
        />
        <MetricCard
          label="Duplicate rows"
          value={result ? formatNumber(result.duplicateRows) : "—"}
          icon={Type}
        />
        <MetricCard
          label="Empty strings"
          value={result ? formatNumber(result.emptyRows) : "—"}
          icon={Mail}
        />
        <MetricCard
          label="Non-null rows"
          value={result ? formatNumber(result.nonNullRows) : "—"}
          icon={Link2}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <ReactEChartsCore
            echarts={echarts}
            option={buildChartOption(result?.lengthBins ?? [], dark)}
            style={{ height: 320 }}
          />
        </div>
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Pattern detection
          </h3>
          <div className="mt-4 space-y-3 text-sm text-slate-700 dark:text-slate-200">
            <div className="flex items-center justify-between rounded-2xl bg-slate-950/5 px-4 py-3 dark:bg-white/5">
              <span className="flex items-center gap-2"><Mail className="h-4 w-4" /> Email matches</span>
              <span>{result ? formatNumber(result.patterns.emails) : "—"}</span>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-slate-950/5 px-4 py-3 dark:bg-white/5">
              <span className="flex items-center gap-2"><Link2 className="h-4 w-4" /> URL matches</span>
              <span>{result ? formatNumber(result.patterns.urls) : "—"}</span>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-slate-950/5 px-4 py-3 dark:bg-white/5">
              <span className="flex items-center gap-2"><Phone className="h-4 w-4" /> Phone-like values</span>
              <span>{result ? formatNumber(result.patterns.phones) : "—"}</span>
            </div>
          </div>
          <h4 className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Top values
          </h4>
          <div className="mt-3 space-y-2">
            {(result?.topValues ?? []).map((item) => (
              <div
                key={`${item.value}-${item.count}`}
                className="flex items-center justify-between rounded-2xl border border-white/15 px-4 py-3 text-sm text-slate-700 dark:text-slate-200"
              >
                <span className="truncate">{item.value}</span>
                <span>{formatNumber(item.count)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
