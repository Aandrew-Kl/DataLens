"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Database,
  Download,
  Hash,
  Link2,
  Loader2,
  Sparkles,
  ToggleLeft,
  Type,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataProfilerAIProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

type InsightTone = "good" | "watch" | "info";

interface ColumnSummary {
  columnName: string;
  qualityScore: number;
  summary: string;
  cleaningSuggestions: string[];
  chartSuggestions: string[];
}

interface Finding {
  id: string;
  title: string;
  summary: string;
  detail: string;
  tone: InsightTone;
  icon: LucideIcon;
}

interface CorrelationInsight {
  left: string;
  right: string;
  coefficient: number;
  summary: string;
}

interface PatternInsight {
  metric: string;
  summary: string;
}

interface ProfileResult {
  overallScore: number;
  keyFindings: Finding[];
  columnSummaries: ColumnSummary[];
  correlations: CorrelationInsight[];
  patterns: PatternInsight[];
  markdown: string;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const CARD =
  "rounded-3xl border border-white/15 bg-white/10 shadow-[0_22px_70px_-40px_rgba(15,23,42,0.85)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/40";
function readNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function buildTypeConsistencyQuery(tableName: string, columns: ColumnProfile[]): string | null {
  const typedColumns = columns.filter(
    (column) => column.type === "number" || column.type === "date" || column.type === "boolean",
  );

  if (typedColumns.length === 0) {
    return null;
  }

  return typedColumns
    .map((column) => {
      const identifier = quoteIdentifier(column.name);
      const safeName = column.name.replaceAll("'", "''");
      const expectedType =
        column.type === "number"
          ? "DOUBLE"
          : column.type === "date"
            ? "TIMESTAMP"
            : "BOOLEAN";

      return `SELECT
        '${safeName}' AS column_name,
        COUNT(*) FILTER (
          WHERE ${identifier} IS NOT NULL AND TRY_CAST(${identifier} AS ${expectedType}) IS NULL
        ) AS invalid_count
      FROM ${quoteIdentifier(tableName)}`;
    })
    .join(" UNION ALL ");
}

function buildOutlierQuery(tableName: string, columns: ColumnProfile[]): string | null {
  const numericColumns = columns.filter((column) => column.type === "number");
  if (numericColumns.length === 0) {
    return null;
  }

  return numericColumns
    .map((column) => {
      const identifier = quoteIdentifier(column.name);
      const safeName = column.name.replaceAll("'", "''");
      return `WITH values AS (
        SELECT TRY_CAST(${identifier} AS DOUBLE) AS value
        FROM ${quoteIdentifier(tableName)}
        WHERE ${identifier} IS NOT NULL
      ),
      bounds AS (
        SELECT QUANTILE_CONT(value, 0.25) AS q1, QUANTILE_CONT(value, 0.75) AS q3 FROM values
      )
      SELECT
        '${safeName}' AS column_name,
        COUNT(*) FILTER (
          WHERE value < bounds.q1 - (1.5 * (bounds.q3 - bounds.q1))
             OR value > bounds.q3 + (1.5 * (bounds.q3 - bounds.q1))
        ) AS outlier_count
      FROM values, bounds`;
    })
    .join(" UNION ALL ");
}

function buildBooleanQuery(tableName: string, columns: ColumnProfile[]): string | null {
  const booleanColumns = columns.filter((column) => column.type === "boolean");
  if (booleanColumns.length === 0) {
    return null;
  }

  return booleanColumns
    .map((column) => {
      const identifier = quoteIdentifier(column.name);
      const safeName = column.name.replaceAll("'", "''");
      return `SELECT
        '${safeName}' AS column_name,
        COUNT(*) FILTER (WHERE ${identifier} = TRUE) AS true_count,
        COUNT(*) FILTER (WHERE ${identifier} = FALSE) AS false_count
      FROM ${quoteIdentifier(tableName)}`;
    })
    .join(" UNION ALL ");
}

function buildDateQuery(tableName: string, columns: ColumnProfile[]): string | null {
  const dateColumns = columns.filter((column) => column.type === "date");
  if (dateColumns.length === 0) {
    return null;
  }

  return dateColumns
    .map((column) => {
      const identifier = quoteIdentifier(column.name);
      const safeName = column.name.replaceAll("'", "''");
      return `SELECT
        '${safeName}' AS column_name,
        MIN(TRY_CAST(${identifier} AS TIMESTAMP))::VARCHAR AS min_value,
        MAX(TRY_CAST(${identifier} AS TIMESTAMP))::VARCHAR AS max_value,
        COUNT(DISTINCT DATE_TRUNC('month', TRY_CAST(${identifier} AS TIMESTAMP))) AS period_count
      FROM ${quoteIdentifier(tableName)}
      WHERE ${identifier} IS NOT NULL`;
    })
    .join(" UNION ALL ");
}

function buildCorrelationQuery(tableName: string, columns: ColumnProfile[]): string | null {
  const numericColumns = columns.filter((column) => column.type === "number").slice(0, 6);
  if (numericColumns.length < 2) {
    return null;
  }

  const pairs: Array<[ColumnProfile, ColumnProfile]> = [];
  for (let leftIndex = 0; leftIndex < numericColumns.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < numericColumns.length; rightIndex += 1) {
      pairs.push([numericColumns[leftIndex], numericColumns[rightIndex]]);
    }
  }

