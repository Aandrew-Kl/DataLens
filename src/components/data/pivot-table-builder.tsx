"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Calculator, Download, Loader2, Table2 } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface PivotTableBuilderProps {
  tableName: string;
  columns: ColumnProfile[];
}

type Aggregation = "sum" | "avg" | "count" | "min" | "max";

interface PivotResult {
  rowKeys: string[];
  columnKeys: string[];
  grid: Map<string, number>;
  rowTotals: Map<string, number>;
  columnTotals: Map<string, number>;
  grandTotal: number;
}

interface MetricCardProps {
  label: string;
  value: string;
  icon: typeof Table2;
}

const AGGREGATIONS = [
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "count", label: "Count" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
] as const satisfies ReadonlyArray<{ value: Aggregation; label: string }>;

function MetricCard({ label, value, icon: Icon }: MetricCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        {label}
      </div>
      <p className="mt-3 text-2xl font-semibold text-slate-950 dark:text-slate-50">{value}</p>
    </div>
  );
}

function cellKey(rowKey: string, columnKey: string) {
  return `${rowKey}\u0000${columnKey}`;
}

function buildAggregationExpression(aggregation: Aggregation, valueField: string) {
  if (aggregation === "count") {
    return "COUNT(*)";
  }

  const valueIdentifier = quoteIdentifier(valueField);
  if (aggregation === "sum") return `SUM(TRY_CAST(${valueIdentifier} AS DOUBLE))`;
  if (aggregation === "avg") return `AVG(TRY_CAST(${valueIdentifier} AS DOUBLE))`;
  if (aggregation === "min") return `MIN(TRY_CAST(${valueIdentifier} AS DOUBLE))`;
  return `MAX(TRY_CAST(${valueIdentifier} AS DOUBLE))`;
}

async function loadPivotResult(args: {
  tableName: string;
  rowField: string;
  columnField: string | null;
  valueField: string;
  aggregation: Aggregation;
}) {
  const aggregationExpression = buildAggregationExpression(args.aggregation, args.valueField);
  const rowIdentifier = quoteIdentifier(args.rowField);
  const tableIdentifier = quoteIdentifier(args.tableName);

  const query = args.columnField
    ? `
        SELECT
          CAST(${rowIdentifier} AS VARCHAR) AS pivot_row,
          CAST(${quoteIdentifier(args.columnField)} AS VARCHAR) AS pivot_column,
          ${aggregationExpression} AS pivot_value
        FROM ${tableIdentifier}
        WHERE ${rowIdentifier} IS NOT NULL
          AND ${quoteIdentifier(args.columnField)} IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 1, 2
      `
    : `
        SELECT
          CAST(${rowIdentifier} AS VARCHAR) AS pivot_row,
          ${aggregationExpression} AS pivot_value
        FROM ${tableIdentifier}
        WHERE ${rowIdentifier} IS NOT NULL
        GROUP BY 1
        ORDER BY 1
      `;

  const rows = await runQuery(query);
  const rowKeys = new Set<string>();
  const columnKeys = new Set<string>();
  const grid = new Map<string, number>();

  rows.forEach((row) => {
    const rowKey = String(row.pivot_row ?? "");
    const columnKey = args.columnField ? String(row.pivot_column ?? "") : "__value__";
    const value = Number(row.pivot_value ?? 0);

    rowKeys.add(rowKey);
    columnKeys.add(columnKey);
    grid.set(cellKey(rowKey, columnKey), Number.isFinite(value) ? value : 0);
  });

  const sortedRows = [...rowKeys].sort((left, right) => left.localeCompare(right));
  const sortedColumns = [...columnKeys].sort((left, right) => left.localeCompare(right));
  const rowTotals = new Map<string, number>();
  const columnTotals = new Map<string, number>();
  let grandTotal = 0;

  sortedRows.forEach((rowKey) => {
    let rowTotal = 0;
    sortedColumns.forEach((columnKey) => {
      const value = grid.get(cellKey(rowKey, columnKey)) ?? 0;
      rowTotal += value;
      columnTotals.set(columnKey, (columnTotals.get(columnKey) ?? 0) + value);
    });
    rowTotals.set(rowKey, rowTotal);
    grandTotal += rowTotal;
  });

  return {
    rowKeys: sortedRows,
    columnKeys: sortedColumns,
    grid,
    rowTotals,
    columnTotals,
    grandTotal,
  } satisfies PivotResult;
}

function buildExportCsv(result: PivotResult) {
  const headers = ["row", ...result.columnKeys, "Total"];
  const lines = [
    headers.join(","),
    ...result.rowKeys.map((rowKey) =>
      [
        rowKey,
        ...result.columnKeys.map((columnKey) =>
          String(result.grid.get(cellKey(rowKey, columnKey)) ?? 0),
        ),
        String(result.rowTotals.get(rowKey) ?? 0),
      ].join(","),
    ),
    [
      "Total",
      ...result.columnKeys.map((columnKey) => String(result.columnTotals.get(columnKey) ?? 0)),
      String(result.grandTotal),
    ].join(","),
  ];

  return lines.join("\n");
}

