"use client";

import { startTransition, useMemo, useState } from "react";
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
import { Download, Gauge, Loader2, ScrollText, Trophy } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface ModelTrainingLogProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface TrainingPoint {
  runName: string;
  epoch: number;
  loss: number;
  accuracy: number;
  f1: number;
}

interface TrainingRunSummary {
  runName: string;
  epochs: number;
  finalLoss: number;
  finalAccuracy: number;
  finalF1: number;
}

interface TrainingLogSnapshot {
  rows: TrainingPoint[];
  summaries: TrainingRunSummary[];
  maxEpoch: number;
  bestRun: string | null;
}

interface SummaryCardProps {
  icon: typeof Gauge;
  label: string;
  value: string;
}

const SAMPLE_LIMIT = 3_000;
const RUN_COLORS = ["#06b6d4", "#22c55e", "#f97316", "#8b5cf6"] as const;

function formatRate(value: number) {
  return formatPercent(value * 100);
}

function SummaryCard({ icon: Icon, label, value }: SummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-cyan-500/10 p-3 text-cyan-700 dark:text-cyan-300">
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

function getColumnByType(columns: ColumnProfile[], type: ColumnProfile["type"]) {
  return columns.find((column) => column.type === type)?.name ?? "";
}

function getNumericColumns(columns: ColumnProfile[]) {
  return columns.filter((column) => column.type === "number");
}

function buildTrainingQuery(
  tableName: string,
  runColumn: string,
  epochColumn: string,
  lossColumn: string,
  accuracyColumn: string,
  f1Column: string,
) {
  return `
    SELECT
      CAST(${quoteIdentifier(runColumn)} AS VARCHAR) AS run_name,
      TRY_CAST(${quoteIdentifier(epochColumn)} AS DOUBLE) AS epoch_value,
      TRY_CAST(${quoteIdentifier(lossColumn)} AS DOUBLE) AS loss_value,
      TRY_CAST(${quoteIdentifier(accuracyColumn)} AS DOUBLE) AS accuracy_value,
      TRY_CAST(${quoteIdentifier(f1Column)} AS DOUBLE) AS f1_value
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(runColumn)} IS NOT NULL
      AND TRY_CAST(${quoteIdentifier(epochColumn)} AS DOUBLE) IS NOT NULL
      AND TRY_CAST(${quoteIdentifier(lossColumn)} AS DOUBLE) IS NOT NULL
      AND TRY_CAST(${quoteIdentifier(accuracyColumn)} AS DOUBLE) IS NOT NULL
      AND TRY_CAST(${quoteIdentifier(f1Column)} AS DOUBLE) IS NOT NULL
    ORDER BY 1, 2
    LIMIT ${SAMPLE_LIMIT}
  `;
}

function buildTrainingSnapshot(rows: Record<string, unknown>[]): TrainingLogSnapshot {
  const points = rows.flatMap<TrainingPoint>((row) => {
    const runName = typeof row.run_name === "string" ? row.run_name : "";
    const epoch = toNumber(row.epoch_value);
    const loss = toNumber(row.loss_value);
    const accuracy = toNumber(row.accuracy_value);
    const f1 = toNumber(row.f1_value);

    if (!runName || epoch === null || loss === null || accuracy === null || f1 === null) {
      return [];
    }

    return [
      {
        runName,
        epoch,
        loss,
        accuracy,
        f1,
      },
    ];
  });

  const grouped = new Map<string, TrainingPoint[]>();

  for (const point of points) {
    const current = grouped.get(point.runName) ?? [];
    current.push(point);
    grouped.set(point.runName, current);
  }

  const summaries = Array.from(grouped.entries())
    .map<TrainingRunSummary>(([runName, entries]) => {
      const ordered = [...entries].sort((left, right) => left.epoch - right.epoch);
      const finalEntry = ordered[ordered.length - 1];

      return {
        runName,
        epochs: ordered.length,
        finalLoss: finalEntry?.loss ?? Number.NaN,
        finalAccuracy: finalEntry?.accuracy ?? Number.NaN,
        finalF1: finalEntry?.f1 ?? Number.NaN,
      };
    })
    .sort((left, right) => {
      if (left.finalLoss !== right.finalLoss) {
        return left.finalLoss - right.finalLoss;
      }
      if (left.finalAccuracy !== right.finalAccuracy) {
        return right.finalAccuracy - left.finalAccuracy;
      }
      return right.finalF1 - left.finalF1;
    });

  return {
    rows: points.sort((left, right) => {
      if (left.runName !== right.runName) {
        return left.runName.localeCompare(right.runName);
      }
      return left.epoch - right.epoch;
    }),
    summaries,
    maxEpoch: Math.max(...points.map((point) => point.epoch), 0),
    bestRun: summaries[0]?.runName ?? null,
  };
}

function buildLossOption(snapshot: TrainingLogSnapshot | null, dark: boolean): EChartsOption {
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";
  const grouped = new Map<string, TrainingPoint[]>();

  for (const row of snapshot?.rows ?? []) {
    const current = grouped.get(row.runName) ?? [];
    current.push(row);
    grouped.set(row.runName, current);
  }

  return {
    animationDuration: 420,
    legend: {
      bottom: 0,
      textStyle: { color: textColor },
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const items = Array.isArray(params)
          ? (params as Array<{ axisValue?: number | string; seriesName?: string; value?: number }>)
          : [params as { axisValue?: number | string; seriesName?: string; value?: number }];

        const lines = [`<strong>Epoch ${items[0]?.axisValue ?? ""}</strong>`];
        for (const item of items) {
          lines.push(`${item.seriesName ?? "Run"}: ${formatNumber(Number(item.value ?? 0))}`);
        }

        return lines.join("<br/>");
      },
    },
    grid: {
      left: 42,
      right: 24,
      top: 24,
      bottom: 56,
      containLabel: true,
    },
    xAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
      name: "Epoch",
      nameTextStyle: { color: textColor },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
      name: "Loss",
      nameTextStyle: { color: textColor },
    },
    series: Array.from(grouped.entries()).map(([runName, entries], index) => ({
      name: runName,
      type: "line" as const,
      showSymbol: entries.length < 20,
      smooth: true,
      lineStyle: {
        width: 3,
        color: RUN_COLORS[index % RUN_COLORS.length],
      },
      itemStyle: {
        color: RUN_COLORS[index % RUN_COLORS.length],
      },
      data: entries.map((entry) => [entry.epoch, entry.loss]),
    })),
  };
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildTrainingCsv(rows: TrainingPoint[]) {
  const header = ["run_name", "epoch", "loss", "accuracy", "f1"];
  const body = rows.map((row) =>
    [row.runName, row.epoch, row.loss, row.accuracy, row.f1].map(csvEscape).join(","),
  );
  return [header.join(","), ...body].join("\n");
}