  return pairs
    .map(([left, right]) => {
      const safeLeft = left.name.replaceAll("'", "''");
      const safeRight = right.name.replaceAll("'", "''");

      return `SELECT
        '${safeLeft}' AS left_column,
        '${safeRight}' AS right_column,
        CORR(TRY_CAST(${quoteIdentifier(left.name)} AS DOUBLE), TRY_CAST(${quoteIdentifier(right.name)} AS DOUBLE)) AS coefficient
      FROM ${quoteIdentifier(tableName)}
      WHERE ${quoteIdentifier(left.name)} IS NOT NULL AND ${quoteIdentifier(right.name)} IS NOT NULL`;
    })
    .join(" UNION ALL ");
}

function chartSuggestionsForColumn(column: ColumnProfile, companionDate?: string, companionCategory?: string): string[] {
  if (column.type === "number") {
    return [companionDate ? "line chart" : "histogram", "box plot", companionCategory ? "bar chart" : "scatter plot"];
  }

  if (column.type === "date") {
    return ["timeline", "line chart", "area trend"];
  }

  if (column.type === "boolean") {
    return ["stacked bar", "pie chart", "funnel"];
  }

  return column.uniqueCount <= 12 ? ["bar chart", "pie chart", "top-N ranking"] : ["horizontal bar", "word frequency table", "waterfall with grouping"];
}

function buildMarkdown(
  tableName: string,
  overallScore: number,
  keyFindings: Finding[],
  columnSummaries: ColumnSummary[],
  correlations: CorrelationInsight[],
  patterns: PatternInsight[],
): string {
  return [
    `# DataLens profile for \`${tableName}\``,
    "",
    `- Overall data quality score: **${overallScore}/100**`,
    `- Columns analyzed: **${columnSummaries.length}**`,
    "",
    "## Key findings",
    ...keyFindings.map((finding) => `- **${finding.title}**: ${finding.summary}`),
    "",
    "## Column summaries",
    ...columnSummaries.flatMap((summary) => [
      `### ${summary.columnName}`,
      `- Quality score: **${summary.qualityScore}/100**`,
      `- Summary: ${summary.summary}`,
      `- Cleaning: ${summary.cleaningSuggestions.join("; ") || "No urgent cleaning steps suggested."}`,
      `- Chart ideas: ${summary.chartSuggestions.join(", ")}`,
      "",
    ]),
    "## Correlations",
    ...(correlations.length > 0
      ? correlations.map(
          (correlation) =>
            `- **${correlation.left} ↔ ${correlation.right}** (${correlation.coefficient.toFixed(2)}): ${correlation.summary}`,
        )
      : ["- No strong numeric correlations detected."]),
    "",
    "## Temporal patterns",
    ...(patterns.length > 0
      ? patterns.map((pattern) => `- **${pattern.metric}**: ${pattern.summary}`)
      : ["- No clear trend or seasonality signal was strong enough to report."]),
  ].join("\n");
}

