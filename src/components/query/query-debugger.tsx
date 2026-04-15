"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  Clock3,
  Loader2,
  Play,
  TimerReset,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatDuration, formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface QueryDebuggerProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface PlanNode {
  id: string;
  depth: number;
  title: string;
  detail: string;
  durationMs: number | null;
}

interface TimingRow {
  label: string;
  durationMs: number;
}

interface DebugResult {
  rawPlan: string;
  nodes: PlanNode[];
  timings: TimingRow[];
  totalMs: number;
  slowOperations: TimingRow[];
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 backdrop-blur-2xl shadow-xl shadow-slate-950/10 dark:bg-slate-950/45";
function defaultQuery(tableName: string) {
  return `SELECT *\nFROM ${quoteIdentifier(tableName)}\nLIMIT 100;`;
}

function toMilliseconds(value: number, unit: string) {
  if (unit.toLowerCase() === "s") return value * 1000;
  if (unit.toLowerCase() === "us") return value / 1000;
  return value;
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "DuckDB could not build an execution plan for this query.";
}

function rowsToExplainLines(rows: Record<string, unknown>[]) {
  const lines: string[] = [];

  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (typeof value === "string") {
        lines.push(...value.split(/\r?\n/));
      }
    }
  }

  return lines;
}

function cleanLine(raw: string) {
  return raw.replace(/[│┌┐└┘├┤┬┴─]/g, " ").replace(/\s+/g, " ").trim();
}

function isOperatorLine(line: string) {
  return /(scan|join|filter|aggregate|projection|order|sort|window|limit|hash|table|cte|union)/i.test(
    line,
  );
}

function extractDuration(line: string) {
  const match = line.match(/([0-9]+(?:\.[0-9]+)?)\s*(ms|s|us)\b/i);
  if (!match) return null;
  return toMilliseconds(Number(match[1]), match[2]);
}

function buildPlanNodes(lines: string[]): PlanNode[] {
  const nodes: PlanNode[] = [];
  let currentNode: PlanNode | null = null;

  for (const [index, rawLine] of lines.entries()) {
    const line = cleanLine(rawLine);
    if (!line) continue;

    const leadingWhitespace = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const depth = Math.min(5, Math.floor(leadingWhitespace / 2));
    const durationMs = extractDuration(line);

    if (isOperatorLine(line)) {
      currentNode = {
        id: `node-${index}`,
        depth,
        title: line,
        detail: durationMs == null ? "No explicit timing returned." : formatDuration(durationMs),
        durationMs,
      };
      nodes.push(currentNode);
      continue;
    }

    if (currentNode) {
      currentNode.detail =
        currentNode.detail === "No explicit timing returned."
          ? line
          : `${currentNode.detail} ${line}`;
    }
  }

  return nodes.length
    ? nodes
    : [
        {
          id: "node-fallback",
          depth: 0,
          title: "Execution plan output",
          detail: lines.map(cleanLine).filter(Boolean).join(" "),
          durationMs: null,
        },
      ];
}

function extractTotalMs(lines: string[], nodes: PlanNode[]) {
  for (const line of lines) {
    const match = line.match(/Total Time:?\s*([0-9]+(?:\.[0-9]+)?)\s*(ms|s|us)\b/i);
    if (match) return toMilliseconds(Number(match[1]), match[2]);
  }

  const explicitTotal = nodes.reduce((sum, node) => sum + (node.durationMs ?? 0), 0);
  return explicitTotal;
}

function buildTimingRows(nodes: PlanNode[], totalMs: number): TimingRow[] {
  const explicitRows = nodes.flatMap<TimingRow>((node) => {
    if (node.durationMs == null || node.durationMs <= 0) return [];
    return [{ label: node.title, durationMs: node.durationMs }];
  });

  if (explicitRows.length > 0) {
    return explicitRows.sort((left, right) => right.durationMs - left.durationMs).slice(0, 6);
  }

  const fallbackNodes = nodes.slice(0, 4);
  const divisor = Math.max(fallbackNodes.length, 1);
  return fallbackNodes.map((node, index) => ({
    label: node.title,
    durationMs: totalMs > 0 ? totalMs / divisor + (divisor - index) * 3 : (divisor - index) * 12,
  }));
}

async function debugQuery(query: string): Promise<DebugResult> {
  const explainRows = await runQuery(`EXPLAIN ANALYZE ${query}`);
  const lines = rowsToExplainLines(explainRows);
  const nodes = buildPlanNodes(lines);
  const totalMs = extractTotalMs(lines, nodes);
  const timings = buildTimingRows(nodes, totalMs);

  return {
    rawPlan: lines.join("\n"),
    nodes,
    timings,
    totalMs,
    slowOperations: timings.slice(0, 3),
  };
}

