"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, ArrowUpDown, BarChart3, Hash, Loader2, Search, Sigma, Table2 } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface FrequencyTableProps { tableName: string; columns: ColumnProfile[]; }
interface BucketRow { key: string; label: string; count: number; valueSort: number | string; }
type SortKey = "count" | "value";
type SortDir = "asc" | "desc";

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
const toNumber = (value: unknown) => {
  const parsed = value == null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const formatPercent = (value: number) => `${value.toFixed(value >= 10 ? 1 : 2)}%`;
const formatBin = (start: number | null, end: number | null) =>
  start == null || end == null ? "No values" : start === end ? nf.format(start) : `${nf.format(start)} – ${nf.format(end)}`;

function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

function buildHistogram(rows: BucketRow[], dark: boolean) {
  const axis = dark ? "#94a3b8" : "#64748b";
  const grid = dark ? "#1e293b" : "#e2e8f0";
  return {
    animationDuration: 400,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: grid,
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
    },
    grid: { left: 14, right: 16, top: 20, bottom: 32, containLabel: true },
    xAxis: {
      type: "category",
      data: rows.map((row) => row.label),
      axisLabel: { color: axis, rotate: rows.length > 10 ? 22 : 0, fontSize: 11 },
      axisLine: { lineStyle: { color: grid } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: axis, fontSize: 11 },
      splitLine: { lineStyle: { color: grid, type: "dashed" } },
    },
    series: [{ type: "bar", data: rows.map((row) => row.count), barMaxWidth: 28, itemStyle: { color: "#38bdf8", borderRadius: [8, 8, 0, 0] } }],
  };
}