async function loadTimePatterns(tableName: string, columns: ColumnProfile[]): Promise<PatternInsight[]> {
  const dateColumn = columns.find((column) => column.type === "date");
  const numericColumns = columns.filter((column) => column.type === "number").slice(0, 3);

  if (!dateColumn || numericColumns.length === 0) {
    return [];
  }

  const patterns = await Promise.all(
    numericColumns.map(async (metric) => {
      const rows = await runQuery(`
        WITH series AS (
          SELECT
            DATE_TRUNC('month', TRY_CAST(${quoteIdentifier(dateColumn.name)} AS TIMESTAMP)) AS bucket,
            AVG(TRY_CAST(${quoteIdentifier(metric.name)} AS DOUBLE)) AS metric_value
          FROM ${quoteIdentifier(tableName)}
          WHERE ${quoteIdentifier(dateColumn.name)} IS NOT NULL
            AND ${quoteIdentifier(metric.name)} IS NOT NULL
          GROUP BY 1
          ORDER BY 1 ASC
          LIMIT 36
        )
        SELECT bucket::VARCHAR AS bucket_label, metric_value FROM series
      `);

      const values = rows.map((row) => readNumber(row.metric_value)).filter((value) => Number.isFinite(value));
      if (values.length < 4) {
        return null;
      }

      const first = values[0];
      const last = values[values.length - 1];
      const spread = Math.max(...values) - Math.min(...values) || Math.max(Math.abs(first), 1);
      const normalizedDelta = (last - first) / Math.max(spread, 1);
      const trend =
        normalizedDelta > 0.22 ? "upward" : normalizedDelta < -0.22 ? "downward" : "flat";

      const monthGroups = new Map<number, number[]>();
      rows.forEach((row) => {
        const parsed = new Date(String(row.bucket_label ?? ""));
        if (Number.isNaN(parsed.getTime())) {
          return;
        }

        const month = parsed.getUTCMonth();
        const group = monthGroups.get(month) ?? [];
        group.push(readNumber(row.metric_value));
        monthGroups.set(month, group);
      });

      const monthlyAverages = Array.from(monthGroups.values()).map(
        (group) => group.reduce((total, value) => total + value, 0) / group.length,
      );
      const meanValue = values.reduce((total, value) => total + value, 0) / values.length;
      const seasonalAmplitude =
        monthlyAverages.length > 1
          ? (Math.max(...monthlyAverages) - Math.min(...monthlyAverages)) / Math.max(Math.abs(meanValue), 1)
          : 0;

      const hasSeasonality = seasonalAmplitude > 0.16 && rows.length >= 12;

      return {
        metric: metric.name,
        summary:
          trend === "flat" && !hasSeasonality
            ? `${metric.name} looks comparatively stable over time, without a strong trend or repeating seasonal swing.`
            : `${metric.name} shows a ${trend} trend${hasSeasonality ? " plus a visible seasonal cycle" : ""} when grouped by month.`,
      } satisfies PatternInsight;
    }),
  );

  return patterns.filter((pattern): pattern is PatternInsight => Boolean(pattern));
}

