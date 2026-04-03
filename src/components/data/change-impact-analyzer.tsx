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
  ArrowRightLeft,
  Download,
  Sigma,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import {
  mean,
  median,
  standardDeviation,
} from "@/lib/utils/statistics";
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

interface ChangeImpactAnalyzerProps {
  tableName: string;
  columns: ColumnProfile[];
}

type ImpactMode = "multiplier" | "offset";

interface MetricDelta {
  before: number;
  after: number;
  changePercent: number;
}

interface HistogramBin {
  label: string;
  lower: number;
  upper: number;
  beforeCount: number;
  afterCount: number;
}

interface ImpactAnalysisResult {
  rowCount: number;
  scenarioLabel: string;
  meanMetric: MetricDelta;
  medianMetric: MetricDelta;
  stddevMetric: MetricDelta;
  histogram: HistogramBin[];
  error: string | null;
}

function LoadingState() {
  return (
    <div
      className={`${GLASS_PANEL_CLASS} flex min-h-[28rem] items-center justify-center`}
    >
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Simulating scenario impact…
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Change Impact Analyzer
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {message}
          </p>
        </div>
      </div>
    </section>
  );
}

function formatMetric(value: number) {
  if (!Number.isFinite(value)) return "—";
  return Math.abs(value) >= 1000 || Number.isInteger(value)
    ? formatNumber(value)
    : value.toFixed(3);
}

function formatSignedPercent(value: number) {
  if (!Number.isFinite(value)) return "—";
  const absolute = formatPercent(Math.abs(value), 1);
  return value > 0 ? `+${absolute}` : value < 0 ? `-${absolute}` : absolute;
}

function computeChangePercent(before: number, after: number) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return 0;
  if (before === 0) {
    return after === 0 ? 0 : 100;
  }
  return ((after - before) / Math.abs(before)) * 100;
}

function applyScenario(value: number, mode: ImpactMode, amount: number) {
  return mode === "multiplier" ? value * amount : value + amount;
}

function buildHistogram(
  beforeValues: number[],
  afterValues: number[],
  binCount: number,
) {
  if (beforeValues.length === 0 || afterValues.length === 0) return [];

  const lowerBound = Math.min(...beforeValues, ...afterValues);
  const upperBound = Math.max(...beforeValues, ...afterValues);
  const span = Math.max(upperBound - lowerBound, 1);
  const width = span / binCount;

  const bins = Array.from({ length: binCount }, (_, index) => {
    const lower = lowerBound + index * width;
    const upper = index === binCount - 1 ? upperBound : lower + width;
    return {
      label: `${formatMetric(lower)} to ${formatMetric(upper)}`,
      lower,
      upper,
      beforeCount: 0,
      afterCount: 0,
    } satisfies HistogramBin;
  });

  const placeValue = (
    value: number,
    key: "beforeCount" | "afterCount",
  ) => {
    const rawIndex = Math.floor((value - lowerBound) / width);
    const index = Math.min(binCount - 1, Math.max(0, rawIndex));
    bins[index][key] += 1;
  };

  beforeValues.forEach((value) => placeValue(value, "beforeCount"));
  afterValues.forEach((value) => placeValue(value, "afterCount"));

  return bins;
}

function loadNumericValues(rows: Record<string, unknown>[]) {
  return rows
    .map((row) => toNumber(row.value))
    .filter((value): value is number => value !== null);
}

