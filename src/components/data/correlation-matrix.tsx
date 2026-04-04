"use client";

import { Fragment, memo, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ColumnProfile } from "@/types/dataset";
import { runQuery } from "@/lib/duckdb/client";

interface CorrelationMatrixProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface CorrelationCell {
  rowName: string;
  columnName: string;
  correlation: number | null;
  pairCount: number;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatCorrelation(value: number | null, digits = 3): string {
  if (value === null || Number.isNaN(value)) return "Insufficient data";
  return value.toFixed(digits);
}

function getHeatStyle(value: number | null): { backgroundColor: string; color: string } {
  if (value === null || Number.isNaN(value)) {
    return {
      backgroundColor: "rgba(148, 163, 184, 0.12)",
      color: "rgb(100, 116, 139)",
    };
  }

  const intensity = Math.min(Math.abs(value), 1);
  const alpha = 0.12 + intensity * 0.76;

  if (value > 0) {
    return {
      backgroundColor: `rgba(59, 130, 246, ${alpha.toFixed(3)})`,
      color: intensity > 0.55 ? "white" : "rgb(15, 23, 42)",
    };
  }

  if (value < 0) {
    return {
      backgroundColor: `rgba(239, 68, 68, ${alpha.toFixed(3)})`,
      color: intensity > 0.55 ? "white" : "rgb(15, 23, 42)",
    };
  }

  return {
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    color: "rgb(15, 23, 42)",
  };
}

function CorrelationMatrix({
  tableName,
  columns,
}: CorrelationMatrixProps) {
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );

  const [cells, setCells] = useState<CorrelationCell[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<CorrelationCell | null>(null);

  useEffect(() => {
    if (numericColumns.length === 0) {
      setCells([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchCorrelations() {
      setLoading(true);
      setError(null);

      try {
        const safeTable = quoteIdentifier(tableName);
        const queryParts = numericColumns.flatMap((rowColumn) =>
          numericColumns.map((column) => {
            const safeRow = quoteIdentifier(rowColumn.name);
            const safeColumn = quoteIdentifier(column.name);

            const correlationExpression =
              rowColumn.name === column.name
                ? "1.0"
                : `corr(${safeRow}, ${safeColumn})`;

            const pairCountExpression =
              rowColumn.name === column.name
                ? `COUNT(${safeRow}) FILTER (WHERE ${safeRow} IS NOT NULL)`
                : `COUNT(*) FILTER (WHERE ${safeRow} IS NOT NULL AND ${safeColumn} IS NOT NULL)`;

            return `
              SELECT
                ${quoteStringLiteral(rowColumn.name)} AS row_name,
                ${quoteStringLiteral(column.name)} AS column_name,
                ${correlationExpression} AS correlation,
                ${pairCountExpression} AS pair_count
              FROM ${safeTable}
            `;
          }),
        );

        const result = await runQuery(queryParts.join(" UNION ALL "));

        if (cancelled) return;

        const parsedCells = result.map((row) => ({
          rowName: String(row.row_name ?? ""),
          columnName: String(row.column_name ?? ""),
          correlation: toNullableNumber(row.correlation),
          pairCount: Number(row.pair_count ?? 0),
        }));

        setCells(parsedCells);
      } catch (fetchError) {
        if (cancelled) return;
        setCells([]);
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to compute correlations.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchCorrelations();

    return () => {
      cancelled = true;
    };
  }, [numericColumns, tableName]);

  const cellLookup = useMemo(() => {
    const lookup = new Map<string, CorrelationCell>();

    for (const cell of cells) {
      lookup.set(`${cell.rowName}::${cell.columnName}`, cell);
    }

    return lookup;
  }, [cells]);

  const strongestSignals = useMemo(() => {
    const candidates = cells.filter(
      (cell) =>
        cell.rowName !== cell.columnName &&
        cell.correlation !== null &&
        Number.isFinite(cell.correlation),
    );

    const strongestPositive = [...candidates]
      .filter((cell) => (cell.correlation ?? 0) > 0)
      .sort((a, b) => (b.correlation ?? 0) - (a.correlation ?? 0))[0];

    const strongestNegative = [...candidates]
      .filter((cell) => (cell.correlation ?? 0) < 0)
      .sort((a, b) => (a.correlation ?? 0) - (b.correlation ?? 0))[0];

    return { strongestPositive, strongestNegative };
  }, [cells]);

  const matrixSize = numericColumns.length;
  const cellSize = matrixSize > 10 ? 36 : matrixSize > 6 ? 48 : 60;
  const gridTemplateColumns =
    matrixSize > 0
      ? `minmax(150px, 190px) repeat(${matrixSize}, minmax(${cellSize}px, ${cellSize}px))`
      : "1fr";

  if (numericColumns.length === 0) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        className="
          rounded-2xl border border-gray-200/50 dark:border-gray-700/50
          bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl
          p-6 shadow-xl shadow-slate-900/5
        "
      >
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">
            Correlation Matrix
          </p>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            No numeric columns available
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Add numeric fields to see pairwise Pearson correlations across the dataset.
          </p>
        </div>
      </motion.section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      className="
        rounded-2xl border border-gray-200/50 dark:border-gray-700/50
        bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl
        p-6 shadow-xl shadow-slate-900/5
      "
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">
            Correlation Matrix
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Pearson heatmap across {numericColumns.length} numeric columns
            </h3>
            <span className="rounded-full border border-gray-200/70 bg-white/70 px-3 py-1 text-xs font-medium text-gray-600 dark:border-gray-700/70 dark:bg-gray-950/40 dark:text-gray-300">
              {numericColumns.length ** 2} cells
            </span>
          </div>
          <p className="max-w-2xl text-sm text-gray-600 dark:text-gray-400">
            Positive relationships trend blue, negative relationships trend red, and values near
            zero stay neutral.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-2xl border border-blue-200/60 bg-blue-500/10 px-4 py-3 dark:border-blue-500/20 dark:bg-blue-500/10">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-300">
              Strongest Positive
            </p>
            <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
              {strongestSignals.strongestPositive
                ? `${strongestSignals.strongestPositive.rowName} × ${strongestSignals.strongestPositive.columnName}`
                : "No positive pair"}
            </p>
            <p className="text-xs text-blue-700/80 dark:text-blue-300/80">
              {strongestSignals.strongestPositive
                ? formatCorrelation(strongestSignals.strongestPositive.correlation, 4)
                : "Insufficient overlap"}
            </p>
          </div>

          <div className="rounded-2xl border border-red-200/60 bg-red-500/10 px-4 py-3 dark:border-red-500/20 dark:bg-red-500/10">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-700 dark:text-red-300">
              Strongest Negative
            </p>
            <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
              {strongestSignals.strongestNegative
                ? `${strongestSignals.strongestNegative.rowName} × ${strongestSignals.strongestNegative.columnName}`
                : "No negative pair"}
            </p>
            <p className="text-xs text-red-700/80 dark:text-red-300/80">
              {strongestSignals.strongestNegative
                ? formatCorrelation(strongestSignals.strongestNegative.correlation, 4)
                : "Insufficient overlap"}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-gray-200/60 bg-white/55 p-4 dark:border-gray-800/70 dark:bg-gray-950/35">
        {loading ? (
          <div className="grid min-h-[240px] place-items-center">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
              className="h-10 w-10 rounded-full border-2 border-blue-500/25 border-t-blue-500"
            />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200/60 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        ) : (
          <div className="overflow-auto">
            <div className="inline-grid gap-2" style={{ gridTemplateColumns }}>
              <div className="flex items-end px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                Columns
              </div>

              {numericColumns.map((column) => (
                <div
                  key={`column-header-${column.name}`}
                  className="flex items-end justify-center pb-2"
                  style={{ minWidth: cellSize }}
                  title={column.name}
                >
                  <span className="max-w-[4rem] truncate text-center text-[11px] font-medium text-gray-600 dark:text-gray-300">
                    {column.name}
                  </span>
                </div>
              ))}

              {numericColumns.map((rowColumn, rowIndex) => (
                <Fragment key={rowColumn.name}>
                  <div className="flex items-center rounded-xl border border-gray-200/60 bg-white/70 px-3 py-2 text-sm font-medium text-gray-700 dark:border-gray-700/70 dark:bg-gray-950/40 dark:text-gray-200">
                    <span className="truncate" title={rowColumn.name}>
                      {rowColumn.name}
                    </span>
                  </div>

                  {numericColumns.map((column, columnIndex) => {
                    const cell =
                      cellLookup.get(`${rowColumn.name}::${column.name}`) ?? {
                        rowName: rowColumn.name,
                        columnName: column.name,
                        correlation: null,
                        pairCount: 0,
                      };

                    const heatStyle = getHeatStyle(cell.correlation);
                    const showValue = matrixSize <= 8;

                    return (
                      <motion.button
                        key={`${rowColumn.name}-${column.name}`}
                        type="button"
                        initial={{ opacity: 0, scale: 0.92 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{
                          delay: rowIndex * 0.02 + columnIndex * 0.01,
                          duration: 0.2,
                        }}
                        className="relative aspect-square rounded-xl border border-white/30 shadow-sm transition-transform duration-150 hover:-translate-y-0.5"
                        style={{
                          ...heatStyle,
                          minWidth: cellSize,
                          minHeight: cellSize,
                        }}
                        title={`${rowColumn.name} × ${column.name}: ${formatCorrelation(
                          cell.correlation,
                          4,
                        )}`}
                        onMouseEnter={() => setHoveredCell(cell)}
                        onMouseLeave={() => setHoveredCell((current) =>
                          current?.rowName === cell.rowName &&
                          current?.columnName === cell.columnName
                            ? null
                            : current,
                        )}
                      >
                        <span className="absolute inset-0 rounded-xl ring-1 ring-inset ring-black/5 dark:ring-white/10" />
                        <span className="relative z-10 text-xs font-semibold">
                          {showValue
                            ? cell.correlation === null
                              ? "—"
                              : cell.correlation.toFixed(2)
                            : ""}
                        </span>
                      </motion.button>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={hoveredCell ? `${hoveredCell.rowName}-${hoveredCell.columnName}` : "default"}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="mt-4 flex min-h-[64px] items-center justify-between rounded-2xl border border-gray-200/60 bg-white/55 px-4 py-3 text-sm dark:border-gray-800/70 dark:bg-gray-950/35"
        >
          {hoveredCell ? (
            <>
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100">
                  {hoveredCell.rowName} × {hoveredCell.columnName}
                </p>
                <p className="text-gray-600 dark:text-gray-400">
                  Exact Pearson coefficient: {formatCorrelation(hoveredCell.correlation, 4)}
                </p>
              </div>
              <span className="rounded-full bg-gray-900 px-3 py-1 text-xs font-semibold text-white dark:bg-gray-100 dark:text-gray-900">
                {hoveredCell.pairCount.toLocaleString()} paired rows
              </span>
            </>
          ) : (
            <>
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100">
                  Hover a cell to inspect the exact coefficient
                </p>
                <p className="text-gray-600 dark:text-gray-400">
                  Cells with insufficient overlap stay muted and report no value.
                </p>
              </div>
              <span className="rounded-full border border-gray-200/70 px-3 py-1 text-xs font-medium text-gray-600 dark:border-gray-700/70 dark:text-gray-300">
                Auto-sized grid
              </span>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </motion.section>
  );
}

export default memo(CorrelationMatrix);
