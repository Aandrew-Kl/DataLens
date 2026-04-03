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
import { BarChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  ArrowLeftRight,
  Download,
  FileDiff,
  History,
  TableProperties,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  BarChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface DataSnapshotCompareProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface TableOption {
  name: string;
  label: string;
}

interface SchemaColumn {
  name: string;
  type: string;
  isNumeric: boolean;
}

interface HistogramBin {
  label: string;
  leftCount: number;
  rightCount: number;
}

interface ColumnDiffRow {
  column: string;
  leftType: string | null;
  rightType: string | null;
  status: "shared" | "added" | "removed" | "type-changed";
}

interface SnapshotComparisonResult {
  leftRowCount: number;
  rightRowCount: number;
  sharedNumericColumns: string[];
  resolvedMetricColumn: string;
  histogram: HistogramBin[];
  columnDiffs: ColumnDiffRow[];
  addedCount: number;
  removedCount: number;
  typeChangedCount: number;
  error: string | null;
}

interface SnapshotOptionsResult {
  options: TableOption[];
  error: string | null;
}

function CompareLoadingState() {
  return (
    <div
      className={`${GLASS_PANEL_CLASS} flex min-h-[28rem] items-center justify-center`}
    >
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Comparing snapshots…
      </div>
    </div>
  );
}

function SnapshotEmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <History className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Data Snapshot Compare
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {message}
          </p>
        </div>
      </div>
    </section>
  );
}

function sanitizeTableName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isNumericType(type: string) {
  return /(double|float|real|decimal|numeric|int)/i.test(type);
}

function loadHistogram(
  leftValues: number[],
  rightValues: number[],
) {
  if (leftValues.length === 0 || rightValues.length === 0) return [];

  const lowerBound = Math.min(...leftValues, ...rightValues);
  const upperBound = Math.max(...leftValues, ...rightValues);
  const span = Math.max(upperBound - lowerBound, 1);
  const binCount = 10;
  const width = span / binCount;

  const bins = Array.from({ length: binCount }, (_, index) => ({
    label: `${(lowerBound + width * index).toFixed(1)} to ${(lowerBound + width * (index + 1)).toFixed(1)}`,
    leftCount: 0,
    rightCount: 0,
  }));

  const placeValue = (value: number, key: "leftCount" | "rightCount") => {
    const rawIndex = Math.floor((value - lowerBound) / width);
    const index = Math.min(binCount - 1, Math.max(0, rawIndex));
    bins[index][key] += 1;
  };

  leftValues.forEach((value) => placeValue(value, "leftCount"));
  rightValues.forEach((value) => placeValue(value, "rightCount"));

  return bins;
}

function buildChartOption(
  histogram: HistogramBin[],
  leftLabel: string,
  rightLabel: string,
  metricColumn: string,
): EChartsOption {
  return {
    animationDuration: 400,
    tooltip: { trigger: "axis" },
    legend: {
      data: [leftLabel, rightLabel],
      top: 0,
    },
    grid: {
      left: 16,
      right: 16,
      top: 42,
      bottom: 16,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      name: metricColumn,
      data: histogram.map((bin) => bin.label),
      axisLabel: {
        interval: 0,
        rotate: 28,
      },
    },
    yAxis: {
      type: "value",
      name: "Rows",
    },
    series: [
      {
        name: leftLabel,
        type: "bar",
        data: histogram.map((bin) => bin.leftCount),
        barGap: "-100%",
        itemStyle: {
          color: "rgba(14, 165, 233, 0.45)",
          borderRadius: [12, 12, 0, 0],
        },
      },
      {
        name: rightLabel,
        type: "bar",
        data: histogram.map((bin) => bin.rightCount),
        itemStyle: {
          color: "rgba(168, 85, 247, 0.55)",
          borderRadius: [12, 12, 0, 0],
        },
      },
    ],
  };
}

