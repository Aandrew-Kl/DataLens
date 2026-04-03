"use client";

import {
  Suspense,
  use,
  useMemo,
  useState,
} from "react";
import { motion } from "framer-motion";
import {
  Columns3,
  Download,
  Rows3,
  Sigma,
  Table2,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface PivotAnalysisProps {
  tableName: string;
  columns: ColumnProfile[];
}

type PivotAggregation = "sum" | "avg" | "count" | "min" | "max";

interface PivotAnalysisResult {
  rowKeys: string[];
  columnKeys: string[];
  cells: Map<string, number>;
  rowTotals: Map<string, number>;
  columnTotals: Map<string, number>;
  grandTotal: number;
  groupedRows: number;
  valueLabel: string;
  error: string | null;
}

interface SummaryCardProps {
  icon: typeof Table2;
  label: string;
  value: string;
}

const AGGREGATION_OPTIONS: Array<{
  value: PivotAggregation;
  label: string;
}> = [
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "count", label: "Count" },
  { value: "min", label: "Minimum" },
  { value: "max", label: "Maximum" },
];

function cellKey(rowKey: string, columnKey: string) {
  return `${rowKey}\u0000${columnKey}`;
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatMetric(value: number) {
  if (!Number.isFinite(value)) return "0";
  return Math.abs(value) >= 1000 || Number.isInteger(value)
    ? formatNumber(value)
    : value.toFixed(2);
}

function heatColor(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return "rgba(148, 163, 184, 0.08)";
  }

  if (max <= min) {
    return "rgba(6, 182, 212, 0.12)";
  }

  const ratio = (value - min) / (max - min);
  return `rgba(6, 182, 212, ${(0.08 + ratio * 0.45).toFixed(3)})`;
}

function buildAggregationExpression(
  aggregation: PivotAggregation,
  valueColumn: string,
) {
  if (aggregation === "count") {
    return "COUNT(*)";
  }

  const safeValueColumn = quoteIdentifier(valueColumn);
  const numericValue = `TRY_CAST(${safeValueColumn} AS DOUBLE)`;

  if (aggregation === "sum") {
    return `SUM(${numericValue})`;
  }
  if (aggregation === "avg") {
    return `AVG(${numericValue})`;
  }
  if (aggregation === "min") {
    return `MIN(${numericValue})`;
  }
  return `MAX(${numericValue})`;
}

function buildValueLabel(
  aggregation: PivotAggregation,
  valueColumn: string,
) {
  if (aggregation === "count") {
    return "Count of rows";
  }

  const option = AGGREGATION_OPTIONS.find((item) => item.value === aggregation);
  return `${option?.label ?? "Value"} of ${valueColumn}`;
}

function buildExportCsv(
  result: PivotAnalysisResult,
  rowField: string,
) {
  const header = [
    rowField,
    ...result.columnKeys,
    "Row total",
  ];
  const body = result.rowKeys.map((rowKey) => [
    rowKey,
    ...result.columnKeys.map((columnKey) =>
      formatMetric(result.cells.get(cellKey(rowKey, columnKey)) ?? 0),
    ),
    formatMetric(result.rowTotals.get(rowKey) ?? 0),
  ]);
  const totalRow = [
    "Column total",
    ...result.columnKeys.map((columnKey) =>
      formatMetric(result.columnTotals.get(columnKey) ?? 0),
    ),
    formatMetric(result.grandTotal),
  ];

  return [header, ...body, totalRow]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
}