export default function PivotTableBuilder({
  tableName,
  columns,
}: PivotTableBuilderProps) {
  const dimensionColumns = useMemo(
    () =>
      columns.filter(
        (column) =>
          column.type === "string" || column.type === "date" || column.type === "boolean",
      ),
    [columns],
  );
  const valueColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );

  const [rowField, setRowField] = useState(dimensionColumns[0]?.name ?? "");
  const [columnField, setColumnField] = useState(dimensionColumns[1]?.name ?? "");
  const [valueField, setValueField] = useState(valueColumns[0]?.name ?? "");
  const [aggregation, setAggregation] = useState<Aggregation>("sum");
  const [result, setResult] = useState<PivotResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const incompatible = dimensionColumns.length === 0 || valueColumns.length === 0;

  async function handleBuild() {
    if (!rowField || !valueField) {
      setError("Choose row and value fields before building the pivot.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const nextResult = await loadPivotResult({
        tableName,
        rowField,
        columnField: columnField || null,
        valueField,
        aggregation,
      });
      setResult(nextResult);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Pivot query failed.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result) return;
    downloadFile(
      buildExportCsv(result),
      `${tableName}-pivot-table.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  if (incompatible) {
    return (
      <section className={`${GLASS_PANEL_CLASS} p-6`}>
        <div className="flex items-center gap-3">
          <Table2 className="h-6 w-6 text-cyan-600 dark:text-cyan-300" />
          <div>
            <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-50">
              Build an interactive pivot table
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              A pivot table needs at least one dimension column and one numeric value column.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Table2 className="h-6 w-6 text-cyan-600 dark:text-cyan-300" />
            <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-50">
              Build an interactive pivot table
            </h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Pick row, column, and value fields, choose an aggregation, and render a pivot table
            with row totals, column totals, and CSV export.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleBuild()}
            disabled={loading}
            className={BUTTON_CLASS}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
            Build pivot
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={!result}
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.1fr)]">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <div className="grid gap-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Row field
              </span>
              <select
                value={rowField}
                onChange={(event) => setRowField(event.target.value)}
                className={FIELD_CLASS}
              >
                {dimensionColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Column field
              </span>
              <select
                value={columnField}
                onChange={(event) => setColumnField(event.target.value)}
                className={FIELD_CLASS}
              >
                <option value="">No column grouping</option>
                {dimensionColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Value field
              </span>
              <select
                value={valueField}
                onChange={(event) => setValueField(event.target.value)}
                className={FIELD_CLASS}
              >
                {valueColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Aggregation
              </span>
              <select
                value={aggregation}
                onChange={(event) => setAggregation(event.target.value as Aggregation)}
                className={FIELD_CLASS}
              >
                {AGGREGATIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error ? (
            <p className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </p>
          ) : null}
        </div>

        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard icon={Table2} label="Rows" value={result ? formatNumber(result.rowKeys.length) : "0"} />
            <MetricCard icon={Table2} label="Columns" value={result ? formatNumber(result.columnKeys.length) : "0"} />
            <MetricCard icon={Calculator} label="Grand total" value={result ? formatNumber(result.grandTotal) : "0"} />
          </div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: ANALYTICS_EASE }}
            className={`${GLASS_CARD_CLASS} overflow-hidden p-4`}
          >
            {result ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/20 text-left text-slate-500 dark:text-slate-400">
                      <th className="px-3 py-2">{rowField}</th>
                      {result.columnKeys.map((columnKey) => (
                        <th key={columnKey} className="px-3 py-2">
                          {columnKey === "__value__" ? aggregation.toUpperCase() : columnKey}
                        </th>
                      ))}
                      <th className="px-3 py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rowKeys.map((rowKey) => (
                      <tr key={rowKey} className="border-b border-white/10 last:border-b-0">
                        <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                          {rowKey}
                        </td>
                        {result.columnKeys.map((columnKey) => (
                          <td key={columnKey} className="px-3 py-2 text-slate-600 dark:text-slate-300">
                            {formatNumber(result.grid.get(cellKey(rowKey, columnKey)) ?? 0)}
                          </td>
                        ))}
                        <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                          {formatNumber(result.rowTotals.get(rowKey) ?? 0)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-950/5 dark:bg-white/5">
                      <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">Total</td>
                      {result.columnKeys.map((columnKey) => (
                        <td key={columnKey} className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">
                          {formatNumber(result.columnTotals.get(columnKey) ?? 0)}
                        </td>
                      ))}
                      <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">
                            {formatNumber(result.grandTotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Build the pivot to inspect grouped values and totals.
              </p>
            )}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