async function loadSnapshotOptions(
  tableName: string,
): Promise<SnapshotOptionsResult> {
  try {
    const rows = await runQuery("SHOW TABLES");
    const tables = rows
      .map((row) => String(row.name ?? row.table_name ?? row.table ?? ""))
      .filter(Boolean);
    const snapshotPrefix = "__snapshot_";
    const versionPrefix = `__version_${sanitizeTableName(tableName)}_`;
    const filtered = tables.filter(
      (name) =>
        name === tableName ||
        name.startsWith(snapshotPrefix) ||
        name.startsWith(versionPrefix),
    );

    const options = filtered
      .map<TableOption>((name) => ({
        name,
        label:
          name === tableName
            ? `${name} (current)`
            : name.startsWith("__snapshot_")
              ? `${name.replace("__snapshot_", "").replaceAll("_", " ")} snapshot`
              : name.replaceAll("_", " "),
      }))
      .sort((left, right) => {
        if (left.name === tableName) return -1;
        if (right.name === tableName) return 1;
        return right.name.localeCompare(left.name);
      });

    return { options, error: null };
  } catch (error) {
    return {
      options: [],
      error:
        error instanceof Error
          ? error.message
          : "Unable to load snapshot tables.",
    };
  }
}

async function loadSchema(tableName: string) {
  const rows = await runQuery(`DESCRIBE ${quoteIdentifier(tableName)}`);
  return rows
    .map((row) => ({
      name: String(row.column_name ?? ""),
      type: String(row.column_type ?? "UNKNOWN"),
      isNumeric: isNumericType(String(row.column_type ?? "")),
    }))
    .filter((row): row is SchemaColumn => Boolean(row.name));
}

async function loadRowCount(tableName: string) {
  const rows = await runQuery(`
    SELECT COUNT(*) AS row_count
    FROM ${quoteIdentifier(tableName)}
  `);
  return Number(rows[0]?.row_count ?? 0);
}

async function loadMetricValues(tableName: string, columnName: string) {
  const rows = await runQuery(`
    SELECT TRY_CAST(${quoteIdentifier(columnName)} AS DOUBLE) AS value
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(columnName)} IS NOT NULL
      AND TRY_CAST(${quoteIdentifier(columnName)} AS DOUBLE) IS NOT NULL
    LIMIT 4000
  `);

  return rows
    .map((row) => toNumber(row.value))
    .filter((value): value is number => value !== null);
}

async function loadSnapshotComparison(
  leftTable: string,
  rightTable: string,
  preferredMetricColumn: string,
): Promise<SnapshotComparisonResult> {
  try {
    const [leftSchema, rightSchema, leftRowCount, rightRowCount] = await Promise.all([
      loadSchema(leftTable),
      loadSchema(rightTable),
      loadRowCount(leftTable),
      loadRowCount(rightTable),
    ]);

    const leftMap = new Map(leftSchema.map((column) => [column.name, column]));
    const rightMap = new Map(rightSchema.map((column) => [column.name, column]));
    const allColumnNames = Array.from(
      new Set([...leftMap.keys(), ...rightMap.keys()]),
    ).sort((left, right) => left.localeCompare(right));
    const columnDiffs = allColumnNames.map<ColumnDiffRow>((column) => {
      const leftColumn = leftMap.get(column);
      const rightColumn = rightMap.get(column);

      if (leftColumn && rightColumn) {
        return {
          column,
          leftType: leftColumn.type,
          rightType: rightColumn.type,
          status:
            leftColumn.type === rightColumn.type ? "shared" : "type-changed",
        };
      }

      return {
        column,
        leftType: leftColumn?.type ?? null,
        rightType: rightColumn?.type ?? null,
        status: leftColumn ? "removed" : "added",
      };
    });

    const sharedNumericColumns = leftSchema
      .filter((column) => column.isNumeric)
      .map((column) => column.name)
      .filter(
        (column) =>
          rightMap.get(column)?.isNumeric === true,
      );
    const resolvedMetricColumn = sharedNumericColumns.includes(preferredMetricColumn)
      ? preferredMetricColumn
      : sharedNumericColumns[0] ?? "";
    const histogram =
      resolvedMetricColumn.length > 0
        ? loadHistogram(
            await loadMetricValues(leftTable, resolvedMetricColumn),
            await loadMetricValues(rightTable, resolvedMetricColumn),
          )
        : [];

    return {
      leftRowCount,
      rightRowCount,
      sharedNumericColumns,
      resolvedMetricColumn,
      histogram,
      columnDiffs,
      addedCount: columnDiffs.filter((row) => row.status === "added").length,
      removedCount: columnDiffs.filter((row) => row.status === "removed").length,
      typeChangedCount: columnDiffs.filter((row) => row.status === "type-changed").length,
      error: null,
    };
  } catch (error) {
    return {
      leftRowCount: 0,
      rightRowCount: 0,
      sharedNumericColumns: [],
      resolvedMetricColumn: "",
      histogram: [],
      columnDiffs: [],
      addedCount: 0,
      removedCount: 0,
      typeChangedCount: 0,
      error:
        error instanceof Error
          ? error.message
          : "Failed to compare snapshots.",
    };
  }
}

