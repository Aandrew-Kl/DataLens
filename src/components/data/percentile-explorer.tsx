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
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  Activity,
  Download,
  Percent,
  SlidersHorizontal,
  Split,
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
import {
  percentile,
  quartiles,
} from "@/lib/utils/statistics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface PercentileExplorerProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface BoxSummary {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

interface PercentileSeries {
  column: string;
  values: number[];
  cdfPoints: Array<[number, number]>;
  boxSummary: BoxSummary;
  checkpoints: Array<{ percentile: number; value: number }>;
}

interface PercentileExplorerResult {
  primary: PercentileSeries | null;
  comparison: PercentileSeries | null;
  error: string | null;
}

interface SummaryCardProps {
  icon: typeof Percent;
  label: string;
  value: string;
}

const CHECKPOINTS = [1, 5, 10, 25, 50, 75, 90, 95, 99];

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatMetric(value: number) {
  if (!Number.isFinite(value)) return "—";
  return Math.abs(value) >= 1000 || Number.isInteger(value)
    ? formatNumber(value)
    : value.toFixed(2);
}

function buildSeries(
  column: string,
  values: number[],
): PercentileSeries {
  const sortedValues = [...values].sort((left, right) => left - right);
  const q = quartiles(sortedValues);
  const checkpoints = CHECKPOINTS.map((point) => ({
    percentile: point,
    value: percentile(sortedValues, point),
  }));

  const cdfPoints = sortedValues.map((value, index) => [
    value,
    ((index + 1) / sortedValues.length) * 100,
  ] as [number, number]);

  return {
    column,
    values: sortedValues,
    cdfPoints,
    boxSummary: {
      min: sortedValues[0],
      q1: q.q1,
      median: q.q2,
      q3: q.q3,
      max: sortedValues[sortedValues.length - 1],
    },
    checkpoints,
  };
}

async function loadNumericValues(
  tableName: string,
  columnName: string,
) {
  const rows = await runQuery(`
    SELECT TRY_CAST(${quoteIdentifier(columnName)} AS DOUBLE) AS metric_value
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(columnName)} IS NOT NULL
      AND TRY_CAST(${quoteIdentifier(columnName)} AS DOUBLE) IS NOT NULL
    LIMIT 5000
  `);

  return rows
    .map((row) => toNumber(row.metric_value))
    .filter((value): value is number => value !== null);
}

async function loadPercentileExplorer(
  tableName: string,
  primaryColumn: string,
  comparisonColumn: string,
): Promise<PercentileExplorerResult> {
  if (!primaryColumn) {
    return {
      primary: null,
      comparison: null,
      error: "Choose a numeric column to explore percentiles.",
    };
  }

  try {
    const [primaryValues, comparisonValues] = await Promise.all([
      loadNumericValues(tableName, primaryColumn),
      comparisonColumn && comparisonColumn !== primaryColumn
        ? loadNumericValues(tableName, comparisonColumn)
        : Promise.resolve<number[]>([]),
    ]);

    if (primaryValues.length === 0) {
      return {
        primary: null,
        comparison: null,
        error: "The selected primary column does not contain numeric values.",
      };
    }

    return {
      primary: buildSeries(primaryColumn, primaryValues),
      comparison:
        comparisonValues.length > 0
          ? buildSeries(comparisonColumn, comparisonValues)
          : null,
      error: null,
    };
  } catch (error) {
    return {
      primary: null,
      comparison: null,
      error:
        error instanceof Error
          ? error.message
          : "Percentile exploration failed.",
    };
  }
}

function buildExportCsv(result: PercentileExplorerResult) {
  const primary = result.primary;
  const comparison = result.comparison;

  if (!primary) {
    return "";
  }

  const header = [
    "percentile",
    primary.column,
    comparison?.column ?? "",
  ];
  const lines = CHECKPOINTS.map((checkpoint) => {
    const primaryValue = primary.checkpoints.find(
      (item) => item.percentile === checkpoint,
    )?.value;
    const comparisonValue = comparison?.checkpoints.find(
      (item) => item.percentile === checkpoint,
    )?.value;

    return [checkpoint, primaryValue ?? "", comparisonValue ?? ""];
  });

  return [header, ...lines]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
}

