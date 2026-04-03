"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeftRight,
  Gauge,
  Loader2,
  Play,
  Scale,
  Sparkles,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface QueryExplainViewerProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface ExplainNode {
  id: string;
  depth: number;
  label: string;
  detail: string;
  cost: number;
  estimatedRows: number | null;
  expensive: boolean;
}

interface ExplainRun {
  query: string;
  generatedAt: number;
  nodes: ExplainNode[];
  totalCost: number;
}

interface CompareSummary {
  deltaCost: number;
  addedLabels: string[];
  removedLabels: string[];
}

const EASE = [0.22, 1, 0.36, 1] as const;
const GLASS_PANEL_CLASS =
  "border border-white/20 bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45";
const FIELD_CLASS =
  "w-full rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-slate-700/70 dark:bg-slate-950/65 dark:text-slate-100";
const BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";

function buildDefaultQuery(tableName: string) {
  return `SELECT *\nFROM "${tableName.replaceAll('"', '""')}"\nLIMIT 100`;
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

function cleanLine(line: string) {
  return line.replace(/[│├└┌┐┘─]/g, " ").replace(/\s+/g, " ").trim();
}

function extractCost(line: string) {
  const match = line.match(/(?:cost|estimated_cost)\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)/i);
  return match ? Number(match[1]) : 0;
}

function extractEstimatedRows(line: string) {
  const match = line.match(/rows?\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)/i);
  return match ? Number(match[1]) : null;
}

function isOperatorLine(line: string) {
  return /(scan|join|filter|projection|aggregate|window|limit|sort|order|hash|cte|union|plan)/i.test(
    line,
  );
}

function buildExplainNodes(lines: string[]) {
  const provisionalNodes = lines.flatMap<ExplainNode>((rawLine, index) => {
    const label = cleanLine(rawLine);
    if (!label || !isOperatorLine(label)) return [];
    const depth = Math.max(0, Math.floor((rawLine.match(/^\s*/)?.[0].length ?? 0) / 2));
    return [
      {
        id: `explain-node-${index}`,
        depth,
        label,
        detail: label,
        cost: extractCost(label),
        estimatedRows: extractEstimatedRows(label),
        expensive: false,
      },
    ];
  });

  const costs = provisionalNodes.map((node) => node.cost).filter((cost) => cost > 0);
  const sortedCosts = [...costs].sort((left, right) => left - right);
  const expensiveThreshold =
    sortedCosts.length > 0
      ? sortedCosts[Math.max(0, Math.floor(sortedCosts.length * 0.66) - 1)] ?? 0
      : 0;

  return provisionalNodes.map((node) => ({
    ...node,
    expensive: node.cost > 0 && node.cost >= expensiveThreshold,
  }));
}

