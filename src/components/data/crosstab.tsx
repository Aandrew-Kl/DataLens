"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, BadgePercent, Columns3, FlaskConical, Loader2, Rows3, Sigma, Table2 } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface CrossTabProps {
  tableName: string;
  columns: ColumnProfile[];
}

type DisplayMode = "count" | "row" | "column" | "total";

interface CrossTabData {
  rowKeys: string[];
  colKeys: string[];
  grid: Map<string, number>;
  rowTotals: Map<string, number>;
  colTotals: Map<string, number>;
  grandTotal: number;
}

const DISPLAY_MODES: { value: DisplayMode; label: string }[] = [{ value: "count", label: "Count" }, { value: "row", label: "Row %" }, { value: "column", label: "Col %" }, { value: "total", label: "Total %" }];

const gridKey = (row: string, col: string) => `${row}\u0000${col}`;
const quoteId = (value: string) => `"${value.replace(/"/g, '""')}"`;
const quoteText = (value: string) => `'${value.replace(/'/g, "''")}'`;
const formatPct = (value: number) => `${value.toFixed(value >= 10 ? 1 : 2)}%`;
const heatTint = (ratio: number) => `rgba(14, 165, 233, ${(0.08 + ratio * 0.46).toFixed(3)})`;

function isEligible(column: ColumnProfile) {
  return column.type !== "unknown" && column.uniqueCount > 1 && column.uniqueCount <= 24;
}

function normalCdf(z: number) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  return 0.5 * (1 + sign * erf);
}