function MetricCard({
  label,
  icon: Icon,
  value,
  detail,
}: {
  label: string;
  icon: typeof History;
  value: string;
  detail: string;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        {label}
      </div>
      <div className="mt-4 text-2xl font-semibold text-slate-950 dark:text-white">
        {value}
      </div>
      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{detail}</div>
    </div>
  );
}

function buildExportCsv(result: SnapshotComparisonResult) {
  const summaryRows = [
    "section,label,value",
    `summary,left_row_count,${result.leftRowCount}`,
    `summary,right_row_count,${result.rightRowCount}`,
    `summary,added_columns,${result.addedCount}`,
    `summary,removed_columns,${result.removedCount}`,
    `summary,type_changed_columns,${result.typeChangedCount}`,
  ];
  const diffRows = [
    "diff,column,left_type,right_type,status",
    ...result.columnDiffs.map(
      (row) =>
        `diff,${row.column},${row.leftType ?? ""},${row.rightType ?? ""},${row.status}`,
    ),
  ];
  const histogramRows = result.histogram.length
    ? [
        "distribution,label,left_count,right_count",
        ...result.histogram.map(
          (row) =>
            `distribution,"${row.label}",${row.leftCount},${row.rightCount}`,
        ),
      ]
    : [];

  return [...summaryRows, "", ...diffRows, ...(histogramRows.length ? ["", ...histogramRows] : [])].join("\n");
}

