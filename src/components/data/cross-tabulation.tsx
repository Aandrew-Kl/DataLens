"use client";

import {
  Suspense,
  use,
  useMemo,
  useState,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { HeatmapChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  Download,
  Grid2X2,
  Percent,
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

echarts.use([
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

interface CrossTabulationProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface CrossTabCell {
  observed: number;
  expected: number;
  residual: number;
}

interface CrossTabulationResult {
  rowKeys: string[];
  columnKeys: string[];
  cells: Map<string, CrossTabCell>;
  rowTotals: Map<string, number>;
  columnTotals: Map<string, number>;
  total: number;
  chiSquare: number;
  pValue: number;
  cramersV: number;
  error: string | null;
}

interface SummaryCardProps {
  icon: typeof Sigma;
  label: string;
  value: string;
}

function cellKey(rowKey: string, columnKey: string) {
  return `${rowKey}\u0000${columnKey}`;
}

function isCategorical(column: ColumnProfile) {
  return (
    (column.type === "string" || column.type === "boolean") &&
    column.uniqueCount >= 2 &&
    column.uniqueCount <= 24
  );
}

function formatMetric(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000 || Number.isInteger(value)) {
    return formatNumber(value);
  }
  return value.toFixed(digits);
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function normalCdf(z: number) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x));
  return 0.5 * (1 + sign * erf);
}

function chiSquarePValue(statistic: number, degreesOfFreedom: number) {
  if (!Number.isFinite(statistic) || degreesOfFreedom <= 0) {
    return 1;
  }

  const z =
    (Math.cbrt(statistic / degreesOfFreedom) -
      (1 - 2 / (9 * degreesOfFreedom))) /
    Math.sqrt(2 / (9 * degreesOfFreedom));
  return Math.max(0, Math.min(1, 1 - normalCdf(z)));
}

async function loadCrossTabulation(
  tableName: string,
  rowColumn: string,
  columnColumn: string,
): Promise<CrossTabulationResult> {
  if (!rowColumn || !columnColumn) {
    return {
      rowKeys: [],
      columnKeys: [],
      cells: new Map<string, CrossTabCell>(),
      rowTotals: new Map<string, number>(),
      columnTotals: new Map<string, number>(),
      total: 0,
      chiSquare: 0,
      pValue: 1,
      cramersV: 0,
      error: "Choose two categorical columns to build the contingency table.",
    };
  }

  try {
    const rows = await runQuery(`
      SELECT
        COALESCE(CAST(${quoteIdentifier(rowColumn)} AS VARCHAR), '(blank)') AS row_key,
        COALESCE(CAST(${quoteIdentifier(columnColumn)} AS VARCHAR), '(blank)') AS column_key,
        COUNT(*) AS observed_count
      FROM ${quoteIdentifier(tableName)}
      WHERE ${quoteIdentifier(rowColumn)} IS NOT NULL
        AND ${quoteIdentifier(columnColumn)} IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);

    const rowOrder: string[] = [];
    const columnOrder: string[] = [];
    const seenRows = new Set<string>();
    const seenColumns = new Set<string>();
    const observedMap = new Map<string, number>();
    const rowTotals = new Map<string, number>();
    const columnTotals = new Map<string, number>();
    let total = 0;

    for (const row of rows) {
      const rowKeyValue = String(row.row_key ?? "(blank)");
      const columnKeyValue = String(row.column_key ?? "(blank)");
      const observed = toNumber(row.observed_count) ?? 0;

      if (!seenRows.has(rowKeyValue)) {
        seenRows.add(rowKeyValue);
        rowOrder.push(rowKeyValue);
      }
      if (!seenColumns.has(columnKeyValue)) {
        seenColumns.add(columnKeyValue);
        columnOrder.push(columnKeyValue);
      }

      observedMap.set(cellKey(rowKeyValue, columnKeyValue), observed);
      rowTotals.set(rowKeyValue, (rowTotals.get(rowKeyValue) ?? 0) + observed);
      columnTotals.set(
        columnKeyValue,
        (columnTotals.get(columnKeyValue) ?? 0) + observed,
      );
      total += observed;
    }

    if (rowOrder.length < 2 || columnOrder.length < 2 || total === 0) {
      return {
        rowKeys: rowOrder,
        columnKeys: columnOrder,
        cells: new Map<string, CrossTabCell>(),
        rowTotals,
        columnTotals,
        total,
        chiSquare: 0,
        pValue: 1,
        cramersV: 0,
        error: "At least two row groups and two column groups are needed for a contingency table.",
      };
    }

    const cells = new Map<string, CrossTabCell>();
    let chiSquare = 0;

    for (const rowKeyValue of rowOrder) {
      const rowTotal = rowTotals.get(rowKeyValue) ?? 0;
      for (const columnKeyValue of columnOrder) {
        const columnTotal = columnTotals.get(columnKeyValue) ?? 0;
        const observed =
          observedMap.get(cellKey(rowKeyValue, columnKeyValue)) ?? 0;
        const expected = (rowTotal * columnTotal) / total;
        const residual =
          expected > 0 ? (observed - expected) / Math.sqrt(expected) : 0;
        chiSquare += expected > 0 ? ((observed - expected) ** 2) / expected : 0;

        cells.set(cellKey(rowKeyValue, columnKeyValue), {
          observed,
          expected,
          residual,
        });
      }
    }

    const degreesOfFreedom = (rowOrder.length - 1) * (columnOrder.length - 1);
    const pValue = chiSquarePValue(chiSquare, degreesOfFreedom);
    const cramersV = Math.sqrt(
      chiSquare /
        (total * Math.max(1, Math.min(rowOrder.length - 1, columnOrder.length - 1))),
    );

    return {
      rowKeys: rowOrder,
      columnKeys: columnOrder,
      cells,
      rowTotals,
      columnTotals,
      total,
      chiSquare,
      pValue,
      cramersV,
      error: null,
    };
  } catch (error) {
    return {
      rowKeys: [],
      columnKeys: [],
      cells: new Map<string, CrossTabCell>(),
      rowTotals: new Map<string, number>(),
      columnTotals: new Map<string, number>(),
      total: 0,
      chiSquare: 0,
      pValue: 1,
      cramersV: 0,
      error:
        error instanceof Error ? error.message : "Cross tabulation failed.",
    };
  }
}

function buildExportCsv(result: CrossTabulationResult) {
  const rows = [["row", "column", "observed", "expected", "residual"]];

  for (const rowKeyValue of result.rowKeys) {
    for (const columnKeyValue of result.columnKeys) {
      const cell = result.cells.get(cellKey(rowKeyValue, columnKeyValue));
      rows.push([
        rowKeyValue,
        columnKeyValue,
        cell?.observed ?? 0,
        cell?.expected ?? 0,
        cell?.residual ?? 0,
      ].map(csvEscape));
    }
  }

  return rows.map((row) => row.join(",")).join("\n");
}

function buildHeatmapOption(result: CrossTabulationResult): EChartsOption {
  const heatValues = result.rowKeys.flatMap((rowKeyValue, rowIndex) =>
    result.columnKeys.map((columnKeyValue, columnIndex) => {
      const residual =
        result.cells.get(cellKey(rowKeyValue, columnKeyValue))?.residual ?? 0;
      return [columnIndex, rowIndex, residual] as [number, number, number];
    }),
  );
  const maxResidual = Math.max(
    ...heatValues.map((point) => Math.abs(point[2])),
    1,
  );

  return {
    animationDuration: 420,
    tooltip: {
      position: "top",
      formatter: (params: unknown) => {
        const point = params as {
          data?: [number, number, number];
        };
        const columnIndex = point.data?.[0] ?? 0;
        const rowIndex = point.data?.[1] ?? 0;
        const residual = point.data?.[2] ?? 0;
        const rowKeyValue = result.rowKeys[rowIndex] ?? "";
        const columnKeyValue = result.columnKeys[columnIndex] ?? "";
        const cell = result.cells.get(cellKey(rowKeyValue, columnKeyValue));

        return [
          `${rowKeyValue} x ${columnKeyValue}`,
          `Observed: ${formatMetric(cell?.observed ?? 0, 0)}`,
          `Expected: ${formatMetric(cell?.expected ?? 0, 2)}`,
          `Residual: ${formatMetric(residual, 2)}`,
        ].join("<br/>");
      },
    },
    grid: {
      left: 100,
      right: 18,
      top: 24,
      bottom: 20,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: result.columnKeys,
    },
    yAxis: {
      type: "category",
      data: result.rowKeys,
    },
    visualMap: {
      min: -maxResidual,
      max: maxResidual,
      orient: "horizontal",
      left: "center",
      bottom: 0,
    },
    series: [
      {
        type: "heatmap",
        data: heatValues,
        label: {
          show: true,
          formatter: (params: unknown) => {
            const point = params as {
              data?: [number, number, number];
            };
            const residual = point.data?.[2] ?? 0;
            return residual.toFixed(1);
          },
        },
      },
    ],
  };
}

function CrossTabLoadingState() {
  return (
    <div
      className={`${GLASS_PANEL_CLASS} flex min-h-[22rem] items-center justify-center`}
    >
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Building contingency table…
      </div>
    </div>
  );
}

function CrossTabEmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <Table2 className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Cross Tabulation
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

function CrossTabulationPanel({
  resource,
  tableName,
  rowColumn,
  columnColumn,
}: {
  resource: Promise<CrossTabulationResult>;
  tableName: string;
  rowColumn: string;
  columnColumn: string;
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

  const chartOption = buildHeatmapOption(result);

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
              Association Summary
            </div>
            <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              {rowColumn} by {columnColumn}
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Observed counts are compared with expected counts to quantify
              dependence and residual concentration.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              downloadFile(
                buildExportCsv(result),
                `${tableName}-${rowColumn}-${columnColumn}-cross-tabulation.csv`,
                "text/csv;charset=utf-8;",
              )
            }
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export contingency CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          icon={Sigma}
          label="Chi-square"
          value={formatMetric(result.chiSquare, 2)}
        />
        <SummaryCard
          icon={Percent}
          label="p-value"
          value={result.pValue.toFixed(4)}
        />
        <SummaryCard
          icon={Grid2X2}
          label="Cramér's V"
          value={result.cramersV.toFixed(3)}
        />
      </div>

      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            Residual heatmap
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Positive residuals show where observed counts exceed expectation.
          </p>
        </div>
        <ReactEChartsCore
          echarts={echarts}
          option={chartOption}
          notMerge
          lazyUpdate
          style={{ height: 340 }}
        />
      </div>

      <div className={`${GLASS_PANEL_CLASS} overflow-hidden`}>
        <div className="border-b border-white/20 px-5 py-4 dark:border-white/10">
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            Observed versus expected counts
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Each cell shows observed count, expected count, and standardized
            residual.
          </p>
        </div>
        <div className="overflow-x-auto px-5 py-5">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 rounded-l-2xl bg-white/90 px-4 py-3 text-left font-semibold text-slate-700 backdrop-blur dark:bg-slate-950/85 dark:text-slate-200">
                  {rowColumn}
                </th>
                {result.columnKeys.map((columnKeyValue) => (
                  <th
                    key={columnKeyValue}
                    className="bg-white/60 px-4 py-3 text-left font-semibold text-slate-700 dark:bg-slate-950/45 dark:text-slate-200"
                  >
                    {columnKeyValue}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rowKeys.map((rowKeyValue) => (
                <tr key={rowKeyValue}>
                  <th className="sticky left-0 z-10 border-t border-white/15 bg-white/90 px-4 py-3 text-left font-medium text-slate-800 backdrop-blur dark:bg-slate-950/85 dark:text-slate-100">
                    {rowKeyValue}
                  </th>
                  {result.columnKeys.map((columnKeyValue) => {
                    const cell =
                      result.cells.get(cellKey(rowKeyValue, columnKeyValue)) ??
                      {
                        observed: 0,
                        expected: 0,
                        residual: 0,
                      };

                    return (
                      <td
                        key={`${rowKeyValue}-${columnKeyValue}`}
                        className="border-t border-white/10 px-4 py-3 align-top text-slate-700 dark:text-slate-200"
                      >
                        <div className="font-semibold">
                          {formatMetric(cell.observed, 0)} observed
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {formatMetric(cell.expected, 2)} expected
                        </div>
                        <div className="mt-1 text-xs text-cyan-700 dark:text-cyan-300">
                          Residual {formatMetric(cell.residual, 2)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}

export default function CrossTabulation({
  tableName,
  columns,
}: CrossTabulationProps) {
  const categoricalColumns = useMemo(
    () => columns.filter(isCategorical),
    [columns],
  );
  const [rowColumn, setRowColumn] = useState(
    categoricalColumns[0]?.name ?? "",
  );
  const [columnColumn, setColumnColumn] = useState(
    categoricalColumns.find((column) => column.name !== categoricalColumns[0]?.name)
      ?.name ?? "",
  );

  const resolvedRowColumn = useMemo(() => {
    if (categoricalColumns.some((column) => column.name === rowColumn)) {
      return rowColumn;
    }
    return categoricalColumns[0]?.name ?? "";
  }, [categoricalColumns, rowColumn]);

  const resolvedColumnColumn = useMemo(() => {
    if (
      columnColumn !== resolvedRowColumn &&
      categoricalColumns.some((column) => column.name === columnColumn)
    ) {
      return columnColumn;
    }
    return (
      categoricalColumns.find((column) => column.name !== resolvedRowColumn)
        ?.name ?? ""
    );
  }, [categoricalColumns, columnColumn, resolvedRowColumn]);

  const resource = useMemo(
    () =>
      loadCrossTabulation(
        tableName,
        resolvedRowColumn,
        resolvedColumnColumn,
      ),
    [resolvedColumnColumn, resolvedRowColumn, tableName],
  );

  if (categoricalColumns.length < 2) {
    return (
      <CrossTabEmptyState message="Cross tabulation requires at least two low-cardinality categorical columns." />
    );
  }

  return (
    <section className="space-y-5">
      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
              <Table2 className="h-4 w-4" />
              Cross Tabulation
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Build a contingency table for two categorical variables
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Inspect observed versus expected counts, chi-square signal, and
              residual pockets in one view.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Row column
              </span>
              <select
                value={resolvedRowColumn}
                onChange={(event) => setRowColumn(event.target.value)}
                className={FIELD_CLASS}
              >
                {categoricalColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Column column
              </span>
              <select
                value={resolvedColumnColumn}
                onChange={(event) => setColumnColumn(event.target.value)}
                className={FIELD_CLASS}
              >
                {categoricalColumns.map((column) => (
                  <option
                    key={column.name}
                    value={column.name}
                    disabled={column.name === resolvedRowColumn}
                  >
                    {column.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      <Suspense fallback={<CrossTabLoadingState />}>
        <CrossTabulationPanel
          resource={resource}
          tableName={tableName}
          rowColumn={resolvedRowColumn}
          columnColumn={resolvedColumnColumn}
        />
      </Suspense>
    </section>
  );
}
