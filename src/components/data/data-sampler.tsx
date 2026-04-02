"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, Shuffle, Table2 } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";
interface DataSamplerProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}
type SampleMode = "random" | "stratified" | "top" | "bottom" | "systematic";
const PREVIEW_LIMIT = 10;
const MODE_OPTIONS: { id: SampleMode; label: string; hint: string }[] = [
  { id: "random", label: "Random %", hint: "Shuffle then keep a percentage." },
  { id: "stratified", label: "Stratified", hint: "Sample inside each category." },
  { id: "top", label: "Top N", hint: "Keep the highest ranked rows." },
  { id: "bottom", label: "Bottom N", hint: "Keep the lowest ranked rows." },
  { id: "systematic", label: "Every Nth", hint: "Walk the table at an interval." },
];
function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}
function clampInt(value: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : min;
}
function formatCell(value: unknown, type: ColumnProfile["type"]) {
  if (value === null || value === undefined) return "null";
  if (type === "number" && typeof value === "number") return value.toLocaleString();
  if (type === "boolean" && typeof value === "boolean") return value ? "true" : "false";
  if (type === "date") {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString();
  }
  return String(value);
}
function toCsv(rows: Record<string, unknown>[], headers: string[]) {
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[,"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    headers.map(escape).join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(",")),
  ].join("\n");
}
export default function DataSampler({ tableName, columns, rowCount }: DataSamplerProps) {
  const categoricalColumns = columns.filter(
    (column) =>
      (column.type === "string" || column.type === "boolean") &&
      column.uniqueCount > 1 &&
      column.uniqueCount <= Math.max(24, Math.min(rowCount, 60)),
  );
  const rankingColumns = columns.filter(
    (column) => column.type !== "unknown" && column.type !== "boolean",
  );
  const columnNames = columns.map((column) => column.name);
  const columnTypes = Object.fromEntries(columns.map((column) => [column.name, column.type])) as Record<string, ColumnProfile["type"]>;
  const [mode, setMode] = useState<SampleMode>("random");
  const [percent, setPercent] = useState(10);
  const [stratifyColumn, setStratifyColumn] = useState("");
  const [orderColumn, setOrderColumn] = useState("");
  const [count, setCount] = useState(100);
  const [step, setStep] = useState(10);
  const [preview, setPreview] = useState<Record<string, unknown>[]>([]);
  const [sampleSize, setSampleSize] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeStratifyColumn = categoricalColumns.find((column) => column.name === stratifyColumn)?.name ?? categoricalColumns[0]?.name ?? "";
  const activeOrderColumn = rankingColumns.find((column) => column.name === orderColumn)?.name ?? rankingColumns[0]?.name ?? "";
  const samplePercent = clampInt(percent, 1, 100);
  const sampleCount = clampInt(count, 1, Math.max(rowCount, 1));
  const sampleStep = clampInt(step, 1, Math.max(rowCount, 1));
  useEffect(() => {
    if (activeStratifyColumn !== stratifyColumn) setStratifyColumn(activeStratifyColumn);
    if (activeOrderColumn !== orderColumn) setOrderColumn(activeOrderColumn);
  }, [activeOrderColumn, activeStratifyColumn, orderColumn, stratifyColumn]);
  function buildSampleSql() {
    const safeTable = quoteIdentifier(tableName);
    const limit = Math.max(1, Math.ceil((rowCount * samplePercent) / 100));
    if (mode === "random") return `SELECT * FROM ${safeTable} ORDER BY RANDOM() LIMIT ${limit}`;
    if (mode === "stratified") {
      if (!activeStratifyColumn) return `SELECT * FROM ${safeTable} LIMIT 0`;
      const safeColumn = quoteIdentifier(activeStratifyColumn);
      return `
        WITH stratified AS (
          SELECT *,
            ROW_NUMBER() OVER (PARTITION BY ${safeColumn} ORDER BY RANDOM()) AS sample_rank,
            COUNT(*) OVER (PARTITION BY ${safeColumn}) AS sample_group_size
          FROM ${safeTable}
        )
        SELECT * EXCLUDE (sample_rank, sample_group_size)
        FROM stratified
        WHERE sample_rank <= GREATEST(1, CAST(CEIL(sample_group_size * ${samplePercent} / 100.0) AS BIGINT))
      `;
    }
    if (mode === "top" || mode === "bottom") {
      if (!activeOrderColumn) return `SELECT * FROM ${safeTable} LIMIT 0`;
      return `SELECT * FROM ${safeTable} ORDER BY ${quoteIdentifier(activeOrderColumn)} ${mode === "top" ? "DESC" : "ASC"} NULLS LAST LIMIT ${sampleCount}`;
    }
    return `
      WITH ordered AS (
        SELECT *, ROW_NUMBER() OVER () AS sample_row_number
        FROM ${safeTable}
      )
      SELECT * EXCLUDE (sample_row_number)
      FROM ordered
      WHERE MOD(sample_row_number - 1, ${sampleStep}) = 0
      ORDER BY sample_row_number
    `;
  }
  async function refreshPreview() {
    setLoading(true);
    setError(null);
    const sampleSql = buildSampleSql();
    try {
      const [rows, countRows] = await Promise.all([
        runQuery(`SELECT * FROM (${sampleSql}) AS sample_preview LIMIT ${PREVIEW_LIMIT}`),
        runQuery(`SELECT COUNT(*) AS cnt FROM (${sampleSql}) AS sample_count`),
      ]);
      setPreview(rows);
      setSampleSize(Number(countRows[0]?.cnt ?? 0));
    } catch (cause) {
      setPreview([]);
      setSampleSize(0);
      setError(cause instanceof Error ? cause.message : "Sampling query failed.");
    } finally {
      setLoading(false);
    }
  }
  async function downloadSample() {
    setLoading(true);
    setError(null);
    try {
      const rows = await runQuery(buildSampleSql());
      downloadFile(toCsv(rows, columnNames), `${tableName}-${mode}-sample.csv`, "text/csv;charset=utf-8;");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Download failed.");
    } finally {
      setLoading(false);
    }
  }
  const modeSummary =
    mode === "random"
      ? `Randomly shuffling ${tableName} and keeping ${samplePercent}% of rows.`
      : mode === "stratified"
        ? `Sampling ${samplePercent}% inside each ${activeStratifyColumn || "category"} group.`
        : mode === "top"
          ? `Returning the top ${formatNumber(sampleCount)} rows by ${activeOrderColumn || "the selected column"}.`
          : mode === "bottom"
            ? `Returning the bottom ${formatNumber(sampleCount)} rows by ${activeOrderColumn || "the selected column"}.`
            : `Keeping every ${formatNumber(sampleStep)}th row in scan order.`;

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="overflow-hidden rounded-2xl border border-gray-200/70 bg-white/85 shadow-sm backdrop-blur-sm dark:border-gray-700/70 dark:bg-gray-900/65"
    >
      <div className="border-b border-gray-200/70 px-6 py-5 dark:border-gray-700/70">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:border-cyan-500/20 dark:text-cyan-300">
              <Shuffle className="h-3.5 w-3.5" />
              Data Sampling
            </div>
            <h2 className="mt-3 text-xl font-semibold text-gray-900 dark:text-gray-50">Sample rows from {tableName}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300">{modeSummary}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={refreshPreview}
              disabled={loading || (mode === "stratified" && !activeStratifyColumn)}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Shuffle className="h-4 w-4" />
              Refresh preview
            </button>
            <button
              type="button"
              onClick={downloadSample}
              disabled={loading || !columns.length}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-300/80 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <Download className="h-4 w-4" />
              Download CSV
            </button>
          </div>
        </div>
      </div>
      <div className="grid gap-5 px-6 py-6 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setMode(option.id)}
                className={`rounded-2xl border p-4 text-left transition ${mode === option.id ? "border-cyan-400/60 bg-cyan-500/10 text-cyan-800 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-200" : "border-gray-200/80 bg-gray-50/80 text-gray-700 hover:border-gray-300 dark:border-gray-700/70 dark:bg-gray-950/30 dark:text-gray-200 dark:hover:border-gray-600"}`}
              >
                <p className="text-sm font-semibold">{option.label}</p>
                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{option.hint}</p>
              </button>
            ))}
          </div>
          <div className="grid gap-4 rounded-2xl border border-gray-200/80 bg-gray-50/70 p-4 dark:border-gray-700/70 dark:bg-gray-950/30 md:grid-cols-2">
            <label className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
              <span className="font-medium">Sample percentage</span>
              <input type="range" min={1} max={100} value={samplePercent} onChange={(event) => setPercent(Number(event.target.value))} className="w-full accent-cyan-500" />
              <span className="block text-xs text-gray-500 dark:text-gray-400">{samplePercent}% of {formatNumber(rowCount)} rows</span>
            </label>
            <label className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
              <span className="font-medium">Stratify by category</span>
              <select value={activeStratifyColumn} onChange={(event) => setStratifyColumn(event.target.value)} disabled={!categoricalColumns.length} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-cyan-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100">
                {categoricalColumns.length ? categoricalColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>) : <option value="">No categorical columns</option>}
              </select>
              <span className="block text-xs text-gray-500 dark:text-gray-400">Recommended for low-cardinality text or boolean fields.</span>
            </label>
            <label className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
              <span className="font-medium">Top or bottom by</span>
              <select value={activeOrderColumn} onChange={(event) => setOrderColumn(event.target.value)} disabled={!rankingColumns.length} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-cyan-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100">
                {rankingColumns.length ? rankingColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>) : <option value="">No sortable columns</option>}
              </select>
              <input type="number" min={1} max={Math.max(rowCount, 1)} value={sampleCount} onChange={(event) => setCount(Number(event.target.value))} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-cyan-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" />
            </label>
            <label className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
              <span className="font-medium">Systematic interval</span>
              <input type="number" min={1} max={Math.max(rowCount, 1)} value={sampleStep} onChange={(event) => setStep(Number(event.target.value))} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-cyan-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" />
              <span className="block text-xs text-gray-500 dark:text-gray-400">A value of 10 keeps rows 1, 11, 21, and so on.</span>
            </label>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200/80 bg-gray-50/80 p-4 dark:border-gray-700/70 dark:bg-gray-950/30">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
            <Table2 className="h-4 w-4 text-cyan-500" />
            Sample Stats
          </div>
          <div className="mt-4 space-y-3 text-sm text-gray-700 dark:text-gray-200">
            <p className="flex items-center justify-between gap-3"><span>Rows in dataset</span><span className="font-semibold">{formatNumber(rowCount)}</span></p>
            <p className="flex items-center justify-between gap-3"><span>Rows in sample</span><span className="font-semibold">{formatNumber(sampleSize)}</span></p>
            <p className="flex items-center justify-between gap-3"><span>Preview size</span><span className="font-semibold">{formatNumber(Math.min(sampleSize, PREVIEW_LIMIT))}</span></p>
          </div>
          <p className="mt-4 text-xs leading-5 text-gray-500 dark:text-gray-400">Random and stratified modes use `ORDER BY RANDOM()` before rows are returned.</p>
        </div>
      </div>
      <div className="border-t border-gray-200/70 px-6 py-5 dark:border-gray-700/70">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sample preview</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">Previewing up to {PREVIEW_LIMIT} rows from the current sampling query.</p>
        </div>
        <AnimatePresence mode="wait">
          {error ? (
            <motion.div key="error" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="rounded-2xl border border-red-300/60 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:text-red-300">
              {error}
            </motion.div>
          ) : loading ? (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-2xl border border-dashed border-gray-300/80 px-4 py-12 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              Running sampling query...
            </motion.div>
          ) : preview.length ? (
            <motion.div key="table" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-700/70">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                  <thead className="bg-gray-50/90 dark:bg-gray-900/80">
                    <tr>{columnNames.map((name) => <th key={name} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">{name}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white/80 dark:divide-gray-800 dark:bg-gray-950/20">
                    {preview.map((row, index) => (
                      <tr key={`${mode}-${index}`} className="hover:bg-cyan-500/5 dark:hover:bg-cyan-500/5">
                        {columnNames.map((name) => <td key={`${index}-${name}`} className="max-w-[220px] truncate px-4 py-3 text-gray-700 dark:text-gray-200">{formatCell(row[name], columnTypes[name] ?? "unknown")}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-2xl border border-dashed border-gray-300/80 px-4 py-12 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              Click <span className="font-semibold text-gray-700 dark:text-gray-200">Refresh preview</span> to run the sampling query.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
