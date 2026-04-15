"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  Sparkles,
} from "lucide-react";
import type { ColumnProfile } from "@/types/dataset";

interface QueryOptimizerProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface OptimizationSuggestion {
  id: string;
  severity: "info" | "warning" | "error";
  title: string;
  summary: string;
  evidence: string;
  rewrite: string;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 backdrop-blur-2xl shadow-xl shadow-slate-950/10 dark:bg-slate-950/45";
function defaultQuery(tableName: string) {
  return `SELECT *\nFROM ${quoteIdentifier(tableName)}\nORDER BY 1 DESC;`;
}

function columnsSignature(columns: ColumnProfile[]) {
  return columns.map((column) => `${column.name}:${column.type}`).join("|");
}

function chooseProjection(columns: ColumnProfile[]) {
  const selected = columns.slice(0, 5).map((column) => quoteIdentifier(column.name));
  return selected.length ? selected.join(", ") : "*";
}

function chooseFilterColumn(columns: ColumnProfile[]) {
  return (
    columns.find((column) => column.type === "date")?.name ??
    columns.find((column) => column.type === "number")?.name ??
    columns.find((column) => column.type === "string")?.name ??
    columns[0]?.name ??
    "created_at"
  );
}

function severityTone(severity: OptimizationSuggestion["severity"]) {
  if (severity === "error") {
    return "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  }
  if (severity === "warning") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  return "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300";
}

function severityIcon(severity: OptimizationSuggestion["severity"]) {
  if (severity === "error") return AlertTriangle;
  if (severity === "warning") return AlertTriangle;
  return Info;
}

function buildHealthyQueryMessage(query: string): OptimizationSuggestion {
  return {
    id: "healthy-query",
    severity: "info",
    title: "No obvious anti-patterns detected",
    summary:
      "The query already scopes the result set and avoids the most common expensive patterns checked here.",
    evidence: query.trim() || "Empty query",
    rewrite: query.trim(),
  };
}

function analyzeQuery(
  query: string,
  tableName: string,
  columns: ColumnProfile[],
): OptimizationSuggestion[] {
  const normalized = query.trim();
  if (!normalized) return [buildHealthyQueryMessage(query)];

  const compact = normalized.replace(/\s+/g, " ");
  const suggestions: OptimizationSuggestion[] = [];
  const filterColumn = quoteIdentifier(chooseFilterColumn(columns));
  const projection = chooseProjection(columns);

  if (/\bselect\s+\*/i.test(compact)) {
    suggestions.push({
      id: "select-star",
      severity: "warning",
      title: "Replace SELECT * with an explicit projection",
      summary:
        "Wildcard scans widen the payload, hide schema drift, and make downstream sorting or joining more expensive than needed.",
      evidence: "Detected SELECT * in the current statement.",
      rewrite: normalized.replace(/\bselect\s+\*/i, `SELECT ${projection}`),
    });
  }

  const hasSelect = /\bselect\b/i.test(compact);
  const hasWhere = /\bwhere\b/i.test(compact);
  const hasLimit = /\blimit\b/i.test(compact);
  if (hasSelect && !hasWhere && !hasLimit) {
    suggestions.push({
      id: "missing-filter",
      severity: "error",
      title: "Add a WHERE or LIMIT clause",
      summary:
        "Full-table scans are often acceptable for profiling, but they are a bad default for exploratory debugging and dashboard queries.",
      evidence: "No WHERE or LIMIT clause was found.",
      rewrite: `${normalized.replace(/;?\s*$/, "")}\nWHERE ${filterColumn} IS NOT NULL\nLIMIT 200;`,
    });
  }

  if (/\b(IN|EXISTS)\s*\(\s*SELECT\b/i.test(compact)) {
    suggestions.push({
      id: "subquery-instead-of-join",
      severity: "warning",
      title: "Rewrite the correlated subquery as a JOIN",
      summary:
        "Semi-joins are usually easier for DuckDB to optimize than repeated nested subquery evaluation when the intent is set membership.",
      evidence: "Found an IN/EXISTS subquery pattern.",
      rewrite: [
        "WITH filtered_keys AS (",
        `  SELECT DISTINCT ${filterColumn}`,
        `  FROM ${quoteIdentifier(tableName)}`,
        ")",
        `SELECT ${projection}`,
        `FROM ${quoteIdentifier(tableName)} AS base`,
        `INNER JOIN filtered_keys AS keys ON base.${filterColumn} = keys.${filterColumn};`,
      ].join("\n"),
    });
  }

  if (/\border\s+by\b/i.test(compact) && !hasLimit) {
    suggestions.push({
      id: "order-by-without-limit",
      severity: "info",
      title: "Add LIMIT after ORDER BY when sampling",
      summary:
        "Sorting the full result set can dominate runtime. Adding a limit keeps the sort bounded when you only need a slice.",
      evidence: "ORDER BY is present without LIMIT.",
      rewrite: `${normalized.replace(/;?\s*$/, "")}\nLIMIT 100;`,
    });
  }

  return suggestions.length ? suggestions : [buildHealthyQueryMessage(query)];
}

function QueryOptimizerPanel({
  tableName,
  columns,
}: QueryOptimizerProps) {
  const [queryText, setQueryText] = useState(() => defaultQuery(tableName));
  const [appliedSuggestionId, setAppliedSuggestionId] = useState<string | null>(null);

  const suggestions = useMemo(
    () => analyzeQuery(queryText, tableName, columns),
    [columns, queryText, tableName],
  );

  const severityCounts = useMemo(
    () =>
      suggestions.reduce(
        (accumulator, suggestion) => {
          accumulator[suggestion.severity] += 1;
          return accumulator;
        },
        { info: 0, warning: 0, error: 0 },
      ),
    [suggestions],
  );

  function applyRewrite(suggestion: OptimizationSuggestion) {
    setQueryText(suggestion.rewrite);
    setAppliedSuggestionId(suggestion.id);
  }

  function resetToSample() {
    setQueryText(defaultQuery(tableName));
    setAppliedSuggestionId(null);
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      className={`${PANEL_CLASS} overflow-hidden`}
    >
      <div className="border-b border-white/20 px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
              <Sparkles className="h-3.5 w-3.5" />
              Query Optimizer
            </div>
            <h2 className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
              Spot common SQL anti-patterns before they hit DuckDB
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              The optimizer checks for wildcard projections, unbounded scans, and subquery patterns
              that usually deserve a faster rewrite.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={resetToSample}
              className="rounded-2xl border border-white/20 bg-white/80 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-cyan-400 hover:text-cyan-700 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:text-cyan-300"
            >
              Reset sample query
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 px-6 py-6 xl:grid-cols-[1.02fr_0.98fr]">
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Query under review
            </span>
            <textarea
              value={queryText}
              onChange={(event) => {
                setQueryText(event.target.value);
                setAppliedSuggestionId(null);
              }}
              className="min-h-[18rem] w-full rounded-3xl border border-white/20 bg-white/85 px-4 py-4 font-mono text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:bg-slate-950/45 dark:text-slate-100"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className={`${PANEL_CLASS} rounded-3xl p-4`}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Info
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {severityCounts.info}
              </p>
            </div>
            <div className={`${PANEL_CLASS} rounded-3xl p-4`}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Warnings
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {severityCounts.warning}
              </p>
            </div>
            <div className={`${PANEL_CLASS} rounded-3xl p-4`}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Errors
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {severityCounts.error}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {suggestions.map((suggestion, index) => {
            const Icon = severityIcon(suggestion.severity);
            const applied = appliedSuggestionId === suggestion.id;

            return (
              <motion.article
                key={suggestion.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: index * 0.04, ease: EASE }}
                className={`${PANEL_CLASS} rounded-3xl p-5`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-3">
                    <div
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${severityTone(suggestion.severity)}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {suggestion.severity}
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                        {suggestion.title}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                        {suggestion.summary}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => applyRewrite(suggestion)}
                    disabled={suggestion.rewrite === queryText}
                    className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-400 dark:disabled:bg-slate-700"
                  >
                    {applied ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <ArrowRight className="h-4 w-4" />
                    )}
                    {applied ? "Rewrite applied" : "Use rewrite"}
                  </button>
                </div>

                <div className="mt-4 rounded-3xl border border-white/20 bg-white/70 p-4 dark:bg-slate-950/25">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Evidence
                  </p>
                  <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                    {suggestion.evidence}
                  </p>
                </div>

                <pre className="mt-4 overflow-x-auto rounded-3xl bg-slate-950 px-4 py-4 text-xs text-slate-100">
                  {suggestion.rewrite}
                </pre>
              </motion.article>
            );
          })}
        </div>
      </div>
    </motion.section>
  );
}

export default function QueryOptimizer(props: QueryOptimizerProps) {
  const componentKey = `${props.tableName}:${columnsSignature(props.columns)}`;
  return <QueryOptimizerPanel key={componentKey} {...props} />;
}
