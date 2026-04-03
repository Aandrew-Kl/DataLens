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
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  BarChart3,
  Download,
  LayoutGrid,
  Sigma,
  SlidersHorizontal,
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
import { percentile } from "@/lib/utils/statistics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface BinAnalyzerProps {
  tableName: string;
  columns: ColumnProfile[];
}

type BinMethod = "equal-width" | "equal-frequency" | "custom";

interface BinRow {
  label: string;
  lower: number;
  upper: number;
  count: number;
  mean: number;
  min: number;
  max: number;
}

interface NumericSnapshot {
  values: number[];
  error: string | null;
}

interface SummaryCardProps {
  icon: typeof LayoutGrid;
  label: string;
  value: string;
}

function formatMetric(value: number) {
  if (!Number.isFinite(value)) return "—";
  return Math.abs(value) >= 1000 || Number.isInteger(value)
    ? formatNumber(value)
    : value.toFixed(2);
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseBreakpoints(value: string) {
  return value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part))
    .sort((left, right) => left - right);
}

function buildEdges(
  values: number[],
  method: BinMethod,
  binCount: number,
  breakpointsInput: string,
) {
  const sortedValues = [...values].sort((left, right) => left - right);
  const min = sortedValues[0];
  const max = sortedValues[sortedValues.length - 1];

  if (method === "equal-width") {
    const span = Math.max(max - min, 1e-6);
    const width = span / binCount;
    return Array.from({ length: binCount + 1 }, (_, index) =>
      index === binCount ? max : min + width * index,
    );
  }

  if (method === "equal-frequency") {
    return Array.from({ length: binCount + 1 }, (_, index) =>
      percentile(sortedValues, (index / binCount) * 100),
    );
  }

  const parsed = parseBreakpoints(breakpointsInput);
  if (parsed.length === 0) {
    throw new Error("Provide at least one numeric breakpoint.");
  }

  const edges = [min, ...parsed.filter((point) => point > min && point < max), max];

  if (edges.length < 2) {
    throw new Error("Custom breakpoints do not create any bins.");
  }

  return edges;
}

function buildBins(
  values: number[],
  method: BinMethod,
  binCount: number,
  breakpointsInput: string,
) {
  if (values.length === 0) {
    return [];
  }

  const edges = buildEdges(values, method, binCount, breakpointsInput);
  const bins = Array.from({ length: Math.max(1, edges.length - 1) }, (_, index) => ({
    lower: edges[index],
    upper: edges[index + 1],
    values: [] as number[],
  }));

  values.forEach((value) => {
    let index = bins.findIndex((bin, binIndex) => {
      if (binIndex === bins.length - 1) {
        return value >= bin.lower && value <= bin.upper;
      }
      return value >= bin.lower && value < bin.upper;
    });

    if (index < 0) {
      index = bins.length - 1;
    }
    bins[index].values.push(value);
  });

  return bins.map((bin) => {
    const sum = bin.values.reduce((total, value) => total + value, 0);
    const count = bin.values.length;

    return {
      label: `${formatMetric(bin.lower)} to ${formatMetric(bin.upper)}`,
      lower: bin.lower,
      upper: bin.upper,
      count,
      mean: count > 0 ? sum / count : 0,
      min: count > 0 ? Math.min(...bin.values) : bin.lower,
      max: count > 0 ? Math.max(...bin.values) : bin.upper,
    } satisfies BinRow;
  });
}