function buildChartOption(result: PercentileExplorerResult): EChartsOption {
  const series = [result.primary, result.comparison]
    .filter((item): item is PercentileSeries => item !== null)
    .map((item, index) => ({
      name: item.column,
      type: "line" as const,
      smooth: true,
      showSymbol: item.cdfPoints.length <= 40,
      lineStyle: { width: 3 },
      areaStyle: { opacity: 0.08 + index * 0.04 },
      data: item.cdfPoints,
    }));

  return {
    animationDuration: 420,
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => {
        const points = Array.isArray(params)
          ? (params as Array<{
              data?: [number, number];
              seriesName?: string;
            }>)
          : [];

        return points
          .map((point) => {
            const value = point.data?.[0] ?? 0;
            const cumulative = point.data?.[1] ?? 0;
            return `${point.seriesName ?? "Series"}: ${formatMetric(value)} at ${cumulative.toFixed(1)}%`;
          })
          .join("<br/>");
      },
    },
    legend: {
      top: 0,
    },
    grid: {
      left: 18,
      right: 18,
      top: 44,
      bottom: 18,
      containLabel: true,
    },
    xAxis: {
      type: "value",
      name: "Value",
    },
    yAxis: {
      type: "value",
      name: "Cumulative percentile",
      min: 0,
      max: 100,
    },
    series,
  };
}

function PercentileLoadingState() {
  return (
    <div
      className={`${GLASS_PANEL_CLASS} flex min-h-[22rem] items-center justify-center`}
    >
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Loading percentile explorer…
      </div>
    </div>
  );
}

function PercentileEmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <Percent className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Percentile Explorer
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

