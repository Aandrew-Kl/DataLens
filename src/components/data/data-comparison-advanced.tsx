"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ReactECharts from "echarts-for-react";
import {
  ArrowLeftRight,
  CheckCircle2,
  Download,
  GitCompareArrows,
  Layers3,
  Loader2,
  Sigma,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { assessDataQuality } from "@/lib/utils/data-quality";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataComparisonAdvancedProps {
  datasets: Array<{ tableName: string; columns: ColumnProfile[]; rowCount: number }>;
}

type Notice = { tone: "success" | "error" | "info"; message: string } | null;

interface ColumnStats {
  mean: number | null;
  median: number | null;
  stddev: number | null;
  nullCount: number;
}

interface PairResult {
  leftColumn: string;
  rightColumn: string;
  leftType: ColumnProfile["type"];
  rightType: ColumnProfile["type"];
  leftStats: ColumnStats;
  rightStats: ColumnStats;
  jaccard: number | null;
}

interface HistogramSeries {
  leftColumn: string;
  rightColumn: string;
  bins: Array<{ label: string; left: number; right: number }>;
}

const EASE = [0.16, 1, 0.3, 1] as const;

function quoteId(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function diffTone(left: number | null, right: number | null, tolerance = 0.0001): string {
  if (left === null || right === null) return "text-slate-500 dark:text-slate-400";
  if (Math.abs(left - right) <= tolerance) return "text-emerald-600 dark:text-emerald-300";
  return "text-red-600 dark:text-red-300";
}

function buildHistogramBins(leftValues: number[], rightValues: number[]): Array<{ label: string; left: number; right: number }> {
  const values = [...leftValues, ...rightValues];
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const binCount = Math.min(14, Math.max(5, Math.ceil(Math.sqrt(values.length))));
  const width = (max - min) / binCount || 1;
  const bins = new Array(binCount).fill(null).map((_, index) => ({
    label: `${(min + index * width).toFixed(1)}`,
    left: 0,
    right: 0,
  }));

  const bucket = (value: number) => {
    if (value === max) return binCount - 1;
    return Math.min(binCount - 1, Math.max(0, Math.floor((value - min) / width)));
  };

  leftValues.forEach((value) => {
    bins[bucket(value)].left += 1;
  });
  rightValues.forEach((value) => {
    bins[bucket(value)].right += 1;
  });
  return bins;
}

function exportReportHtml(
  leftTable: string,
  rightTable: string,
  leftQuality: number,
  rightQuality: number,
  leftOnly: string[],
  rightOnly: string[],
  typeMismatches: PairResult[],
  pairs: PairResult[],
) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${leftTable} vs ${rightTable}</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: linear-gradient(135deg, #020617, #0f172a 45%, #082f49); color: #e2e8f0; }
    .shell { padding: 32px; }
    .card { margin-bottom: 16px; border: 1px solid rgba(255,255,255,.08); border-radius: 24px; background: rgba(15,23,42,.72); padding: 20px; backdrop-filter: blur(18px); }
    .title { margin: 0; font-size: 28px; }
    .subtle { color: #94a3b8; font-size: 13px; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { padding: 10px; border-bottom: 1px solid rgba(255,255,255,.08); font-size: 13px; text-align: left; }
  </style>
</head>
<body>
  <div class="shell">
    <section class="card">
      <h1 class="title">${leftTable} vs ${rightTable}</h1>
      <p class="subtle">Advanced comparison export</p>
      <div class="grid" style="margin-top: 16px;">
        <div class="card"><div class="subtle">Left quality</div><div style="font-size:36px;font-weight:700;">${leftQuality}</div></div>
        <div class="card"><div class="subtle">Right quality</div><div style="font-size:36px;font-weight:700;">${rightQuality}</div></div>
      </div>
    </section>
    <section class="card">
      <h2>Schema diff</h2>
      <p class="subtle">Left-only: ${leftOnly.join(", ") || "none"}<br />Right-only: ${rightOnly.join(", ") || "none"}</p>
      <table>
        <thead><tr><th>Left column</th><th>Right column</th><th>Left type</th><th>Right type</th></tr></thead>
        <tbody>
          ${typeMismatches.map((pair) => `<tr><td>${pair.leftColumn}</td><td>${pair.rightColumn}</td><td>${pair.leftType}</td><td>${pair.rightType}</td></tr>`).join("") || '<tr><td colspan="4">No type mismatches</td></tr>'}
        </tbody>
      </table>
    </section>
    <section class="card">
      <h2>Mapped column stats</h2>
      <table>
        <thead><tr><th>Left</th><th>Right</th><th>Mean</th><th>Median</th><th>Stddev</th><th>Nulls</th><th>Jaccard</th></tr></thead>
        <tbody>
          ${pairs.map((pair) => `<tr><td>${pair.leftColumn}</td><td>${pair.rightColumn}</td><td>${pair.leftStats.mean ?? "—"} / ${pair.rightStats.mean ?? "—"}</td><td>${pair.leftStats.median ?? "—"} / ${pair.rightStats.median ?? "—"}</td><td>${pair.leftStats.stddev ?? "—"} / ${pair.rightStats.stddev ?? "—"}</td><td>${pair.leftStats.nullCount} / ${pair.rightStats.nullCount}</td><td>${pair.jaccard == null ? "—" : pair.jaccard.toFixed(3)}</td></tr>`).join("")}
        </tbody>
      </table>
    </section>
  </div>
</body>
</html>`;
}

export default function DataComparisonAdvanced({ datasets }: DataComparisonAdvancedProps) {
  const [leftTable, setLeftTable] = useState(datasets[0]?.tableName ?? "");
  const [rightTable, setRightTable] = useState(datasets[1]?.tableName ?? datasets[0]?.tableName ?? "");
  const [manualMap, setManualMap] = useState<Record<string, string>>({});
  const [pairResults, setPairResults] = useState<PairResult[]>([]);
  const [histograms, setHistograms] = useState<HistogramSeries[]>([]);
  const [selectedHistogram, setSelectedHistogram] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const leftDataset = useMemo(
    () => datasets.find((dataset) => dataset.tableName === leftTable) ?? null,
    [datasets, leftTable],
  );
  const rightDataset = useMemo(
    () => datasets.find((dataset) => dataset.tableName === rightTable) ?? null,
    [datasets, rightTable],
  );

  const leftColumns = useMemo(() => leftDataset?.columns ?? [], [leftDataset]);
  const rightColumns = useMemo(() => rightDataset?.columns ?? [], [rightDataset]);
  const rightColumnNames = useMemo(() => new Set(rightColumns.map((column) => column.name)), [rightColumns]);
  const autoMap = useMemo(
    () =>
      Object.fromEntries(
        leftColumns
          .filter((column) => rightColumnNames.has(column.name))
          .map((column) => [column.name, column.name]),
      ),
    [leftColumns, rightColumnNames],
  );
  const effectiveMap = useMemo(
    () =>
      Object.fromEntries(
        leftColumns.map((column) => [
          column.name,
          manualMap[column.name] || autoMap[column.name] || "",
        ]),
      ),
    [autoMap, leftColumns, manualMap],
  );
  const mappedPairs = useMemo(
    () =>
      leftColumns
        .map((column) => ({
          left: column,
          right: rightColumns.find((candidate) => candidate.name === effectiveMap[column.name]) ?? null,
        }))
        .filter((pair) => pair.right),
    [effectiveMap, leftColumns, rightColumns],
  );

  const leftQuality = useMemo(
    () => (leftDataset ? assessDataQuality(leftDataset.columns, leftDataset.rowCount).overallScore : 0),
    [leftDataset],
  );
  const rightQuality = useMemo(
    () => (rightDataset ? assessDataQuality(rightDataset.columns, rightDataset.rowCount).overallScore : 0),
    [rightDataset],
  );
  const rowDiffPercent = useMemo(() => {
    if (!leftDataset || !rightDataset || leftDataset.rowCount === 0) return 0;
    return ((rightDataset.rowCount - leftDataset.rowCount) / leftDataset.rowCount) * 100;
  }, [leftDataset, rightDataset]);
  const leftOnly = useMemo(
    () => leftColumns.filter((column) => !rightColumnNames.has(column.name)).map((column) => column.name),
    [leftColumns, rightColumnNames],
  );
  const rightOnly = useMemo(() => {
    const leftNames = new Set(leftColumns.map((column) => column.name));
    return rightColumns.filter((column) => !leftNames.has(column.name)).map((column) => column.name);
  }, [leftColumns, rightColumns]);
  const histogramOptions = useMemo(
    () => histograms.map((histogram) => `${histogram.leftColumn} → ${histogram.rightColumn}`),
    [histograms],
  );
  const activeHistogram = useMemo(
    () => histograms.find((histogram) => `${histogram.leftColumn} → ${histogram.rightColumn}` === selectedHistogram) ?? histograms[0] ?? null,
    [histograms, selectedHistogram],
  );

  useEffect(() => {
    if (!leftDataset || !rightDataset || leftDataset.tableName === rightDataset.tableName) {
      setPairResults([]);
      setHistograms([]);
      return;
    }

    const activeLeftDataset = leftDataset;
    const activeRightDataset = rightDataset;
    let cancelled = false;
    async function loadComparison() {
      setLoading(true);
      setNotice(null);
      try {
        const pairRows = await Promise.all(
          mappedPairs.map(async ({ left, right }) => {
            if (!right) return null;
            const leftField = quoteId(left.name);
            const rightField = quoteId(right.name);
            const leftTableSql = quoteId(activeLeftDataset.tableName);
            const rightTableSql = quoteId(activeRightDataset.tableName);

            const [leftStatsRows, rightStatsRows, jaccardRows] = await Promise.all([
              runQuery(`
                SELECT
                  AVG(TRY_CAST(${leftField} AS DOUBLE)) AS mean_value,
                  MEDIAN(TRY_CAST(${leftField} AS DOUBLE)) AS median_value,
                  STDDEV_SAMP(TRY_CAST(${leftField} AS DOUBLE)) AS stddev_value,
                  COUNT(*) FILTER (WHERE ${leftField} IS NULL) AS null_count
                FROM ${leftTableSql}
              `),
              runQuery(`
                SELECT
                  AVG(TRY_CAST(${rightField} AS DOUBLE)) AS mean_value,
                  MEDIAN(TRY_CAST(${rightField} AS DOUBLE)) AS median_value,
                  STDDEV_SAMP(TRY_CAST(${rightField} AS DOUBLE)) AS stddev_value,
                  COUNT(*) FILTER (WHERE ${rightField} IS NULL) AS null_count
                FROM ${rightTableSql}
              `),
              left.type === "string" && right.type === "string"
                ? runQuery(`
                    WITH left_values AS (
                      SELECT DISTINCT CAST(${leftField} AS VARCHAR) AS value
                      FROM ${leftTableSql}
                      WHERE ${leftField} IS NOT NULL
                    ),
                    right_values AS (
                      SELECT DISTINCT CAST(${rightField} AS VARCHAR) AS value
                      FROM ${rightTableSql}
                      WHERE ${rightField} IS NOT NULL
                    )
                    SELECT
                      (SELECT COUNT(*) FROM (SELECT value FROM left_values INTERSECT SELECT value FROM right_values)) AS overlap_count,
                      (SELECT COUNT(*) FROM (SELECT value FROM left_values UNION SELECT value FROM right_values)) AS union_count
                  `)
                : Promise.resolve([]),
            ]);

            const leftStatsRow = leftStatsRows[0] ?? {};
            const rightStatsRow = rightStatsRows[0] ?? {};
            const jaccardRow = jaccardRows[0] ?? {};
            const unionCount = toNumber(jaccardRow.union_count);
            return {
              leftColumn: left.name,
              rightColumn: right.name,
              leftType: left.type,
              rightType: right.type,
              leftStats: {
                mean: toNumber(leftStatsRow.mean_value),
                median: toNumber(leftStatsRow.median_value),
                stddev: toNumber(leftStatsRow.stddev_value),
                nullCount: toNumber(leftStatsRow.null_count) ?? 0,
              },
              rightStats: {
                mean: toNumber(rightStatsRow.mean_value),
                median: toNumber(rightStatsRow.median_value),
                stddev: toNumber(rightStatsRow.stddev_value),
                nullCount: toNumber(rightStatsRow.null_count) ?? 0,
              },
              jaccard: unionCount ? (toNumber(jaccardRow.overlap_count) ?? 0) / unionCount : null,
            } satisfies PairResult;
          }),
        );

        const numericPairs = mappedPairs
          .filter((pair) => pair.left.type === "number" && pair.right?.type === "number")
          .slice(0, 4);
        const histogramRows = await Promise.all(
          numericPairs.map(async ({ left, right }) => {
            if (!right || !leftDataset || !rightDataset) return null;
            const leftValuesRows = await runQuery(`
              SELECT TRY_CAST(${quoteId(left.name)} AS DOUBLE) AS value
              FROM ${quoteId(leftDataset.tableName)}
              WHERE ${quoteId(left.name)} IS NOT NULL
              LIMIT 2000
            `);
            const rightValuesRows = await runQuery(`
              SELECT TRY_CAST(${quoteId(right.name)} AS DOUBLE) AS value
              FROM ${quoteId(rightDataset.tableName)}
              WHERE ${quoteId(right.name)} IS NOT NULL
              LIMIT 2000
            `);
            return {
              leftColumn: left.name,
              rightColumn: right.name,
              bins: buildHistogramBins(
                leftValuesRows.map((row) => toNumber(row.value)).filter((value): value is number => value !== null),
                rightValuesRows.map((row) => toNumber(row.value)).filter((value): value is number => value !== null),
              ),
            } satisfies HistogramSeries;
          }),
        );

        if (!cancelled) {
          startTransition(() => {
            setPairResults(pairRows.filter((pair): pair is PairResult => pair !== null));
            setHistograms(histogramRows.filter((histogram): histogram is HistogramSeries => histogram !== null));
          });
        }
      } catch (error) {
        if (!cancelled) {
          setNotice({
            tone: "error",
            message: error instanceof Error ? error.message : "Failed to compare the selected datasets.",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadComparison();
    return () => {
      cancelled = true;
    };
  }, [leftDataset, mappedPairs, rightDataset]);

  function handleExport() {
    if (!leftDataset || !rightDataset) return;
    try {
      const html = exportReportHtml(
        leftDataset.tableName,
        rightDataset.tableName,
        leftQuality,
        rightQuality,
        leftOnly,
        rightOnly,
        pairResults.filter((pair) => pair.leftType !== pair.rightType),
        pairResults,
      );
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${leftDataset.tableName}-vs-${rightDataset.tableName}.html`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice({ tone: "success", message: "Exported the comparison report as HTML." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Failed to export the comparison report." });
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      className="overflow-hidden rounded-3xl border border-white/10 bg-white/10 shadow-2xl shadow-slate-950/10 backdrop-blur-xl dark:bg-slate-950/45"
    >
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
              <GitCompareArrows className="h-3.5 w-3.5" />
              Advanced Comparison
            </div>
            <h2 className="mt-3 text-xl font-semibold text-slate-950 dark:text-slate-50">Compare two loaded datasets side by side</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Diff schemas, compare statistics, inspect value overlap, and export a standalone comparison report.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={!leftDataset || !rightDataset}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200"
          >
            <Download className="h-4 w-4" />
            Export Comparison Report
          </button>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_auto_1fr]">
          <label className="text-sm text-slate-600 dark:text-slate-300">
            <span className="mb-2 block font-medium text-slate-800 dark:text-slate-100">Left dataset</span>
            <select value={leftTable} onChange={(event) => setLeftTable(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-black/10 px-3 py-2.5 text-slate-900 outline-none transition focus:border-cyan-400 dark:text-slate-100">
              {datasets.map((dataset) => <option key={dataset.tableName} value={dataset.tableName}>{dataset.tableName}</option>)}
            </select>
          </label>
          <div className="flex items-end justify-center text-slate-500 dark:text-slate-400">
            <ArrowLeftRight className="mb-2 h-5 w-5" />
          </div>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            <span className="mb-2 block font-medium text-slate-800 dark:text-slate-100">Right dataset</span>
            <select value={rightTable} onChange={(event) => setRightTable(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-black/10 px-3 py-2.5 text-slate-900 outline-none transition focus:border-cyan-400 dark:text-slate-100">
              {datasets.map((dataset) => <option key={dataset.tableName} value={dataset.tableName}>{dataset.tableName}</option>)}
            </select>
          </label>
        </div>

        <AnimatePresence mode="wait">
          {notice ? (
            <motion.div
              key={notice.message}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
                notice.tone === "success"
                  ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : notice.tone === "error"
                    ? "border-red-400/25 bg-red-500/10 text-red-700 dark:text-red-300"
                    : "border-sky-400/25 bg-sky-500/10 text-sky-700 dark:text-sky-300"
              }`}
            >
              {notice.message}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="grid gap-6 p-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                label: "Row count delta",
                value: leftDataset && rightDataset ? formatPercent(rowDiffPercent, 1) : "—",
                tone: rowDiffPercent === 0 ? "text-emerald-600 dark:text-emerald-300" : rowDiffPercent > 0 ? "text-red-600 dark:text-red-300" : "text-cyan-600 dark:text-cyan-300",
              },
              {
                label: "Quality score delta",
                value: leftDataset && rightDataset ? `${rightQuality - leftQuality > 0 ? "+" : ""}${rightQuality - leftQuality}` : "—",
                tone: rightQuality === leftQuality ? "text-emerald-600 dark:text-emerald-300" : rightQuality > leftQuality ? "text-cyan-600 dark:text-cyan-300" : "text-red-600 dark:text-red-300",
              },
            ].map((card) => (
              <div key={card.label} className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{card.label}</p>
                <p className={`mt-3 text-3xl font-semibold ${card.tone}`}>{card.value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-50">
              <Layers3 className="h-4 w-4 text-cyan-500" />
              Column mapping
            </p>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Override the automatic name-based mapping when two fields describe the same thing with different names.
            </p>
            <div className="mt-4 space-y-3">
              {leftColumns.map((column) => (
                <div key={column.name} className="grid gap-3 rounded-2xl border border-white/10 bg-black/10 p-3 md:grid-cols-[0.95fr_1.05fr]">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{column.name}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{column.type}</p>
                  </div>
                  <select
                    value={effectiveMap[column.name] ?? ""}
                    onChange={(event) =>
                      setManualMap((current) => ({
                        ...current,
                        [column.name]: event.target.value,
                      }))
                    }
                    className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-cyan-400 dark:text-slate-100"
                  >
                    <option value="">No mapping</option>
                    {rightColumns.map((candidate) => (
                      <option key={candidate.name} value={candidate.name}>
                        {candidate.name} ({candidate.type})
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-50">
              <CheckCircle2 className="h-4 w-4 text-cyan-500" />
              Schema diff
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-700 dark:text-red-300">Left only</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {leftOnly.length ? leftOnly.map((name) => <span key={name} className="rounded-full border border-red-400/20 px-3 py-1 text-xs text-red-700 dark:text-red-300">{name}</span>) : <span className="text-sm text-emerald-700 dark:text-emerald-300">No left-only columns</span>}
                </div>
              </div>
              <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-700 dark:text-red-300">Right only</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {rightOnly.length ? rightOnly.map((name) => <span key={name} className="rounded-full border border-red-400/20 px-3 py-1 text-xs text-red-700 dark:text-red-300">{name}</span>) : <span className="text-sm text-emerald-700 dark:text-emerald-300">No right-only columns</span>}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-50">
                  <Sigma className="h-4 w-4 text-cyan-500" />
                  Statistical comparison
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Green values align closely. Red values diverge.</p>
              </div>
              {loading ? (
                <span className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin text-cyan-500" />
                  Comparing
                </span>
              ) : null}
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
              <div className="max-h-[30rem] overflow-auto">
                <table className="min-w-full divide-y divide-white/10 text-sm">
                  <thead className="bg-black/10">
                    <tr>
                      {["Left", "Right", "Mean", "Median", "Stddev", "Nulls", "Jaccard"].map((label) => (
                        <th key={label} className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-200">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 bg-white/5">
                    {pairResults.map((pair) => (
                      <tr key={`${pair.leftColumn}:${pair.rightColumn}`}>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                          <div>{pair.leftColumn}</div>
                          <div className={`text-xs ${pair.leftType === pair.rightType ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-300"}`}>{pair.leftType}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                          <div>{pair.rightColumn}</div>
                          <div className={`text-xs ${pair.leftType === pair.rightType ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-300"}`}>{pair.rightType}</div>
                        </td>
                        <td className={`px-4 py-3 ${diffTone(pair.leftStats.mean, pair.rightStats.mean)}`}>{pair.leftStats.mean == null ? "—" : `${formatNumber(pair.leftStats.mean)} / ${formatNumber(pair.rightStats.mean ?? 0)}`}</td>
                        <td className={`px-4 py-3 ${diffTone(pair.leftStats.median, pair.rightStats.median)}`}>{pair.leftStats.median == null ? "—" : `${formatNumber(pair.leftStats.median)} / ${formatNumber(pair.rightStats.median ?? 0)}`}</td>
                        <td className={`px-4 py-3 ${diffTone(pair.leftStats.stddev, pair.rightStats.stddev)}`}>{pair.leftStats.stddev == null ? "—" : `${formatNumber(pair.leftStats.stddev)} / ${formatNumber(pair.rightStats.stddev ?? 0)}`}</td>
                        <td className={pair.leftStats.nullCount === pair.rightStats.nullCount ? "px-4 py-3 text-emerald-600 dark:text-emerald-300" : "px-4 py-3 text-red-600 dark:text-red-300"}>
                          {formatNumber(pair.leftStats.nullCount)} / {formatNumber(pair.rightStats.nullCount)}
                        </td>
                        <td className={pair.jaccard == null ? "px-4 py-3 text-slate-500 dark:text-slate-400" : pair.jaccard >= 0.7 ? "px-4 py-3 text-emerald-600 dark:text-emerald-300" : "px-4 py-3 text-red-600 dark:text-red-300"}>
                          {pair.jaccard == null ? "—" : pair.jaccard.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                    {!pairResults.length && !loading ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                          Map at least one column pair to populate the comparison matrix.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 dark:bg-slate-950/35">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">Distribution comparison</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Overlayed histograms for mapped numeric columns.</p>
              </div>
              {histogramOptions.length ? (
                <select value={selectedHistogram || histogramOptions[0]} onChange={(event) => setSelectedHistogram(event.target.value)} className="rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-400 dark:text-slate-100">
                  {histogramOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              ) : null}
            </div>

            {activeHistogram ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-2">
                <ReactECharts
                  notMerge
                  lazyUpdate
                  style={{ height: 280 }}
                  option={{
                    tooltip: { trigger: "axis" },
                    legend: {
                      bottom: 0,
                      textStyle: {
                        color: typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "#cbd5e1" : "#475569",
                      },
                    },
                    grid: { left: 40, right: 18, top: 20, bottom: 48, containLabel: true },
                    xAxis: {
                      type: "category",
                      data: activeHistogram.bins.map((bin) => bin.label),
                      axisLabel: {
                        color: typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "#cbd5e1" : "#475569",
                      },
                    },
                    yAxis: {
                      type: "value",
                      axisLabel: {
                        color: typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "#cbd5e1" : "#475569",
                      },
                    },
                    series: [
                      { name: activeHistogram.leftColumn, type: "bar", data: activeHistogram.bins.map((bin) => bin.left), itemStyle: { color: "#38bdf8", opacity: 0.7 } },
                      { name: activeHistogram.rightColumn, type: "bar", data: activeHistogram.bins.map((bin) => bin.right), itemStyle: { color: "#22c55e", opacity: 0.7 } },
                    ],
                  }}
                />
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-8 text-sm text-slate-500 dark:text-slate-400">
                Map numeric columns on both sides to see an overlay histogram.
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
