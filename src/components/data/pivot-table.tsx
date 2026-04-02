"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  GripVertical,
  Loader2,
  RotateCcw,
  Table2,
} from "lucide-react";
import type { ColumnProfile } from "@/types/dataset";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import { downloadFile } from "@/lib/utils/export";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AggFn = "SUM" | "AVG" | "COUNT" | "MIN" | "MAX";
type SortDir = "asc" | "desc" | null;

interface PivotConfig {
  rowDim: string;
  colDim: string;
  valueField: string;
  aggFn: AggFn;
}

interface PivotResult {
  rowKeys: string[];
  colKeys: string[];
  grid: Map<string, number>;
  rowTotals: Map<string, number>;
  colTotals: Map<string, number>;
  grandTotal: number;
}

interface PivotTableProps {
  tableName: string;
  columns: ColumnProfile[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGG_OPTIONS: { value: AggFn; label: string }[] = [
  { value: "SUM", label: "Sum" },
  { value: "AVG", label: "Average" },
  { value: "COUNT", label: "Count" },
  { value: "MIN", label: "Min" },
  { value: "MAX", label: "Max" },
];

function cellKey(row: string, col: string): string {
  return `${row}\x00${col}`;
}

function heatColor(value: number, min: number, max: number): string {
  if (max === min) return "rgba(99, 102, 241, 0.12)";
  const t = (value - min) / (max - min);
  const alpha = 0.06 + t * 0.52;
  return `rgba(99, 102, 241, ${alpha.toFixed(3)})`;
}

function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PivotTable({ tableName, columns }: PivotTableProps) {
  const stringCols = useMemo(
    () => columns.filter((c) => c.type === "string" || c.type === "date"),
    [columns],
  );
  const stringOnlyCols = useMemo(
    () => columns.filter((c) => c.type === "string"),
    [columns],
  );
  const numericCols = useMemo(
    () => columns.filter((c) => c.type === "number"),
    [columns],
  );

  const [config, setConfig] = useState<PivotConfig>({
    rowDim: stringCols[0]?.name ?? "",
    colDim: "",
    valueField: numericCols[0]?.name ?? "",
    aggFn: "SUM",
  });

  const [result, setResult] = useState<PivotResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  // Fetch pivot data whenever config changes
  useEffect(() => {
    if (!config.rowDim || !config.valueField) {
      setResult(null);
      return;
    }

    let cancelled = false;

    async function fetchPivot() {
      setLoading(true);
      setError(null);

      try {
        const rowCol = quote(config.rowDim);
        const valCol = quote(config.valueField);
        const agg = `${config.aggFn}(${valCol})`;

        let sql: string;
        if (config.colDim) {
          const colCol = quote(config.colDim);
          sql = `
            SELECT
              CAST(${rowCol} AS VARCHAR) AS pivot_row,
              CAST(${colCol} AS VARCHAR) AS pivot_col,
              ${agg} AS pivot_val
            FROM "${tableName}"
            WHERE ${rowCol} IS NOT NULL
            GROUP BY ${rowCol}, ${colCol}
            ORDER BY ${rowCol}
          `;
        } else {
          sql = `
            SELECT
              CAST(${rowCol} AS VARCHAR) AS pivot_row,
              ${agg} AS pivot_val
            FROM "${tableName}"
            WHERE ${rowCol} IS NOT NULL
            GROUP BY ${rowCol}
            ORDER BY ${rowCol}
          `;
        }

        const rows = await runQuery(sql);
        if (cancelled) return;

        const rowKeySet = new Set<string>();
        const colKeySet = new Set<string>();
        const grid = new Map<string, number>();

        for (const row of rows) {
          const rk = String(row.pivot_row ?? "");
          const val = Number(row.pivot_val ?? 0);
          rowKeySet.add(rk);

          if (config.colDim) {
            const ck = String(row.pivot_col ?? "(blank)");
            colKeySet.add(ck);
            grid.set(cellKey(rk, ck), val);
          } else {
            grid.set(cellKey(rk, "__value__"), val);
          }
        }

        const rowKeys = Array.from(rowKeySet).sort();
        const colKeys = config.colDim
          ? Array.from(colKeySet).sort()
          : ["__value__"];

        // Compute totals
        const rowTotals = new Map<string, number>();
        const colTotals = new Map<string, number>();
        let grandTotal = 0;

        for (const rk of rowKeys) {
          let rowSum = 0;
          for (const ck of colKeys) {
            const v = grid.get(cellKey(rk, ck)) ?? 0;
            rowSum += v;
            colTotals.set(ck, (colTotals.get(ck) ?? 0) + v);
          }
          rowTotals.set(rk, rowSum);
          grandTotal += rowSum;
        }

        setResult({ rowKeys, colKeys, grid, rowTotals, colTotals, grandTotal });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Pivot query failed.");
        setResult(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchPivot();
    return () => {
      cancelled = true;
    };
  }, [tableName, config]);

  // Reset sort when config changes
  useEffect(() => {
    setSortCol(null);
    setSortDir(null);
  }, [config]);

  // Sorted row keys
  const sortedRowKeys = useMemo(() => {
    if (!result || !sortCol || !sortDir) return result?.rowKeys ?? [];
    const keys = [...result.rowKeys];

    keys.sort((a, b) => {
      let av: number;
      let bv: number;

      if (sortCol === "__row_total__") {
        av = result.rowTotals.get(a) ?? 0;
        bv = result.rowTotals.get(b) ?? 0;
      } else if (sortCol === "__row_label__") {
        return sortDir === "asc" ? a.localeCompare(b) : b.localeCompare(a);
      } else {
        av = result.grid.get(cellKey(a, sortCol)) ?? 0;
        bv = result.grid.get(cellKey(b, sortCol)) ?? 0;
      }

      return sortDir === "asc" ? av - bv : bv - av;
    });

    return keys;
  }, [result, sortCol, sortDir]);

  // Min/max for heatmap
  const [heatMin, heatMax] = useMemo(() => {
    if (!result) return [0, 1];
    const values = Array.from(result.grid.values());
    if (values.length === 0) return [0, 1];
    return [Math.min(...values), Math.max(...values)];
  }, [result]);

  // Handlers
  const handleSort = useCallback(
    (col: string) => {
      if (sortCol === col) {
        setSortDir((d) => (d === "asc" ? "desc" : d === "desc" ? null : "asc"));
        if (sortDir === "desc") setSortCol(null);
      } else {
        setSortCol(col);
        setSortDir("asc");
      }
    },
    [sortCol, sortDir],
  );

  const handleExport = useCallback(() => {
    if (!result) return;
    const hasColDim = config.colDim !== "";
    const headers = [
      config.rowDim,
      ...(hasColDim ? result.colKeys : [config.valueField]),
      "Total",
    ];
    const csvRows = sortedRowKeys.map((rk) => {
      const cells = hasColDim
        ? result.colKeys.map((ck) => String(result.grid.get(cellKey(rk, ck)) ?? 0))
        : [String(result.grid.get(cellKey(rk, "__value__")) ?? 0)];
      return [rk, ...cells, String(result.rowTotals.get(rk) ?? 0)];
    });

    const totalRow = [
      "Total",
      ...(hasColDim
        ? result.colKeys.map((ck) => String(result.colTotals.get(ck) ?? 0))
        : [String(result.grandTotal)]),
      String(result.grandTotal),
    ];

    const escape = (v: string) =>
      v.includes(",") || v.includes('"') || v.includes("\n")
        ? `"${v.replace(/"/g, '""')}"`
        : v;

    const csv = [headers.map(escape).join(",")]
      .concat(csvRows.map((r) => r.map(escape).join(",")))
      .concat([totalRow.map(escape).join(",")])
      .join("\n");

    downloadFile(csv, "pivot_export.csv", "text/csv;charset=utf-8;");
  }, [result, sortedRowKeys, config]);

  const handleReset = useCallback(() => {
    setConfig({
      rowDim: stringCols[0]?.name ?? "",
      colDim: "",
      valueField: numericCols[0]?.name ?? "",
      aggFn: "SUM",
    });
  }, [stringCols, numericCols]);

  // Sort icon helper
  const SortIcon = ({ col }: { col: string }) => {
    if (sortCol !== col)
      return (
        <ArrowUpDown className="w-3 h-3 text-gray-300 dark:text-gray-600 opacity-0 group-hover/th:opacity-100 transition-opacity" />
      );
    return sortDir === "asc" ? (
      <ArrowUp className="w-3 h-3 text-indigo-500" />
    ) : (
      <ArrowDown className="w-3 h-3 text-indigo-500" />
    );
  };

  // Dropdown helper
  const Select = ({
    value,
    onChange,
    options,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    placeholder?: string;
  }) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 dark:focus:ring-indigo-500/50 transition-shadow"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  // No columns available
  if (stringCols.length === 0 || numericCols.length === 0) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-gray-200/50 dark:border-gray-700/50 bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl p-6 shadow-xl shadow-slate-900/5"
      >
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">
            Pivot Table
          </p>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Insufficient columns
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            A pivot table requires at least one string/date column and one numeric column.
          </p>
        </div>
      </motion.section>
    );
  }

  const hasColDim = config.colDim !== "";
  const displayColKeys = hasColDim ? result?.colKeys ?? [] : ["__value__"];

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-gray-200/50 dark:border-gray-700/50 bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl shadow-xl shadow-slate-900/5"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <Table2 className="w-5 h-5 text-indigo-500" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">
              Pivot Table
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Drag dimensions to reshape your data
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleReset}
            title="Reset configuration"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={handleExport}
            disabled={!result}
            title="Export as CSV"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Configuration bar */}
      <div className="mx-6 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-gray-200/60 dark:border-gray-700/60 bg-gray-50/60 dark:bg-gray-800/40 p-3">
        <div className="space-y-1">
          <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <GripVertical className="w-3 h-3" /> Rows
          </label>
          <Select
            value={config.rowDim}
            onChange={(v) => setConfig((c) => ({ ...c, rowDim: v }))}
            options={stringCols.map((c) => ({ value: c.name, label: c.name }))}
          />
        </div>
        <div className="space-y-1">
          <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <GripVertical className="w-3 h-3" /> Columns
          </label>
          <Select
            value={config.colDim}
            onChange={(v) => setConfig((c) => ({ ...c, colDim: v }))}
            options={stringOnlyCols.map((c) => ({ value: c.name, label: c.name }))}
            placeholder="(none)"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Value
          </label>
          <Select
            value={config.valueField}
            onChange={(v) => setConfig((c) => ({ ...c, valueField: v }))}
            options={numericCols.map((c) => ({ value: c.name, label: c.name }))}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Aggregation
          </label>
          <Select
            value={config.aggFn}
            onChange={(v) => setConfig((c) => ({ ...c, aggFn: v as AggFn }))}
            options={AGG_OPTIONS}
          />
        </div>
      </div>

      {/* Content area */}
      <div className="mx-6 mb-6 overflow-hidden rounded-xl border border-gray-200/60 dark:border-gray-700/60 bg-white/55 dark:bg-gray-950/35">
        {loading ? (
          <div className="grid min-h-[240px] place-items-center">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
            >
              <Loader2 className="w-8 h-8 text-indigo-500" />
            </motion.div>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200/60 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        ) : !result ? (
          <div className="grid min-h-[200px] place-items-center text-sm text-gray-400 dark:text-gray-500">
            Select a row dimension and value field to generate the pivot.
          </div>
        ) : (
          <div className="overflow-auto max-h-[520px]">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50/95 dark:bg-gray-800/95 backdrop-blur-sm">
                  {/* Row dimension header */}
                  <th
                    className="group/th cursor-pointer select-none border-b border-r border-gray-200/60 dark:border-gray-700/60 px-3 py-2.5 text-left text-[11px] font-semibold text-gray-600 dark:text-gray-300 sticky left-0 bg-gray-50/95 dark:bg-gray-800/95 backdrop-blur-sm z-20"
                    onClick={() => handleSort("__row_label__")}
                  >
                    <div className="flex items-center gap-1">
                      <span className="truncate">{config.rowDim}</span>
                      <SortIcon col="__row_label__" />
                    </div>
                  </th>

                  {/* Value column headers */}
                  {displayColKeys.map((ck) => (
                    <th
                      key={ck}
                      className="group/th cursor-pointer select-none border-b border-r border-gray-200/60 dark:border-gray-700/60 px-3 py-2.5 text-right text-[11px] font-semibold text-gray-600 dark:text-gray-300"
                      onClick={() => handleSort(ck)}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span className="truncate max-w-[120px]">
                          {ck === "__value__"
                            ? `${config.aggFn}(${config.valueField})`
                            : ck}
                        </span>
                        <SortIcon col={ck} />
                      </div>
                    </th>
                  ))}

                  {/* Total column header */}
                  {hasColDim && (
                    <th
                      className="group/th cursor-pointer select-none border-b border-gray-200/60 dark:border-gray-700/60 px-3 py-2.5 text-right text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50/40 dark:bg-indigo-900/10"
                      onClick={() => handleSort("__row_total__")}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Total
                        <SortIcon col="__row_total__" />
                      </div>
                    </th>
                  )}
                </tr>
              </thead>

              <tbody>
                <AnimatePresence mode="popLayout">
                  {sortedRowKeys.map((rk, idx) => (
                    <motion.tr
                      key={rk}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                      transition={{ delay: Math.min(idx * 0.015, 0.3) }}
                      className={`
                        border-b border-gray-100 dark:border-gray-800/50 transition-colors
                        hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10
                        ${idx % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/40 dark:bg-gray-800/20"}
                      `}
                    >
                      {/* Row label */}
                      <td className="border-r border-gray-200/60 dark:border-gray-700/60 px-3 py-2 font-medium text-gray-800 dark:text-gray-200 sticky left-0 bg-inherit z-10 whitespace-nowrap">
                        {rk || "(blank)"}
                      </td>

                      {/* Value cells */}
                      {displayColKeys.map((ck) => {
                        const val = result.grid.get(cellKey(rk, ck));
                        return (
                          <td
                            key={ck}
                            className="border-r border-gray-100/60 dark:border-gray-800/40 px-3 py-2 text-right font-mono tabular-nums text-gray-700 dark:text-gray-300"
                            style={{
                              backgroundColor:
                                val !== undefined
                                  ? heatColor(val, heatMin, heatMax)
                                  : undefined,
                            }}
                            title={val !== undefined ? val.toLocaleString() : ""}
                          >
                            {val !== undefined ? formatNumber(val) : "\u2014"}
                          </td>
                        );
                      })}

                      {/* Row total */}
                      {hasColDim && (
                        <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50/30 dark:bg-indigo-900/10">
                          {formatNumber(result.rowTotals.get(rk) ?? 0)}
                        </td>
                      )}
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>

              {/* Totals row */}
              <tfoot className="sticky bottom-0 z-10">
                <tr className="bg-gray-50/95 dark:bg-gray-800/95 backdrop-blur-sm border-t-2 border-gray-300/60 dark:border-gray-600/60">
                  <td className="border-r border-gray-200/60 dark:border-gray-700/60 px-3 py-2.5 font-bold text-[11px] uppercase tracking-wider text-gray-600 dark:text-gray-300 sticky left-0 bg-gray-50/95 dark:bg-gray-800/95 backdrop-blur-sm z-20">
                    Total
                  </td>
                  {displayColKeys.map((ck) => (
                    <td
                      key={ck}
                      className="border-r border-gray-200/60 dark:border-gray-700/60 px-3 py-2.5 text-right font-mono tabular-nums font-bold text-gray-800 dark:text-gray-200"
                    >
                      {formatNumber(
                        hasColDim
                          ? (result.colTotals.get(ck) ?? 0)
                          : result.grandTotal,
                      )}
                    </td>
                  ))}
                  {hasColDim && (
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50/40 dark:bg-indigo-900/15">
                      {formatNumber(result.grandTotal)}
                    </td>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Footer stats */}
      {result && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-between mx-6 mb-5 px-4 py-2.5 rounded-xl border border-gray-200/60 dark:border-gray-700/60 bg-gray-50/60 dark:bg-gray-800/40 text-[11px] text-gray-500 dark:text-gray-400"
        >
          <span>
            {result.rowKeys.length} rows
            {hasColDim ? ` \u00d7 ${result.colKeys.length} columns` : ""}
          </span>
          <span className="font-semibold text-gray-700 dark:text-gray-300">
            Grand Total: {formatNumber(result.grandTotal)}
          </span>
        </motion.div>
      )}
    </motion.section>
  );
}