async function loadNumericSnapshot(
  tableName: string,
  columnName: string,
): Promise<NumericSnapshot> {
  if (!columnName) {
    return {
      values: [],
      error: "Choose a numeric column to build bins.",
    };
  }

  try {
    const rows = await runQuery(`
      SELECT TRY_CAST(${quoteIdentifier(columnName)} AS DOUBLE) AS metric_value
      FROM ${quoteIdentifier(tableName)}
      WHERE ${quoteIdentifier(columnName)} IS NOT NULL
        AND TRY_CAST(${quoteIdentifier(columnName)} AS DOUBLE) IS NOT NULL
      LIMIT 5000
    `);
    const values = rows
      .map((row) => toNumber(row.metric_value))
      .filter((value): value is number => value !== null);

    if (values.length === 0) {
      return {
        values: [],
        error: "The selected column does not contain numeric values to bin.",
      };
    }

    return {
      values,
      error: null,
    };
  } catch (error) {
    return {
      values: [],
      error: error instanceof Error ? error.message : "Bin analysis failed.",
    };
  }
}

function buildExportCsv(rows: BinRow[]) {
  return [
    ["label", "lower", "upper", "count", "mean", "min", "max"],
    ...rows.map((row) => [
      row.label,
      row.lower,
      row.upper,
      row.count,
      row.mean,
      row.min,
      row.max,
    ]),
  ]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
}

function buildChartOption(rows: BinRow[]): EChartsOption {
  return {
    animationDuration: 420,
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => {
        const points = Array.isArray(params)
          ? (params as Array<{
              axisValue?: string;
              data?: number;
            }>)
          : [];
        const point = points[0];
        return `${point?.axisValue ?? "Bin"}<br/>Count: ${formatMetric(
          typeof point?.data === "number" ? point.data : 0,
          )}`;
      },
    },
    grid: {
      left: 18,
      right: 18,
      top: 18,
      bottom: 42,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: rows.map((row) => row.label),
      axisLabel: {
        interval: 0,
        rotate: rows.length > 5 ? 28 : 0,
      },
    },
    yAxis: {
      type: "value",
      name: "Count",
    },
    series: [
      {
        type: "bar",
        data: rows.map((row) => row.count),
        itemStyle: {
          color: "rgba(6, 182, 212, 0.72)",
          borderRadius: [12, 12, 0, 0],
        },
      },
    ],
  };
}

function BinLoadingState() {
  return (
    <div
      className={`${GLASS_PANEL_CLASS} flex min-h-[22rem] items-center justify-center`}
    >
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Building bins…
      </div>
    </div>
  );
}

function BinEmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <BarChart3 className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Bin Analyzer
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