async function profileDataset(
  tableName: string,
  columns: ColumnProfile[],
  rowCount: number,
): Promise<ProfileResult> {
  const [typeRows, outlierRows, booleanRows, dateRows, correlationRows, patterns] = await Promise.all([
    buildTypeConsistencyQuery(tableName, columns)
      ? runQuery(buildTypeConsistencyQuery(tableName, columns) ?? "")
      : Promise.resolve<Record<string, unknown>[]>([]),
    buildOutlierQuery(tableName, columns)
      ? runQuery(buildOutlierQuery(tableName, columns) ?? "")
      : Promise.resolve<Record<string, unknown>[]>([]),
    buildBooleanQuery(tableName, columns)
      ? runQuery(buildBooleanQuery(tableName, columns) ?? "")
      : Promise.resolve<Record<string, unknown>[]>([]),
    buildDateQuery(tableName, columns)
      ? runQuery(buildDateQuery(tableName, columns) ?? "")
      : Promise.resolve<Record<string, unknown>[]>([]),
    buildCorrelationQuery(tableName, columns)
      ? runQuery(buildCorrelationQuery(tableName, columns) ?? "")
      : Promise.resolve<Record<string, unknown>[]>([]),
    loadTimePatterns(tableName, columns),
  ]);

  const invalidByColumn = new Map<string, number>();
  typeRows.forEach((row) => invalidByColumn.set(String(row.column_name ?? ""), readNumber(row.invalid_count)));

  const outlierByColumn = new Map<string, number>();
  outlierRows.forEach((row) => outlierByColumn.set(String(row.column_name ?? ""), readNumber(row.outlier_count)));

  const booleanByColumn = new Map<string, { trueCount: number; falseCount: number }>();
  booleanRows.forEach((row) =>
    booleanByColumn.set(String(row.column_name ?? ""), {
      trueCount: readNumber(row.true_count),
      falseCount: readNumber(row.false_count),
    }),
  );

  const dateByColumn = new Map<string, { minValue: string; maxValue: string; periodCount: number }>();
  dateRows.forEach((row) =>
    dateByColumn.set(String(row.column_name ?? ""), {
      minValue: String(row.min_value ?? ""),
      maxValue: String(row.max_value ?? ""),
      periodCount: readNumber(row.period_count),
    }),
  );

  const categoricalCompanion = columns.find(
    (column) => (column.type === "string" || column.type === "boolean") && column.uniqueCount <= 24,
  )?.name;
  const dateCompanion = columns.find((column) => column.type === "date")?.name;

  const columnSummaries = columns.map((column) => {
    const nullRatio = rowCount === 0 ? 0 : column.nullCount / rowCount;
    const nonNullCount = Math.max(rowCount - column.nullCount, 0);
    const uniquenessRatio = nonNullCount <= 1 ? 1 : column.uniqueCount / nonNullCount;
    const invalidRatio = rowCount === 0 ? 0 : (invalidByColumn.get(column.name) ?? 0) / rowCount;
    const outlierRatio = rowCount === 0 ? 0 : (outlierByColumn.get(column.name) ?? 0) / rowCount;
    const qualityScore = clampScore(
      100 -
        Math.min(58, nullRatio * 64) -
        (/(_id$|^id$|key$|code$)/i.test(column.name) ? (1 - Math.min(uniquenessRatio, 1)) * 28 : 0) -
        Math.min(24, invalidRatio * 100),
    );

    const cleaningSuggestions: string[] = [];
    if (nullRatio >= 0.25) {
      cleaningSuggestions.push(
        nullRatio >= 0.8
          ? `Consider removing ${column.name}; it is mostly null.`
          : `Fill or backfill missing values in ${column.name}.`,
      );
    }
    if (invalidRatio >= 0.05) {
      cleaningSuggestions.push(`Normalize ${column.name} before casting to ${column.type}.`);
    }
    if (outlierRatio >= 0.05) {
      cleaningSuggestions.push(`Inspect ${column.name} for outliers before aggregation.`);
    }
    if (cleaningSuggestions.length === 0) {
      cleaningSuggestions.push(`No urgent cleaning action stands out for ${column.name}.`);
    }

    let summary = "";
    if (column.type === "number") {
      summary = `${column.name} is numeric, ranging from ${String(column.min ?? "n/a")} to ${String(column.max ?? "n/a")}, with ${formatPercent(nullRatio * 100)} nulls and ${formatPercent(outlierRatio * 100)} likely outliers.`;
    } else if (column.type === "date") {
      const range = dateByColumn.get(column.name);
      summary = `${column.name} spans ${range?.minValue || "n/a"} to ${range?.maxValue || "n/a"} across ${formatNumber(range?.periodCount ?? 0)} distinct monthly buckets.`;
    } else if (column.type === "boolean") {
      const balance = booleanByColumn.get(column.name);
      const total = (balance?.trueCount ?? 0) + (balance?.falseCount ?? 0);
      const trueRatio = total > 0 ? (balance?.trueCount ?? 0) / total : 0;
      summary = `${column.name} behaves like a binary flag with ${formatPercent(trueRatio * 100)} true values and ${formatPercent((1 - trueRatio) * 100)} false values.`;
    } else {
      summary = `${column.name} looks text-like, with ${formatNumber(column.uniqueCount)} distinct values and sample entries such as ${column.sampleValues.slice(0, 3).map((value) => String(value ?? "null")).join(", ") || "n/a"}.`;
    }

    return {
      columnName: column.name,
      qualityScore,
      summary,
      cleaningSuggestions,
      chartSuggestions: chartSuggestionsForColumn(column, dateCompanion, categoricalCompanion),
    } satisfies ColumnSummary;
  });

  const correlations = correlationRows
    .map((row) => ({
      left: String(row.left_column ?? ""),
      right: String(row.right_column ?? ""),
      coefficient: readNumber(row.coefficient),
      summary:
        Math.abs(readNumber(row.coefficient)) >= 0.8
          ? "These metrics move closely enough that one may explain or duplicate the other."
          : "This pair has a moderate relationship that is still worth visual inspection.",
    }))
    .filter((item) => Number.isFinite(item.coefficient) && Math.abs(item.coefficient) >= 0.55)
    .sort((left, right) => Math.abs(right.coefficient) - Math.abs(left.coefficient))
    .slice(0, 4);

  const bestColumn = [...columnSummaries].sort((left, right) => right.qualityScore - left.qualityScore)[0];
  const weakestColumn = [...columnSummaries].sort((left, right) => left.qualityScore - right.qualityScore)[0];
  const mostSparse = [...columns].sort((left, right) => right.nullCount - left.nullCount)[0];
  const worstOutlier = [...columns]
    .map((column) => ({ column, ratio: rowCount === 0 ? 0 : (outlierByColumn.get(column.name) ?? 0) / rowCount }))
    .sort((left, right) => right.ratio - left.ratio)[0];
  const strongestCorrelation = correlations[0];

  const overallScore =
    columnSummaries.length > 0
      ? clampScore(columnSummaries.reduce((total, summary) => total + summary.qualityScore, 0) / columnSummaries.length)
      : 0;

  const keyFindings = [
    bestColumn
      ? {
          id: "best-column",
          title: `${bestColumn.columnName} is the cleanest field`,
          summary: `${bestColumn.columnName} scored ${bestColumn.qualityScore}/100 and is the strongest candidate for immediate charting.`,
          detail: `${bestColumn.summary} Recommended charts: ${bestColumn.chartSuggestions.join(", ")}.`,
          tone: "good",
          icon: CheckCircle2,
        }
      : null,
    weakestColumn
      ? {
          id: "weakest-column",
          title: `${weakestColumn.columnName} needs the most cleanup`,
          summary: `${weakestColumn.columnName} scored ${weakestColumn.qualityScore}/100 and should be reviewed before model or dashboard use.`,
          detail: weakestColumn.cleaningSuggestions.join(" "),
          tone: "watch",
          icon: AlertTriangle,
        }
      : null,
    strongestCorrelation
      ? {
          id: "strongest-correlation",
          title: `Strongest correlation: ${strongestCorrelation.left} and ${strongestCorrelation.right}`,
          summary: `The top numeric relationship measured ${strongestCorrelation.coefficient.toFixed(2)}.`,
          detail: strongestCorrelation.summary,
          tone: "info",
          icon: Link2,
        }
      : null,
    mostSparse
      ? {
          id: "sparsest-column",
          title: `${mostSparse.name} is the sparsest field`,
          summary: `${mostSparse.name} is missing ${formatPercent(((rowCount === 0 ? 0 : mostSparse.nullCount / rowCount) * 100))} of its values.`,
          detail: `This directly lowers completeness and increases the chance of biased aggregates or failed joins.`,
          tone: "watch",
          icon: Database,
        }
      : null,
    worstOutlier && worstOutlier.ratio > 0
      ? {
          id: "worst-outlier-column",
          title: `${worstOutlier.column.name} has the densest outlier envelope`,
          summary: `${formatPercent(worstOutlier.ratio * 100)} of rows sit outside the IQR fence for ${worstOutlier.column.name}.`,
          detail: `Consider winsorization, trimming, or separate anomaly analysis before using this field in charts.`,
          tone: "watch",
          icon: Hash,
        }
      : null,
    patterns[0]
      ? {
          id: "time-pattern",
          title: `${patterns[0].metric} shows a notable temporal pattern`,
          summary: patterns[0].summary,
          detail: "This pattern came from monthly DuckDB rollups rather than an external AI model.",
          tone: "info",
          icon: Calendar,
        }
      : null,
  ]
    .filter((finding): finding is Finding => Boolean(finding))
    .slice(0, 5);

  const markdown = buildMarkdown(tableName, overallScore, keyFindings, columnSummaries, correlations, patterns);

  return {
    overallScore,
    keyFindings,
    columnSummaries,
    correlations,
    patterns,
    markdown,
  };
}

function SummaryStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className={`${CARD} px-4 py-3`}>
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">{value}</div>
      <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{detail}</div>
    </div>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const Icon = finding.icon;
  const toneClass =
    finding.tone === "good"
      ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : finding.tone === "watch"
        ? "border-amber-400/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-cyan-400/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      className={`${CARD} overflow-hidden p-5`}
    >
      <div className="flex items-start gap-4">
        <div className={`rounded-2xl border px-3 py-3 ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-slate-950 dark:text-slate-50">{finding.title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{finding.summary}</p>
          <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">{finding.detail}</p>
        </div>
      </div>
    </motion.article>
  );
}

export default function DataProfilerAI({ tableName, columns, rowCount }: DataProfilerAIProps) {
  const [result, setResult] = useState<ProfileResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const signature = useMemo(
    () =>
      `${tableName}:${rowCount}:${columns.map((column) => `${column.name}:${column.type}:${column.nullCount}:${column.uniqueCount}`).join("|")}`,
    [columns, rowCount, tableName],
  );

  useEffect(() => {
    let cancelled = false;

    async function runProfile(): Promise<void> {
      setLoading(true);
      setNotice(null);

      try {
        const nextResult = await profileDataset(tableName, columns, rowCount);
        if (!cancelled) {
          setResult(nextResult);
        }
      } catch (error) {
        if (!cancelled) {
          setNotice(error instanceof Error ? error.message : "Profiling failed.");
          setResult(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void runProfile();
    return () => {
      cancelled = true;
    };
  }, [columns, rowCount, signature, tableName]);

  async function exportMarkdown(): Promise<void> {
    if (!result) {
      return;
    }

    const blob = new Blob([result.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${tableName}-insights.md`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setNotice("Markdown export downloaded.");
  }

  return (
    <section className="overflow-hidden rounded-[30px] border border-white/15 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_30%),linear-gradient(135deg,rgba(248,250,252,0.92),rgba(226,232,240,0.75))] shadow-[0_30px_120px_-50px_rgba(15,23,42,0.9)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_26%),linear-gradient(135deg,rgba(2,6,23,0.94),rgba(15,23,42,0.88))]">
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
              <Sparkles className="h-3.5 w-3.5" />
              AI data profiler
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
              Rule-based dataset insights for {tableName}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              DuckDB-generated profiling catches outliers, correlations, type drift, trend signals, and chart opportunities without requiring Ollama or any external model.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className={`${CARD} px-4 py-3`}>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Rows</div>
              <div className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">{formatNumber(rowCount)}</div>
            </div>
            <div className={`${CARD} px-4 py-3`}>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Columns</div>
              <div className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">{columns.length}</div>
            </div>
            <button
              type="button"
              onClick={() => void exportMarkdown()}
              disabled={!result}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-white/15 disabled:opacity-60 dark:text-slate-200"
            >
              <Download className="h-4 w-4" />
              Export markdown
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-6 py-6">
        {loading ? (
          <div className={`${CARD} flex min-h-44 items-center justify-center gap-3 px-6 py-10 text-slate-600 dark:text-slate-300`}>
            <Loader2 className="h-5 w-5 animate-spin" />
            Profiling dataset with DuckDB queries...
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-800 dark:text-cyan-200">
            {notice}
          </div>
        ) : null}

        {result ? (
          <>
            <div className="grid gap-3 lg:grid-cols-4">
              <SummaryStat label="Quality score" value={`${result.overallScore}/100`} detail="Computed from null ratio, uniqueness, and type consistency." />
              <SummaryStat label="Key findings" value={String(result.keyFindings.length)} detail="Top rule-based facts ranked by analytical impact." />
              <SummaryStat label="Correlations" value={String(result.correlations.length)} detail="Strong numeric pairings worth charting or de-duplicating." />
              <SummaryStat label="Patterns" value={String(result.patterns.length)} detail="Trend and seasonality signals extracted from date buckets." />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {result.keyFindings.map((finding) => (
                <FindingCard key={finding.id} finding={finding} />
              ))}
            </div>

            <div className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
              <div className="space-y-5">
                <div className={`${CARD} p-5`}>
                  <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100">
                    <Link2 className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                    Correlation watchlist
                  </div>
                  <div className="space-y-3">
                    {result.correlations.length > 0 ? (
                      result.correlations.map((correlation) => (
                        <div key={`${correlation.left}-${correlation.right}`} className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 dark:bg-slate-950/35">
                          <div className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                            {correlation.left} ↔ {correlation.right}
                          </div>
                          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                            Correlation {correlation.coefficient.toFixed(2)}. {correlation.summary}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                        No strong numeric correlations cleared the reporting threshold.
                      </div>
                    )}
                  </div>
                </div>

                <div className={`${CARD} p-5`}>
                  <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-slate-100">
                    <Calendar className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                    Trend and seasonality scan
                  </div>
                  <div className="space-y-3">
                    {result.patterns.length > 0 ? (
                      result.patterns.map((pattern) => (
                        <div key={pattern.metric} className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 dark:bg-slate-950/35">
                          <div className="text-sm font-semibold text-slate-950 dark:text-slate-50">{pattern.metric}</div>
                          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{pattern.summary}</div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                        No date-plus-metric combination was strong enough to report a stable pattern.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-5">
                {result.columnSummaries.map((summary) => {
                  const column = columns.find((item) => item.name === summary.columnName);
                  const Icon =
                    column?.type === "number"
                      ? Hash
                      : column?.type === "date"
                        ? Calendar
                        : column?.type === "boolean"
                          ? ToggleLeft
                          : Type;

                  return (
                    <motion.article
                      key={summary.columnName}
                      layout
                      initial={{ opacity: 0, y: 18 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.28, ease: EASE }}
                      className={`${CARD} p-5`}
                    >
                      <div className="flex items-start gap-4">
                        <div className="rounded-2xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-3 text-cyan-700 dark:text-cyan-300">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold text-slate-950 dark:text-slate-50">{summary.columnName}</h3>
                            <span className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:bg-slate-950/35 dark:text-slate-400">
                              {summary.qualityScore}/100
                            </span>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{summary.summary}</p>
                          <div className="mt-4 grid gap-4 lg:grid-cols-2">
                            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 dark:bg-slate-950/35">
                              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
                                Cleaning suggestions
                              </div>
                              <div className="space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                {summary.cleaningSuggestions.map((suggestion) => (
                                  <div key={suggestion}>• {suggestion}</div>
                                ))}
                              </div>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 dark:bg-slate-950/35">
                              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                <Sparkles className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                                Suggested charts
                              </div>
                              <div className="space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                {summary.chartSuggestions.map((suggestion) => (
                                  <div key={suggestion}>• {suggestion}</div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.article>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