async function loadPivotAnalysis(
  tableName: string,
  rowField: string,
  columnField: string,
  valueField: string,
  aggregation: PivotAggregation,
): Promise<PivotAnalysisResult> {
  if (!rowField || !columnField) {
    return {
      rowKeys: [],
      columnKeys: [],
      cells: new Map<string, number>(),
      rowTotals: new Map<string, number>(),
      columnTotals: new Map<string, number>(),
      grandTotal: 0,
      groupedRows: 0,
      valueLabel: buildValueLabel(aggregation, valueField),
      error: "Choose both a row field and a column field to build the pivot.",
    };
  }

  try {
    const safeRowField = quoteIdentifier(rowField);
    const safeColumnField = quoteIdentifier(columnField);
    const aggregationExpression = buildAggregationExpression(
      aggregation,
      valueField,
    );

    const rows = await runQuery(`
      SELECT
        COALESCE(CAST(${safeRowField} AS VARCHAR), '(blank)') AS row_key,
        COALESCE(CAST(${safeColumnField} AS VARCHAR), '(blank)') AS column_key,
        ${aggregationExpression} AS metric_value
      FROM ${quoteIdentifier(tableName)}
      WHERE ${safeRowField} IS NOT NULL
        AND ${safeColumnField} IS NOT NULL
        ${aggregation === "count" ? "" : `AND TRY_CAST(${quoteIdentifier(valueField)} AS DOUBLE) IS NOT NULL`}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);

    const rowOrder: string[] = [];
    const columnOrder: string[] = [];
    const seenRows = new Set<string>();
    const seenColumns = new Set<string>();
    const cells = new Map<string, number>();
    const rowTotals = new Map<string, number>();
    const columnTotals = new Map<string, number>();
    let grandTotal = 0;

    for (const row of rows) {
      const rowKeyValue = String(row.row_key ?? "(blank)");
      const columnKeyValue = String(row.column_key ?? "(blank)");
      const metricValue = toNumber(row.metric_value) ?? 0;

      if (!seenRows.has(rowKeyValue)) {
        seenRows.add(rowKeyValue);
        rowOrder.push(rowKeyValue);
      }
      if (!seenColumns.has(columnKeyValue)) {
        seenColumns.add(columnKeyValue);
        columnOrder.push(columnKeyValue);
      }

      cells.set(cellKey(rowKeyValue, columnKeyValue), metricValue);
      rowTotals.set(
        rowKeyValue,
        (rowTotals.get(rowKeyValue) ?? 0) + metricValue,
      );
      columnTotals.set(
        columnKeyValue,
        (columnTotals.get(columnKeyValue) ?? 0) + metricValue,
      );
      grandTotal += metricValue;
    }

    if (rowOrder.length === 0 || columnOrder.length === 0) {
      return {
        rowKeys: [],
        columnKeys: [],
        cells,
        rowTotals,
        columnTotals,
        grandTotal,
        groupedRows: 0,
        valueLabel: buildValueLabel(aggregation, valueField),
        error: "No grouped values were returned for the selected pivot fields.",
      };
    }

    return {
      rowKeys: rowOrder,
      columnKeys: columnOrder,
      cells,
      rowTotals,
      columnTotals,
      grandTotal,
      groupedRows: rows.length,
      valueLabel: buildValueLabel(aggregation, valueField),
      error: null,
    };
  } catch (error) {
    return {
      rowKeys: [],
      columnKeys: [],
      cells: new Map<string, number>(),
      rowTotals: new Map<string, number>(),
      columnTotals: new Map<string, number>(),
      grandTotal: 0,
      groupedRows: 0,
      valueLabel: buildValueLabel(aggregation, valueField),
      error:
        error instanceof Error ? error.message : "Pivot analysis failed.",
    };
  }
}

function PivotLoadingState() {
  return (
    <div
      className={`${GLASS_PANEL_CLASS} flex min-h-[22rem] items-center justify-center`}
    >
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Building pivot analysis…
      </div>
    </div>
  );
}

function PivotEmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <Table2 className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Pivot Analysis
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {message}
          </p>
        </div>
      </div>
    </section>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: SummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
        {value}
      </div>
    </div>
  );
}

function PivotAnalysisPanel({
  resource,
  tableName,
  rowField,
  valueField,
  aggregation,
}: {
  resource: Promise<PivotAnalysisResult>;
  tableName: string;
  rowField: string;
  valueField: string;
  aggregation: PivotAggregation;
}) {
  const result = use(resource);

  if (result.error) {
    return (
      <div className={`${GLASS_PANEL_CLASS} p-6`}>
        <p className="text-sm text-rose-600 dark:text-rose-300">
          {result.error}
        </p>
      </div>
    );
  }

  const values = Array.from(result.cells.values());
  const minCell = values.length > 0 ? Math.min(...values) : 0;
  const maxCell = values.length > 0 ? Math.max(...values) : 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className="space-y-5"
    >
      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Pivot Summary
            </div>
            <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              {result.valueLabel}
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Grouped into {formatNumber(result.groupedRows)} intersections with
              row and column totals computed in the client for fast export.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              downloadFile(
                buildExportCsv(result, rowField),
                `${tableName}-${valueField}-${aggregation}-pivot-analysis.csv`,
                "text/csv;charset=utf-8;",
              )
            }
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export pivot CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          icon={Rows3}
          label="Row groups"
          value={formatNumber(result.rowKeys.length)}
        />
        <SummaryCard
          icon={Columns3}
          label="Column groups"
          value={formatNumber(result.columnKeys.length)}
        />
        <SummaryCard
          icon={Sigma}
          label="Grand total"
          value={formatMetric(result.grandTotal)}
        />
      </div>

      <div className={`${GLASS_PANEL_CLASS} overflow-hidden`}>
        <div className="border-b border-white/20 px-5 py-4 dark:border-white/10">
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            Heatmapped pivot table
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Numeric cells are shaded by magnitude to make concentration patterns
            easier to scan.
          </p>
        </div>

        <div className="overflow-x-auto px-5 py-5">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 rounded-l-2xl bg-white/90 px-4 py-3 text-left font-semibold text-slate-700 backdrop-blur dark:bg-slate-950/85 dark:text-slate-200">
                  {rowField}
                </th>
                {result.columnKeys.map((columnKey) => (
                  <th
                    key={columnKey}
                    className="bg-white/60 px-4 py-3 text-right font-semibold text-slate-700 dark:bg-slate-950/45 dark:text-slate-200"
                  >
                    {columnKey}
                  </th>
                ))}
                <th className="rounded-r-2xl bg-cyan-500/10 px-4 py-3 text-right font-semibold text-cyan-900 dark:text-cyan-200">
                  Row total
                </th>
              </tr>
            </thead>
            <tbody>
              {result.rowKeys.map((rowKey) => (
                <tr key={rowKey}>
                  <th className="sticky left-0 z-10 border-t border-white/15 bg-white/90 px-4 py-3 text-left font-medium text-slate-800 backdrop-blur dark:bg-slate-950/85 dark:text-slate-100">
                    {rowKey}
                  </th>
                  {result.columnKeys.map((columnKey) => {
                    const value =
                      result.cells.get(cellKey(rowKey, columnKey)) ?? 0;
                    return (
                      <td
                        key={`${rowKey}-${columnKey}`}
                        className="border-t border-white/10 px-4 py-3 text-right text-slate-700 dark:text-slate-200"
                        style={{
                          backgroundColor: heatColor(value, minCell, maxCell),
                        }}
                      >
                        {formatMetric(value)}
                      </td>
                    );
                  })}
                  <td className="border-t border-white/10 bg-cyan-500/8 px-4 py-3 text-right font-semibold text-cyan-900 dark:text-cyan-200">
                    {formatMetric(result.rowTotals.get(rowKey) ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th className="sticky left-0 z-10 rounded-bl-2xl border-t border-white/20 bg-white/90 px-4 py-3 text-left font-semibold text-slate-900 backdrop-blur dark:bg-slate-950/85 dark:text-white">
                  Column total
                </th>
                {result.columnKeys.map((columnKey) => (
                  <td
                    key={`total-${columnKey}`}
                    className="border-t border-white/20 bg-cyan-500/8 px-4 py-3 text-right font-semibold text-cyan-900 dark:text-cyan-200"
                  >
                    {formatMetric(result.columnTotals.get(columnKey) ?? 0)}
                  </td>
                ))}
                <td className="rounded-br-2xl border-t border-white/20 bg-cyan-500/14 px-4 py-3 text-right font-semibold text-cyan-950 dark:text-cyan-100">
                  {formatMetric(result.grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </motion.div>
  );
}

export default function PivotAnalysis({
  tableName,
  columns,
}: PivotAnalysisProps) {
  const dimensionColumns = useMemo(
    () => columns.filter((column) => column.type !== "unknown"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );

  const [rowField, setRowField] = useState(dimensionColumns[0]?.name ?? "");
  const [columnField, setColumnField] = useState(
    dimensionColumns.find((column) => column.name !== dimensionColumns[0]?.name)
      ?.name ?? "",
  );
  const [valueField, setValueField] = useState(numericColumns[0]?.name ?? "");
  const [aggregation, setAggregation] = useState<PivotAggregation>("sum");

  const resolvedRowField = useMemo(() => {
    if (dimensionColumns.some((column) => column.name === rowField)) {
      return rowField;
    }
    return dimensionColumns[0]?.name ?? "";
  }, [dimensionColumns, rowField]);

  const resolvedColumnField = useMemo(() => {
    if (
      columnField !== resolvedRowField &&
      dimensionColumns.some((column) => column.name === columnField)
    ) {
      return columnField;
    }
    return (
      dimensionColumns.find((column) => column.name !== resolvedRowField)?.name ??
      ""
    );
  }, [columnField, dimensionColumns, resolvedRowField]);

  const resolvedValueField = useMemo(() => {
    if (aggregation === "count") {
      return valueField || numericColumns[0]?.name || columns[0]?.name || "rows";
    }

    if (numericColumns.some((column) => column.name === valueField)) {
      return valueField;
    }

    return numericColumns[0]?.name ?? "";
  }, [aggregation, columns, numericColumns, valueField]);

  const resource = useMemo(
    () =>
      loadPivotAnalysis(
        tableName,
        resolvedRowField,
        resolvedColumnField,
        resolvedValueField,
        aggregation,
      ),
    [
      aggregation,
      resolvedColumnField,
      resolvedRowField,
      resolvedValueField,
      tableName,
    ],
  );

  if (dimensionColumns.length < 2) {
    return (
      <PivotEmptyState message="Pivot analysis needs at least two usable columns." />
    );
  }

  if (aggregation !== "count" && numericColumns.length === 0) {
    return (
      <PivotEmptyState message="A numeric value column is required for sum, average, min, and max aggregations." />
    );
  }

  return (
    <section className="space-y-5">
      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
              <Table2 className="h-4 w-4" />
              Pivot Analysis
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Group rows and columns into a live pivot
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Choose dimensions and an aggregation to build a grouped pivot table
              directly from DuckDB.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Row field
              </span>
              <select
                value={resolvedRowField}
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

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Column field
              </span>
              <select
                value={resolvedColumnField}
                onChange={(event) => setColumnField(event.target.value)}
                className={FIELD_CLASS}
              >
                {dimensionColumns.map((column) => (
                  <option
                    key={column.name}
                    value={column.name}
                    disabled={column.name === resolvedRowField}
                  >
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Value field
              </span>
              <select
                value={resolvedValueField}
                onChange={(event) => setValueField(event.target.value)}
                className={FIELD_CLASS}
                disabled={aggregation !== "count" && numericColumns.length === 0}
              >
                {(aggregation === "count" ? columns : numericColumns).map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Aggregation
              </span>
              <select
                value={aggregation}
                onChange={(event) =>
                  setAggregation(event.target.value as PivotAggregation)
                }
                className={FIELD_CLASS}
              >
                {AGGREGATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      <Suspense fallback={<PivotLoadingState />}>
        <PivotAnalysisPanel
          resource={resource}
          tableName={tableName}
          rowField={resolvedRowField}
          valueField={resolvedValueField}
          aggregation={aggregation}
        />
      </Suspense>
    </section>
  );
}