function SnapshotComparisonPanel({
  resource,
  leftTable,
  rightTable,
}: {
  resource: Promise<SnapshotComparisonResult>;
  leftTable: string;
  rightTable: string;
}) {
  const result = use(resource);

  if (result.error) {
    return (
      <div className={`${GLASS_PANEL_CLASS} p-6`}>
        <p className="text-sm text-rose-600 dark:text-rose-300">{result.error}</p>
      </div>
    );
  }

  const chartOption = buildChartOption(
    result.histogram,
    leftTable,
    rightTable,
    result.resolvedMetricColumn,
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className="space-y-5"
    >
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard
          label="Row count"
          icon={History}
          value={`${formatNumber(result.leftRowCount)} / ${formatNumber(result.rightRowCount)}`}
          detail={`${leftTable} versus ${rightTable}`}
        />
        <MetricCard
          label="Added columns"
          icon={ArrowLeftRight}
          value={formatNumber(result.addedCount)}
          detail="Present only in the right snapshot"
        />
        <MetricCard
          label="Removed columns"
          icon={TableProperties}
          value={formatNumber(result.removedCount)}
          detail="Present only in the left snapshot"
        />
        <MetricCard
          label="Type changes"
          icon={FileDiff}
          value={formatNumber(result.typeChangedCount)}
          detail="Shared names with changed data types"
        />
      </div>

      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
              Value distribution comparison
            </h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Shared numeric columns can be compared as overlaid histograms.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              downloadFile(
                buildExportCsv(result),
                `${leftTable}-vs-${rightTable}-snapshot-comparison.csv`,
                "text/csv;charset=utf-8;",
              )
            }
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export comparison report
          </button>
        </div>

        {result.resolvedMetricColumn ? (
          <ReactEChartsCore
            echarts={echarts}
            option={chartOption}
            notMerge
            lazyUpdate
            style={{ height: 340 }}
          />
        ) : (
          <div className="rounded-2xl border border-amber-200/60 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/20 dark:text-amber-300">
            No shared numeric columns were available for distribution comparison.
          </div>
        )}
      </div>

      <div className={`${GLASS_PANEL_CLASS} overflow-hidden p-5`}>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            Column diff table
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Added, removed, and type-changed columns are highlighted inline.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Column</th>
                <th className="px-3 py-2">{leftTable}</th>
                <th className="px-3 py-2">{rightTable}</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {result.columnDiffs.map((row) => (
                <tr
                  key={row.column}
                  className="border-t border-white/10 text-slate-700 dark:text-slate-200"
                >
                  <td className="px-3 py-3 font-medium">{row.column}</td>
                  <td className="px-3 py-3">{row.leftType ?? "—"}</td>
                  <td className="px-3 py-3">{row.rightType ?? "—"}</td>
                  <td className="px-3 py-3 capitalize">{row.status.replace("-", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}

function SnapshotCompareWorkspace({
  tableName,
  optionsResource,
}: {
  tableName: string;
  optionsResource: Promise<SnapshotOptionsResult>;
}) {
  const optionsResult = use(optionsResource);
  const options = optionsResult.options;
  const [leftTable, setLeftTable] = useState(tableName);
  const [rightTable, setRightTable] = useState("");
  const [metricColumn, setMetricColumn] = useState("");

  if (optionsResult.error) {
    return <SnapshotEmptyState message={optionsResult.error} />;
  }

  if (options.length < 2) {
    return (
      <SnapshotEmptyState message="No snapshot tables available for comparison yet." />
    );
  }

  const resolvedLeftTable = options.some((option) => option.name === leftTable)
    ? leftTable
    : options[0]?.name ?? "";
  const fallbackRightTable =
    options.find((option) => option.name !== resolvedLeftTable)?.name ?? "";
  const resolvedRightTable =
    rightTable &&
    rightTable !== resolvedLeftTable &&
    options.some((option) => option.name === rightTable)
      ? rightTable
      : fallbackRightTable;

  const comparisonResource = useMemo(
    () =>
      loadSnapshotComparison(
        resolvedLeftTable,
        resolvedRightTable,
        metricColumn,
      ),
    [metricColumn, resolvedLeftTable, resolvedRightTable],
  );
  const comparisonResult = use(comparisonResource);

  return (
    <section className="space-y-5">
      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                <History className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Version Diff
                </p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                  Data Snapshot Compare
                </h2>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Compare two physical DuckDB snapshots side-by-side, inspect schema
              drift, and quantify how shared numeric columns shifted between
              versions.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Left snapshot
              </span>
              <select
                value={resolvedLeftTable}
                onChange={(event) => setLeftTable(event.target.value)}
                className={FIELD_CLASS}
              >
                {options.map((option) => (
                  <option key={option.name} value={option.name}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Right snapshot
              </span>
              <select
                value={resolvedRightTable}
                onChange={(event) => setRightTable(event.target.value)}
                className={FIELD_CLASS}
              >
                {options
                  .filter((option) => option.name !== resolvedLeftTable)
                  .map((option) => (
                    <option key={option.name} value={option.name}>
                      {option.label}
                    </option>
                  ))}
              </select>
            </label>

            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Shared metric
              </span>
              <select
                value={comparisonResult.resolvedMetricColumn}
                onChange={(event) => setMetricColumn(event.target.value)}
                className={FIELD_CLASS}
                disabled={comparisonResult.sharedNumericColumns.length === 0}
              >
                {comparisonResult.sharedNumericColumns.length === 0 ? (
                  <option value="">No shared numeric columns</option>
                ) : (
                  comparisonResult.sharedNumericColumns.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
        </div>
      </div>

      <SnapshotComparisonPanel
        resource={Promise.resolve(comparisonResult)}
        leftTable={resolvedLeftTable}
        rightTable={resolvedRightTable}
      />
    </section>
  );
}

export default function DataSnapshotCompare({
  tableName,
}: DataSnapshotCompareProps) {
  const optionsResource = useMemo(() => loadSnapshotOptions(tableName), [tableName]);

  return (
    <Suspense fallback={<CompareLoadingState />}>
      <SnapshotCompareWorkspace
        tableName={tableName}
        optionsResource={optionsResource}
      />
    </Suspense>
  );
}