async function loadImpactAnalysis(
  tableName: string,
  columnName: string,
  mode: ImpactMode,
  amount: number,
  binCount: number,
): Promise<ImpactAnalysisResult> {
  try {
    const rows = await runQuery(`
      SELECT TRY_CAST(${quoteIdentifier(columnName)} AS DOUBLE) AS value
      FROM ${quoteIdentifier(tableName)}
      WHERE ${quoteIdentifier(columnName)} IS NOT NULL
        AND TRY_CAST(${quoteIdentifier(columnName)} AS DOUBLE) IS NOT NULL
      LIMIT 5000
    `);

    const values = loadNumericValues(rows);

    if (values.length === 0) {
      return {
        rowCount: 0,
        scenarioLabel: "",
        meanMetric: { before: 0, after: 0, changePercent: 0 },
        medianMetric: { before: 0, after: 0, changePercent: 0 },
        stddevMetric: { before: 0, after: 0, changePercent: 0 },
        histogram: [],
        error: "No numeric values were available for the selected column.",
      };
    }

    const transformedValues = values.map((value) =>
      applyScenario(value, mode, amount),
    );
    const meanBefore = mean(values);
    const meanAfter = mean(transformedValues);
    const medianBefore = median(values);
    const medianAfter = median(transformedValues);
    const stddevBefore = standardDeviation(values);
    const stddevAfter = standardDeviation(transformedValues);

    return {
      rowCount: values.length,
      scenarioLabel:
        mode === "multiplier"
          ? `Applying a ${amount.toFixed(2)}x multiplier to ${columnName}`
          : `Applying a ${amount.toFixed(2)} offset to ${columnName}`,
      meanMetric: {
        before: meanBefore,
        after: meanAfter,
        changePercent: computeChangePercent(meanBefore, meanAfter),
      },
      medianMetric: {
        before: medianBefore,
        after: medianAfter,
        changePercent: computeChangePercent(medianBefore, medianAfter),
      },
      stddevMetric: {
        before: stddevBefore,
        after: stddevAfter,
        changePercent: computeChangePercent(stddevBefore, stddevAfter),
      },
      histogram: buildHistogram(values, transformedValues, binCount),
      error: null,
    };
  } catch (error) {
    return {
      rowCount: 0,
      scenarioLabel: "",
      meanMetric: { before: 0, after: 0, changePercent: 0 },
      medianMetric: { before: 0, after: 0, changePercent: 0 },
      stddevMetric: { before: 0, after: 0, changePercent: 0 },
      histogram: [],
      error:
        error instanceof Error
          ? error.message
          : "Impact simulation failed.",
    };
  }
}

function buildChartOption(
  histogram: HistogramBin[],
  columnName: string,
): EChartsOption {
  return {
    animationDuration: 450,
    animationEasing: "cubicOut",
    tooltip: { trigger: "axis" },
    legend: {
      data: ["Before", "After"],
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
      name: columnName,
      data: histogram.map((bin) => bin.label),
      axisLabel: {
        interval: 0,
        rotate: 30,
      },
    },
    yAxis: {
      type: "value",
      name: "Rows",
    },
    series: [
      {
        name: "Before",
        type: "bar",
        data: histogram.map((bin) => bin.beforeCount),
        barGap: "-100%",
        itemStyle: {
          color: "rgba(14, 165, 233, 0.45)",
          borderRadius: [12, 12, 0, 0],
        },
      },
      {
        name: "After",
        type: "bar",
        data: histogram.map((bin) => bin.afterCount),
        itemStyle: {
          color: "rgba(249, 115, 22, 0.55)",
          borderRadius: [12, 12, 0, 0],
        },
      },
    ],
  };
}

function buildExportCsv(result: ImpactAnalysisResult) {
  const metricRows = [
    "section,metric,before,after,change_percent",
    `summary,mean,${result.meanMetric.before},${result.meanMetric.after},${result.meanMetric.changePercent}`,
    `summary,median,${result.medianMetric.before},${result.medianMetric.after},${result.medianMetric.changePercent}`,
    `summary,stddev,${result.stddevMetric.before},${result.stddevMetric.after},${result.stddevMetric.changePercent}`,
  ];
  const histogramRows = [
    "distribution,label,lower,upper,before_count,after_count",
    ...result.histogram.map(
      (bin) =>
        `distribution,"${bin.label}",${bin.lower},${bin.upper},${bin.beforeCount},${bin.afterCount}`,
    ),
  ];

  return [...metricRows, "", ...histogramRows].join("\n");
}

function ImpactCard({
  label,
  icon: Icon,
  metric,
}: {
  label: string;
  icon: typeof Sigma;
  metric: MetricDelta;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        {label}
      </div>
      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold text-slate-950 dark:text-white">
            {formatSignedPercent(metric.changePercent)}
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {formatMetric(metric.before)} to {formatMetric(metric.after)}
          </div>
        </div>
      </div>
    </div>
  );
}

