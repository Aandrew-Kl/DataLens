"use client";

import { startTransition, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { FunnelChart } from "echarts/charts";
import { LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { ArrowDown, Download, Filter, TrendingDown, Waypoints } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([FunnelChart, LegendComponent, TooltipComponent, CanvasRenderer]);

interface FunnelAnalysisProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface FunnelStepMetric {
  step: string;
  count: number;
  conversionRate: number;
  dropOffRate: number;
}

interface FunnelResult {
  steps: FunnelStepMetric[];
  rowCount: number;
  overallConversion: number;
  largestDropStep: string | null;
}

interface SummaryCardProps {
  icon: typeof Filter;
  label: string;
  value: string;
}

const MAX_STEPS = 6;
const MAX_SAMPLE_ROWS = 10_000;

function SummaryCard({ icon: Icon, label, value }: SummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-sky-500/10 p-3 text-sky-600 dark:text-sky-300">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv(steps: FunnelStepMetric[]): string {
  const header = ["step", "count", "conversion_rate", "drop_off_rate"];
  const body = steps.map((step) =>
    [step.step, step.count, step.conversionRate.toFixed(2), step.dropOffRate.toFixed(2)]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...body].join("\n");
}

function buildQuery(tableName: string, steps: string[]): string {
  const selected = steps.map((step) => quoteIdentifier(step)).join(", ");
  return `SELECT ${selected} FROM ${quoteIdentifier(tableName)} LIMIT ${MAX_SAMPLE_ROWS}`;
}

function isStepComplete(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 && !["0", "false", "no", "null", "none"].includes(normalized);
  }
  return false;
}

function buildFunnelResult(rows: Record<string, unknown>[], steps: string[]): FunnelResult {
  if (rows.length === 0) {
    throw new Error("DuckDB returned no rows for the selected funnel steps.");
  }

  const stepMetrics: FunnelStepMetric[] = [];

  for (const [index, step] of steps.entries()) {
    const count = rows.filter((row) =>
      steps.slice(0, index + 1).every((name) => isStepComplete(row[name])),
    ).length;

    const previousCount = index === 0 ? count : stepMetrics[index - 1]?.count ?? 0;

    stepMetrics.push({
      step,
      count,
      conversionRate: index === 0 || previousCount === 0 ? 100 : (count / previousCount) * 100,
      dropOffRate: index === 0 || previousCount === 0 ? 0 : 100 - (count / previousCount) * 100,
    });
  }

  if (stepMetrics[0]?.count === 0) {
    throw new Error("The first funnel step has no qualifying rows.");
  }

  const largestDrop = stepMetrics.reduce<FunnelStepMetric | null>((current, step, index) => {
    if (index === 0) {
      return current;
    }
    if (!current || step.dropOffRate > current.dropOffRate) {
      return step;
    }
    return current;
  }, null);

  return {
    steps: stepMetrics,
    rowCount: rows.length,
    overallConversion:
      stepMetrics.length < 2 || stepMetrics[0].count === 0
        ? 0
        : (stepMetrics.at(-1)?.count ?? 0) / stepMetrics[0].count * 100,
    largestDropStep: largestDrop?.step ?? null,
  };
}

function buildChartOption(result: FunnelResult | null, dark: boolean): EChartsOption {
  const steps = result?.steps ?? [];
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";

  return {
    animationDuration: 420,
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const point = params as {
          name?: string;
          value?: number;
          data?: { conversionRate?: number; dropOffRate?: number };
        };
        return [
          point.name ?? "Step",
          `Rows: ${formatNumber(point.value ?? 0)}`,
          `Conversion: ${formatPercent(point.data?.conversionRate ?? 0)}`,
          `Drop-off: ${formatPercent(point.data?.dropOffRate ?? 0)}`,
        ].join("<br/>");
      },
    },
    legend: {
      bottom: 0,
      textStyle: { color: textColor },
    },
    series: [
      {
        name: "Funnel",
        type: "funnel",
        left: "8%",
        width: "84%",
        minSize: "25%",
        maxSize: "100%",
        sort: "descending",
        gap: 6,
        label: {
          color: dark ? "#f8fafc" : "#0f172a",
          formatter: "{b}: {c}",
        },
        itemStyle: {
          borderColor,
          borderWidth: 1,
        },
        data: steps.map((step) => ({
          name: step.step,
          value: step.count,
          conversionRate: Number(step.conversionRate.toFixed(2)),
          dropOffRate: Number(step.dropOffRate.toFixed(2)),
        })),
      },
    ],
  };
}