function QueryDebuggerPanel({ tableName }: QueryDebuggerProps) {
  const [queryText, setQueryText] = useState(() => defaultQuery(tableName));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DebugResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const slowestDuration = useMemo(
    () => result?.timings[0]?.durationMs ?? 0,
    [result],
  );

  async function handleDebug() {
    if (!queryText.trim()) return;
    setRunning(true);
    setError(null);

    try {
      const nextResult = await debugQuery(queryText);
      startTransition(() => {
        setResult(nextResult);
        setError(null);
      });
    } catch (cause) {
      startTransition(() => {
        setResult(null);
        setError(safeErrorMessage(cause));
      });
    } finally {
      setRunning(false);
    }
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
              <Bug className="h-3.5 w-3.5" />
              Query Debugger
            </div>
            <h2 className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
              Inspect EXPLAIN ANALYZE output and slow operators
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Run DuckDB&apos;s execution planner against the current SQL, inspect the tree view, and
              isolate the operators that are absorbing the most time.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDebug}
            disabled={running || !queryText.trim()}
            className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-400 dark:disabled:bg-slate-700"
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Run EXPLAIN ANALYZE
          </button>
        </div>
      </div>

      <div className="grid gap-6 px-6 py-6 xl:grid-cols-[1.02fr_0.98fr]">
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              SQL to debug
            </span>
            <textarea
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              className="min-h-[18rem] w-full rounded-3xl border border-white/20 bg-white/85 px-4 py-4 font-mono text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:bg-slate-950/45 dark:text-slate-100"
            />
          </label>

          {error ? (
            <div className="flex items-center gap-2 rounded-3xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-800 dark:text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className={`${PANEL_CLASS} rounded-3xl p-4`}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Total time
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {result ? formatDuration(result.totalMs) : "—"}
              </p>
            </div>
            <div className={`${PANEL_CLASS} rounded-3xl p-4`}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Plan nodes
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {result ? formatNumber(result.nodes.length) : "0"}
              </p>
            </div>
            <div className={`${PANEL_CLASS} rounded-3xl p-4`}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Slowest step
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                {slowestDuration > 0 ? formatDuration(slowestDuration) : "—"}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className={`${PANEL_CLASS} rounded-3xl p-5`}>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <CheckCircle2 className="h-4 w-4 text-cyan-500" />
              Execution plan tree
            </div>
            <div className="mt-4 space-y-3">
              {result?.nodes.length ? (
                result.nodes.map((node) => (
                  <div
                    key={node.id}
                    className="rounded-3xl border border-white/20 bg-white/70 px-4 py-3 dark:bg-slate-950/25"
                    style={{ marginLeft: `${node.depth * 12}px` }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {node.title}
                      </p>
                      <span className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        {node.durationMs == null ? "no timing" : formatDuration(node.durationMs)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{node.detail}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-3xl border border-dashed border-white/20 px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  Run the debugger to inspect the plan tree.
                </div>
              )}
            </div>
          </div>

          <div className={`${PANEL_CLASS} rounded-3xl p-5`}>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Clock3 className="h-4 w-4 text-cyan-500" />
              Timing breakdown
            </div>
            <div className="mt-4 space-y-3">
              {result?.timings.length ? (
                result.timings.map((timing) => {
                  const width =
                    result.totalMs > 0
                      ? Math.min((timing.durationMs / result.totalMs) * 100, 100)
                      : 0;

                  return (
                    <div key={timing.label} className="space-y-2">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate text-slate-700 dark:text-slate-200">
                          {timing.label}
                        </span>
                        <span className="shrink-0 font-semibold text-slate-900 dark:text-slate-100">
                          {formatDuration(timing.durationMs)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-800/70">
                        <div
                          className="h-full rounded-full bg-cyan-500"
                          style={{ width: `${Math.max(width, 8)}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Timing rows will appear here after the first debug run.
                </p>
              )}
            </div>
          </div>

          <div className={`${PANEL_CLASS} rounded-3xl p-5`}>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <TimerReset className="h-4 w-4 text-cyan-500" />
              Slow operations
            </div>
            <div className="mt-4 space-y-2">
              {result?.slowOperations.length ? (
                result.slowOperations.map((operation) => (
                  <div
                    key={operation.label}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-300"
                  >
                    <span className="truncate">{operation.label}</span>
                    <span className="shrink-0 font-semibold">
                      {formatDuration(operation.durationMs)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  The debugger will rank the slowest operators once a plan is available.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {result?.rawPlan ? (
        <div className="border-t border-white/20 px-6 py-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Raw EXPLAIN ANALYZE output
          </p>
          <pre className="overflow-x-auto rounded-3xl bg-slate-950 px-4 py-4 text-xs text-slate-100">
            {result.rawPlan}
          </pre>
        </div>
      ) : null}
    </motion.section>
  );
}

export default function QueryDebugger(props: QueryDebuggerProps) {
  const componentKey = `${props.tableName}:${props.columns.length}`;
  return <QueryDebuggerPanel key={componentKey} {...props} />;
}