export default function FrequencyTable({ tableName, columns }: FrequencyTableProps) {
  const dark = useDarkMode();
  const [selectedName, setSelectedName] = useState(columns[0]?.name ?? "");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [binMode, setBinMode] = useState<"auto" | "custom">("auto");
  const [customBinCount, setCustomBinCount] = useState(12);
  const [rows, setRows] = useState<BucketRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  const selectedColumn = useMemo(
    () => columns.find((column) => column.name === selectedName) ?? columns[0] ?? null,
    [columns, selectedName],
  );
  const isNumeric = selectedColumn?.type === "number";
  const autoBinCount = useMemo(() => {
    const distinct = Math.max(selectedColumn?.uniqueCount ?? 1, 1);
    return Math.min(24, Math.max(6, Math.round(Math.sqrt(distinct))));
  }, [selectedColumn]);
  const binCount = isNumeric ? (binMode === "custom" ? Math.min(60, Math.max(2, customBinCount || 12)) : autoBinCount) : null;

  useEffect(() => {
    if (!columns.length) return void setSelectedName("");
    if (!columns.some((column) => column.name === selectedName)) setSelectedName(columns[0].name);
  }, [columns, selectedName]);

  useEffect(() => {
    setSortBy(isNumeric ? "value" : "count");
    setSortDir(isNumeric ? "asc" : "desc");
    setSearch("");
  }, [selectedName, isNumeric]);

  useEffect(() => {
    if (!selectedColumn) return void setRows([]);
    let cancelled = false;

    async function loadDistribution() {
      setLoading(true);
      setError(null);
      try {
        const table = quote(tableName);
        const field = quote(selectedColumn.name);
        const sql = isNumeric && binCount
          ? `
              WITH clean AS (SELECT CAST(${field} AS DOUBLE) AS value FROM ${table} WHERE ${field} IS NOT NULL),
              stats AS (SELECT MIN(value) AS min_value, MAX(value) AS max_value FROM clean),
              series AS (SELECT range AS bin_index FROM range(0, ${binCount})),
              binned AS (
                SELECT CASE
                  WHEN s.min_value = s.max_value THEN 0
                  ELSE LEAST(CAST(FLOOR(((c.value - s.min_value) / NULLIF(s.max_value - s.min_value, 0)) * ${binCount}) AS INTEGER), ${binCount - 1})
                END AS bin_index, COUNT(*) AS count
                FROM clean c CROSS JOIN stats s GROUP BY 1
              )
              SELECT series.bin_index, s.min_value + ((s.max_value - s.min_value) / ${binCount}.0) * series.bin_index AS start_value,
                CASE WHEN series.bin_index = ${binCount - 1} THEN s.max_value
                  ELSE s.min_value + ((s.max_value - s.min_value) / ${binCount}.0) * (series.bin_index + 1) END AS end_value,
                COALESCE(binned.count, 0) AS count
              FROM series CROSS JOIN stats s LEFT JOIN binned USING (bin_index) ORDER BY series.bin_index
            `
          : `
              SELECT CAST(${field} AS VARCHAR) AS bucket_label, COUNT(*) AS count
              FROM ${table} WHERE ${field} IS NOT NULL GROUP BY 1 ORDER BY 1
            `;
        const result = await runQuery(sql);
        if (cancelled) return;

        if (isNumeric) {
          const mapped = result.map((row, index) => ({
            key: `bin-${index}`,
            label: formatBin(toNumber(row.start_value), toNumber(row.end_value)),
            count: Number(row.count ?? 0),
            valueSort: toNumber(row.start_value) ?? Number.POSITIVE_INFINITY,
          }));
          const total = mapped.reduce((sum, row) => sum + row.count, 0);
          if (!total) return void setRows([]);
          const sameLabel = mapped.every((row) => row.label === mapped[0]?.label);
          return void setRows(sameLabel ? [mapped.find((row) => row.count > 0) ?? mapped[0]] : mapped);
        }

        setRows(result.map((row, index) => ({
          key: `value-${index}`,
          label: String(row.bucket_label ?? ""),
          count: Number(row.count ?? 0),
          valueSort: String(row.bucket_label ?? ""),
        })));
      } catch (cause) {
        if (!cancelled) {
          setRows([]);
          setError(cause instanceof Error ? cause.message : "Failed to load frequency table.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadDistribution();
    return () => { cancelled = true; };
  }, [binCount, isNumeric, selectedColumn, tableName]);

  const totalCount = useMemo(() => rows.reduce((sum, row) => sum + row.count, 0), [rows]);
  const displayRows = useMemo(() => {
    const filtered = rows.filter((row) => row.label.toLowerCase().includes(deferredSearch.trim().toLowerCase()));
    filtered.sort((left, right) => {
      const direction = sortDir === "asc" ? 1 : -1;
      if (sortBy === "count") return (left.count - right.count) * direction;
      if (typeof left.valueSort === "number" && typeof right.valueSort === "number") return (left.valueSort - right.valueSort) * direction;
      return String(left.valueSort).localeCompare(String(right.valueSort), undefined, { numeric: true }) * direction;
    });
    let running = 0;
    return filtered.map((row) => {
      running += row.count;
      return { ...row, percentage: totalCount ? (row.count / totalCount) * 100 : 0, cumulativePercentage: totalCount ? (running / totalCount) * 100 : 0 };
    });
  }, [deferredSearch, rows, sortBy, sortDir, totalCount]);
  const maxCount = displayRows.reduce((max, row) => Math.max(max, row.count), 1);

  if (!columns.length) {
    return (
      <section className="rounded-2xl border border-gray-200/70 bg-white/80 p-6 shadow-sm dark:border-gray-700/70 dark:bg-gray-900/60">
        <p className="text-sm text-gray-600 dark:text-gray-300">No columns available for frequency analysis.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-gray-200/70 bg-white/80 p-6 shadow-sm dark:border-gray-700/70 dark:bg-gray-900/60">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200/70 pb-5 dark:border-gray-700/70">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-sky-600 dark:text-sky-400"><Table2 className="h-4 w-4" /> Frequency Table</div>
          <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-gray-100">{selectedColumn?.name}</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Distribution for `{tableName}` with sortable counts, cumulative percentages, inline bars, and search.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-medium">
          <span className="rounded-full border border-gray-200/70 px-3 py-1.5 text-gray-700 dark:border-gray-700 dark:text-gray-200"><Sigma className="mr-1 inline h-3.5 w-3.5" /> {formatNumber(totalCount)} rows</span>
          <span className="rounded-full border border-gray-200/70 px-3 py-1.5 text-gray-700 dark:border-gray-700 dark:text-gray-200"><Hash className="mr-1 inline h-3.5 w-3.5" /> {formatNumber(rows.length)} buckets</span>
          <span className="rounded-full border border-gray-200/70 px-3 py-1.5 capitalize text-gray-700 dark:border-gray-700 dark:text-gray-200">{selectedColumn?.type}</span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto_auto]">
        <select value={selectedColumn?.name ?? ""} onChange={(event) => setSelectedName(event.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-sky-400 dark:border-gray-700 dark:bg-gray-950/60 dark:text-gray-100">
          {columns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
        </select>
        <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 dark:border-gray-700 dark:bg-gray-950/60">
          <Search className="h-4 w-4 text-gray-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search values or bins" className="w-full bg-transparent py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100" />
        </label>
        <button type="button" onClick={() => setSortBy((current) => current === "count" ? "value" : "count")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:border-sky-300 hover:text-sky-700 dark:border-gray-700 dark:text-gray-200 dark:hover:border-sky-500/50 dark:hover:text-sky-300">
          <ArrowUpDown className="h-4 w-4" /> Sort: {sortBy}
        </button>
        <button type="button" onClick={() => setSortDir((current) => current === "asc" ? "desc" : "asc")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:border-sky-300 hover:text-sky-700 dark:border-gray-700 dark:text-gray-200 dark:hover:border-sky-500/50 dark:hover:text-sky-300">
          {sortDir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />} {sortDir}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {isNumeric && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="mt-3 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950/50">
              {(["auto", "custom"] as const).map((mode) => (
                <button key={mode} type="button" onClick={() => setBinMode(mode)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${binMode === mode ? "bg-sky-500 text-white" : "text-gray-600 dark:text-gray-300"}`}>
                  {mode === "auto" ? `Auto (${autoBinCount})` : "Custom"}
                </button>
              ))}
            </div>
            {binMode === "custom" && (
              <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-950/60 dark:text-gray-200">
                <BarChart3 className="h-4 w-4 text-gray-400" />
                <span>Bins</span>
                <input type="number" min={2} max={60} value={customBinCount} onChange={(event) => setCustomBinCount(Number(event.target.value) || 12)} className="w-16 bg-transparent text-right outline-none" />
              </label>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {isNumeric && displayRows.length > 0 && (
          <motion.div key={`${selectedName}-${binCount}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="mt-5 rounded-2xl border border-gray-200/70 bg-gray-50/80 p-4 dark:border-gray-700/70 dark:bg-gray-950/35">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200"><BarChart3 className="h-4 w-4 text-sky-500" /> Histogram</div>
            <ReactECharts option={buildHistogram(displayRows, dark)} style={{ height: 240, width: "100%" }} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative mt-5 overflow-hidden rounded-2xl border border-gray-200/70 dark:border-gray-700/70">
        {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-sm dark:bg-gray-950/70"><Loader2 className="h-5 w-5 animate-spin text-sky-500" /></div>}
        {displayRows.length > 0 ? (
          <div className="max-h-[28rem] overflow-auto">
            <table className="min-w-full divide-y divide-gray-200/70 text-sm dark:divide-gray-700/70">
              <thead className="sticky top-0 bg-gray-50/90 backdrop-blur dark:bg-gray-950/90">
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3 font-semibold">Value</th>
                  <th className="px-4 py-3 font-semibold">Count</th>
                  <th className="px-4 py-3 font-semibold">Percentage</th>
                  <th className="px-4 py-3 font-semibold">Cumulative</th>
                  <th className="px-4 py-3 font-semibold">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200/70 bg-white/70 dark:divide-gray-800/70 dark:bg-gray-900/40">
                {displayRows.map((row) => (
                  <tr key={row.key} className="align-top transition hover:bg-sky-50/60 dark:hover:bg-sky-500/5">
                    <td className="max-w-[18rem] px-4 py-3 font-medium text-gray-900 dark:text-gray-100" title={row.label}>{row.label}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{formatNumber(row.count)}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{formatPercent(row.percentage)}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{formatPercent(row.cumulativePercentage)}</td>
                    <td className="px-4 py-3"><div className="h-2.5 w-40 rounded-full bg-gray-200 dark:bg-gray-800"><div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-cyan-500" style={{ width: `${(row.count / maxCount) * 100}%` }} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !loading && (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
            <Search className="h-5 w-5 text-gray-400" />
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">No matching values.</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{error ?? "Adjust the search, bins, or selected column."}</p>
          </div>
        )}
      </div>
    </section>
  );
}
