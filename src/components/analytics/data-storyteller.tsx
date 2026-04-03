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
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  BookText,
  ChevronDown,
  ChevronUp,
  Download,
  Sparkles,
  TrendingUp,
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
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import {
  correlation,
  kurtosis,
  mean,
  median,
  quartiles,
  skewness,
  standardDeviation,
} from "@/lib/utils/statistics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface DataStorytellerProps {
  tableName: string;
  columns: ColumnProfile[];
}

type ExportFormat = "markdown" | "html";
type SparkKind = "line" | "bar";

interface StoryFinding {
  id: string;
  title: string;
  score: number;
  summary: string;
  markdown: string;
  sparkKind: SparkKind;
  sparkLabels: string[];
  sparkValues: number[];
}

interface StorytellingResult {
  rowCount: number;
  completeness: number;
  findings: StoryFinding[];
  markdownStory: string;
  error: string | null;
}

interface NumericSignal {
  column: string;
  values: number[];
  bins: Array<{ label: string; count: number }>;
  score: number;
  markdown: string;
  title: string;
}

function StorytellingLoading() {
  return (
    <div
      className={`${GLASS_PANEL_CLASS} flex min-h-[32rem] items-center justify-center`}
    >
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Generating story findings…
      </div>
    </div>
  );
}

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

function numericBins(values: number[]) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = Math.max((max - min) / 8, 1e-6);
  const bins = Array.from({ length: 8 }, (_, index) => ({
    lower: min + index * width,
    upper: index === 7 ? max : min + (index + 1) * width,
    count: 0,
  }));

  for (const value of values) {
    const index = Math.min(7, Math.max(0, Math.floor((value - min) / width)));
    bins[index].count += 1;
  }

  return bins.map((bin) => ({
    label: `${bin.lower.toFixed(0)}-${bin.upper.toFixed(0)}`,
    count: bin.count,
  }));
}

