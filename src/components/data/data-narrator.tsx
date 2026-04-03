"use client";

import {
  Suspense,
  startTransition,
  use,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowDownToLine,
  BarChart3,
  FileText,
  GitCompareArrows,
  Lightbulb,
  Loader2,
  Sigma,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { assessDataQuality } from "@/lib/utils/data-quality";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  BarChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface DataNarratorProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

interface NumericNarrativeMetric {
  name: string;
  nonNullCount: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  q1: number | null;
  q3: number | null;
  outlierCount: number;
  outlierRate: number;
}

interface CategoryBreakdown {
  label: string;
  count: number;
  share: number;
}

interface CategoryNarrativeMetric {
  name: string;
  nonNullCount: number;
  distinctCount: number;
  topValues: CategoryBreakdown[];
  dominanceShare: number;
}

interface TemporalNarrativeMetric {
  name: string;
  minValue: string | null;
  maxValue: string | null;
  spanDays: number | null;
}

interface CorrelationNarrativeMetric {
  left: string;
  right: string;
  correlation: number;
  pairCount: number;
  strength: number;
}

type MiniVisual =
  | {
      kind: "donut";
      title: string;
      items: Array<{ label: string; value: number; color: string; valueLabel: string }>;
    }
  | {
      kind: "bars";
      title: string;
      items: Array<{ label: string; value: number; color: string; valueLabel: string }>;
      max: number;
    };

interface NarrativeSection {
  id: "intro" | "metrics" | "distributions" | "correlations" | "outliers" | "recommendations";
  title: string;
  kicker: string;
  icon: LucideIcon;
  accent: string;
  narrative: string;
  bullets: string[];
  visual: MiniVisual | null;
}

interface NarrativeReport {
  qualityScore: number;
  completeness: number;
  sections: NarrativeSection[];
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const NAV_BUTTON_CLASS =
  "rounded-2xl border border-white/15 bg-white/45 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-cyan-300/35 hover:text-slate-950 dark:bg-slate-950/35 dark:text-slate-200";
const VISUAL_COLORS = [
  "#38bdf8",
  "#2dd4bf",
  "#f59e0b",
  "#a78bfa",
  "#fb7185",
  "#22c55e",
] as const;

function subscribeDarkMode(listener: () => void) {
  if (typeof document === "undefined") return () => undefined;
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getDarkModeSnapshot() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

function useDarkMode() {
  return useSyncExternalStore(subscribeDarkMode, getDarkModeSnapshot, () => false);
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatPercent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

function formatMetricValue(value: number | null) {
  if (value == null) return "—";
  if (Math.abs(value) >= 1000) return formatNumber(value);
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toFixed(2);
}

function describeCorrelation(value: number) {
  const strength = Math.abs(value);
  if (strength >= 0.8) return value > 0 ? "very strong positive" : "very strong negative";
  if (strength >= 0.6) return value > 0 ? "strong positive" : "strong negative";
  if (strength >= 0.4) return value > 0 ? "moderate positive" : "moderate negative";
  return value > 0 ? "weak positive" : "weak negative";
}

function pickNumericTargets(columns: ColumnProfile[], rowCount: number) {
  return [...columns]
    .filter((column) => column.type === "number")
    .sort(
      (left, right) =>
        ((rowCount - right.nullCount) + right.uniqueCount) -
          ((rowCount - left.nullCount) + left.uniqueCount) ||
        left.name.localeCompare(right.name),
    )
    .slice(0, 4);
}

function pickCategoryTargets(columns: ColumnProfile[], rowCount: number) {
  return [...columns]
    .filter((column) => {
      if (column.type !== "string" && column.type !== "boolean") return false;
      const nonNullCount = Math.max(rowCount - column.nullCount, 0);
      return nonNullCount > 0 && column.uniqueCount > 1 && column.uniqueCount <= Math.min(24, Math.max(5, Math.floor(nonNullCount * 0.3)));
    })
    .sort(
      (left, right) =>
        ((rowCount - right.nullCount) - right.uniqueCount) -
          ((rowCount - left.nullCount) - left.uniqueCount) ||
        left.name.localeCompare(right.name),
    )
    .slice(0, 2);
}

async function loadNumericMetric(
  tableName: string,
  columnName: string,
  rowCount: number,
): Promise<NumericNarrativeMetric> {
  const safeTable = quoteIdentifier(tableName);
  const safeColumn = quoteIdentifier(columnName);

  const row = (await runQuery(`
    WITH stats AS (
      SELECT
        AVG(${safeColumn}) AS mean_value,
        MEDIAN(${safeColumn}) AS median_value,
        MIN(${safeColumn}) AS min_value,
        MAX(${safeColumn}) AS max_value,
        QUANTILE_CONT(${safeColumn}, 0.25) AS q1,
        QUANTILE_CONT(${safeColumn}, 0.75) AS q3,
        COUNT(${safeColumn}) AS non_null_count
      FROM ${safeTable}
      WHERE ${safeColumn} IS NOT NULL
    ),
    bounds AS (
      SELECT
        q1,
        q3,
        q1 - 1.5 * (q3 - q1) AS lower_bound,
        q3 + 1.5 * (q3 - q1) AS upper_bound,
        non_null_count
      FROM stats
    )
    SELECT
      mean_value,
      median_value,
      min_value,
      max_value,
      q1,
      q3,
      non_null_count,
      COUNT(*) FILTER (
        WHERE ${safeColumn} IS NOT NULL
          AND (
            ${safeColumn} < lower_bound
            OR ${safeColumn} > upper_bound
          )
      ) AS outlier_count
    FROM ${safeTable}, bounds
  `))[0] ?? {};

  const nonNullCount = Number(row.non_null_count ?? 0);
  const outlierCount = Number(row.outlier_count ?? 0);

  return {
    name: columnName,
    nonNullCount,
    mean: toNumber(row.mean_value),
    median: toNumber(row.median_value),
    min: toNumber(row.min_value),
    max: toNumber(row.max_value),
    q1: toNumber(row.q1),
    q3: toNumber(row.q3),
    outlierCount,
    outlierRate: rowCount === 0 ? 0 : (outlierCount / rowCount) * 100,
  };
}

async function loadCategoryMetric(
  tableName: string,
  columnName: string,
): Promise<CategoryNarrativeMetric> {
  const safeTable = quoteIdentifier(tableName);
  const safeColumn = quoteIdentifier(columnName);

  const [summaryRow, topRows] = await Promise.all([
    runQuery(`
      SELECT
        COUNT(${safeColumn}) AS non_null_count,
        COUNT(DISTINCT ${safeColumn}) AS distinct_count
      FROM ${safeTable}
    `),
    runQuery(`
      SELECT
        CAST(${safeColumn} AS VARCHAR) AS value_label,
        COUNT(*) AS value_count
      FROM ${safeTable}
      WHERE ${safeColumn} IS NOT NULL
      GROUP BY 1
      ORDER BY value_count DESC, value_label
      LIMIT 5
    `),
  ]);

  const baseRow = summaryRow[0] ?? {};
  const nonNullCount = Number(baseRow.non_null_count ?? 0);
  const topValues = topRows.map((row) => {
    const count = Number(row.value_count ?? 0);
    return {
      label: String(row.value_label ?? "Unknown"),
      count,
      share: nonNullCount === 0 ? 0 : (count / nonNullCount) * 100,
    };
  });

  return {
    name: columnName,
    nonNullCount,
    distinctCount: Number(baseRow.distinct_count ?? 0),
    topValues,
    dominanceShare: topValues[0]?.share ?? 0,
  };
}

async function loadTemporalMetric(
  tableName: string,
  columnName: string,
): Promise<TemporalNarrativeMetric> {
  const safeTable = quoteIdentifier(tableName);
  const safeColumn = quoteIdentifier(columnName);

  const row = (await runQuery(`
    SELECT
      MIN(TRY_CAST(${safeColumn} AS TIMESTAMP)) AS min_value,
      MAX(TRY_CAST(${safeColumn} AS TIMESTAMP)) AS max_value,
      DATE_DIFF(
        'day',
        CAST(MIN(TRY_CAST(${safeColumn} AS TIMESTAMP)) AS DATE),
        CAST(MAX(TRY_CAST(${safeColumn} AS TIMESTAMP)) AS DATE)
      ) AS span_days
    FROM ${safeTable}
    WHERE TRY_CAST(${safeColumn} AS TIMESTAMP) IS NOT NULL
  `))[0] ?? {};

  return {
    name: columnName,
    minValue: row.min_value == null ? null : String(row.min_value),
    maxValue: row.max_value == null ? null : String(row.max_value),
    spanDays: toNumber(row.span_days),
  };
}

async function loadCorrelationMetrics(
  tableName: string,
  columnNames: string[],
): Promise<CorrelationNarrativeMetric[]> {
  if (columnNames.length < 2) return [];
  const safeTable = quoteIdentifier(tableName);

  const unionQuery = columnNames.flatMap((left, leftIndex) =>
    columnNames.slice(leftIndex + 1).map((right) => {
      const safeLeft = quoteIdentifier(left);
      const safeRight = quoteIdentifier(right);
      return `
        SELECT
          '${left.replaceAll("'", "''")}' AS left_name,
          '${right.replaceAll("'", "''")}' AS right_name,
          corr(TRY_CAST(${safeLeft} AS DOUBLE), TRY_CAST(${safeRight} AS DOUBLE)) AS correlation_value,
          COUNT(*) FILTER (
            WHERE TRY_CAST(${safeLeft} AS DOUBLE) IS NOT NULL
              AND TRY_CAST(${safeRight} AS DOUBLE) IS NOT NULL
          ) AS pair_count
        FROM ${safeTable}
      `;
    }),
  );

  const rows = await runQuery(unionQuery.join(" UNION ALL "));
  return rows
    .flatMap<CorrelationNarrativeMetric>((row) => {
      const correlation = toNumber(row.correlation_value);
      const pairCount = Number(row.pair_count ?? 0);
      const left = String(row.left_name ?? "");
      const right = String(row.right_name ?? "");
      if (!left || !right || correlation == null || pairCount < 3) return [];
      return [
        {
          left,
          right,
          correlation,
          pairCount,
          strength: Math.abs(correlation),
        },
      ];
    })
    .sort((left, right) => right.strength - left.strength || left.left.localeCompare(right.left))
    .slice(0, 5);
}

function buildVisualOption(visual: MiniVisual, dark: boolean): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";

  if (visual.kind === "donut") {
    return {
      animationDuration: 420,
      color: visual.items.map((item) => item.color),
      tooltip: {
        trigger: "item",
        backgroundColor: dark ? "#020617ee" : "#ffffffee",
        borderColor,
        textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      },
      legend: {
        show: false,
      },
      series: [
        {
          type: "pie",
          radius: ["42%", "74%"],
          center: ["50%", "50%"],
          label: {
            show: true,
            color: textColor,
            fontSize: 10,
            formatter: "{b}",
          },
          itemStyle: {
            borderWidth: 2,
            borderColor: dark ? "#020617" : "#ffffff",
          },
          data: visual.items.map((item) => ({
            name: item.label,
            value: item.value,
          })),
        },
      ],
    };
  }

  return {
    animationDuration: 420,
    grid: {
      left: 10,
      right: 16,
      top: 10,
      bottom: 12,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    xAxis: {
      type: "value",
      max: visual.max,
      axisLabel: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: "category",
      data: visual.items.map((item) => item.label),
      axisLabel: {
        color: textColor,
        fontSize: 10,
      },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    series: [
      {
        type: "bar",
        data: visual.items.map((item) => ({
          value: item.value,
          itemStyle: {
            color: item.color,
            borderRadius: [999, 999, 999, 999],
          },
        })),
        label: {
          show: true,
          position: "right",
          color: textColor,
          fontSize: 10,
          formatter: (params: unknown) => {
            const item = params as { dataIndex?: number };
            return visual.items[item.dataIndex ?? 0]?.valueLabel ?? "";
          },
        },
      },
    ],
  };
}

function renderVisualHtml(visual: MiniVisual | null) {
  if (!visual) return "";

  if (visual.kind === "donut") {
    return `
      <div class="visual-block">
        <div class="visual-title">${escapeHtml(visual.title)}</div>
        <div class="pill-grid">
          ${visual.items
            .map(
              (item) => `
                <div class="pill">
                  <span class="swatch" style="background:${escapeHtml(item.color)}"></span>
                  <span>${escapeHtml(item.label)}</span>
                  <strong>${escapeHtml(item.valueLabel)}</strong>
                </div>
              `,
            )
            .join("")}
        </div>
      </div>
    `;
  }

  return `
    <div class="visual-block">
      <div class="visual-title">${escapeHtml(visual.title)}</div>
      <div class="bar-list">
        ${visual.items
          .map((item) => {
            const width = visual.max <= 0 ? 0 : Math.max((item.value / visual.max) * 100, 4);
            return `
              <div class="bar-row">
                <div class="bar-meta">
                  <span>${escapeHtml(item.label)}</span>
                  <strong>${escapeHtml(item.valueLabel)}</strong>
                </div>
                <div class="bar-track">
                  <div class="bar-fill" style="width:${width}%;background:${escapeHtml(item.color)}"></div>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function buildNarratorHtml(
  tableName: string,
  report: NarrativeReport,
  rowCount: number,
  columnCount: number,
) {
  const sectionHtml = report.sections
    .map(
      (section) => `
        <section class="story-card">
          <span class="eyebrow">${escapeHtml(section.kicker)}</span>
          <h2>${escapeHtml(section.title)}</h2>
          <p>${escapeHtml(section.narrative)}</p>
          <ul>
            ${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
          </ul>
          ${renderVisualHtml(section.visual)}
        </section>
      `,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(tableName)} narrative report</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #060816;
        --panel: rgba(15, 23, 42, 0.78);
        --line: rgba(148, 163, 184, 0.16);
        --text: #e2e8f0;
        --muted: #94a3b8;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background:
          radial-gradient(circle at top left, rgba(56, 189, 248, 0.14), transparent 28%),
          linear-gradient(180deg, #050814, var(--bg));
        color: var(--text);
        font-family: Inter, "Segoe UI", sans-serif;
      }
      main { max-width: 1120px; margin: 0 auto; padding: 40px 20px 56px; }
      .hero, .story-card { background: var(--panel); border: 1px solid var(--line); backdrop-filter: blur(18px); }
      .hero { border-radius: 28px; padding: 28px; box-shadow: 0 30px 80px rgba(2, 6, 23, 0.45); }
      h1 { margin: 0; font-size: 2.3rem; letter-spacing: -0.04em; }
      .lede { margin: 14px 0 0; color: #cbd5e1; line-height: 1.75; max-width: 72ch; }
      .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-top: 20px; }
      .stat { border-radius: 20px; border: 1px solid var(--line); background: rgba(15, 23, 42, 0.55); padding: 16px 18px; }
      .stat span, .eyebrow, .visual-title {
        display: block;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.14em;
        font-size: 0.73rem;
      }
      .stat strong { display: block; margin-top: 8px; font-size: 1.35rem; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 20px; }
      .story-card { border-radius: 24px; padding: 22px; }
      .story-card h2 { margin: 10px 0 0; font-size: 1.35rem; }
      .story-card p { margin: 14px 0 0; line-height: 1.75; color: #d8e1ec; }
      .story-card ul { margin: 16px 0 0; padding-left: 18px; color: #dbe4ef; line-height: 1.7; }
      .visual-block { margin-top: 18px; }
      .pill-grid { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
      .pill { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 999px; padding: 8px 12px; background: rgba(15, 23, 42, 0.55); }
      .swatch { width: 10px; height: 10px; border-radius: 999px; }
      .bar-list { margin-top: 12px; display: grid; gap: 10px; }
      .bar-meta { display: flex; justify-content: space-between; gap: 12px; font-size: 0.92rem; }
      .bar-track { margin-top: 6px; height: 10px; border-radius: 999px; background: rgba(148, 163, 184, 0.16); overflow: hidden; }
      .bar-fill { height: 100%; border-radius: 999px; }
      @media (max-width: 900px) {
        .stats, .grid { grid-template-columns: 1fr; }
        h1 { font-size: 1.9rem; }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <span class="eyebrow">Automatic narrative</span>
        <h1>${escapeHtml(tableName)} data narrator</h1>
        <p class="lede">A rule-based report generated from live DuckDB analysis, column profiles, and lightweight visual summaries. Each section is grounded in the actual loaded dataset rather than a generic prompt response.</p>
        <div class="stats">
          <div class="stat"><span>Rows</span><strong>${escapeHtml(formatNumber(rowCount))}</strong></div>
          <div class="stat"><span>Columns</span><strong>${escapeHtml(formatNumber(columnCount))}</strong></div>
          <div class="stat"><span>Quality Score</span><strong>${escapeHtml(String(report.qualityScore))}/100</strong></div>
          <div class="stat"><span>Completeness</span><strong>${escapeHtml(formatPercent(report.completeness))}</strong></div>
        </div>
      </section>
      <section class="grid">${sectionHtml}</section>
    </main>
  </body>
</html>`;
}

function buildNarrativeReport(
  columns: ColumnProfile[],
  rowCount: number,
  numericMetrics: NumericNarrativeMetric[],
  categoryMetrics: CategoryNarrativeMetric[],
  temporalMetric: TemporalNarrativeMetric | null,
  correlations: CorrelationNarrativeMetric[],
): NarrativeReport {
  const quality = assessDataQuality(columns, rowCount);
  const totalNulls = columns.reduce((sum, column) => sum + column.nullCount, 0);
  const totalCells = Math.max(rowCount * Math.max(columns.length, 1), 1);
  const completeness = ((totalCells - totalNulls) / totalCells) * 100;
  const typeCounts = [
    { label: "Numeric", count: columns.filter((column) => column.type === "number").length },
    { label: "String", count: columns.filter((column) => column.type === "string").length },
    { label: "Date", count: columns.filter((column) => column.type === "date").length },
    { label: "Boolean", count: columns.filter((column) => column.type === "boolean").length },
  ].filter((item) => item.count > 0);

  const strongestCorrelation = correlations[0] ?? null;
  const topOutliers = [...numericMetrics]
    .filter((metric) => metric.outlierCount > 0)
    .sort((left, right) => right.outlierCount - left.outlierCount || left.name.localeCompare(right.name))
    .slice(0, 3);
  const nullHeavyColumns = columns
    .filter((column) => rowCount > 0 && column.nullCount / rowCount >= 0.2)
    .sort((left, right) => right.nullCount - left.nullCount)
    .slice(0, 3);

  const introVisual: MiniVisual | null = typeCounts.length
    ? {
        kind: "donut",
        title: "Schema mix",
        items: typeCounts.map((item, index) => ({
          label: item.label,
          value: item.count,
          color: VISUAL_COLORS[index % VISUAL_COLORS.length],
          valueLabel: `${item.count} col`,
        })),
      }
    : null;
  const metricVisual: MiniVisual | null = numericMetrics.length
    ? {
        kind: "bars",
        title: "Metric coverage",
        items: numericMetrics.map((metric, index) => ({
          label: metric.name,
          value: rowCount === 0 ? 0 : (metric.nonNullCount / rowCount) * 100,
          color: VISUAL_COLORS[index % VISUAL_COLORS.length],
          valueLabel: formatPercent(rowCount === 0 ? 0 : (metric.nonNullCount / rowCount) * 100),
        })),
        max: 100,
      }
    : null;
  const distributionVisual: MiniVisual | null = categoryMetrics.length
    ? {
        kind: "bars",
        title: "Category dominance",
        items: categoryMetrics.map((metric, index) => ({
          label: metric.name,
          value: metric.dominanceShare,
          color: VISUAL_COLORS[index % VISUAL_COLORS.length],
          valueLabel: formatPercent(metric.dominanceShare),
        })),
        max: 100,
      }
    : numericMetrics.length
      ? {
          kind: "bars",
          title: "Middle 50% of range",
          items: numericMetrics.map((metric, index) => {
            const range = metric.max != null && metric.min != null ? metric.max - metric.min : null;
            const iqr = metric.q1 != null && metric.q3 != null ? metric.q3 - metric.q1 : null;
            const share = range && range !== 0 && iqr != null ? Math.max((iqr / range) * 100, 0) : 0;
            return {
              label: metric.name,
              value: share,
              color: VISUAL_COLORS[index % VISUAL_COLORS.length],
              valueLabel: formatPercent(share),
            };
          }),
          max: 100,
        }
      : null;
  const correlationVisual: MiniVisual | null = correlations.length
    ? {
        kind: "bars",
        title: "Absolute correlation strength",
        items: correlations.map((pair) => ({
          label: `${pair.left} ↔ ${pair.right}`,
          value: pair.strength * 100,
          color: pair.correlation >= 0 ? "#22c55e" : "#f97316",
          valueLabel: pair.correlation.toFixed(2),
        })),
        max: 100,
      }
    : null;
  const outlierVisual: MiniVisual | null = topOutliers.length
    ? {
        kind: "bars",
        title: "Outlier rate",
        items: topOutliers.map((metric, index) => ({
          label: metric.name,
          value: metric.outlierRate,
          color: index === 0 ? "#fb7185" : VISUAL_COLORS[index % VISUAL_COLORS.length],
          valueLabel: formatPercent(metric.outlierRate),
        })),
        max: Math.max(...topOutliers.map((metric) => metric.outlierRate), 1),
      }
    : null;
  const highIssues = quality.issues.filter((issue) => issue.severity === "high").length;
  const mediumIssues = quality.issues.filter((issue) => issue.severity === "medium").length;
  const recommendationVisual: MiniVisual = {
    kind: "bars",
    title: "Issue mix",
    items: [
      { label: "High", value: highIssues, color: "#fb7185", valueLabel: String(highIssues) },
      { label: "Medium", value: mediumIssues, color: "#f59e0b", valueLabel: String(mediumIssues) },
      { label: "Low", value: quality.issues.length - highIssues - mediumIssues, color: "#38bdf8", valueLabel: String(quality.issues.length - highIssues - mediumIssues) },
    ],
    max: Math.max(quality.issues.length, 1),
  };

  const sections: NarrativeSection[] = [
    {
      id: "intro",
      title: "Introduction",
      kicker: "Dataset framing",
      icon: FileText,
      accent: "from-cyan-500/25 to-sky-500/10",
      narrative:
        `${formatNumber(rowCount)} rows across ${formatNumber(columns.length)} columns gives this dataset a ${quality.overallScore >= 85 ? "high-confidence" : quality.overallScore >= 70 ? "usable" : "fragile"} analytical starting point. ` +
        `Overall completeness sits at ${formatPercent(completeness)}, and the schema is weighted toward ${typeCounts[0] ? `${typeCounts[0].label.toLowerCase()} fields` : "mixed fields"}. ` +
        `${quality.summary}`,
      bullets: [
        typeCounts.length > 0
          ? `Largest type family: ${typeCounts[0]?.label} (${typeCounts[0]?.count} columns)`
          : "No stable type breakdown was available.",
        temporalMetric
          ? `${temporalMetric.name} spans ${formatNumber(Math.max(temporalMetric.spanDays ?? 0, 0))} days of history`
          : "No strongly typed date field was available for timeline coverage.",
        quality.issues[0]
          ? `Primary watchpoint: ${quality.issues[0].column} (${quality.issues[0].message})`
          : "No quality issues were flagged by the initial rule-based audit.",
      ],
      visual: introVisual,
    },
    {
      id: "metrics",
      title: "Key Metrics",
      kicker: "Numeric baseline",
      icon: Sigma,
      accent: "from-violet-500/25 to-fuchsia-500/10",
      narrative:
        numericMetrics.length > 0
          ? `${numericMetrics[0].name} anchors the numeric profile with a mean of ${formatMetricValue(numericMetrics[0].mean)} and a median of ${formatMetricValue(numericMetrics[0].median)}. ` +
            `${numericMetrics[1] ? `${numericMetrics[1].name} follows with a center around ${formatMetricValue(numericMetrics[1].median)}. ` : ""}` +
            `Across the leading metrics, non-null coverage stays between ${formatPercent(Math.min(...numericMetrics.map((metric) => (rowCount === 0 ? 0 : (metric.nonNullCount / rowCount) * 100))))} and ${formatPercent(Math.max(...numericMetrics.map((metric) => (rowCount === 0 ? 0 : (metric.nonNullCount / rowCount) * 100))))}.`
          : "No numeric columns were available, so the metric layer is limited to structural counts instead of true quantitative measures.",
      bullets: numericMetrics.length > 0
        ? numericMetrics.map(
            (metric) =>
              `${metric.name}: mean ${formatMetricValue(metric.mean)}, median ${formatMetricValue(metric.median)}, range ${formatMetricValue(metric.min)} to ${formatMetricValue(metric.max)}`,
          )
        : ["Add numeric columns to generate metric-centered narrative sections."],
      visual: metricVisual,
    },
    {
      id: "distributions",
      title: "Distributions",
      kicker: "Shape and concentration",
      icon: BarChart3,
      accent: "from-amber-500/25 to-orange-500/10",
      narrative:
        categoryMetrics[0]
          ? `${categoryMetrics[0].name} is ${categoryMetrics[0].dominanceShare >= 55 ? "highly concentrated" : categoryMetrics[0].dominanceShare >= 35 ? "moderately concentrated" : "fairly distributed"}, with ${categoryMetrics[0].topValues[0]?.label ?? "the leading group"} covering ${formatPercent(categoryMetrics[0].dominanceShare)} of populated rows. ` +
            `${numericMetrics[0] ? `${numericMetrics[0].name} keeps its middle 50% between ${formatMetricValue(numericMetrics[0].q1)} and ${formatMetricValue(numericMetrics[0].q3)}, which frames the core band of everyday values.` : ""}`
          : numericMetrics[0]
            ? `${numericMetrics[0].name} places its central mass between ${formatMetricValue(numericMetrics[0].q1)} and ${formatMetricValue(numericMetrics[0].q3)}, which is the cleanest read on spread without letting extremes dominate the story.`
            : "Distribution analysis is limited because neither numeric metrics nor low-cardinality category fields were available.",
      bullets: categoryMetrics.length > 0
        ? categoryMetrics.map((metric) => {
            const topValue = metric.topValues[0];
            return `${metric.name}: ${metric.distinctCount} distinct values, led by ${topValue?.label ?? "—"} at ${formatPercent(topValue?.share ?? 0)}`;
          })
        : numericMetrics.length > 0
          ? numericMetrics.map((metric) => `${metric.name}: Q1 ${formatMetricValue(metric.q1)}, median ${formatMetricValue(metric.median)}, Q3 ${formatMetricValue(metric.q3)}`)
          : ["No distribution-friendly columns were detected."],
      visual: distributionVisual,
    },
    {
      id: "correlations",
      title: "Correlations",
      kicker: "Linked movement",
      icon: GitCompareArrows,
      accent: "from-cyan-500/25 to-teal-500/10",
      narrative:
        strongestCorrelation
          ? `${strongestCorrelation.left} and ${strongestCorrelation.right} show a ${describeCorrelation(strongestCorrelation.correlation)} relationship at ${strongestCorrelation.correlation.toFixed(2)}. ` +
            `That signal is backed by ${formatNumber(strongestCorrelation.pairCount)} overlapping rows, which is enough to treat the pairing as a real modeling or de-duplication candidate.`
          : "No numeric pair was strong enough to stand out, so the dataset reads as relatively independent across its main measures.",
      bullets: correlations.length > 0
        ? correlations.map(
            (pair) =>
              `${pair.left} ↔ ${pair.right}: r = ${pair.correlation.toFixed(2)} across ${formatNumber(pair.pairCount)} rows`,
          )
        : ["No stable Pearson relationships were detected among the leading numeric columns."],
      visual: correlationVisual,
    },
    {
      id: "outliers",
      title: "Outliers",
      kicker: "Extremes and anomalies",
      icon: AlertTriangle,
      accent: "from-rose-500/25 to-red-500/10",
      narrative:
        topOutliers[0]
          ? `${topOutliers[0].name} carries the heaviest anomaly footprint, with ${formatNumber(topOutliers[0].outlierCount)} points outside its Tukey fences. ` +
            `${topOutliers[0].outlierRate >= 5 ? "That density is high enough to influence dashboard averages and warrant segmentation." : "The rate is noticeable but still more diagnostic than dominant."}`
          : "The leading numeric columns do not show a large Tukey-fence outlier burden, which lowers the odds that a few extreme rows are driving the overall picture.",
      bullets: topOutliers.length > 0
        ? topOutliers.map(
            (metric) =>
              `${metric.name}: ${formatNumber(metric.outlierCount)} outliers (${formatPercent(metric.outlierRate)})`,
          )
        : ["No numeric column exceeded the outlier threshold used in the first-pass scan."],
      visual: outlierVisual,
    },
    {
      id: "recommendations",
      title: "Recommendations",
      kicker: "What to do next",
      icon: Lightbulb,
      accent: "from-indigo-500/25 to-cyan-500/10",
      narrative:
        `${nullHeavyColumns[0] ? `Start with ${nullHeavyColumns[0].name}, because missingness is the clearest trust drag. ` : ""}` +
        `${strongestCorrelation ? `Treat ${strongestCorrelation.left} and ${strongestCorrelation.right} as a linked pair in dashboards or feature engineering. ` : ""}` +
        `${topOutliers[0] ? `Use medians, percentile bands, or segmented views when reporting ${topOutliers[0].name}.` : "Current spread looks stable enough for ordinary mean-based reporting."}`,
      bullets: [
        nullHeavyColumns[0]
          ? `Remediate ${nullHeavyColumns[0].name}; ${formatPercent((nullHeavyColumns[0].nullCount / Math.max(rowCount, 1)) * 100)} of rows are missing`
          : "Preserve current ingestion quality; missingness is not concentrated in a single field.",
        strongestCorrelation
          ? `Chart ${strongestCorrelation.left} against ${strongestCorrelation.right} before adding both to the same scorecard`
          : "Look for non-linear or segmented relationships if pairwise Pearson coefficients stay quiet.",
        topOutliers[0]
          ? `Add a robust outlier-handling rule for ${topOutliers[0].name} before automated reporting`
          : "Proceed with ordinary aggregation, but keep range and percentile context visible.",
      ],
      visual: recommendationVisual,
    },
  ];

  return {
    qualityScore: quality.overallScore,
    completeness,
    sections,
  };
}

async function loadNarrativeReport(
  tableName: string,
  columns: ColumnProfile[],
  rowCount: number,
): Promise<NarrativeReport> {
  const numericTargets = pickNumericTargets(columns, rowCount);
  const categoryTargets = pickCategoryTargets(columns, rowCount);
  const dateTarget = [...columns]
    .filter((column) => column.type === "date")
    .sort((left, right) => left.nullCount - right.nullCount)[0];

  const [numericMetrics, categoryMetrics, temporalMetric, correlations] = await Promise.all([
    Promise.all(numericTargets.map((column) => loadNumericMetric(tableName, column.name, rowCount))),
    Promise.all(categoryTargets.map((column) => loadCategoryMetric(tableName, column.name))),
    dateTarget ? loadTemporalMetric(tableName, dateTarget.name) : Promise.resolve<TemporalNarrativeMetric | null>(null),
    loadCorrelationMetrics(tableName, numericTargets.map((column) => column.name)),
  ]);

  return buildNarrativeReport(columns, rowCount, numericMetrics, categoryMetrics, temporalMetric, correlations);
}

function DataNarratorLoading() {
  return (
    <div className={`${PANEL_CLASS} flex min-h-[36rem] items-center justify-center`}>
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        Generating narrative sections…
      </div>
    </div>
  );
}

function DataNarratorReady({ tableName, columns, rowCount }: DataNarratorProps) {
  const dark = useDarkMode();
  const [activeSectionId, setActiveSectionId] = useState<NarrativeSection["id"]>("intro");
  const sectionNodes = useRef(new Map<NarrativeSection["id"], HTMLElement>());

  const reportPromise = useMemo(
    () =>
      loadNarrativeReport(tableName, columns, rowCount).catch((error) => ({
        qualityScore: 0,
        completeness: 0,
        sections: [
          {
            id: "intro" as const,
            title: "Introduction",
            kicker: "Narrative generation failed",
            icon: FileText,
            accent: "from-rose-500/25 to-red-500/10",
            narrative: error instanceof Error ? error.message : "Unable to generate the narrative report.",
            bullets: ["Try refreshing after the dataset finishes profiling."],
            visual: null,
          },
          {
            id: "metrics" as const,
            title: "Key Metrics",
            kicker: "Unavailable",
            icon: Sigma,
            accent: "from-slate-500/25 to-slate-400/10",
            narrative: "The analysis pipeline returned early.",
            bullets: ["No metric summary available."],
            visual: null,
          },
          {
            id: "distributions" as const,
            title: "Distributions",
            kicker: "Unavailable",
            icon: BarChart3,
            accent: "from-slate-500/25 to-slate-400/10",
            narrative: "The analysis pipeline returned early.",
            bullets: ["No distribution summary available."],
            visual: null,
          },
          {
            id: "correlations" as const,
            title: "Correlations",
            kicker: "Unavailable",
            icon: GitCompareArrows,
            accent: "from-slate-500/25 to-slate-400/10",
            narrative: "The analysis pipeline returned early.",
            bullets: ["No correlation summary available."],
            visual: null,
          },
          {
            id: "outliers" as const,
            title: "Outliers",
            kicker: "Unavailable",
            icon: AlertTriangle,
            accent: "from-slate-500/25 to-slate-400/10",
            narrative: "The analysis pipeline returned early.",
            bullets: ["No outlier summary available."],
            visual: null,
          },
          {
            id: "recommendations" as const,
            title: "Recommendations",
            kicker: "Unavailable",
            icon: Lightbulb,
            accent: "from-slate-500/25 to-slate-400/10",
            narrative: "The analysis pipeline returned early.",
            bullets: ["No recommendations available."],
            visual: null,
          },
        ],
      })),
    [columns, rowCount, tableName],
  );

  const report = use(reportPromise);

  const setSectionRef = useCallback(
    (id: NarrativeSection["id"]) => (node: HTMLElement | null) => {
      if (node) {
        sectionNodes.current.set(id, node);
      } else {
        sectionNodes.current.delete(id);
      }
    },
    [],
  );

  const scrollToSection = useCallback((id: NarrativeSection["id"]) => {
    const node = sectionNodes.current.get(id);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
    startTransition(() => setActiveSectionId(id));
  }, []);

  const exportHtml = useCallback(() => {
    const html = buildNarratorHtml(tableName, report, rowCount, columns.length);
    downloadFile(html, `${tableName}-narrative-report.html`, "text/html;charset=utf-8;");
  }, [columns.length, report, rowCount, tableName]);

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: EASE }}
        className={`${PANEL_CLASS} overflow-hidden`}
      >
        <div className="border-b border-white/15 px-6 py-6 dark:border-white/10">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
                <FileText className="h-3.5 w-3.5" />
                Data narrator
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                Section-by-section narrative for {tableName}
              </h2>
              <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
                Every section is generated from live DuckDB queries, column profiles, and
                rule-based interpretation so the story stays close to the actual data.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-2xl border border-white/15 bg-white/45 px-4 py-3 dark:bg-slate-950/35">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Quality score
                </div>
                <div className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                  {report.qualityScore}/100
                </div>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/45 px-4 py-3 dark:bg-slate-950/35">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Completeness
                </div>
                <div className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                  {formatPercent(report.completeness)}
                </div>
              </div>
              <button
                type="button"
                onClick={exportHtml}
                className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-700 transition hover:bg-cyan-500/15 dark:text-cyan-300"
              >
                <ArrowDownToLine className="h-4 w-4" />
                Export HTML report
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="flex flex-wrap gap-2">
            {report.sections.map((section) => {
              const active = activeSectionId === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => scrollToSection(section.id)}
                  className={`${NAV_BUTTON_CLASS} ${
                    active
                      ? "border-cyan-400/35 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200"
                      : ""
                  }`}
                >
                  {section.title}
                </button>
              );
            })}
          </div>
        </div>
      </motion.section>

      <div className="grid gap-5">
        {report.sections.map((section) => {
          const Icon = section.icon;
          const option = section.visual ? buildVisualOption(section.visual, dark) : null;
          return (
            <motion.section
              key={section.id}
              ref={setSectionRef(section.id)}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.38, ease: EASE }}
              className={`${PANEL_CLASS} scroll-mt-28 p-5`}
            >
              <div className="grid gap-5 xl:grid-cols-[1.06fr_0.94fr]">
                <div>
                  <div className={`inline-flex rounded-2xl bg-gradient-to-br p-[1px] ${section.accent}`}>
                    <div className="rounded-[15px] bg-white/85 p-2.5 dark:bg-slate-950/75">
                      <Icon className="h-4 w-4 text-slate-700 dark:text-slate-200" />
                    </div>
                  </div>
                  <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    {section.kicker}
                  </div>
                  <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                    {section.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
                    {section.narrative}
                  </p>
                  <div className="mt-4 space-y-2">
                    {section.bullets.map((bullet) => (
                      <div
                        key={bullet}
                        className="rounded-2xl border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/35 dark:text-slate-200"
                      >
                        {bullet}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
                  {option ? (
                    <>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        {section.visual?.title}
                      </div>
                      <ReactEChartsCore
                        echarts={echarts}
                        option={option}
                        notMerge
                        lazyUpdate
                        style={{ height: 240 }}
                      />
                    </>
                  ) : (
                    <div className="flex h-[240px] items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                      No embedded mini-chart for this section.
                    </div>
                  )}
                </div>
              </div>
            </motion.section>
          );
        })}
      </div>
    </div>
  );
}

export default function DataNarrator({
  tableName,
  columns,
  rowCount,
}: DataNarratorProps) {
  return (
    <Suspense fallback={<DataNarratorLoading />}>
      <DataNarratorReady tableName={tableName} columns={columns} rowCount={rowCount} />
    </Suspense>
  );
}
