"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Code2,
  Filter,
  Lightbulb,
  Loader2,
  Play,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import type { ColumnProfile } from "@/types/dataset";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";

/* ─── Types ─── */

interface AIInsightsProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

type InsightType =
  | "distribution"
  | "correlation"
  | "anomaly"
  | "completeness"
  | "cardinality"
  | "date"
  | "top_bottom";

type InsightSeverity = "info" | "warning" | "interesting";

interface Insight {
  id: string;
  type: InsightType;
  severity: InsightSeverity;
  title: string;
  description: string;
  sql: string;
}

/* ─── Constants ─── */

const TYPE_META: Record<
  InsightType,
  { label: string; Icon: React.ElementType }
> = {
  distribution: { label: "Distribution", Icon: BarChart3 },
  correlation: { label: "Correlation", Icon: TrendingUp },
  anomaly: { label: "Anomaly", Icon: AlertTriangle },
  completeness: { label: "Completeness", Icon: CheckCircle },
  cardinality: { label: "Cardinality", Icon: Lightbulb },
  date: { label: "Date", Icon: Lightbulb },
  top_bottom: { label: "Top / Bottom", Icon: TrendingUp },
};

const SEVERITY_STYLES: Record<InsightSeverity, string> = {
  info: "border-blue-200/60 bg-blue-500/10 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300",
  warning:
    "border-amber-200/60 bg-amber-500/10 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300",
  interesting:
    "border-purple-200/60 bg-purple-500/10 text-purple-700 dark:border-purple-500/20 dark:bg-purple-500/10 dark:text-purple-300",
};

const SEVERITY_ICON: Record<InsightSeverity, React.ElementType> = {
  info: CheckCircle,
  warning: AlertTriangle,
  interesting: Lightbulb,
};

/* ─── Helpers ─── */