function buildSparklineOption(
  finding: StoryFinding,
  dark: boolean,
): EChartsOption {
  return {
    animationDuration: 420,
    grid: { left: 0, right: 0, top: 4, bottom: 4 },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    xAxis: {
      type: "category",
      data: finding.sparkLabels,
      show: false,
    },
    yAxis: {
      type: "value",
      show: false,
    },
    series: [
      finding.sparkKind === "line"
        ? {
            type: "line",
            smooth: true,
            data: finding.sparkValues,
            symbol: "none",
            lineStyle: { color: "#38bdf8", width: 2.5 },
            areaStyle: { color: "rgba(56, 189, 248, 0.12)" },
          }
        : {
            type: "bar",
            data: finding.sparkValues,
            itemStyle: { color: "#22c55e", borderRadius: [4, 4, 0, 0] },
          },
    ],
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function markdownToHtml(markdown: string) {
  const lines = markdown.split("\n");
  let html = "";
  let inList = false;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<h2>${escapeHtml(line.slice(3))}</h2>`;
      continue;
    }

    if (line.startsWith("- ")) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${escapeHtml(line.slice(2))}</li>`;
      continue;
    }

    if (inList) {
      html += "</ul>";
      inList = false;
    }

    if (line.trim().length > 0) {
      html += `<p>${escapeHtml(line)}</p>`;
    }
  }

  if (inList) {
    html += "</ul>";
  }

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Data story</title><style>body{margin:0;padding:32px;font-family:Inter,Segoe UI,sans-serif;background:#020617;color:#e2e8f0}main{max-width:920px;margin:0 auto}h1{font-size:2.2rem;margin-bottom:8px}h2{margin-top:28px;font-size:1.35rem}p,li{line-height:1.7;color:#cbd5e1}ul{padding-left:20px}</style></head><body><main>${html}</main></body></html>`;
}

async function loadRowCount(tableName: string) {
  const rows = await runQuery(
    `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tableName)}`,
  );
  return toCount(rows[0]?.row_count);
}

async function loadNumericSignal(
  tableName: string,
  column: ColumnProfile,
): Promise<NumericSignal | null> {
  const rows = await runQuery(`
    SELECT TRY_CAST(${quoteIdentifier(column.name)} AS DOUBLE) AS value
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(column.name)} IS NOT NULL
      AND TRY_CAST(${quoteIdentifier(column.name)} AS DOUBLE) IS NOT NULL
    LIMIT 2000
  `);

  const values = rows
    .map((row) => toNumber(row.value))
    .filter((value): value is number => value !== null);

  if (values.length < 12) return null;

  const average = mean(values);
  const middle = median(values);
  const spread = standardDeviation(values);
  const { q1, q3 } = quartiles(values);
  const outlierCount = values.filter(
    (value) => value < q1 - 1.5 * (q3 - q1) || value > q3 + 1.5 * (q3 - q1),
  ).length;
  const outlierRate = (outlierCount / values.length) * 100;
  const skewValue = skewness(values);
  const kurtosisValue = kurtosis(values);
  const heavyTail = Math.abs(kurtosisValue) >= 1.2;
  const direction =
    skewValue >= 0.7 ? "upper tail" : skewValue <= -0.7 ? "lower tail" : "core spread";
  const score = Math.min(
    100,
    outlierRate * 2.8 + Math.abs(skewValue) * 24 + Math.abs(kurtosisValue) * 8,
  );

  return {
    column: column.name,
    values,
    bins: numericBins(values),
    score,
    title:
      outlierRate >= 5
        ? `${column.name} carries notable outliers`
        : `${column.name} has a ${direction} signature`,
    markdown: [
      `## ${column.name} distribution signal`,
      `- Mean: ${average.toFixed(2)}; median: ${middle.toFixed(2)}; std dev: ${spread.toFixed(2)}`,
      `- Skewness: ${skewValue.toFixed(2)} and kurtosis: ${kurtosisValue.toFixed(2)}${heavyTail ? ", which points to heavier tails than a normal baseline." : "."}`,
      `- Outlier rate: ${outlierRate.toFixed(1)}% of sampled values fall outside the Tukey fences.`,
    ].join("\n"),
  };
}

async function loadCorrelationFindings(
  tableName: string,
  columns: ColumnProfile[],
): Promise<StoryFinding[]> {
  if (columns.length < 2) return [];
  const pairs: Array<[ColumnProfile, ColumnProfile]> = [];
  for (let left = 0; left < columns.length; left += 1) {
    for (let right = left + 1; right < columns.length; right += 1) {
      pairs.push([columns[left], columns[right]]);
    }
  }

  const rows = await Promise.all(
    pairs.slice(0, 6).map(async ([left, right]) => {
      const result = await runQuery(`
        SELECT
          TRY_CAST(${quoteIdentifier(left.name)} AS DOUBLE) AS left_value,
          TRY_CAST(${quoteIdentifier(right.name)} AS DOUBLE) AS right_value
        FROM ${quoteIdentifier(tableName)}
        WHERE ${quoteIdentifier(left.name)} IS NOT NULL
          AND ${quoteIdentifier(right.name)} IS NOT NULL
          AND TRY_CAST(${quoteIdentifier(left.name)} AS DOUBLE) IS NOT NULL
          AND TRY_CAST(${quoteIdentifier(right.name)} AS DOUBLE) IS NOT NULL
        LIMIT 1500
      `);
      const leftValues: number[] = [];
      const rightValues: number[] = [];
      for (const row of result) {
        const leftValue = toNumber(row.left_value);
        const rightValue = toNumber(row.right_value);
        if (leftValue === null || rightValue === null) continue;
        leftValues.push(leftValue);
        rightValues.push(rightValue);
      }
      if (leftValues.length < 12) return null;
      const corr = correlation(leftValues, rightValues);
      if (!Number.isFinite(corr) || Math.abs(corr) < 0.5) return null;
      const magnitude = Math.abs(corr);
      return {
        id: `${left.name}-${right.name}-corr`,
        title: `${left.name} and ${right.name} move together`,
        score: Math.min(100, magnitude * 110),
        summary:
          corr >= 0
            ? `Positive correlation at ${corr.toFixed(2)}`
            : `Negative correlation at ${corr.toFixed(2)}`,
        markdown: [
          `## Correlation: ${left.name} ↔ ${right.name}`,
          `- Correlation coefficient: ${corr.toFixed(2)}`,
          `- Evaluated on ${formatNumber(leftValues.length)} paired rows`,
          `- ${corr >= 0 ? "Higher values tend to rise together." : "As one rises, the other tends to fall."}`,
        ].join("\n"),
        sparkKind: "bar" as const,
        sparkLabels: ["|r|"],
        sparkValues: [Number((magnitude * 100).toFixed(2))],
      } as StoryFinding;
    }),
  );

  const filtered: StoryFinding[] = rows.filter(
    (row): row is StoryFinding => row !== null,
  );
  return filtered
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
}

async function loadTemporalFinding(
  tableName: string,
  column: ColumnProfile | undefined,
): Promise<StoryFinding[]> {
  if (!column) return [];

  const rows = await runQuery(`
    WITH parsed AS (
      SELECT TRY_CAST(${quoteIdentifier(column.name)} AS TIMESTAMP) AS ts
      FROM ${quoteIdentifier(tableName)}
      WHERE ${quoteIdentifier(column.name)} IS NOT NULL
    )
    SELECT
      STRFTIME(CAST(DATE_TRUNC('month', ts) AS DATE), '%Y-%m') AS month_bucket,
      COUNT(*) AS row_count
    FROM parsed
    WHERE ts IS NOT NULL
    GROUP BY 1
    ORDER BY 1
  `);

  const monthly = rows.map((row) => ({
    label: String(row.month_bucket ?? ""),
    count: toCount(row.row_count),
  }));

  if (monthly.length < 3) return [];

  const first = monthly[0]?.count ?? 0;
  const last = monthly[monthly.length - 1]?.count ?? 0;
  const growth = first === 0 ? 0 : ((last - first) / Math.abs(first)) * 100;
  const score = Math.min(100, Math.abs(growth) * 0.6 + monthly.length * 2);

  return [
    {
      id: `${column.name}-trend`,
      title: `${column.name} shows a month-over-month trend`,
      score,
      summary: `${growth >= 0 ? "Growth" : "Decline"} of ${formatPercent(
        Math.abs(growth),
      )} from the first to the latest month`,
      markdown: [
        `## Temporal trend on ${column.name}`,
        `- Coverage spans ${formatNumber(monthly.length)} monthly buckets`,
        `- First month volume: ${formatNumber(first)}; latest month volume: ${formatNumber(last)}`,
        `- Net change across the window: ${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%`,
      ].join("\n"),
      sparkKind: "line",
      sparkLabels: monthly.map((item) => item.label),
      sparkValues: monthly.map((item) => item.count),
    },
  ];
}

async function loadCategoryFinding(
  tableName: string,
  columns: ColumnProfile[],
): Promise<StoryFinding[]> {
  const candidates = columns.filter((column) => {
    if (column.type !== "string" && column.type !== "boolean") return false;
    return column.uniqueCount > 1 && column.uniqueCount <= 20;
  });

  if (candidates.length === 0) return [];

  const target = candidates[0];
  const rows = await runQuery(`
    SELECT
      CAST(${quoteIdentifier(target.name)} AS VARCHAR) AS value,
      COUNT(*) AS row_count
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(target.name)} IS NOT NULL
    GROUP BY 1
    ORDER BY row_count DESC, value
    LIMIT 6
  `);

  const values = rows.map((row) => ({
    label: String(row.value ?? ""),
    count: toCount(row.row_count),
  }));

  if (values.length === 0) return [];

  const total = values.reduce((sum, item) => sum + item.count, 0);
  const leadShare =
    total === 0 ? 0 : (values[0].count / total) * 100;
  const score = Math.min(100, leadShare * 1.1);

  return [
    {
      id: `${target.name}-category`,
      title: `${target.name} is concentrated around a few values`,
      score,
      summary: `${values[0].label || "Top value"} covers ${formatPercent(
        leadShare,
      )} of the sampled category mass`,
      markdown: [
        `## Category concentration: ${target.name}`,
        `- Lead value: ${values[0].label || "(blank)"} at ${formatPercent(leadShare)}`,
        `- Distinct values profiled: ${formatNumber(values.length)}`,
        `- A concentrated category can hide segment-level performance unless it is split out in reporting.`,
      ].join("\n"),
      sparkKind: "bar",
      sparkLabels: values.map((item) => item.label || "(blank)"),
      sparkValues: values.map((item) => item.count),
    },
  ];
}

async function buildStorytellingResult(
  tableName: string,
  columns: ColumnProfile[],
): Promise<StorytellingResult> {
  const rowCount = await loadRowCount(tableName);
  const totalNulls = columns.reduce((sum, column) => sum + column.nullCount, 0);
  const totalCells = Math.max(rowCount * Math.max(columns.length, 1), 1);
  const completeness = ((totalCells - totalNulls) / totalCells) * 100;

  const numericColumns = columns
    .filter((column) => column.type === "number")
    .slice(0, 4);
  const dateColumn = columns.find((column) => column.type === "date");

  const [numericSignals, temporalFindings, correlationFindings, categoryFindings] =
    await Promise.all([
      Promise.all(numericColumns.map((column) => loadNumericSignal(tableName, column))),
      loadTemporalFinding(tableName, dateColumn),
      loadCorrelationFindings(tableName, numericColumns),
      loadCategoryFinding(tableName, columns),
    ]);

  const findings: StoryFinding[] = [];

  const nullHeavyColumns = [...columns]
    .filter((column) => rowCount > 0 && column.nullCount / rowCount >= 0.12)
    .sort((left, right) => right.nullCount - left.nullCount)
    .slice(0, 5);

  if (nullHeavyColumns.length > 0) {
    const lead = nullHeavyColumns[0];
    const leadPct = (lead.nullCount / Math.max(rowCount, 1)) * 100;
    findings.push({
      id: "missingness",
      title: `${lead.name} is the leading completeness risk`,
      score: Math.min(100, leadPct * 1.6),
      summary: `${formatPercent(leadPct)} of rows are missing in ${lead.name}`,
      markdown: [
        `## Missingness hot spot`,
        `- ${lead.name} is missing in ${formatPercent(leadPct)} of rows`,
        `- Dataset completeness overall: ${formatPercent(completeness)}`,
        `- Prioritize this field before building any dashboards that depend on it.`,
      ].join("\n"),
      sparkKind: "bar",
      sparkLabels: nullHeavyColumns.map((column) => column.name),
      sparkValues: nullHeavyColumns.map((column) =>
        Number(((column.nullCount / Math.max(rowCount, 1)) * 100).toFixed(2)),
      ),
    });
  }

  findings.push(
    ...numericSignals
      .filter((signal): signal is NumericSignal => signal !== null)
      .sort((left, right) => right.score - left.score)
      .slice(0, 2)
      .map((signal) => ({
        id: `${signal.column}-distribution`,
        title: signal.title,
        score: signal.score,
        summary: `${signal.column} has one of the most interesting numeric shapes in the dataset`,
        markdown: signal.markdown,
        sparkKind: "bar" as const,
        sparkLabels: signal.bins.map((bin) => bin.label),
        sparkValues: signal.bins.map((bin) => bin.count),
      })),
  );

  findings.push(...temporalFindings, ...correlationFindings, ...categoryFindings);

  if (findings.length === 0) {
    findings.push({
      id: "overview",
      title: "The dataset looks structurally stable",
      score: 40,
      summary: "No standout anomalies crossed the story threshold",
      markdown: [
        `## Structural overview`,
        `- Row count: ${formatNumber(rowCount)}`,
        `- Column count: ${formatNumber(columns.length)}`,
        `- Completeness: ${formatPercent(completeness)}`,
        `- The first pass did not surface a dominant outlier, trend, or concentration pattern.`,
      ].join("\n"),
      sparkKind: "bar",
      sparkLabels: ["Rows", "Columns"],
      sparkValues: [rowCount, columns.length],
    });
  }

  const rankedFindings = findings
    .sort((left, right) => right.score - left.score)
    .slice(0, 6);

  const markdownStory = [
    `# ${tableName} story`,
    "",
    `Dataset size: ${formatNumber(rowCount)} rows across ${formatNumber(columns.length)} columns`,
    `Completeness: ${formatPercent(completeness)}`,
    "",
    ...rankedFindings.flatMap((finding, index) => [
      `## ${index + 1}. ${finding.title}`,
      finding.summary,
      ...finding.markdown.split("\n").filter((line) => !line.startsWith("## ")),
      "",
    ]),
  ].join("\n");

  return {
    rowCount,
    completeness,
    findings: rankedFindings,
    markdownStory,
    error: null,
  };
}

function DataStorytellerReady({
  tableName,
  columns,
}: DataStorytellerProps) {
  const dark = useDarkMode();
  const [exportFormat, setExportFormat] = useState<ExportFormat>("markdown");
  const [openIds, setOpenIds] = useState<string[]>([]);

  const resultPromise = useMemo(
    () =>
      buildStorytellingResult(tableName, columns).catch((error) => ({
        rowCount: 0,
        completeness: 0,
        findings: [],
        markdownStory: "",
        error:
          error instanceof Error
            ? error.message
            : "Unable to generate the data story.",
      })),
    [columns, tableName],
  );

  const result = use(resultPromise);

  function toggleFinding(id: string) {
    setOpenIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function exportStory() {
    if (result.error) return;
    if (exportFormat === "markdown") {
      downloadFile(
        result.markdownStory,
        `${tableName}-story.md`,
        "text/markdown;charset=utf-8;",
      );
      return;
    }

    downloadFile(
      markdownToHtml(result.markdownStory),
      `${tableName}-story.html`,
      "text/html;charset=utf-8;",
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
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
              <BookText className="h-4 w-4" />
              Rule-Based Data Storyteller
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Turn patterns into a ranked narrative
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              The story is generated locally from schema quality, numeric shape,
              category concentration, trend movement, and correlation strength.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <select
              aria-label="Export format"
              value={exportFormat}
              onChange={(event) =>
                startTransition(() =>
                  setExportFormat(event.target.value as ExportFormat),
                )
              }
              className={FIELD_CLASS}
            >
              <option value="markdown">Markdown</option>
              <option value="html">HTML</option>
            </select>
            <button type="button" onClick={exportStory} className={BUTTON_CLASS}>
              <Download className="h-4 w-4" />
              Export story
            </button>
          </div>
        </div>

        {result.error ? (
          <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-5 text-sm text-rose-700 dark:text-rose-300">
            {result.error}
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="Rows"
                value={formatNumber(result.rowCount)}
              />
              <SummaryCard
                label="Columns"
                value={formatNumber(columns.length)}
              />
              <SummaryCard
                label="Completeness"
                value={formatPercent(result.completeness)}
              />
              <SummaryCard
                label="Findings"
                value={formatNumber(result.findings.length)}
              />
            </div>

            <div className="space-y-4">
              {result.findings.map((finding) => {
                const isOpen = openIds.includes(finding.id);
                return (
                  <div key={finding.id} className={`${GLASS_CARD_CLASS} overflow-hidden`}>
                    <button
                      type="button"
                      onClick={() => toggleFinding(finding.id)}
                      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                    >
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 dark:text-amber-300">
                          Interestingness {Math.round(finding.score)}/100
                        </div>
                        <div className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                          {finding.title}
                        </div>
                        <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                          {finding.summary}
                        </div>
                      </div>
                      {isOpen ? (
                        <ChevronUp className="h-5 w-5 text-slate-500 dark:text-slate-300" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-slate-500 dark:text-slate-300" />
                      )}
                    </button>

                    {isOpen ? (
                      <div className="grid gap-4 border-t border-white/10 px-5 py-5 xl:grid-cols-[1.4fr_0.8fr]">
                        <div className="rounded-2xl border border-white/10 bg-white/45 p-4 dark:bg-slate-950/30">
                          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                            <Sparkles className="h-4 w-4" />
                            Markdown finding
                          </div>
                          <pre className="whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-slate-200">
                            {finding.markdown}
                          </pre>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/45 p-4 dark:bg-slate-950/30">
                          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                            <TrendingUp className="h-4 w-4" />
                            Mini chart
                          </div>
                          <ReactEChartsCore
                            echarts={echarts}
                            option={buildSparklineOption(finding, dark)}
                            notMerge
                            lazyUpdate
                            style={{ height: 110 }}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </motion.section>
  );
}

export default function DataStoryteller(props: DataStorytellerProps) {
  return (
    <Suspense fallback={<StorytellingLoading />}>
      <DataStorytellerReady {...props} />
    </Suspense>
  );
}