export default function ModelTrainingLog({
  tableName,
  columns,
}: ModelTrainingLogProps) {
  const stringColumns = useMemo(
    () => columns.filter((column) => column.type === "string"),
    [columns],
  );
  const numericColumns = useMemo(() => getNumericColumns(columns), [columns]);
  const dark = useDarkMode();

  const [runColumn, setRunColumn] = useState(getColumnByType(columns, "string"));
  const [epochColumn, setEpochColumn] = useState(numericColumns[0]?.name ?? "");
  const [lossColumn, setLossColumn] = useState(numericColumns[1]?.name ?? numericColumns[0]?.name ?? "");
  const [accuracyColumn, setAccuracyColumn] = useState(
    numericColumns[2]?.name ?? numericColumns[0]?.name ?? "",
  );
  const [f1Column, setF1Column] = useState(numericColumns[3]?.name ?? numericColumns[0]?.name ?? "");
  const [snapshot, setSnapshot] = useState<TrainingLogSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState(
    "Load epoch-by-epoch training metrics to compare experiment runs.",
  );

  const chartOption = useMemo(() => buildLossOption(snapshot, dark), [dark, snapshot]);

  async function handleLoad() {
    if (!runColumn || !epochColumn || !lossColumn || !accuracyColumn || !f1Column) {
      setStatus("Select run, epoch, loss, accuracy, and F1 columns before loading logs.");
      return;
    }

    setIsLoading(true);

    try {
      const rows = await runQuery(
        buildTrainingQuery(
          tableName,
          runColumn,
          epochColumn,
          lossColumn,
          accuracyColumn,
          f1Column,
        ),
      );
      const nextSnapshot = buildTrainingSnapshot(rows);

      if (nextSnapshot.rows.length === 0) {
        setStatus("No training rows matched the selected columns.");
      } else {
        startTransition(() => {
          setSnapshot(nextSnapshot);
          setStatus(
            `Compared ${nextSnapshot.summaries.length} runs across ${nextSnapshot.maxEpoch.toFixed(0)} epochs.`,
          );
        });
      }
    } catch {
      setStatus("Training log loading failed. Verify the selected metric columns.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleExport() {
    if (!snapshot || snapshot.rows.length === 0) return;

    downloadFile(
      buildTrainingCsv(snapshot.rows),
      `${tableName}-training-log.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  const hasRequiredColumns = stringColumns.length > 0 && numericColumns.length >= 4;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <ScrollText className="h-3.5 w-3.5" />
            Training logs
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Inspect training progress across experiment runs
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Compare loss curves, final accuracy, and F1 so you can identify the strongest
            training run before deployment.
          </p>
        </div>

        <div className={`${GLASS_CARD_CLASS} max-w-md p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Training summary
          </p>
          <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
            {snapshot?.bestRun ? `Best run: ${snapshot.bestRun}` : "Awaiting logs"}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{status}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Run column
              </span>
              <select
                value={runColumn}
                onChange={(event) => setRunColumn(event.target.value)}
                className={FIELD_CLASS}
                aria-label="Run column"
              >
                {stringColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Epoch column
              </span>
              <select
                value={epochColumn}
                onChange={(event) => setEpochColumn(event.target.value)}
                className={FIELD_CLASS}
                aria-label="Epoch column"
              >
                {numericColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Loss column
              </span>
              <select
                value={lossColumn}
                onChange={(event) => setLossColumn(event.target.value)}
                className={FIELD_CLASS}
                aria-label="Loss column"
              >
                {numericColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Accuracy column
              </span>
              <select
                value={accuracyColumn}
                onChange={(event) => setAccuracyColumn(event.target.value)}
                className={FIELD_CLASS}
                aria-label="Accuracy column"
              >
                {numericColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block md:col-span-2">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                F1 column
              </span>
              <select
                value={f1Column}
                onChange={(event) => setF1Column(event.target.value)}
                className={FIELD_CLASS}
                aria-label="F1 column"
              >
                {numericColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleLoad()}
              className={BUTTON_CLASS}
              disabled={!hasRequiredColumns || isLoading}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}
              Load training log
            </button>
            <button
              type="button"
              onClick={handleExport}
              className={BUTTON_CLASS}
              disabled={!snapshot || snapshot.rows.length === 0}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>

        <div className="grid gap-4">
          <SummaryCard
            icon={Gauge}
            label="Tracked rows"
            value={snapshot ? snapshot.rows.length.toString() : "0"}
          />
          <SummaryCard
            icon={Trophy}
            label="Best run"
            value={snapshot?.bestRun ?? "Not loaded"}
          />
          <SummaryCard
            icon={ScrollText}
            label="Compared runs"
            value={snapshot ? snapshot.summaries.length.toString() : "0"}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-950 dark:text-white">
              Loss curve
            </h3>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              ECharts
            </p>
          </div>
          <ReactEChartsCore
            echarts={echarts}
            option={chartOption}
            notMerge
            lazyUpdate
            style={{ height: 320 }}
          />
        </div>

        <div className={`${GLASS_CARD_CLASS} overflow-hidden p-5`}>
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">
            Metrics by run
          </h3>

          {!hasRequiredColumns ? (
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
              Add one string run column and at least four numeric metric columns to inspect
              training logs.
            </p>
          ) : !snapshot || snapshot.summaries.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
              Load the training log to compare loss, accuracy, and F1 across runs.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-white/20 text-sm">
                <thead>
                  <tr className="text-left text-slate-500 dark:text-slate-400">
                    <th className="px-3 py-2 font-medium">Run</th>
                    <th className="px-3 py-2 font-medium">Epochs</th>
                    <th className="px-3 py-2 font-medium">Final loss</th>
                    <th className="px-3 py-2 font-medium">Accuracy</th>
                    <th className="px-3 py-2 font-medium">F1</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.summaries.map((summary) => (
                    <tr key={summary.runName} className="border-t border-white/10">
                      <td className="px-3 py-2 font-medium text-slate-950 dark:text-white">
                        {summary.runName}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {summary.epochs}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {formatNumber(summary.finalLoss)}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {formatRate(summary.finalAccuracy)}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {formatRate(summary.finalF1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}