function BinAnalyzerPanel({
  resource,
  tableName,
  columnName,
  method,
  binCount,
  breakpointsInput,
}: {
  resource: Promise<NumericSnapshot>;
  tableName: string;
  columnName: string;
  method: BinMethod;
  binCount: number;
  breakpointsInput: string;
}) {
  const snapshot = use(resource);

  if (snapshot.error) {
    return (
      <div className={`${GLASS_PANEL_CLASS} p-6`}>
        <p className="text-sm text-rose-600 dark:text-rose-300">
          {snapshot.error}
        </p>
      </div>
    );
  }

  let rows: BinRow[] = [];
  let derivedError: string | null = null;

  try {
    rows = buildBins(snapshot.values, method, binCount, breakpointsInput);
  } catch (error) {
    derivedError =
      error instanceof Error ? error.message : "Unable to build the selected bins.";
  }

  if (derivedError) {
    return (
      <div className={`${GLASS_PANEL_CLASS} p-6`}>
        <p className="text-sm text-rose-600 dark:text-rose-300">
          {derivedError}
        </p>
      </div>
    );
  }

  const chartOption = buildChartOption(rows);

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
              Bin Summary
            </div>
            <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              {method} bins for {columnName}
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Each bin reports count, mean, minimum, and maximum values for the
              profiled numeric rows.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              downloadFile(
                buildExportCsv(rows),
                `${tableName}-${columnName}-${method}-bins.csv`,
                "text/csv;charset=utf-8;",
              )
            }
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export bins CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          icon={LayoutGrid}
          label="Bins"
          value={formatNumber(rows.length)}
        />
        <SummaryCard
          icon={Sigma}
          label="Rows profiled"
          value={formatNumber(snapshot.values.length)}
        />
        <SummaryCard
          icon={SlidersHorizontal}
          label="Method"
          value={method}
        />
      </div>

      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            Bin distribution
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Compare how observations distribute across the generated bin edges.
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
            Bin statistics
          </h3>
        </div>
        <div className="overflow-x-auto px-5 py-5">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {["Bin", "Count", "Mean", "Min", "Max"].map((header) => (
                  <th
                    key={header}
                    className="bg-white/60 px-4 py-3 text-left font-semibold text-slate-700 dark:bg-slate-950/45 dark:text-slate-200"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td className="border-t border-white/10 px-4 py-3 text-slate-700 dark:text-slate-200">
                    {row.label}
                  </td>
                  <td className="border-t border-white/10 px-4 py-3 text-slate-700 dark:text-slate-200">
                    {formatNumber(row.count)}
                  </td>
                  <td className="border-t border-white/10 px-4 py-3 text-slate-700 dark:text-slate-200">
                    {formatMetric(row.mean)}
                  </td>
                  <td className="border-t border-white/10 px-4 py-3 text-slate-700 dark:text-slate-200">
                    {formatMetric(row.min)}
                  </td>
                  <td className="border-t border-white/10 px-4 py-3 text-slate-700 dark:text-slate-200">
                    {formatMetric(row.max)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}

export default function BinAnalyzer({
  tableName,
  columns,
}: BinAnalyzerProps) {
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [columnName, setColumnName] = useState(numericColumns[0]?.name ?? "");
  const [method, setMethod] = useState<BinMethod>("equal-width");
  const [binCountInput, setBinCountInput] = useState("5");
  const [breakpointsInput, setBreakpointsInput] = useState("10, 20, 30");

  const resolvedColumnName = useMemo(() => {
    if (numericColumns.some((column) => column.name === columnName)) {
      return columnName;
    }
    return numericColumns[0]?.name ?? "";
  }, [columnName, numericColumns]);

  const binCount = useMemo(
    () => Math.max(2, Math.min(20, Math.round(toNumber(binCountInput) ?? 5))),
    [binCountInput],
  );

  const resource = useMemo(
    () => loadNumericSnapshot(tableName, resolvedColumnName),
    [resolvedColumnName, tableName],
  );

  if (numericColumns.length === 0) {
    return (
      <BinEmptyState message="Bin analysis requires at least one numeric column." />
    );
  }

  return (
    <section className="space-y-5">
      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
              <BarChart3 className="h-4 w-4" />
              Bin Analyzer
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Configure equal-width, equal-frequency, or custom bins
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Build numeric bins, inspect the resulting distribution, and export
              the per-bin statistics as CSV.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Numeric column
              </span>
              <select
                value={resolvedColumnName}
                onChange={(event) => setColumnName(event.target.value)}
                className={FIELD_CLASS}
              >
                {numericColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Method
              </span>
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value as BinMethod)}
                className={FIELD_CLASS}
              >
                <option value="equal-width">Equal width</option>
                <option value="equal-frequency">Equal frequency</option>
                <option value="custom">Custom breakpoints</option>
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Bin count
              </span>
              <input
                value={binCountInput}
                onChange={(event) => setBinCountInput(event.target.value)}
                className={FIELD_CLASS}
                inputMode="numeric"
                disabled={method === "custom"}
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Custom breakpoints
              </span>
              <input
                value={breakpointsInput}
                onChange={(event) => setBreakpointsInput(event.target.value)}
                className={FIELD_CLASS}
                placeholder="10, 20, 30"
                disabled={method !== "custom"}
              />
            </label>
          </div>
        </div>
      </div>

      <Suspense fallback={<BinLoadingState />}>
        <BinAnalyzerPanel
          resource={resource}
          tableName={tableName}
          columnName={resolvedColumnName}
          method={method}
          binCount={binCount}
          breakpointsInput={breakpointsInput}
        />
      </Suspense>
    </section>
  );
}
