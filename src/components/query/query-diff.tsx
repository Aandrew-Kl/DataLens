"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { GitCompareArrows, Timer, Workflow } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
  toCount,
} from "@/lib/utils/advanced-analytics";
import { formatDuration, formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface QueryDiffProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface DiffLine {
  left: string;
  right: string;
  status: "same" | "changed" | "added" | "removed";
}

interface QueryMetrics {
  rowCount: number;
  durationMs: number;
  planLines: string[];
}

interface QueryDiffResult {
  queryLines: DiffLine[];
  planLines: DiffLine[];
  leftMetrics: QueryMetrics;
  rightMetrics: QueryMetrics;
}

function extractPlanLines(rows: Record<string, unknown>[]) {
  return rows.flatMap((row) => {
    if ("explain_value" in row && typeof row.explain_value === "string") {
      return row.explain_value.split("\n").filter(Boolean);
    }

    const fragments = Object.values(row).flatMap((value) =>
      typeof value === "string" ? [value] : [],
    );
    return fragments.length ? [fragments.join(" | ")] : [];
  });
}

function buildLineDiff(leftLines: string[], rightLines: string[]) {
  const maxLength = Math.max(leftLines.length, rightLines.length);
  return Array.from({ length: maxLength }, (_, index) => {
    const left = leftLines[index] ?? "";
    const right = rightLines[index] ?? "";
    const status: DiffLine["status"] =
      left === right
        ? "same"
        : !left
          ? "added"
          : !right
            ? "removed"
            : "changed";

    return { left, right, status };
  });
}

async function collectMetrics(sql: string) {
  const started = performance.now();
  const [planRows, countRows] = await Promise.all([
    runQuery(`EXPLAIN ${sql}`),
    runQuery(`SELECT COUNT(*) AS row_count FROM (${sql}) AS compared_query`),
  ]);
  const durationMs = performance.now() - started;

  return {
    rowCount: toCount(countRows[0]?.row_count),
    durationMs,
    planLines: extractPlanLines(planRows),
  } satisfies QueryMetrics;
}

function DiffTable({
  lines,
}: {
  lines: DiffLine[];
}) {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/20">
      <table className="min-w-full table-fixed text-left text-sm text-slate-700 dark:text-slate-200">
        <thead className="bg-slate-950/5 text-xs uppercase tracking-[0.16em] text-slate-500 dark:bg-white/5 dark:text-slate-400">
          <tr>
            <th className="w-1/2 px-4 py-3">Left query</th>
            <th className="w-1/2 px-4 py-3">Right query</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr
              key={`diff-${index}`}
              className={`border-t border-white/15 ${
                line.status === "changed"
                  ? "bg-amber-500/10"
                  : line.status === "added"
                    ? "bg-emerald-500/10"
                    : line.status === "removed"
                      ? "bg-rose-500/10"
                      : ""
              }`}
            >
              <td className="px-4 py-3 align-top">
                <code>{line.left || "—"}</code>
              </td>
              <td className="px-4 py-3 align-top">
                <code>{line.right || "—"}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function QueryDiff({ tableName }: QueryDiffProps) {
  const [leftQuery, setLeftQuery] = useState(`SELECT * FROM ${tableName} LIMIT 50`);
  const [rightQuery, setRightQuery] = useState(`SELECT * FROM ${tableName} LIMIT 100`);
  const [result, setResult] = useState<QueryDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changedLineCount = useMemo(
    () => result?.queryLines.filter((line) => line.status !== "same").length ?? 0,
    [result],
  );

  async function handleCompare() {
    if (!leftQuery.trim() || !rightQuery.trim()) {
      setResult(null);
      setError("Provide both queries before comparing them.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [leftMetrics, rightMetrics] = await Promise.all([
        collectMetrics(leftQuery),
        collectMetrics(rightQuery),
      ]);

      setResult({
        queryLines: buildLineDiff(
          leftQuery.split("\n").map((line) => line.trim()),
          rightQuery.split("\n").map((line) => line.trim()),
        ),
        planLines: buildLineDiff(leftMetrics.planLines, rightMetrics.planLines),
        leftMetrics,
        rightMetrics,
      });
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : "Query diff failed.");
    } finally {
      setLoading(false);
    }
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
            <GitCompareArrows className="h-4 w-4" />
            Query Diff
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            Compare two SQL queries side by side
          </h2>
        </div>
        <button type="button" onClick={() => void handleCompare()} disabled={loading} className={BUTTON_CLASS}>
          {loading ? "Comparing…" : "Compare queries"}
        </button>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <label className={`${GLASS_CARD_CLASS} p-4 text-sm text-slate-600 dark:text-slate-300`}>
          <span className="mb-2 block font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Left query
          </span>
          <textarea
            aria-label="Left query"
            value={leftQuery}
            onChange={(event) => setLeftQuery(event.target.value)}
            className="min-h-[200px] w-full rounded-3xl border border-white/20 bg-white/75 px-4 py-4 font-mono text-sm text-slate-900 outline-none backdrop-blur-2xl dark:bg-slate-950/45 dark:text-slate-100"
          />
        </label>
        <label className={`${GLASS_CARD_CLASS} p-4 text-sm text-slate-600 dark:text-slate-300`}>
          <span className="mb-2 block font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Right query
          </span>
          <textarea
            aria-label="Right query"
            value={rightQuery}
            onChange={(event) => setRightQuery(event.target.value)}
            className="min-h-[200px] w-full rounded-3xl border border-white/20 bg-white/75 px-4 py-4 font-mono text-sm text-slate-900 outline-none backdrop-blur-2xl dark:bg-slate-950/45 dark:text-slate-100"
          />
        </label>
      </div>

      {error ? (
        <div className="mt-6 rounded-3xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <GitCompareArrows className="h-4 w-4" />
            Changed lines
          </div>
          <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
            {result ? formatNumber(changedLineCount) : "—"}
          </div>
        </div>
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <Workflow className="h-4 w-4" />
            Left rows
          </div>
          <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
            {result ? formatNumber(result.leftMetrics.rowCount) : "—"}
          </div>
        </div>
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <Timer className="h-4 w-4" />
            Timing delta
          </div>
          <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">
            {result
              ? formatDuration(Math.abs(result.leftMetrics.durationMs - result.rightMetrics.durationMs))
              : "—"}
          </div>
        </div>
      </div>

      <div className={`${GLASS_CARD_CLASS} mt-6 p-4`}>
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          Query differences
        </h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Highlighted rows show added, removed, or modified SQL lines.
        </p>
        <div className="mt-4">
          <DiffTable lines={result?.queryLines ?? []} />
        </div>
      </div>

      <div className={`${GLASS_CARD_CLASS} mt-6 p-4`}>
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          Execution plan diff
        </h3>
        <div className="mt-4">
          <DiffTable lines={result?.planLines ?? []} />
        </div>
      </div>

      <div className={`${GLASS_CARD_CLASS} mt-6 p-4`}>
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          Performance comparison
        </h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/15 px-4 py-4 text-sm text-slate-700 dark:text-slate-200">
            <div className="font-semibold">Left query</div>
            <div className="mt-2">{result ? `${formatNumber(result.leftMetrics.rowCount)} rows` : "—"}</div>
            <div className="mt-1">{result ? formatDuration(result.leftMetrics.durationMs) : "—"}</div>
          </div>
          <div className="rounded-2xl border border-white/15 px-4 py-4 text-sm text-slate-700 dark:text-slate-200">
            <div className="font-semibold">Right query</div>
            <div className="mt-2">{result ? `${formatNumber(result.rightMetrics.rowCount)} rows` : "—"}</div>
            <div className="mt-1">{result ? formatDuration(result.rightMetrics.durationMs) : "—"}</div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