function ImpactAnalysisPanel({
  resource,
  tableName,
  columnName,
}: {
  resource: Promise<ImpactAnalysisResult>;
  tableName: string;
  columnName: string;
}) {
  const result = use(resource);

  if (result.error) {
    return (
      <div className={`${GLASS_PANEL_CLASS} p-6`}>
        <p className="text-sm text-rose-600 dark:text-rose-300">{result.error}</p>
      </div>
    );
  }

  const chartOption = buildChartOption(result.histogram, columnName);

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
              Scenario Summary
            </div>
            <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              {result.scenarioLabel}
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Compared across {formatNumber(result.rowCount)} sampled rows with an
              overlaid histogram showing the baseline and adjusted distribution.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              downloadFile(
                buildExportCsv(result),
                `${tableName}-${columnName}-impact-comparison.csv`,
                "text/csv;charset=utf-8;",
              )
            }
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export comparison CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <ImpactCard label="Mean delta" icon={Sigma} metric={result.meanMetric} />
        <ImpactCard
          label="Median delta"
          icon={ArrowRightLeft}
          metric={result.medianMetric}
        />
        <ImpactCard
          label="Std dev delta"
          icon={SlidersHorizontal}
          metric={result.stddevMetric}
        />
      </div>

      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            Before and after distribution
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            The orange bars represent the simulated values after the selected
            adjustment is applied.
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
    </motion.div>
  );
}

export default function ChangeImpactAnalyzer({
  tableName,
  columns,
}: ChangeImpactAnalyzerProps) {
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [selectedColumn, setSelectedColumn] = useState(
    numericColumns[0]?.name ?? "",
  );
  const [impactMode, setImpactMode] = useState<ImpactMode>("multiplier");
  const [amountInput, setAmountInput] = useState("1.10");
  const [binInput, setBinInput] = useState("12");

  const resolvedColumn = useMemo(() => {
    if (numericColumns.some((column) => column.name === selectedColumn)) {
      return selectedColumn;
    }
    return numericColumns[0]?.name ?? "";
  }, [numericColumns, selectedColumn]);

  const parsedAmount = toNumber(amountInput) ?? (impactMode === "multiplier" ? 1 : 0);
  const binCount = Math.min(24, Math.max(6, Math.round(toNumber(binInput) ?? 12)));

  const resource = useMemo(() => {
    if (!resolvedColumn) {
      return Promise.resolve<ImpactAnalysisResult>({
        rowCount: 0,
        scenarioLabel: "",
        meanMetric: { before: 0, after: 0, changePercent: 0 },
        medianMetric: { before: 0, after: 0, changePercent: 0 },
        stddevMetric: { before: 0, after: 0, changePercent: 0 },
        histogram: [],
        error: "Choose a numeric column to simulate.",
      });
    }

    return loadImpactAnalysis(
      tableName,
      resolvedColumn,
      impactMode,
      parsedAmount,
      binCount,
    );
  }, [binCount, impactMode, parsedAmount, resolvedColumn, tableName]);

  if (numericColumns.length === 0) {
    return (
      <EmptyState message="No numeric columns available for what-if impact analysis." />
    );
  }

  return (
    <section className="space-y-5">
      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                  Scenario Simulator
                </p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                  Change Impact Analyzer
                </h2>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Run multiplier or offset scenarios against a numeric column, compare
              the before and after histogram, and quantify how much the center and
              spread of the data move.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Numeric column
              </span>
              <select
                value={resolvedColumn}
                onChange={(event) => setSelectedColumn(event.target.value)}
                className={FIELD_CLASS}
              >
                {numericColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Scenario
              </span>
              <select
                value={impactMode}
                onChange={(event) =>
                  setImpactMode(event.target.value as ImpactMode)
                }
                className={FIELD_CLASS}
              >
                <option value="multiplier">Multiplier</option>
                <option value="offset">Offset</option>
              </select>
            </label>

            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                {impactMode === "multiplier" ? "Factor" : "Offset"}
              </span>
              <input
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                inputMode="decimal"
                className={FIELD_CLASS}
              />
            </label>

            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Histogram bins
              </span>
              <input
                value={binInput}
                onChange={(event) => setBinInput(event.target.value)}
                inputMode="numeric"
                className={FIELD_CLASS}
              />
            </label>
          </div>
        </div>
      </div>

      <Suspense fallback={<LoadingState />}>
        <ImpactAnalysisPanel
          resource={resource}
          tableName={tableName}
          columnName={resolvedColumn}
        />
      </Suspense>
    </section>
  );
}