function quoteId(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

let nextInsightId = 0;
function makeId(): string {
  nextInsightId += 1;
  return `insight-${nextInsightId}`;
}

/* ─── Insight generators ─── */

async function generateCompletenessInsights(
  table: string,
  columns: ColumnProfile[],
  rowCount: number,
): Promise<Insight[]> {
  const insights: Insight[] = [];
  const highNullCols = columns.filter(
    (c) => rowCount > 0 && c.nullCount / rowCount > 0.1,
  );

  if (highNullCols.length > 0) {
    const pctList = highNullCols
      .map((c) => `${c.name} (${((c.nullCount / rowCount) * 100).toFixed(1)}%)`)
      .join(", ");

    const sql = `SELECT\n${highNullCols
      .map(
        (c) =>
          `  ROUND(COUNT(*) FILTER (WHERE ${quoteId(c.name)} IS NULL) * 100.0 / COUNT(*), 1) AS "${c.name}_null_pct"`,
      )
      .join(",\n")}\nFROM ${quoteId(table)};`;

    insights.push({
      id: makeId(),
      type: "completeness",
      severity: highNullCols.some((c) => c.nullCount / rowCount > 0.5)
        ? "warning"
        : "info",
      title: `${highNullCols.length} column${highNullCols.length > 1 ? "s" : ""} have >10% null values`,
      description: `Columns with significant missing data: ${pctList}. Consider imputation or filtering.`,
      sql,
    });
  }

  return insights;
}

async function generateCardinalityInsights(
  table: string,
  columns: ColumnProfile[],
  rowCount: number,
): Promise<Insight[]> {
  const insights: Insight[] = [];

  for (const col of columns) {
    if (
      col.type !== "boolean" &&
      col.uniqueCount > 0 &&
      col.uniqueCount <= 10 &&
      rowCount > 20
    ) {
      const sql = `SELECT ${quoteId(col.name)}, COUNT(*) AS cnt\nFROM ${quoteId(table)}\nGROUP BY ${quoteId(col.name)}\nORDER BY cnt DESC;`;

      insights.push({
        id: makeId(),
        type: "cardinality",
        severity: "interesting",
        title: `${col.name} has only ${col.uniqueCount} unique value${col.uniqueCount > 1 ? "s" : ""}`,
        description: `With just ${col.uniqueCount} distinct values across ${formatNumber(rowCount)} rows, this column may be best treated as categorical.`,
        sql,
      });
    }
  }

  return insights;
}

async function generateDistributionInsights(
  table: string,
  columns: ColumnProfile[],
  rowCount: number,
): Promise<Insight[]> {
  const insights: Insight[] = [];
  const stringCols = columns.filter(
    (c) => c.type === "string" && c.uniqueCount > 1,
  );

  for (const col of stringCols.slice(0, 5)) {
    const sql = `SELECT ${quoteId(col.name)}, COUNT(*) AS cnt\nFROM ${quoteId(table)}\nWHERE ${quoteId(col.name)} IS NOT NULL\nGROUP BY ${quoteId(col.name)}\nORDER BY cnt DESC\nLIMIT 3;`;

    try {
      const rows = await runQuery(sql);
      if (rows.length >= 2) {
        const topTotal = rows.reduce(
          (sum, r) => sum + Number(r.cnt ?? 0),
          0,
        );
        const nonNull = rowCount - col.nullCount;
        const topPct = nonNull > 0 ? (topTotal / nonNull) * 100 : 0;

        if (topPct >= 70) {
          const topNames = rows
            .map((r) => String(r[col.name]))
            .join(", ");

          insights.push({
            id: makeId(),
            type: "distribution",
            severity: "interesting",
            title: `${col.name} is heavily skewed`,
            description: `Top ${rows.length} values (${topNames}) represent ${topPct.toFixed(0)}% of data.`,
            sql,
          });
        }
      }
    } catch {
      /* skip column on query error */
    }
  }

  return insights;
}

async function generateAnomalyInsights(
  table: string,
  columns: ColumnProfile[],
): Promise<Insight[]> {
  const insights: Insight[] = [];
  const numericCols = columns.filter((c) => c.type === "number");

  for (const col of numericCols.slice(0, 6)) {
    const sql = `WITH stats AS (\n  SELECT AVG(${quoteId(col.name)}) AS mu, STDDEV(${quoteId(col.name)}) AS sigma\n  FROM ${quoteId(table)}\n  WHERE ${quoteId(col.name)} IS NOT NULL\n)\nSELECT COUNT(*) AS outlier_count\nFROM ${quoteId(table)}, stats\nWHERE ${quoteId(col.name)} IS NOT NULL\n  AND ABS(${quoteId(col.name)} - mu) > 3 * sigma\n  AND sigma > 0;`;

    try {
      const rows = await runQuery(sql);
      const count = Number(rows[0]?.outlier_count ?? 0);

      if (count > 0) {
        insights.push({
          id: makeId(),
          type: "anomaly",
          severity: count >= 10 ? "warning" : "info",
          title: `${col.name} has ${count} extreme outlier${count > 1 ? "s" : ""}`,
          description: `${count} value${count > 1 ? "s" : ""} more than 3 standard deviations from the mean. These may indicate data entry errors or genuinely unusual observations.`,
          sql,
        });
      }
    } catch {
      /* skip column on query error */
    }
  }

  return insights;
}

async function generateCorrelationInsights(
  table: string,
  columns: ColumnProfile[],
): Promise<Insight[]> {
  const insights: Insight[] = [];
  const numericCols = columns.filter((c) => c.type === "number");

  for (let i = 0; i < Math.min(numericCols.length, 6); i++) {
    for (let j = i + 1; j < Math.min(numericCols.length, 6); j++) {
      const a = numericCols[i];
      const b = numericCols[j];

      const sql = `SELECT ROUND(CORR(${quoteId(a.name)}, ${quoteId(b.name)}), 4) AS r\nFROM ${quoteId(table)}\nWHERE ${quoteId(a.name)} IS NOT NULL\n  AND ${quoteId(b.name)} IS NOT NULL;`;

      try {
        const rows = await runQuery(sql);
        const r = Number(rows[0]?.r ?? 0);

        if (Math.abs(r) >= 0.75) {
          const direction = r > 0 ? "positively" : "negatively";
          insights.push({
            id: makeId(),
            type: "correlation",
            severity: "interesting",
            title: `${a.name} and ${b.name} are ${direction} correlated`,
            description: `Pearson r = ${r.toFixed(3)}. These columns ${r > 0 ? "increase together" : "move in opposite directions"}, suggesting a strong linear relationship.`,
            sql,
          });
        }
      } catch {
        /* skip pair on query error */
      }
    }
  }

  return insights;
}

async function generateDateInsights(
  table: string,
  columns: ColumnProfile[],
): Promise<Insight[]> {
  const insights: Insight[] = [];
  const dateCols = columns.filter((c) => c.type === "date");

  for (const col of dateCols.slice(0, 3)) {
    const sql = `SELECT\n  MIN(${quoteId(col.name)}) AS earliest,\n  MAX(${quoteId(col.name)}) AS latest,\n  COUNT(DISTINCT DATE_TRUNC('month', ${quoteId(col.name)}::TIMESTAMP)) AS months_present,\n  DATEDIFF('month', MIN(${quoteId(col.name)}::TIMESTAMP), MAX(${quoteId(col.name)}::TIMESTAMP)) + 1 AS total_months\nFROM ${quoteId(table)}\nWHERE ${quoteId(col.name)} IS NOT NULL;`;

    try {
      const rows = await runQuery(sql);
      const row = rows[0];
      if (!row) continue;

      const earliest = String(row.earliest ?? "").slice(0, 10);
      const latest = String(row.latest ?? "").slice(0, 10);
      const monthsPresent = Number(row.months_present ?? 0);
      const totalMonths = Number(row.total_months ?? 0);
      const gaps = totalMonths - monthsPresent;

      let description = `Data spans from ${earliest} to ${latest}.`;
      if (gaps > 0 && totalMonths > 1) {
        description += ` ${gaps} month${gaps > 1 ? "s" : ""} missing in this range.`;
      }

      insights.push({
        id: makeId(),
        type: "date",
        severity: gaps > 0 ? "warning" : "info",
        title: `${col.name} spans ${earliest} to ${latest}`,
        description,
        sql,
      });
    } catch {
      /* skip column on query error */
    }
  }

  return insights;
}

async function generateTopBottomInsights(
  table: string,
  columns: ColumnProfile[],
): Promise<Insight[]> {
  const insights: Insight[] = [];
  const numericCols = columns.filter(
    (c) => c.type === "number" && c.max !== undefined,
  );

  for (const col of numericCols.slice(0, 4)) {
    const sql = `SELECT ${quoteId(col.name)}\nFROM ${quoteId(table)}\nWHERE ${quoteId(col.name)} IS NOT NULL\nORDER BY ${quoteId(col.name)} DESC\nLIMIT 1;`;

    try {
      const rows = await runQuery(sql);
      const maxVal = Number(rows[0]?.[col.name] ?? 0);

      if (col.mean !== undefined && col.mean > 0) {
        const ratio = maxVal / col.mean;
        if (ratio >= 5) {
          insights.push({
            id: makeId(),
            type: "top_bottom",
            severity: "interesting",
            title: `Highest ${col.name} is ${formatNumber(maxVal)}`,
            description: `The maximum value is ${ratio.toFixed(1)}x the mean (${formatNumber(col.mean)}), indicating a large spread at the top of the distribution.`,
            sql,
          });
        }
      }
    } catch {
      /* skip column on query error */
    }
  }

  return insights;
}

/* ─── Insight Card ─── */

function InsightCard({
  insight,
  index,
}: {
  insight: Insight;
  index: number;
}) {
  const [sqlExpanded, setSqlExpanded] = useState(false);
  const [queryResult, setQueryResult] = useState<
    Record<string, unknown>[] | null
  >(null);
  const [queryRunning, setQueryRunning] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);

  const meta = TYPE_META[insight.type];
  const SeverityIcon = SEVERITY_ICON[insight.severity];

  async function handleRunQuery() {
    setQueryRunning(true);
    setQueryError(null);
    try {
      const rows = await runQuery(insight.sql);
      setQueryResult(rows);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : "Query failed");
    } finally {
      setQueryRunning(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.28 }}
      className="overflow-hidden rounded-2xl border border-gray-200/60 bg-white/70 dark:border-gray-700/70 dark:bg-gray-950/35"
    >
      <div className="p-5">
        {/* Badges */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${SEVERITY_STYLES[insight.severity]}`}
          >
            <SeverityIcon className="h-3 w-3" />
            {insight.severity.charAt(0).toUpperCase() +
              insight.severity.slice(1)}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200/60 bg-gray-100/80 px-2.5 py-0.5 text-[11px] font-medium text-gray-600 dark:border-gray-700/60 dark:bg-gray-800/60 dark:text-gray-400">
            <meta.Icon className="h-3 w-3" />
            {meta.label}
          </span>
        </div>

        {/* Title & description */}
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {insight.title}
        </h4>
        <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
          {insight.description}
        </p>

        {/* SQL toggle & run */}
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSqlExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200/60 bg-white/80 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700/60 dark:bg-gray-900/60 dark:text-gray-400 dark:hover:bg-gray-800/60"
          >
            <Code2 className="h-3.5 w-3.5" />
            {sqlExpanded ? "Hide SQL" : "Show SQL"}
            {sqlExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>

          <button
            type="button"
            onClick={() => void handleRunQuery()}
            disabled={queryRunning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200/60 bg-indigo-50/80 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
          >
            {queryRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Run Query
          </button>
        </div>
      </div>

      {/* Collapsible SQL */}
      <AnimatePresence initial={false}>
        {sqlExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-gray-200/60 dark:border-gray-800/70"
          >
            <pre className="overflow-x-auto bg-gray-50/80 px-5 py-4 text-xs leading-relaxed text-gray-700 dark:bg-gray-950/40 dark:text-gray-300 font-mono">
              {insight.sql}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Query result */}
      <AnimatePresence initial={false}>
        {queryError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-red-200/60 bg-red-50/80 px-5 py-3 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
          >
            {queryError}
          </motion.div>
        )}
        {queryResult && !queryError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-gray-200/60 dark:border-gray-800/70"
          >
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200/60 text-left text-xs dark:divide-gray-800/70">
                <thead className="bg-gray-50/80 dark:bg-gray-900/70">
                  <tr>
                    {queryResult.length > 0 &&
                      Object.keys(queryResult[0]).map((key) => (
                        <th
                          key={key}
                          className="px-4 py-2 font-semibold uppercase tracking-[0.15em] text-gray-500 dark:text-gray-400"
                        >
                          {key}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200/60 bg-white/80 dark:divide-gray-800/70 dark:bg-gray-950/25">
                  {queryResult.slice(0, 20).map((row, ri) => (
                    <tr key={ri}>
                      {Object.values(row).map((val, ci) => (
                        <td
                          key={ci}
                          className="whitespace-nowrap px-4 py-2 font-mono text-gray-700 dark:text-gray-300"
                        >
                          {val === null || val === undefined
                            ? "null"
                            : String(val)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {queryResult.length > 20 && (
              <p className="px-5 py-2 text-[11px] text-gray-400 dark:text-gray-500">
                Showing 20 of {queryResult.length} rows
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ─── Main component ─── */

export default function AIInsights({
  tableName,
  columns,
  rowCount,
}: AIInsightsProps) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<InsightType | "all">("all");

  const generateInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInsights([]);
    nextInsightId = 0;

    try {
      const batches = await Promise.all([
        generateCompletenessInsights(tableName, columns, rowCount),
        generateCardinalityInsights(tableName, columns, rowCount),
        generateDistributionInsights(tableName, columns, rowCount),
        generateAnomalyInsights(tableName, columns),
        generateCorrelationInsights(tableName, columns),
        generateDateInsights(tableName, columns),
        generateTopBottomInsights(tableName, columns),
      ]);

      setInsights(batches.flat());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate insights.",
      );
    } finally {
      setLoading(false);
    }
  }, [tableName, columns, rowCount]);

  useEffect(() => {
    void generateInsights();
  }, [generateInsights]);

  /* Derived values */
  const availableTypes = useMemo(() => {
    const types = new Set(insights.map((i) => i.type));
    return Array.from(types).sort();
  }, [insights]);

  const filteredInsights = useMemo(
    () =>
      activeFilter === "all"
        ? insights
        : insights.filter((i) => i.type === activeFilter),
    [insights, activeFilter],
  );

  /* ─── Render ─── */
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-gray-200/50 dark:border-gray-700/50 bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl p-6 shadow-xl shadow-slate-900/5"
    >
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">
            AI Insights
          </p>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Automated findings for{" "}
            <span className="text-indigo-600 dark:text-indigo-400">
              {tableName}
            </span>
          </h3>
          <p className="max-w-xl text-sm text-gray-600 dark:text-gray-400">
            Rule-based analysis across {columns.length} columns and{" "}
            {formatNumber(rowCount)} rows. Each insight includes its underlying
            SQL query for verification.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void generateInsights()}
          disabled={loading}
          className="inline-flex items-center gap-2 self-start rounded-full border border-gray-200/70 bg-white/80 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700/70 dark:bg-gray-950/40 dark:text-gray-200 dark:hover:bg-gray-900"
        >
          <RefreshCw
            className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
          />
          Refresh Insights
        </button>
      </div>

      {/* Filter bar */}
      {availableTypes.length > 1 && !loading && (
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
          <button
            type="button"
            onClick={() => setActiveFilter("all")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeFilter === "all"
                ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
            }`}
          >
            All ({insights.length})
          </button>
          {availableTypes.map((type) => {
            const meta = TYPE_META[type as InsightType];
            const count = insights.filter((i) => i.type === type).length;
            return (
              <button
                key={type}
                type="button"
                onClick={() => setActiveFilter(type as InsightType)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  activeFilter === type
                    ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                }`}
              >
                <meta.Icon className="h-3 w-3" />
                {meta.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      <div className="mt-5 space-y-4">
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border border-gray-200/50 dark:border-gray-700/50 bg-white/60 dark:bg-gray-900/60 p-5 space-y-3"
              >
                <div className="flex gap-2">
                  <div className="h-5 w-20 rounded-full bg-gray-200/70 dark:bg-gray-800/70 animate-pulse" />
                  <div className="h-5 w-24 rounded-full bg-gray-200/70 dark:bg-gray-800/70 animate-pulse" />
                </div>
                <div className="h-4 w-3/5 rounded bg-gray-200/70 dark:bg-gray-800/70 animate-pulse" />
                <div className="h-4 w-full rounded bg-gray-200/70 dark:bg-gray-800/70 animate-pulse" />
                <div className="h-4 w-4/5 rounded bg-gray-200/70 dark:bg-gray-800/70 animate-pulse" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200/60 bg-red-500/10 px-5 py-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        ) : filteredInsights.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Lightbulb className="h-10 w-10 text-gray-300 dark:text-gray-600" />
            <p className="text-sm text-gray-400 dark:text-gray-500">
              {insights.length === 0
                ? "No insights generated for this dataset."
                : "No insights match the selected filter."}
            </p>
          </div>
        ) : (
          filteredInsights.map((insight, i) => (
            <InsightCard key={insight.id} insight={insight} index={i} />
          ))
        )}
      </div>
    </motion.section>
  );
}