export default function FunnelAnalysis({ tableName, columns }: FunnelAnalysisProps) {
  const dark = useDarkMode();
  const selectableColumns = useMemo(() => columns.slice(0, 12), [columns]);
  const [selectedSteps, setSelectedSteps] = useState<string[]>(() =>
    selectableColumns.slice(0, 4).map((column) => column.name),
  );
  const [result, setResult] = useState<FunnelResult | null>(null);
  const [status, setStatus] = useState("Choose at least two step columns, then build the funnel.");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const chartOption = useMemo(() => buildChartOption(result, dark), [dark, result]);

  function toggleStep(step: string) {
    setSelectedSteps((current) => {
      if (current.includes(step)) {
        return current.filter((value) => value !== step);
      }
      if (current.length >= MAX_STEPS) {
        return current;
      }
      return [...current, step];
    });
  }

  async function handleBuild() {
    if (selectedSteps.length < 2) {
      setError("Select at least two funnel step columns.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(buildQuery(tableName, selectedSteps));
      const nextResult = buildFunnelResult(rows, selectedSteps);

      startTransition(() => {
        setResult(nextResult);
        setStatus(
          `Overall conversion ${formatPercent(nextResult.overallConversion)} across ${formatNumber(nextResult.rowCount)} rows.`,
        );
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Unable to build the funnel analysis.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExport() {
    if (!result || result.steps.length === 0) {
      return;
    }

    downloadFile(
      buildCsv(result.steps),
      `${tableName}-funnel-analysis.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
            <Waypoints className="h-3.5 w-3.5" />
            Funnel analysis
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Conversion funnel analysis
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Compare sequential funnel completion, quantify drop-offs between stages, and export the
            step-by-step conversion breakdown.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExport}
          disabled={!result || result.steps.length === 0}
          className={BUTTON_CLASS}
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          Selected steps
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          {selectableColumns.map((column) => {
            const active = selectedSteps.includes(column.name);
            return (
              <button
                key={column.name}
                type="button"
                onClick={() => toggleStep(column.name)}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  active
                    ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200"
                    : "border-white/20 bg-white/65 text-slate-700 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-200"
                }`}
              >
                {column.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-600 dark:text-slate-300">{status}</div>
        <button
          type="button"
          onClick={handleBuild}
          disabled={loading}
          className={BUTTON_CLASS}
        >
          <Filter className="h-4 w-4" />
          {loading ? "Building funnel..." : "Build funnel"}
        </button>
      </div>

      {error ? (
        <div className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <SummaryCard
          icon={Waypoints}
          label="Steps selected"
          value={formatNumber(selectedSteps.length)}
        />
        <SummaryCard
          icon={ArrowDown}
          label="Overall conversion"
          value={result ? formatPercent(result.overallConversion) : "0.0%"}
        />
        <SummaryCard
          icon={TrendingDown}
          label="Largest drop"
          value={result?.largestDropStep ?? "Not run"}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
        className={`${GLASS_CARD_CLASS} mt-6 p-4`}
      >
        {result ? (
          <ReactEChartsCore
            echarts={echarts}
            option={chartOption}
            notMerge
            style={{ height: 420 }}
          />
        ) : (
          <div className="flex min-h-[20rem] items-center justify-center rounded-[1.5rem] border border-dashed border-white/20 text-center text-sm text-slate-500 dark:text-slate-400">
            Choose at least two step columns, then build the funnel.
          </div>
        )}
      </motion.div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(result?.steps ?? selectedSteps.map((step) => ({
          step,
          count: 0,
          conversionRate: 0,
          dropOffRate: 0,
        }))).map((step) => (
          <div key={step.step} className={`${GLASS_CARD_CLASS} p-4`}>
            <p className="text-sm font-semibold text-slate-950 dark:text-white">{step.step}</p>
            <div className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <div className="flex items-center justify-between">
                <span>Rows</span>
                <span>{formatNumber(step.count)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Conversion</span>
                <span>{formatPercent(step.conversionRate)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Drop-off</span>
                <span>{formatPercent(step.dropOffRate)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