function chiSquarePValue(statistic: number, df: number) {
  if (df <= 0 || !Number.isFinite(statistic)) return 1;
  const z = (Math.cbrt(statistic / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return Math.max(0, Math.min(1, 1 - normalCdf(z)));
}

function displayValue(count: number, rowTotal: number, colTotal: number, grandTotal: number, mode: DisplayMode) {
  if (mode === "count") return count;
  if (mode === "row") return rowTotal ? (count / rowTotal) * 100 : 0;
  if (mode === "column") return colTotal ? (count / colTotal) * 100 : 0;
  return grandTotal ? (count / grandTotal) * 100 : 0;
}

export default function CrossTabulation({ tableName, columns }: CrossTabProps) {
  const eligibleColumns = useMemo(() => columns.filter(isEligible), [columns]);
  const [rowDim, setRowDim] = useState("");
  const [colDim, setColDim] = useState("");
  const [mode, setMode] = useState<DisplayMode>("count");
  const [data, setData] = useState<CrossTabData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextRow = eligibleColumns.some((column) => column.name === rowDim) ? rowDim : eligibleColumns[0]?.name ?? "";
    const nextCol = eligibleColumns.some((column) => column.name === colDim) && colDim !== nextRow
      ? colDim
      : eligibleColumns.find((column) => column.name !== nextRow)?.name ?? "";
    if (nextRow !== rowDim) setRowDim(nextRow);
    if (nextCol !== colDim) setColDim(nextCol);
  }, [eligibleColumns, rowDim, colDim]);

  useEffect(() => {
    if (!rowDim || !colDim || rowDim === colDim) {
      setData(null);
      return;
    }

    let cancelled = false;

    async function loadCrossTab() {
      setLoading(true);
      setError(null);
      try {
        const table = quoteId(tableName);
        const rowId = quoteId(rowDim);
        const colId = quoteId(colDim);
        const valueExpr = (field: string) => `COALESCE(NULLIF(TRIM(CAST(${field} AS VARCHAR)), ''), '(blank)')`;

        const rowLevels = await runQuery(`SELECT ${valueExpr(rowId)} AS label FROM ${table} GROUP BY 1 ORDER BY 1`);
        const colLevels = await runQuery(`SELECT ${valueExpr(colId)} AS label FROM ${table} GROUP BY 1 ORDER BY 1`);
        const rowKeys = rowLevels.map((row) => String(row.label ?? "(blank)"));
        const colKeys = colLevels.map((row) => String(row.label ?? "(blank)"));

        if (!rowKeys.length || !colKeys.length) {
          if (!cancelled) setData(null);
          return;
        }

        const aliases = colKeys.map((label, index) => ({ label, alias: `pivot_${index}` }));
        const pivotSql = `
          WITH counts AS (
            SELECT ${valueExpr(rowId)} AS row_key, ${valueExpr(colId)} AS col_key, COUNT(*) AS cell_count
            FROM ${table}
            GROUP BY 1, 2
          )
          SELECT
            row_key,
            ${aliases.map(({ label, alias }) => `SUM(CASE WHEN col_key = ${quoteText(label)} THEN cell_count ELSE 0 END) AS ${quoteId(alias)}`).join(",\n            ")},
            SUM(cell_count) AS "__row_total__"
          FROM counts
          GROUP BY 1
          ORDER BY 1
        `;

        const rows = await runQuery(pivotSql);
        if (cancelled) return;

        const grid = new Map<string, number>();
        const rowTotals = new Map<string, number>();
        const colTotals = new Map<string, number>(colKeys.map((key) => [key, 0]));
        let grandTotal = 0;

        for (const row of rows) {
          const rowKey = String(row.row_key ?? "(blank)");
          const rowTotal = Number(row.__row_total__ ?? 0);
          rowTotals.set(rowKey, rowTotal);
          grandTotal += rowTotal;
          for (const { label, alias } of aliases) {
            const count = Number(row[alias] ?? 0);
            grid.set(gridKey(rowKey, label), count);
            colTotals.set(label, (colTotals.get(label) ?? 0) + count);
          }
        }

        setData({ rowKeys, colKeys, grid, rowTotals, colTotals, grandTotal });
      } catch (cause) {
        if (!cancelled) {
          setData(null);
          setError(cause instanceof Error ? cause.message : "Failed to build crosstab.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadCrossTab();
    return () => {
      cancelled = true;
    };
  }, [colDim, rowDim, tableName]);

  const analysis = useMemo(() => {
    if (!data || data.rowKeys.length < 2 || data.colKeys.length < 2 || !data.grandTotal) return null;
    let chiSquare = 0;
    for (const rowKey of data.rowKeys) {
      const rowTotal = data.rowTotals.get(rowKey) ?? 0;
      for (const colKey of data.colKeys) {
        const colTotal = data.colTotals.get(colKey) ?? 0;
        const expected = (rowTotal * colTotal) / data.grandTotal;
        const observed = data.grid.get(gridKey(rowKey, colKey)) ?? 0;
        if (expected > 0) chiSquare += ((observed - expected) ** 2) / expected;
      }
    }
    const df = (data.rowKeys.length - 1) * (data.colKeys.length - 1);
    const pValue = chiSquarePValue(chiSquare, df);
    const cramerV = Math.sqrt(chiSquare / (data.grandTotal * Math.max(1, Math.min(data.rowKeys.length - 1, data.colKeys.length - 1))));
    return { chiSquare, df, pValue, cramerV };
  }, [data]);

  const heatMax = useMemo(() => {
    if (!data) return 1;
    let max = 0;
    for (const rowKey of data.rowKeys) {
      const rowTotal = data.rowTotals.get(rowKey) ?? 0;
      for (const colKey of data.colKeys) {
        const colTotal = data.colTotals.get(colKey) ?? 0;
        const count = data.grid.get(gridKey(rowKey, colKey)) ?? 0;
        max = Math.max(max, displayValue(count, rowTotal, colTotal, data.grandTotal, mode));
      }
    }
    return max || 1;
  }, [data, mode]);

  if (eligibleColumns.length < 2) {
    return (
      <section className="rounded-[26px] border border-gray-200/70 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-gray-700/70 dark:bg-gray-900/60">
        <div className="flex items-start gap-3 text-sm text-gray-600 dark:text-gray-300">
          <AlertCircle className="mt-0.5 h-5 w-5 text-amber-500" />
          <div>
            <p className="font-medium text-gray-900 dark:text-gray-100">Cross tab needs at least two low-cardinality columns.</p>
            <p className="mt-1">Selectable variables are limited to fields with 2-24 distinct values so the pivot stays interpretable.</p>
          </div>
        </div>
      </section>
    );
  }

  const chiTone = !analysis ? "border-gray-200/70 text-gray-600 dark:border-gray-700/70 dark:text-gray-300"
    : analysis.pValue < 0.01 ? "border-rose-300/60 text-rose-700 dark:border-rose-500/40 dark:text-rose-300"
    : analysis.pValue < 0.05 ? "border-amber-300/60 text-amber-700 dark:border-amber-500/40 dark:text-amber-300"
    : "border-emerald-300/60 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300";

  return (
    <section className="overflow-hidden rounded-[28px] border border-gray-200/70 bg-white/85 shadow-[0_20px_70px_-40px_rgba(15,23,42,0.55)] backdrop-blur dark:border-gray-700/70 dark:bg-gray-900/65">
      <div className="border-b border-gray-200/70 p-6 dark:border-gray-700/70">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-sky-600 dark:text-sky-400">
              <Table2 className="h-4 w-4" />
              Cross Tabulation
            </div>
            <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-gray-100">{rowDim} by {colDim}</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Counts are computed live from `{tableName}` with a generated conditional pivot query and rendered with totals plus association diagnostics.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-medium">
            <span className="rounded-full border border-gray-200/70 px-3 py-1.5 text-gray-700 dark:border-gray-700/70 dark:text-gray-200"><Rows3 className="mr-1 inline h-3.5 w-3.5" /> {formatNumber(data?.rowKeys.length ?? 0)} rows</span>
            <span className="rounded-full border border-gray-200/70 px-3 py-1.5 text-gray-700 dark:border-gray-700/70 dark:text-gray-200"><Columns3 className="mr-1 inline h-3.5 w-3.5" /> {formatNumber(data?.colKeys.length ?? 0)} cols</span>
            <span className="rounded-full border border-gray-200/70 px-3 py-1.5 text-gray-700 dark:border-gray-700/70 dark:text-gray-200"><Sigma className="mr-1 inline h-3.5 w-3.5" /> {formatNumber(data?.grandTotal ?? 0)} obs</span>
            <span className={`rounded-full border px-3 py-1.5 ${chiTone}`}><FlaskConical className="mr-1 inline h-3.5 w-3.5" /> {analysis ? (analysis.pValue < 0.05 ? "Associated" : "No signal") : "Chi-square n/a"}</span>
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="rounded-2xl border border-gray-200/70 bg-white px-3 py-3 dark:border-gray-700/70 dark:bg-gray-950/40">
            <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400"><Rows3 className="h-3.5 w-3.5" /> Row variable</span>
            <select value={rowDim} onChange={(event) => setRowDim(event.target.value)} className="w-full bg-transparent text-sm text-gray-900 outline-none dark:text-gray-100">
              {eligibleColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
            </select>
          </label>
          <label className="rounded-2xl border border-gray-200/70 bg-white px-3 py-3 dark:border-gray-700/70 dark:bg-gray-950/40">
            <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400"><Columns3 className="h-3.5 w-3.5" /> Column variable</span>
            <select value={colDim} onChange={(event) => setColDim(event.target.value)} className="w-full bg-transparent text-sm text-gray-900 outline-none dark:text-gray-100">
              {eligibleColumns.map((column) => <option key={column.name} value={column.name} disabled={column.name === rowDim}>{column.name}</option>)}
            </select>
          </label>
          <div className="rounded-2xl border border-gray-200/70 bg-gray-50/80 p-1 dark:border-gray-700/70 dark:bg-gray-950/45">
            <div className="mb-2 flex items-center gap-2 px-3 pt-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400"><BadgePercent className="h-3.5 w-3.5" /> View</div>
            <div className="flex flex-wrap gap-1">
              {DISPLAY_MODES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMode(option.value)}
                  className={`rounded-xl px-3 py-2 text-sm font-medium transition ${mode === option.value ? "bg-sky-500 text-white shadow-sm" : "text-gray-600 hover:text-sky-700 dark:text-gray-300 dark:hover:text-sky-300"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {analysis && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex flex-wrap gap-2 text-xs text-gray-600 dark:text-gray-300">
            <span className="rounded-full border border-gray-200/70 px-3 py-1.5 dark:border-gray-700/70">χ²({analysis.df}) = {analysis.chiSquare.toFixed(2)}</span>
            <span className="rounded-full border border-gray-200/70 px-3 py-1.5 dark:border-gray-700/70">p {analysis.pValue < 0.001 ? "< 0.001" : `= ${analysis.pValue.toFixed(3)}`}</span>
            <span className="rounded-full border border-gray-200/70 px-3 py-1.5 dark:border-gray-700/70">Cramér&apos;s V = {analysis.cramerV.toFixed(2)}</span>
          </motion.div>
        )}
      </div>

      <div className="relative p-6">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-sm dark:bg-gray-950/70">
            <Loader2 className="h-5 w-5 animate-spin text-sky-500" />
          </div>
        )}

        <AnimatePresence mode="wait">
          {error ? (
            <motion.div key="error" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="rounded-2xl border border-rose-200/70 bg-rose-50/80 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-950/20 dark:text-rose-300">
              {error}
            </motion.div>
          ) : data ? (
            <motion.div key={`${rowDim}-${colDim}-${mode}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="overflow-hidden rounded-[24px] border border-gray-200/70 dark:border-gray-700/70">
              <div className="max-h-[32rem] overflow-auto">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead className="sticky top-0 z-[1] bg-gray-50/95 backdrop-blur dark:bg-gray-950/95">
                    <tr>
                      <th className="sticky left-0 z-[2] border-b border-r border-gray-200/70 bg-gray-50/95 px-4 py-3 text-left font-semibold text-gray-700 dark:border-gray-700/70 dark:bg-gray-950/95 dark:text-gray-200">{rowDim}</th>
                      {data.colKeys.map((colKey) => (
                        <th key={colKey} className="border-b border-gray-200/70 px-3 py-3 text-center font-semibold text-gray-700 dark:border-gray-700/70 dark:text-gray-200">{colKey}</th>
                      ))}
                      <th className="border-b border-l border-gray-200/70 bg-gray-50/95 px-4 py-3 text-right font-semibold text-gray-700 dark:border-gray-700/70 dark:bg-gray-950/95 dark:text-gray-200">Row total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rowKeys.map((rowKey) => {
                      const rowTotal = data.rowTotals.get(rowKey) ?? 0;
                      return (
                        <tr key={rowKey}>
                          <th className="sticky left-0 border-b border-r border-gray-200/70 bg-white/95 px-4 py-3 text-left font-medium text-gray-700 dark:border-gray-700/70 dark:bg-gray-900/95 dark:text-gray-200">{rowKey}</th>
                          {data.colKeys.map((colKey) => {
                            const count = data.grid.get(gridKey(rowKey, colKey)) ?? 0;
                            const colTotal = data.colTotals.get(colKey) ?? 0;
                            const value = displayValue(count, rowTotal, colTotal, data.grandTotal, mode);
                            const ratio = heatMax ? value / heatMax : 0;
                            return (
                              <td key={`${rowKey}-${colKey}`} className="border-b border-gray-200/70 px-3 py-2 text-center dark:border-gray-700/70" style={{ backgroundColor: heatTint(ratio) }}>
                                <div className="font-semibold text-gray-900 dark:text-gray-100">{mode === "count" ? formatNumber(count) : formatPct(value)}</div>
                                {mode !== "count" && <div className="text-[11px] text-gray-500 dark:text-gray-400">{formatNumber(count)}</div>}
                              </td>
                            );
                          })}
                          <td className="border-b border-l border-gray-200/70 bg-gray-50/60 px-4 py-2 text-right dark:border-gray-700/70 dark:bg-gray-950/35">
                            <div className="font-semibold text-gray-900 dark:text-gray-100">{formatNumber(rowTotal)}</div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400">{formatPct(data.grandTotal ? (rowTotal / data.grandTotal) * 100 : 0)}</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="sticky bottom-0 bg-gray-50/95 backdrop-blur dark:bg-gray-950/95">
                    <tr>
                      <th className="sticky left-0 border-r border-t border-gray-200/70 bg-gray-50/95 px-4 py-3 text-left font-semibold text-gray-700 dark:border-gray-700/70 dark:bg-gray-950/95 dark:text-gray-200">Column total</th>
                      {data.colKeys.map((colKey) => {
                        const total = data.colTotals.get(colKey) ?? 0;
                        return (
                          <td key={`total-${colKey}`} className="border-t border-gray-200/70 px-3 py-3 text-center dark:border-gray-700/70">
                            <div className="font-semibold text-gray-900 dark:text-gray-100">{formatNumber(total)}</div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400">{formatPct(data.grandTotal ? (total / data.grandTotal) * 100 : 0)}</div>
                          </td>
                        );
                      })}
                      <td className="border-l border-t border-gray-200/70 bg-gray-50/95 px-4 py-3 text-right font-semibold text-gray-900 dark:border-gray-700/70 dark:bg-gray-950/95 dark:text-gray-100">{formatNumber(data.grandTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="rounded-2xl border border-dashed border-gray-300/70 p-8 text-center text-sm text-gray-600 dark:border-gray-700/70 dark:text-gray-300">
              Choose two different variables to generate the contingency table.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