function BoxSummaryTable({
  series,
}: {
  series: PercentileSeries;
}) {
  const rows = [
    ["Minimum", series.boxSummary.min],
    ["Q1", series.boxSummary.q1],
    ["Median", series.boxSummary.median],
    ["Q3", series.boxSummary.q3],
    ["Maximum", series.boxSummary.max],
  ] as const;

  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Split className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        {series.column} box summary
      </div>
      <div className="mt-4 space-y-2 text-sm text-slate-700 dark:text-slate-200">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <span>{label}</span>
            <span className="font-semibold">{formatMetric(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PercentileExplorerPanel({
  resource,
  tableName,
  percentileValue,
}: {
  resource: Promise<PercentileExplorerResult>;
  tableName: string;
  percentileValue: number;
}) {
  const result = use(resource);

  if (result.error || !result.primary) {
    return (
      <div className={`${GLASS_PANEL_CLASS} p-6`}>
        <p className="text-sm text-rose-600 dark:text-rose-300">
          {result.error ?? "Unable to build the percentile view."}
        </p>
      </div>
    );
  }

  const primaryValue = percentile(result.primary.values, percentileValue);
  const comparisonValue = result.comparison
    ? percentile(result.comparison.values, percentileValue)
    : null;
  const chartOption = buildChartOption(result);

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
              Percentile Snapshot
            </div>
            <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              P{percentileValue} comparison
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Compare cumulative distribution curves and box summaries for the
              selected numeric columns.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              downloadFile(
                buildExportCsv(result),
                `${tableName}-${result.primary?.column ?? "percentiles"}-percentiles.csv`,
                "text/csv;charset=utf-8;",
              )
            }
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export percentile CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          icon={Percent}
          label={`${result.primary.column} at P${percentileValue}`}
          value={formatMetric(primaryValue)}
        />
        <SummaryCard
          icon={SlidersHorizontal}
          label={
            result.comparison
              ? `${result.comparison.column} at P${percentileValue}`
              : "Comparison column"
          }
          value={
            result.comparison && comparisonValue !== null
              ? formatMetric(comparisonValue)
              : "Optional"
          }
        />
        <SummaryCard
          icon={Activity}
          label="Rows profiled"
          value={formatNumber(result.primary.values.length)}
        />
      </div>

      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            Cumulative distribution function
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            The line chart shows how quickly each column accumulates percentile
            mass across its numeric range.
          </p>
        </div>
        <ReactEChartsCore
          echarts={echarts}
          option={chartOption}
          notMerge
          lazyUpdate
          style={{ height: 360 }}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <BoxSummaryTable series={result.primary} />
        {result.comparison ? (
          <BoxSummaryTable series={result.comparison} />
        ) : (
          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              <Split className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
              Comparison column
            </div>
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
              Select a second numeric column to compare percentile curves side by
              side.
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function PercentileExplorer({
  tableName,
  columns,
}: PercentileExplorerProps) {
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [primaryColumn, setPrimaryColumn] = useState(
    numericColumns[0]?.name ?? "",
  );
  const [comparisonColumn, setComparisonColumn] = useState(
    numericColumns.find((column) => column.name !== numericColumns[0]?.name)
      ?.name ?? "",
  );
  const [percentileValue, setPercentileValue] = useState(50);

  const resolvedPrimaryColumn = useMemo(() => {
    if (numericColumns.some((column) => column.name === primaryColumn)) {
      return primaryColumn;
    }
    return numericColumns[0]?.name ?? "";
  }, [numericColumns, primaryColumn]);

  const resolvedComparisonColumn = useMemo(() => {
    if (
      comparisonColumn !== resolvedPrimaryColumn &&
      numericColumns.some((column) => column.name === comparisonColumn)
    ) {
      return comparisonColumn;
    }
    return (
      numericColumns.find((column) => column.name !== resolvedPrimaryColumn)?.name ??
      ""
    );
  }, [comparisonColumn, numericColumns, resolvedPrimaryColumn]);

  const resource = useMemo(
    () =>
      loadPercentileExplorer(
        tableName,
        resolvedPrimaryColumn,
        resolvedComparisonColumn,
      ),
    [resolvedComparisonColumn, resolvedPrimaryColumn, tableName],
  );

  if (numericColumns.length === 0) {
    return (
      <PercentileEmptyState message="Percentile exploration requires at least one numeric column." />
    );
  }

  return (
    <section className="space-y-5">
      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
              <Percent className="h-4 w-4" />
              Percentile Explorer
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Explore percentile curves and box summaries
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Slide between P1 and P99 to see how two numeric columns separate
              across their distributions.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Primary column
              </span>
              <select
                value={resolvedPrimaryColumn}
                onChange={(event) => setPrimaryColumn(event.target.value)}
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
                Comparison column
              </span>
              <select
                value={resolvedComparisonColumn}
                onChange={(event) => setComparisonColumn(event.target.value)}
                className={FIELD_CLASS}
              >
                {numericColumns.map((column) => (
                  <option
                    key={column.name}
                    value={column.name}
                    disabled={column.name === resolvedPrimaryColumn}
                  >
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Percentile
              </span>
              <div className={`${GLASS_CARD_CLASS} px-4 py-3`}>
                <input
                  type="range"
                  min={1}
                  max={99}
                  value={percentileValue}
                  onChange={(event) =>
                    setPercentileValue(Number(event.target.value))
                  }
                  className="w-full accent-cyan-500"
                />
                <div className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  P{percentileValue}
                </div>
              </div>
            </label>
          </div>
        </div>
      </div>

      <Suspense fallback={<PercentileLoadingState />}>
        <PercentileExplorerPanel
          resource={resource}
          tableName={tableName}
          percentileValue={percentileValue}
        />
      </Suspense>
    </section>
  );
}