function compareRuns(currentRun: ExplainRun, baselineRun: ExplainRun): CompareSummary {
  const currentLabels = new Set(currentRun.nodes.map((node) => node.label));
  const baselineLabels = new Set(baselineRun.nodes.map((node) => node.label));

  return {
    deltaCost: currentRun.totalCost - baselineRun.totalCost,
    addedLabels: Array.from(currentLabels).filter((label) => !baselineLabels.has(label)),
    removedLabels: Array.from(baselineLabels).filter((label) => !currentLabels.has(label)),
  };
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={`rounded-3xl p-4 shadow-sm ${GLASS_PANEL_CLASS}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
        {value}
      </p>
    </div>
  );
}

export default function QueryExplainViewer({
  tableName,
  columns,
}: QueryExplainViewerProps) {
  const [queryText, setQueryText] = useState(() => buildDefaultQuery(tableName));
  const [currentRun, setCurrentRun] = useState<ExplainRun | null>(null);
  const [baselineRun, setBaselineRun] = useState<ExplainRun | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const comparison = useMemo(
    () =>
      currentRun && baselineRun
        ? compareRuns(currentRun, baselineRun)
        : null,
    [baselineRun, currentRun],
  );

  async function handleExplain() {
    if (!queryText.trim()) return;

    setRunning(true);
    setError(null);

    try {
      const rows = await runQuery(`EXPLAIN ${queryText.trim()}`);
      const lines = rowsToExplainLines(rows);
      const nodes = buildExplainNodes(lines);
      const totalCost = nodes.reduce((sum, node) => sum + node.cost, 0);
      setCurrentRun({
        query: queryText.trim(),
        generatedAt: Date.now(),
        nodes,
        totalCost,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Explain plan failed.");
    } finally {
      setRunning(false);
    }
  }

  function handleUseAsBaseline() {
    if (!currentRun) return;
    setBaselineRun(currentRun);
  }

  const expensiveCount = currentRun?.nodes.filter((node) => node.expensive).length ?? 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      className={`rounded-[2rem] p-6 shadow-[0_28px_90px_-52px_rgba(15,23,42,0.85)] ${GLASS_PANEL_CLASS}`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
            <Gauge className="h-3.5 w-3.5" />
            Query explain viewer
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Run EXPLAIN, inspect the plan tree, and compare cost changes over time
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Analyze the active query for {tableName}, inspect expensive operators, and pin a
            baseline plan so regressions are easier to spot while the dataset evolves.
          </p>
        </div>

        <div className="grid w-full gap-3 sm:grid-cols-3 lg:max-w-md">
          <MetricCard
            label="Nodes"
            value={formatNumber(currentRun?.nodes.length ?? 0)}
          />
          <MetricCard
            label="Expensive"
            value={formatNumber(expensiveCount)}
          />
          <MetricCard
            label="Columns"
            value={formatNumber(columns.length)}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className={`rounded-[1.75rem] p-5 ${GLASS_PANEL_CLASS}`}>
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              SQL query
            </span>
            <textarea
              aria-label="SQL query"
              className={`${FIELD_CLASS} min-h-60`}
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
            />
          </label>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleExplain}
              disabled={running}
              className={`${BUTTON_CLASS} bg-cyan-600 text-white hover:bg-cyan-500`}
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Run EXPLAIN
            </button>
            <button
              type="button"
              onClick={handleUseAsBaseline}
              disabled={!currentRun}
              className={`${BUTTON_CLASS} border border-white/20 bg-white/70 text-slate-800 hover:bg-white dark:bg-slate-950/45 dark:text-slate-100 dark:hover:bg-slate-950/60`}
            >
              <ArrowLeftRight className="h-4 w-4" />
              Use current as baseline
            </button>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          ) : null}

          {comparison ? (
            <div className={`mt-4 rounded-3xl p-4 ${GLASS_PANEL_CLASS}`}>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-white">
                <Scale className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                Compare plans
              </div>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                Cost delta: {comparison.deltaCost >= 0 ? "+" : ""}
                {comparison.deltaCost.toFixed(2)}
              </p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Added operators: {comparison.addedLabels.length > 0 ? comparison.addedLabels.join(", ") : "None"}
              </p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Removed operators: {comparison.removedLabels.length > 0 ? comparison.removedLabels.join(", ") : "None"}
              </p>
            </div>
          ) : null}
        </div>

        <div className={`rounded-[1.75rem] p-5 ${GLASS_PANEL_CLASS}`}>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
            <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
              Plan tree
            </h3>
          </div>

          {currentRun === null ? (
            <div className="mt-5 rounded-3xl border border-dashed border-white/25 bg-white/35 p-8 text-sm text-slate-600 dark:bg-slate-950/25 dark:text-slate-300">
              Run EXPLAIN to render the operator tree and compare it against a saved baseline.
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {currentRun.nodes.map((node) => (
                <div
                  key={node.id}
                  className={`rounded-3xl border px-4 py-4 ${
                    node.expensive
                      ? "border-amber-500/25 bg-amber-500/10"
                      : "border-white/20 bg-white/60 dark:bg-slate-950/35"
                  }`}
                  style={{ marginLeft: `${node.depth * 16}px` }}
                >
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-950 dark:text-white">
                        {node.label}
                      </p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {node.estimatedRows == null
                          ? "No row estimate returned."
                          : `${formatNumber(node.estimatedRows)} estimated rows`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {node.expensive ? (
                        <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
                          Expensive
                        </span>
                      ) : null}
                      <span className="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 dark:bg-white/5 dark:text-slate-300">
                        Cost {node.cost.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}
