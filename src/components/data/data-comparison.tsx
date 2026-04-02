"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeftRight,
  ChevronDown,
  Columns3,
  Equal,
  Hash,
  Layers,
  Loader2,
  Minus,
  Plus,
  Rows3,
  Type,
} from "lucide-react";
import type { DatasetMeta } from "@/types/dataset";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber, sanitizeTableName } from "@/lib/utils/formatters";

/* ─── Types ─── */

interface DataComparisonProps {
  datasets: DatasetMeta[];
}

interface ColumnStats {
  name: string;
  type: "number" | "string" | "other";
  min?: number;
  max?: number;
  mean?: number;
  uniqueCount?: number;
}

interface ComparisonResult {
  leftStats: ColumnStats[];
  rightStats: ColumnStats[];
  commonColumns: string[];
  leftOnly: string[];
  rightOnly: string[];
}

/* ─── Helpers ─── */

function quoteId(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

function diffLabel(a: number, b: number): { text: string; color: string } {
  const diff = b - a;
  if (diff === 0) return { text: "0", color: "text-gray-400 dark:text-gray-500" };
  const sign = diff > 0 ? "+" : "";
  return {
    text: `${sign}${formatNumber(diff)}`,
    color:
      diff > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-red-500 dark:text-red-400",
  };
}

/* ─── Dataset Selector ─── */

function DatasetSelector({
  datasets,
  selected,
  onChange,
  label,
}: {
  datasets: DatasetMeta[];
  selected: string | null;
  onChange: (id: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const current = datasets.find((d) => d.id === selected);

  return (
    <div className="relative flex-1 min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5 font-semibold">
        {label}
      </p>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 rounded-xl border border-gray-200/60 dark:border-gray-700/50 bg-white/80 dark:bg-gray-900/60 backdrop-blur-sm px-4 py-2.5 text-sm text-left transition-colors hover:border-indigo-300 dark:hover:border-indigo-700"
      >
        <span className="truncate text-gray-900 dark:text-white font-medium">
          {current ? current.name : "Select dataset\u2026"}
        </span>
        <ChevronDown className="w-4 h-4 shrink-0 text-gray-400" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 mt-1 w-full rounded-xl border border-gray-200/60 dark:border-gray-700/50 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl shadow-lg py-1 max-h-60 overflow-auto"
          >
            {datasets.map((ds) => (
              <button
                key={ds.id}
                onClick={() => {
                  onChange(ds.id);
                  setOpen(false);
                }}
                className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${
                  ds.id === selected
                    ? "text-indigo-600 dark:text-indigo-400 font-medium"
                    : "text-gray-700 dark:text-gray-300"
                }`}
              >
                <span className="block truncate">{ds.name}</span>
                <span className="text-[11px] text-gray-400 dark:text-gray-500">
                  {formatNumber(ds.rowCount)} rows &middot; {ds.columnCount} cols
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Stat Card ─── */

function StatCard({
  icon: Icon,
  label,
  leftValue,
  rightValue,
}: {
  icon: React.ElementType;
  label: string;
  leftValue: number;
  rightValue: number;
}) {
  const diff = diffLabel(leftValue, rightValue);
  return (
    <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 bg-white/80 dark:bg-gray-900/60 backdrop-blur-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-indigo-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {label}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-lg font-bold text-gray-900 dark:text-white">
            {formatNumber(leftValue)}
          </p>
          <p className="text-[10px] text-gray-400">Dataset A</p>
        </div>
        <div className="flex items-center justify-center">
          <span className={`text-sm font-semibold font-mono ${diff.color}`}>
            {diff.text}
          </span>
        </div>
        <div>
          <p className="text-lg font-bold text-gray-900 dark:text-white">
            {formatNumber(rightValue)}
          </p>
          <p className="text-[10px] text-gray-400">Dataset B</p>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Component ─── */

export default function DataComparison({ datasets }: DataComparisonProps) {
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leftDs = datasets.find((d) => d.id === leftId) ?? null;
  const rightDs = datasets.find((d) => d.id === rightId) ?? null;

  const fetchStats = useCallback(
    async (ds: DatasetMeta): Promise<ColumnStats[]> => {
      const table = quoteId(sanitizeTableName(ds.fileName));
      const stats: ColumnStats[] = [];

      for (const col of ds.columns) {
        const safeCol = quoteId(col.name);

        if (col.type === "number") {
          const rows = await runQuery(
            `SELECT MIN(${safeCol}) AS mn, MAX(${safeCol}) AS mx, AVG(${safeCol}) AS avg_val FROM ${table}`
          );
          const row = rows[0] ?? {};
          stats.push({
            name: col.name,
            type: "number",
            min: row.mn != null ? Number(row.mn) : undefined,
            max: row.mx != null ? Number(row.mx) : undefined,
            mean: row.avg_val != null ? Number(row.avg_val) : undefined,
          });
        } else if (col.type === "string") {
          const rows = await runQuery(
            `SELECT COUNT(DISTINCT ${safeCol}) AS uq FROM ${table}`
          );
          stats.push({
            name: col.name,
            type: "string",
            uniqueCount: Number(rows[0]?.uq ?? 0),
          });
        } else {
          stats.push({ name: col.name, type: "other" });
        }
      }
      return stats;
    },
    []
  );

  useEffect(() => {
    if (!leftDs || !rightDs) {
      setResult(null);
      return;
    }

    let cancelled = false;

    async function compare() {
      setLoading(true);
      setError(null);
      try {
        const [leftStats, rightStats] = await Promise.all([
          fetchStats(leftDs!),
          fetchStats(rightDs!),
        ]);

        if (cancelled) return;

        const leftNames = new Set(leftStats.map((s) => s.name));
        const rightNames = new Set(rightStats.map((s) => s.name));

        const commonColumns = [...leftNames].filter((n) => rightNames.has(n));
        const leftOnly = [...leftNames].filter((n) => !rightNames.has(n));
        const rightOnly = [...rightNames].filter((n) => !leftNames.has(n));

        setResult({ leftStats, rightStats, commonColumns, leftOnly, rightOnly });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Comparison failed.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    compare();
    return () => {
      cancelled = true;
    };
  }, [leftDs, rightDs, fetchStats]);

  const statsLookup = useMemo(() => {
    if (!result) return { left: new Map<string, ColumnStats>(), right: new Map<string, ColumnStats>() };
    return {
      left: new Map(result.leftStats.map((s) => [s.name, s])),
      right: new Map(result.rightStats.map((s) => [s.name, s])),
    };
  }, [result]);

  /* ─── Render ─── */

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-gray-200/50 dark:border-gray-700/50 bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl p-6 shadow-xl shadow-slate-900/5 space-y-6"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <ArrowLeftRight className="w-5 h-5 text-indigo-500" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Dataset Comparison
        </h2>
      </div>

      {/* Selectors */}
      <div className="flex items-end gap-4">
        <DatasetSelector
          datasets={datasets}
          selected={leftId}
          onChange={setLeftId}
          label="Dataset A"
        />
        <div className="pb-2">
          <ArrowLeftRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
        </div>
        <DatasetSelector
          datasets={datasets}
          selected={rightId}
          onChange={setRightId}
          label="Dataset B"
        />
      </div>

      {/* States */}
      {loading && (
        <div className="flex items-center justify-center py-12 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Comparing datasets...
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200/60 dark:border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && result && leftDs && rightDs && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="space-y-6"
        >
          {/* Overview cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StatCard icon={Rows3} label="Row Count" leftValue={leftDs.rowCount} rightValue={rightDs.rowCount} />
            <StatCard icon={Columns3} label="Column Count" leftValue={leftDs.columnCount} rightValue={rightDs.columnCount} />
          </div>

          {/* Column summary badges */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-xs font-medium">
              <Equal className="w-3 h-3" />
              {result.commonColumns.length} Common
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-medium">
              <Minus className="w-3 h-3" />
              {result.leftOnly.length} Only in A
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-xs font-medium">
              <Plus className="w-3 h-3" />
              {result.rightOnly.length} Only in B
            </span>
          </div>

          {/* Column-by-column comparison table */}
          <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/60">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Column
                  </th>
                  <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    A
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    B
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Diff
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {/* Common columns */}
                {result.commonColumns.map((name, idx) => {
                  const left = statsLookup.left.get(name);
                  const right = statsLookup.right.get(name);

                  const isNumeric = left?.type === "number" && right?.type === "number";
                  const isString = left?.type === "string" && right?.type === "string";

                  let leftLabel = "\u2014";
                  let rightLabel = "\u2014";
                  let diffInfo = { text: "\u2014", color: "text-gray-400 dark:text-gray-500" };
                  let metric = "";

                  if (isNumeric) {
                    leftLabel = left.mean != null ? formatNumber(Number(left.mean.toFixed(2))) : "\u2014";
                    rightLabel = right.mean != null ? formatNumber(Number(right.mean.toFixed(2))) : "\u2014";
                    if (left.mean != null && right.mean != null) {
                      diffInfo = diffLabel(left.mean, right.mean);
                    }
                    metric = "mean";
                  } else if (isString) {
                    leftLabel = left.uniqueCount != null ? formatNumber(left.uniqueCount) : "\u2014";
                    rightLabel = right.uniqueCount != null ? formatNumber(right.uniqueCount) : "\u2014";
                    if (left.uniqueCount != null && right.uniqueCount != null) {
                      diffInfo = diffLabel(left.uniqueCount, right.uniqueCount);
                    }
                    metric = "uniques";
                  }

                  return (
                    <motion.tr
                      key={name}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.02 }}
                      className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {isNumeric ? (
                            <Hash className="w-3.5 h-3.5 text-emerald-500" />
                          ) : isString ? (
                            <Type className="w-3.5 h-3.5 text-blue-500" />
                          ) : (
                            <Layers className="w-3.5 h-3.5 text-gray-400" />
                          )}
                          <span className="font-medium text-gray-900 dark:text-white text-sm">
                            {name}
                          </span>
                          {metric && (
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">
                              ({metric})
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400">
                          Shared
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-600 dark:text-gray-400">
                        {leftLabel}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-600 dark:text-gray-400">
                        {rightLabel}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono text-xs font-semibold ${diffInfo.color}`}>
                        {diffInfo.text}
                      </td>
                    </motion.tr>
                  );
                })}

                {/* Numeric columns: show additional min/max rows for common numeric cols */}
                {result.commonColumns
                  .filter((name) => {
                    const l = statsLookup.left.get(name);
                    const r = statsLookup.right.get(name);
                    return l?.type === "number" && r?.type === "number";
                  })
                  .flatMap((name) => {
                    const left = statsLookup.left.get(name)!;
                    const right = statsLookup.right.get(name)!;
                    const rows: { key: string; metric: string; lv: number | undefined; rv: number | undefined }[] = [
                      { key: `${name}-min`, metric: "min", lv: left.min, rv: right.min },
                      { key: `${name}-max`, metric: "max", lv: left.max, rv: right.max },
                    ];
                    return rows.map(({ key, metric, lv, rv }) => {
                      const lStr = lv != null ? formatNumber(lv) : "\u2014";
                      const rStr = rv != null ? formatNumber(rv) : "\u2014";
                      const d = lv != null && rv != null ? diffLabel(lv, rv) : { text: "\u2014", color: "text-gray-400 dark:text-gray-500" };
                      return (
                        <tr key={key} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors bg-gray-50/30 dark:bg-gray-800/10">
                          <td className="px-4 py-1.5 pl-12">
                            <span className="text-[11px] text-gray-400 dark:text-gray-500">{name} ({metric})</span>
                          </td>
                          <td className="px-4 py-1.5 text-center">
                            <span className="text-[10px] text-gray-300 dark:text-gray-600">&mdash;</span>
                          </td>
                          <td className="px-4 py-1.5 text-right font-mono text-[11px] text-gray-500 dark:text-gray-400">{lStr}</td>
                          <td className="px-4 py-1.5 text-right font-mono text-[11px] text-gray-500 dark:text-gray-400">{rStr}</td>
                          <td className={`px-4 py-1.5 text-right font-mono text-[11px] font-semibold ${d.color}`}>{d.text}</td>
                        </tr>
                      );
                    });
                  })}

                {/* Left-only columns */}
                {result.leftOnly.map((name) => (
                  <tr key={`l-${name}`} className="bg-amber-50/40 dark:bg-amber-900/10">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-gray-700 dark:text-gray-300 text-sm">{name}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400">
                        Only A
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-400">&bull;</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-300 dark:text-gray-600">&mdash;</td>
                    <td className="px-4 py-2.5" />
                  </tr>
                ))}

                {/* Right-only columns */}
                {result.rightOnly.map((name) => (
                  <tr key={`r-${name}`} className="bg-teal-50/40 dark:bg-teal-900/10">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-gray-700 dark:text-gray-300 text-sm">{name}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-100 dark:bg-teal-900/40 text-teal-600 dark:text-teal-400">
                        Only B
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-300 dark:text-gray-600">&mdash;</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-400">&bull;</td>
                    <td className="px-4 py-2.5" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Empty state */}
      {!loading && !error && !result && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <ArrowLeftRight className="h-10 w-10 text-gray-300 dark:text-gray-600" />
          <p className="text-sm text-gray-400 dark:text-gray-500">
            Select two datasets above to compare them side by side
          </p>
        </div>
      )}
    </motion.section>
  );
}
