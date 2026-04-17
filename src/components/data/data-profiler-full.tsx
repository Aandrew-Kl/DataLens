"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import {
  Suspense,
  startTransition,
  use,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart, HeatmapChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  BarChart3,
  CopyCheck,
  Database,
  Download,
  FileSearch,
  HardDrive,
  Loader2,
  ScanSearch,
  Sparkles,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([BarChart, HeatmapChart, GridComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

interface DataProfilerFullProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

interface Recommendation {
  column: string;
  message: string;
}

interface QualityBreakdown {
  completeness: number;
  uniqueness: number;
  typeConfidence: number;
  duplicatePenalty: number;
  overall: number;
}

interface CorrelationCell {
  left: string;
  right: string;
  value: number;
}

interface OverviewResult {
  memoryBytes: number;
  typeBreakdown: Record<string, number>;
  duplicateRows: number;
  correlations: CorrelationCell[];
  missingMatrix: Array<{ column: string; missingPct: number; missingCount: number }>;
  recommendations: Recommendation[];
  quality: QualityBreakdown;
}

interface ColumnFrequency {
  label: string;
  count: number;
}

interface ColumnDetailResult {
  distribution: ColumnFrequency[];
  topValues: ColumnFrequency[];
  bottomValues: ColumnFrequency[];
  lengthStats: {
    min: number;
    avg: number;
    max: number;
  };
  patterns: Array<{ label: string; count: number }>;
  recommendation: string;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";

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
function truncate(value: string, max = 28) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function estimateMemoryBytes(columns: ColumnProfile[], rowCount: number) {
  return columns.reduce((sum, column) => {
    if (column.type === "number" || column.type === "date") return sum + rowCount * 8;
    if (column.type === "boolean") return sum + rowCount;
    if (column.type === "string") {
      const averageLength =
        column.sampleValues.length > 0
          ? column.sampleValues.reduce<number>((total, value) => total + String(value ?? "").length, 0) /
            column.sampleValues.length
          : 12;
      return sum + rowCount * (averageLength + 12);
    }
    return sum + rowCount * 16;
  }, 0);
}

function buildTypeBreakdown(columns: ColumnProfile[]) {
  return columns.reduce<Record<string, number>>((accumulator, column) => {
    accumulator[column.type] = (accumulator[column.type] ?? 0) + 1;
    return accumulator;
  }, {});
}

function buildRecommendations(columns: ColumnProfile[], rowCount: number) {
  return columns.flatMap<Recommendation>((column) => {
    const nonNull = Math.max(rowCount - column.nullCount, 0);
    const suggestions: string[] = [];

    if (column.type === "unknown") suggestions.push("Add an explicit type cast or schema hint.");
    if (column.type === "string" && column.sampleValues.every((value) => /^\d+(\.\d+)?$/.test(String(value ?? "")))) {
      suggestions.push("This string field looks numeric and could be cast for analytics.");
    }
    if (column.type === "number" && nonNull > 0 && column.uniqueCount / nonNull < 0.05) {
      suggestions.push("Low-cardinality numeric values may work better as grouped categories.");
    }
    if (column.nullCount > rowCount * 0.2) suggestions.push("Null coverage is high; consider imputation or filtering.");
    if (column.type === "string" && column.sampleValues.some((value) => /@/.test(String(value ?? "")))) {
      suggestions.push("Contains email-like values; check masking and domain normalization.");
    }

    return suggestions.length > 0
      ? [{ column: column.name, message: suggestions.join(" ") }]
      : [];
  });
}

function buildQualityBreakdown(columns: ColumnProfile[], rowCount: number, duplicateRows: number): QualityBreakdown {
  const completeness =
    columns.length === 0 || rowCount === 0
      ? 0
      : columns.reduce((sum, column) => sum + (rowCount - column.nullCount) / Math.max(rowCount, 1), 0) /
        columns.length *
        100;
  const uniqueness =
    columns.length === 0 || rowCount === 0
      ? 0
      : columns.reduce((sum, column) => {
          const nonNull = Math.max(rowCount - column.nullCount, 1);
          return sum + Math.min(column.uniqueCount / nonNull, 1);
        }, 0) /
        columns.length *
        100;
  const typeConfidence =
    columns.length === 0
      ? 0
      : columns.filter((column) => column.type !== "unknown").length / columns.length * 100;
  const duplicatePenalty = rowCount === 0 ? 0 : Math.min(duplicateRows / rowCount, 1) * 100;
  const overall = Math.max(
    0,
    Math.round(completeness * 0.45 + uniqueness * 0.25 + typeConfidence * 0.2 + (100 - duplicatePenalty) * 0.1),
  );
  return {
    completeness,
    uniqueness,
    typeConfidence,
    duplicatePenalty,
    overall,
  };
}

async function loadOverview(
  tableName: string,
  columns: ColumnProfile[],
  rowCount: number,
): Promise<OverviewResult> {
  const memoryBytes = estimateMemoryBytes(columns, rowCount);
  const typeBreakdown = buildTypeBreakdown(columns);
  const missingMatrix = columns.map((column) => ({
    column: column.name,
    missingPct: rowCount === 0 ? 0 : (column.nullCount / rowCount) * 100,
    missingCount: column.nullCount,
  }));
  const recommendations = buildRecommendations(columns, rowCount);
  const numericColumns = columns.filter((column) => column.type === "number").map((column) => column.name).slice(0, 8);
  const duplicateQuery =
    columns.length === 0
      ? Promise.resolve<Record<string, unknown>[]>([{ duplicate_rows: 0 }])
      : runQuery(`
          SELECT COALESCE(SUM(group_count - 1), 0) AS duplicate_rows
          FROM (
            SELECT COUNT(*) AS group_count
            FROM ${quoteIdentifier(tableName)}
            GROUP BY ${columns.map((column) => quoteIdentifier(column.name)).join(", ")}
            HAVING COUNT(*) > 1
          ) duplicates
        `);

  const correlationQuery =
    numericColumns.length < 2
      ? Promise.resolve<Record<string, unknown>[]>([])
      : runQuery(
          numericColumns
            .flatMap((left, leftIndex) =>
              numericColumns.slice(leftIndex + 1).map(
                (right) => `
                  SELECT
                    '${left.replaceAll("'", "''")}' AS left_name,
                    '${right.replaceAll("'", "''")}' AS right_name,
                    CORR(TRY_CAST(${quoteIdentifier(left)} AS DOUBLE), TRY_CAST(${quoteIdentifier(right)} AS DOUBLE)) AS corr_value
                  FROM ${quoteIdentifier(tableName)}
                `,
              ),
            )
            .join(" UNION ALL "),
        );

  const [duplicateRowsResult, correlationRows] = await Promise.all([duplicateQuery, correlationQuery]);
  const duplicateRows = Number(duplicateRowsResult[0]?.duplicate_rows ?? 0);
  const correlations = numericColumns.flatMap<CorrelationCell>((left) =>
    numericColumns.map((right) => {
      if (left === right) return { left, right, value: 1 };
      const match = correlationRows.find(
        (row: Record<string, unknown>) =>
          (row.left_name === left && row.right_name === right) ||
          (row.left_name === right && row.right_name === left),
      );
      return {
        left,
        right,
        value: Number(match?.corr_value ?? 0),
      };
    }),
  );

  return {
    memoryBytes,
    typeBreakdown,
    duplicateRows,
    correlations,
    missingMatrix,
    recommendations,
    quality: buildQualityBreakdown(columns, rowCount, duplicateRows),
  };
}

function buildColumnRecommendation(column: ColumnProfile, patterns: Record<string, number>) {
  const nonNull = Math.max(column.sampleValues.length, 1);
  if (column.type === "unknown") return "Promote this field to an explicit type before downstream modeling.";
  if (column.type === "string" && patterns.email_like > 0) return "Email-like values detected; normalize domains and consider masking.";
  if (column.type === "string" && patterns.url_like > 0) return "URL-like values detected; extract hosts or paths into separate dimensions.";
  if (column.type === "number" && column.uniqueCount / Math.max(nonNull, 1) < 0.3) return "This numeric field may be better analyzed as a grouped categorical feature.";
  if (column.nullCount > 0) return "Missing values are present; assess whether imputation or exclusion is appropriate.";
  return "Column shape looks stable for exploratory analysis.";
}

async function loadColumnDetail(
  tableName: string,
  column: ColumnProfile,
): Promise<ColumnDetailResult> {
  const identifier = quoteIdentifier(column.name);
  const valueAsText = `CAST(${identifier} AS VARCHAR)`;

  const baseFrequencySql = `
    SELECT ${valueAsText} AS label, COUNT(*) AS count
    FROM ${quoteIdentifier(tableName)}
    WHERE ${identifier} IS NOT NULL
    GROUP BY 1
  `;

  const [topRows, bottomRows, lengthRows, patternRows, distributionRows] = await Promise.all([
    runQuery(`${baseFrequencySql} ORDER BY count DESC, label ASC LIMIT 8`),
    runQuery(`${baseFrequencySql} ORDER BY count ASC, label ASC LIMIT 8`),
    runQuery(`
      SELECT
        MIN(LENGTH(${valueAsText})) AS min_length,
        AVG(LENGTH(${valueAsText})) AS avg_length,
        MAX(LENGTH(${valueAsText})) AS max_length
      FROM ${quoteIdentifier(tableName)}
      WHERE ${identifier} IS NOT NULL
    `),
    runQuery(String.raw`
      WITH clean AS (
        SELECT ${valueAsText} AS value
        FROM ${quoteIdentifier(tableName)}
        WHERE ${identifier} IS NOT NULL
      )
      SELECT
        SUM(CASE WHEN TRIM(value) = '' THEN 1 ELSE 0 END) AS blank_like,
        SUM(CASE WHEN regexp_matches(value, '^[0-9]+$') THEN 1 ELSE 0 END) AS numeric_like,
        SUM(CASE WHEN regexp_matches(value, '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') THEN 1 ELSE 0 END) AS email_like,
        SUM(CASE WHEN regexp_matches(value, '^(https?://|www\.)') THEN 1 ELSE 0 END) AS url_like,
        SUM(CASE WHEN regexp_matches(value, '[A-Za-z]') AND regexp_matches(value, '[0-9]') THEN 1 ELSE 0 END) AS mixed_token
      FROM clean
    `),
    column.type === "number"
      ? runQuery(`
          WITH clean AS (
            SELECT TRY_CAST(${identifier} AS DOUBLE) AS metric
            FROM ${quoteIdentifier(tableName)}
            WHERE TRY_CAST(${identifier} AS DOUBLE) IS NOT NULL
          ),
          bucketed AS (
            SELECT NTILE(12) OVER (ORDER BY metric) AS bucket, metric
            FROM clean
          )
          SELECT
            CONCAT(ROUND(MIN(metric), 2), '–', ROUND(MAX(metric), 2)) AS label,
            COUNT(*) AS count
          FROM bucketed
          GROUP BY bucket
          ORDER BY bucket
        `)
      : column.type === "date"
        ? runQuery(`
            WITH clean AS (
              SELECT DATE_TRUNC('month', TRY_CAST(${identifier} AS TIMESTAMP)) AS bucket
              FROM ${quoteIdentifier(tableName)}
              WHERE TRY_CAST(${identifier} AS TIMESTAMP) IS NOT NULL
            )
            SELECT STRFTIME(bucket, '%Y-%m') AS label, COUNT(*) AS count
            FROM clean
            GROUP BY 1
            ORDER BY 1
            LIMIT 12
          `)
        : runQuery(`${baseFrequencySql} ORDER BY count DESC, label ASC LIMIT 10`),
  ]);

  const lengthRow = lengthRows[0] ?? {};
  const patternRow = patternRows[0] ?? {};
  const patterns = {
    blank_like: Number(patternRow.blank_like ?? 0),
    numeric_like: Number(patternRow.numeric_like ?? 0),
    email_like: Number(patternRow.email_like ?? 0),
    url_like: Number(patternRow.url_like ?? 0),
    mixed_token: Number(patternRow.mixed_token ?? 0),
  };

  return {
    distribution: distributionRows.map((row) => ({
      label: truncate(String((row as Record<string, unknown>).label ?? "Unknown")),
      count: Number((row as Record<string, unknown>).count ?? 0),
    })),
    topValues: topRows.map((row) => ({
      label: truncate(String((row as Record<string, unknown>).label ?? "Unknown")),
      count: Number((row as Record<string, unknown>).count ?? 0),
    })),
    bottomValues: bottomRows.map((row) => ({
      label: truncate(String((row as Record<string, unknown>).label ?? "Unknown")),
      count: Number((row as Record<string, unknown>).count ?? 0),
    })),
    lengthStats: {
      min: Number(lengthRow.min_length ?? 0),
      avg: Number(lengthRow.avg_length ?? 0),
      max: Number(lengthRow.max_length ?? 0),
    },
    patterns: [
      { label: "Blank-like", count: patterns.blank_like },
      { label: "Numeric-like", count: patterns.numeric_like },
      { label: "Email-like", count: patterns.email_like },
      { label: "URL-like", count: patterns.url_like },
      { label: "Mixed tokens", count: patterns.mixed_token },
    ],
    recommendation: buildColumnRecommendation(column, patterns),
  };
}

function buildHeatmapOption(
  labels: string[],
  cells: CorrelationCell[],
  dark: boolean,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  return {
    animationDuration: 500,
    tooltip: {
      position: "top",
      formatter: (params) => {
        const value = Array.isArray(params)
          ? params[0]
          : params;
        const payload = value as { data?: [number, number, number] };
        const x = payload.data?.[0] ?? 0;
        const y = payload.data?.[1] ?? 0;
        const corr = payload.data?.[2] ?? 0;
        return `${labels[y] ?? ""} × ${labels[x] ?? ""}: ${corr.toFixed(2)}`;
      },
    },
    grid: {
      left: 72,
      right: 20,
      top: 12,
      bottom: 60,
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { color: textColor, rotate: labels.length > 5 ? 28 : 0 },
    },
    yAxis: {
      type: "category",
      data: labels,
      axisLabel: { color: textColor },
    },
    visualMap: {
      min: -1,
      max: 1,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      inRange: {
        color: ["#0f172a", "#38bdf8", "#f8fafc", "#f59e0b", "#7f1d1d"],
      },
      textStyle: { color: textColor },
    },
    series: [
      {
        type: "heatmap",
        data: cells.map((cell) => [
          labels.indexOf(cell.right),
          labels.indexOf(cell.left),
          Number(cell.value.toFixed(3)),
        ]),
        label: {
          show: true,
          color: dark ? "#f8fafc" : "#0f172a",
          formatter: ({ data }) => String((data as [number, number, number])[2].toFixed(2)),
        },
      },
    ],
  };
}

function buildMissingMatrixOption(
  missing: Array<{ column: string; missingPct: number }>,
  dark: boolean,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  return {
    animationDuration: 420,
    tooltip: {
      formatter: (params) => {
        const payload = Array.isArray(params) ? params[0] : params;
        const data = payload as { data?: [number, number, number] };
        return `${missing[data.data?.[0] ?? 0]?.column ?? ""}: ${(data.data?.[2] ?? 0).toFixed(1)}% missing`;
      },
    },
    grid: {
      left: 60,
      right: 20,
      top: 18,
      bottom: 60,
    },
    xAxis: {
      type: "category",
      data: missing.map((entry) => entry.column),
      axisLabel: { color: textColor, rotate: missing.length > 5 ? 28 : 0 },
    },
    yAxis: {
      type: "category",
      data: ["Missing values"],
      axisLabel: { color: textColor },
    },
    visualMap: {
      min: 0,
      max: 100,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      inRange: {
        color: ["#22c55e", "#f59e0b", "#ef4444"],
      },
      textStyle: { color: textColor },
    },
    series: [
      {
        type: "heatmap",
        data: missing.map((entry, index) => [index, 0, Number(entry.missingPct.toFixed(2))]),
        label: {
          show: true,
          color: dark ? "#f8fafc" : "#0f172a",
          formatter: ({ data }) => `${(data as [number, number, number])[2].toFixed(0)}%`,
        },
      },
    ],
  };
}

function buildBarOption(rows: ColumnFrequency[], dark: boolean, title: string): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";
  return {
    animationDuration: 420,
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 20, right: 20, top: 44, bottom: 28, containLabel: true },
    xAxis: {
      type: "category",
      data: rows.map((row) => row.label),
      axisLabel: { color: textColor, rotate: rows.length > 5 ? 24 : 0 },
      axisLine: { lineStyle: { color: borderColor } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        name: title,
        type: "bar",
        data: rows.map((row) => row.count),
        itemStyle: {
          color: "#38bdf8",
          borderRadius: [10, 10, 0, 0],
        },
      },
    ],
  };
}

function buildExportHtml(
  tableName: string,
  rowCount: number,
  columns: ColumnProfile[],
  overview: OverviewResult,
  selectedColumn: string,
  detail: ColumnDetailResult,
) {
  const typeRows = Object.entries(overview.typeBreakdown)
    .map(([type, count]) => `<li><strong>${type}</strong>: ${count}</li>`)
    .join("");
  const recommendationRows = overview.recommendations
    .map((item) => `<li><strong>${item.column}</strong>: ${item.message}</li>`)
    .join("");
  const columnRows = columns
    .map(
      (column) =>
        `<tr><td>${column.name}</td><td>${column.type}</td><td>${column.nullCount}</td><td>${column.uniqueCount}</td></tr>`,
    )
    .join("");
  const detailRows = detail.topValues
    .map((item) => `<tr><td>${item.label}</td><td>${item.count}</td></tr>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${tableName} profiling report</title>
    <style>
      :root { color-scheme: dark; --bg:#060816; --panel:rgba(15,23,42,.78); --line:rgba(148,163,184,.18); --text:#e2e8f0; --muted:#94a3b8; --accent:#38bdf8; }
      body { margin:0; padding:28px; background:linear-gradient(180deg,#020617,#0f172a); color:var(--text); font-family:Inter, ui-sans-serif, system-ui, sans-serif; }
      .shell { max-width:1100px; margin:0 auto; display:grid; gap:18px; }
      .card { background:var(--panel); border:1px solid var(--line); border-radius:24px; padding:20px; }
      .grid { display:grid; gap:14px; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); }
      h1, h2 { margin:0 0 10px; }
      p, li { color:#d6e0ea; }
      ul { margin:0; padding-left:18px; }
      table { width:100%; border-collapse:collapse; margin-top:12px; }
      th, td { padding:10px; border-bottom:1px solid var(--line); text-align:left; font-size:14px; }
      .metric { font-size:32px; font-weight:700; }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="card">
        <h1>${tableName}</h1>
        <p>PDF-ready HTML export generated by DataLens comprehensive profiler.</p>
        <div class="grid">
          <div><div>Rows</div><div class="metric">${rowCount}</div></div>
          <div><div>Columns</div><div class="metric">${columns.length}</div></div>
          <div><div>Quality score</div><div class="metric">${overview.quality.overall}</div></div>
          <div><div>Duplicate rows</div><div class="metric">${overview.duplicateRows}</div></div>
        </div>
      </section>
      <section class="card">
        <h2>Structure summary</h2>
        <ul>${typeRows}</ul>
      </section>
      <section class="card">
        <h2>Recommendations</h2>
        <ul>${recommendationRows || "<li>No recommendations triggered.</li>"}</ul>
      </section>
      <section class="card">
        <h2>Selected column detail: ${selectedColumn}</h2>
        <p>${detail.recommendation}</p>
        <table>
          <thead><tr><th>Top value</th><th>Count</th></tr></thead>
          <tbody>${detailRows}</tbody>
        </table>
      </section>
      <section class="card">
        <h2>Column inventory</h2>
        <table>
          <thead><tr><th>Column</th><th>Type</th><th>Nulls</th><th>Unique</th></tr></thead>
          <tbody>${columnRows}</tbody>
        </table>
      </section>
    </div>
  </body>
</html>`;
}

function ProfilerLoading() {
  return (
    <div className={`${PANEL_CLASS} flex min-h-[30rem] items-center justify-center`}>
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading full profiling report…
      </div>
    </div>
  );
}

function DetailLoading() {
  return (
    <div className="flex min-h-[18rem] items-center justify-center rounded-3xl border border-white/15 bg-white/45 dark:bg-slate-950/35">
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        Profiling column…
      </div>
    </div>
  );
}

function ColumnDetailPanel({
  tableName,
  column,
}: {
  tableName: string;
  column: ColumnProfile;
}) {
  const dark = useDarkMode();
  const detailPromise = useMemo(
    () => loadColumnDetail(tableName, column),
    [column, tableName],
  );
  const detail = use(detailPromise);
  const distributionOption = useMemo(
    () => buildBarOption(detail.distribution, dark, "Distribution"),
    [dark, detail.distribution],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Distribution histogram
          </div>
          <ReactEChartsCore
            echarts={echarts}
            option={distributionOption}
            notMerge
            lazyUpdate
            style={{ height: 320 }}
          />
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Value lengths
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Min</div>
                <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{detail.lengthStats.min}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Avg</div>
                <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{detail.lengthStats.avg.toFixed(1)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Max</div>
                <div className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{detail.lengthStats.max}</div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Recommendation
            </div>
            <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">{detail.recommendation}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Top values
          </div>
          <div className="space-y-2">
            {detail.topValues.map((item) => (
              <div key={`top-${item.label}`} className="flex items-center justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-300">{item.label}</span>
                <span className="font-medium text-slate-950 dark:text-white">{formatNumber(item.count)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Bottom values
          </div>
          <div className="space-y-2">
            {detail.bottomValues.map((item) => (
              <div key={`bottom-${item.label}`} className="flex items-center justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-300">{item.label}</span>
                <span className="font-medium text-slate-950 dark:text-white">{formatNumber(item.count)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Pattern detection
          </div>
          <div className="space-y-2">
            {detail.patterns.map((item) => (
              <div key={item.label} className="flex items-center justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-300">{item.label}</span>
                <span className="font-medium text-slate-950 dark:text-white">{formatNumber(item.count)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FullProfilerReady({ tableName, columns, rowCount }: DataProfilerFullProps) {
  const dark = useDarkMode();
  const overviewPromise = useMemo(
    () => loadOverview(tableName, columns, rowCount),
    [columns, rowCount, tableName],
  );
  const overview = use(overviewPromise);
  const numericLabels = useMemo(
    () => Array.from(new Set(overview.correlations.map((cell) => cell.left))),
    [overview.correlations],
  );
  const [selectedColumn, setSelectedColumn] = useState(columns[0]?.name ?? "");
  const safeSelectedColumn = columns.some((column) => column.name === selectedColumn)
    ? selectedColumn
    : columns[0]?.name ?? "";
  const activeColumn = columns.find((column) => column.name === safeSelectedColumn) ?? columns[0];

  const correlationOption = useMemo(
    () => buildHeatmapOption(numericLabels, overview.correlations, dark),
    [dark, numericLabels, overview.correlations],
  );
  const missingMatrixOption = useMemo(
    () => buildMissingMatrixOption(overview.missingMatrix, dark),
    [dark, overview.missingMatrix],
  );

  async function handleExport() {
    if (!activeColumn) return;
    const detail = await loadColumnDetail(tableName, activeColumn);
    const html = buildExportHtml(tableName, rowCount, columns, overview, activeColumn.name, detail);
    downloadFile(html, `${tableName}-profile-report.html`, "text/html;charset=utf-8;");
  }

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: EASE }}
        className={`${PANEL_CLASS} p-5`}
      >
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
              <ScanSearch className="h-3.5 w-3.5" />
              Comprehensive auto-profiling
            </div>
            <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              Deep report for structure, quality, and distribution
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Review dataset health, duplicates, missingness, correlations, and per-column signals from a single panel.
            </p>
          </div>

          <div className="flex items-start justify-end">
            <button
              type="button"
              onClick={() => void handleExport()}
              className="rounded-2xl border border-white/20 bg-white/55 px-3 py-2 text-sm text-slate-600 transition hover:border-cyan-300/40 dark:bg-slate-950/35 dark:text-slate-200"
            >
              <span className="flex items-center gap-2">
                <Download className="h-4 w-4" />
                Export PDF-ready HTML
              </span>
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              <Database className="h-3.5 w-3.5" />
              Rows
            </div>
            <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">{formatNumber(rowCount)}</div>
          </div>
          <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              <BarChart3 className="h-3.5 w-3.5" />
              Columns
            </div>
            <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">{formatNumber(columns.length)}</div>
          </div>
          <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              <HardDrive className="h-3.5 w-3.5" />
              Memory estimate
            </div>
            <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">{formatNumber(overview.memoryBytes / 1024)} KB</div>
          </div>
          <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              <Sparkles className="h-3.5 w-3.5" />
              Quality score
            </div>
            <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">{overview.quality.overall}</div>
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className={`${PANEL_CLASS} p-5`}
      >
        <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
          <div className="space-y-4">
            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                Quality breakdown
              </div>
              {[
                ["Completeness", overview.quality.completeness],
                ["Uniqueness", overview.quality.uniqueness],
                ["Type confidence", overview.quality.typeConfidence],
                ["Duplicate penalty", 100 - overview.quality.duplicatePenalty],
              ].map(([label, value]) => (
                <div key={label} className="mb-3 last:mb-0">
                  <div className="mb-1 flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
                    <span>{label}</span>
                    <span>{Number(value).toFixed(1)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/60 dark:bg-slate-900/80">
                    <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.max(0, Math.min(Number(value), 100))}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <CopyCheck className="h-3.5 w-3.5" />
                Duplicate rows
              </div>
              <div className="text-3xl font-semibold text-slate-950 dark:text-white">{formatNumber(overview.duplicateRows)}</div>
            </div>

            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Data type breakdown
              </div>
              <div className="space-y-2">
                {Object.entries(overview.typeBreakdown).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-slate-600 dark:text-slate-300">{type}</span>
                    <span className="font-medium text-slate-950 dark:text-white">{formatNumber(count)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Correlations heatmap
              </div>
              {numericLabels.length > 1 ? (
                <ReactEChartsCore
                  echarts={echarts}
                  option={correlationOption}
                  notMerge
                  lazyUpdate
                  style={{ height: 340 }}
                />
              ) : (
                <div className="rounded-2xl border border-white/15 bg-white/55 px-4 py-6 text-sm text-slate-600 dark:bg-slate-950/35 dark:text-slate-300">
                  Add at least two numeric columns to render the correlation matrix.
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Missing values matrix
              </div>
              <ReactEChartsCore
                echarts={echarts}
                option={missingMatrixOption}
                notMerge
                lazyUpdate
                style={{ height: 240 }}
              />
            </div>
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: EASE }}
        className={`${PANEL_CLASS} p-5`}
      >
        <div className="grid gap-4 xl:grid-cols-[0.36fr_0.64fr]">
          <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              <FileSearch className="h-3.5 w-3.5" />
              Column navigator
            </div>
            <div className="space-y-2">
              {columns.map((column) => (
                <button
                  key={column.name}
                  type="button"
                  onClick={() => startTransition(() => setSelectedColumn(column.name))}
                  className={`w-full rounded-2xl border px-3 py-3 text-left text-sm transition ${
                    column.name === safeSelectedColumn
                      ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-700 dark:text-cyan-200"
                      : "border-white/15 bg-white/55 text-slate-600 dark:bg-slate-950/35 dark:text-slate-300"
                  }`}
                >
                  <div className="font-medium">{column.name}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.16em] opacity-80">{column.type}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            {activeColumn ? (
              <Suspense fallback={<DetailLoading />}>
                <ColumnDetailPanel tableName={tableName} column={activeColumn} />
              </Suspense>
            ) : (
              <div className="rounded-3xl border border-white/15 bg-white/45 px-4 py-6 text-sm text-slate-600 dark:bg-slate-950/35 dark:text-slate-300">
                No columns are available to profile.
              </div>
            )}
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.44, ease: EASE }}
        className={`${PANEL_CLASS} p-5`}
      >
        <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          Data type recommendations
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {overview.recommendations.length > 0 ? (
            overview.recommendations.map((item) => (
              <div key={`${item.column}-${item.message}`} className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
                <div className="font-semibold text-slate-950 dark:text-white">{item.column}</div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{item.message}</p>
              </div>
            ))
          ) : (
            <div className="rounded-3xl border border-white/15 bg-white/45 px-4 py-5 text-sm text-slate-600 dark:bg-slate-950/35 dark:text-slate-300">
              No type recommendations were triggered from the current profile.
            </div>
          )}
        </div>
      </motion.section>
    </div>
  );
}

export default function DataProfilerFull({ tableName, columns, rowCount }: DataProfilerFullProps) {
  return (
    <Suspense fallback={<ProfilerLoading />}>
      <FullProfilerReady tableName={tableName} columns={columns} rowCount={rowCount} />
    </Suspense>
  );
}
