"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { startTransition, useMemo, useRef, useState, useSyncExternalStore } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { FunnelChart as EChartsFunnelChart } from "echarts/charts";
import { LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  ArrowDownWideNarrow,
  Download,
  FlipHorizontal2,
  Loader2,
  Percent,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([EChartsFunnelChart, LegendComponent, TooltipComponent, CanvasRenderer]);

interface FunnelChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface FunnelStage {
  name: string;
  value: number;
  percentOfTop: number;
  conversionFromPrevious: number | null;
  color: string;
}

type FunnelOrientation = "vertical" | "horizontal";

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 dark:bg-slate-950/45 dark:text-slate-100";

function subscribeDarkMode(listener: () => void) {
  if (typeof document === "undefined") return () => undefined;
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getDarkModeSnapshot() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}
function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((part) => `${part}${part}`).join("") : value;
  const intValue = Number.parseInt(normalized, 16);
  return {
    r: (intValue >> 16) & 255,
    g: (intValue >> 8) & 255,
    b: intValue & 255,
  };
}

function mixColors(start: string, end: string, ratio: number) {
  const startRgb = hexToRgb(start);
  const endRgb = hexToRgb(end);
  const blend = (from: number, to: number) => Math.round(from + (to - from) * ratio);
  return `rgb(${blend(startRgb.r, endRgb.r)}, ${blend(startRgb.g, endRgb.g)}, ${blend(startRgb.b, endRgb.b)})`;
}

function buildFunnelQuery(tableName: string, stageColumn: string, valueColumn: string) {
  const safeTable = quoteIdentifier(tableName);
  const safeStage = quoteIdentifier(stageColumn);
  const safeValue = quoteIdentifier(valueColumn);

  return `
    SELECT
      CAST(${safeStage} AS VARCHAR) AS stage_name,
      SUM(TRY_CAST(${safeValue} AS DOUBLE)) AS stage_value
    FROM ${safeTable}
    WHERE ${safeStage} IS NOT NULL
      AND ${safeValue} IS NOT NULL
      AND TRY_CAST(${safeValue} AS DOUBLE) IS NOT NULL
    GROUP BY 1
    HAVING SUM(TRY_CAST(${safeValue} AS DOUBLE)) IS NOT NULL
    ORDER BY stage_value DESC
    LIMIT 14
  `;
}

function buildStages(rows: Record<string, unknown>[]) {
  const values = rows
    .map((row) => ({
      name: String(row.stage_name ?? "Untitled"),
      value: toNumber(row.stage_value),
    }))
    .filter((row) => row.value > 0);

  const topValue = values[0]?.value ?? 0;
  return values.map((entry, index) => ({
    ...entry,
    percentOfTop: topValue === 0 ? 0 : (entry.value / topValue) * 100,
    conversionFromPrevious: index === 0 ? null : values[index - 1] ? (entry.value / values[index - 1].value) * 100 : null,
    color: mixColors("#34d399", "#2563eb", values.length <= 1 ? 0 : index / (values.length - 1)),
  }));
}

function exportChartImage(chartRef: ReactEChartsCore | null, dark: boolean, fileName: string) {
  const instance = chartRef?.getEchartsInstance();
  if (!instance) return;
  const url = instance.getDataURL({
    type: "png",
    pixelRatio: 2,
    backgroundColor: dark ? "#020617" : "#f8fafc",
  });
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
}

function buildOption(
  dark: boolean,
  stages: FunnelStage[],
  orientation: FunnelOrientation,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const total = stages.reduce((sum, stage) => sum + stage.value, 0);

  return {
    animationDuration: 520,
    legend: {
      show: false,
      textStyle: { color: textColor },
    },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params;
        const stageName = "name" in item ? String(item.name ?? "") : "";
        const current = stages.find((stage) => stage.name === stageName);
        if (!current) return "";
        return [
          `<strong>${current.name}</strong>`,
          `Value: ${formatNumber(current.value)}`,
          `Share of funnel: ${total === 0 ? "0.0" : ((current.value / total) * 100).toFixed(1)}%`,
          current.conversionFromPrevious == null
            ? "Conversion from previous: —"
            : `Conversion from previous: ${current.conversionFromPrevious.toFixed(1)}%`,
        ].join("<br/>");
      },
    },
    series: [
      {
        name: "Funnel",
        type: "funnel",
        orient: orientation,
        sort: "descending",
        gap: 8,
        minSize: "20%",
        maxSize: "92%",
        left: orientation === "vertical" ? "10%" : "14%",
        right: "10%",
        top: "6%",
        bottom: "10%",
        label: {
          show: true,
          color: textColor,
          formatter: (params) => {
            const current = stages.find((stage) => stage.name === String(params.name));
            return current ? `${current.name}\n${formatNumber(current.value)}` : String(params.name);
          },
        },
        itemStyle: {
          borderWidth: 1,
          borderColor: dark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.9)",
        },
        data: stages.map((stage) => ({
          name: stage.name,
          value: stage.value,
          itemStyle: { color: stage.color },
        })),
      },
    ],
  };
}

function FunnelMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 dark:bg-slate-950/45">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

export default function FunnelChart({ tableName, columns }: FunnelChartProps) {
  const dark = useSyncExternalStore(subscribeDarkMode, getDarkModeSnapshot, () => false);
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const categoryColumns = useMemo(
    () => columns.filter((column) => column.type !== "unknown"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );

  const [stageColumn, setStageColumn] = useState(categoryColumns[0]?.name ?? "");
  const [valueColumn, setValueColumn] = useState(numericColumns[0]?.name ?? "");
  const [orientation, setOrientation] = useState<FunnelOrientation>("vertical");
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const option = useMemo(
    () => buildOption(dark, stages, orientation),
    [dark, orientation, stages],
  );

  async function loadFunnel() {
    if (!stageColumn || !valueColumn) {
      setError("Select a stage column and a numeric value column.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(buildFunnelQuery(tableName, stageColumn, valueColumn));
      startTransition(() => {
        setStages(buildStages(rows));
      });
    } catch (loadError) {
      setStages([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to build the funnel chart.");
    } finally {
      setLoading(false);
    }
  }

  const topStage = stages[0];
  const finalStage = stages[stages.length - 1];
  const overallConversion =
    topStage && finalStage && topStage.value > 0 ? (finalStage.value / topStage.value) * 100 : 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: EASE }}
      className={`${PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700 dark:text-sky-300">
            <Percent className="h-4 w-4" />
            Funnel Chart
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">Measure stage-by-stage conversion and drop-off</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
            Aggregate a numeric outcome by stage, auto-sort the largest stage first, and inspect conversion rates between steps.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <FunnelMetric label="Stages" value={formatNumber(stages.length)} />
          <FunnelMetric label="Top stage" value={topStage ? formatNumber(topStage.value) : "—"} />
          <FunnelMetric label="Overall conversion" value={`${overallConversion.toFixed(1)}%`} />
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_1fr_0.8fr_auto]">
        <select value={stageColumn} onChange={(event) => setStageColumn(event.target.value)} className={FIELD_CLASS}>
          <option value="">Stage column</option>
          {categoryColumns.map((column) => (
            <option key={column.name} value={column.name}>
              {column.name}
            </option>
          ))}
        </select>
        <select value={valueColumn} onChange={(event) => setValueColumn(event.target.value)} className={FIELD_CLASS}>
          <option value="">Value column</option>
          {numericColumns.map((column) => (
            <option key={column.name} value={column.name}>
              {column.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/45 dark:text-slate-200">
          <FlipHorizontal2 className="h-4 w-4 text-cyan-500" />
          <select value={orientation} onChange={(event) => setOrientation(event.target.value as FunnelOrientation)} className="w-full bg-transparent outline-none">
            <option value="vertical">Vertical</option>
            <option value="horizontal">Horizontal</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void loadFunnel()}
          disabled={loading || !stageColumn || !valueColumn}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownWideNarrow className="h-4 w-4" />}
          Build chart
        </button>
      </div>

      {error ? (
        <div className="mt-5 rounded-2xl border border-rose-300/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.45fr_0.8fr]">
        <div className="rounded-[1.5rem] border border-white/15 bg-white/65 p-4 dark:bg-slate-950/35">
          {stages.length === 0 ? (
            <div className="flex min-h-[380px] items-center justify-center rounded-[1.25rem] border border-dashed border-white/20 text-center text-sm text-slate-500 dark:text-slate-400">
              Build the funnel to compare stage volume and conversion rates.
            </div>
          ) : (
            <ReactEChartsCore
              ref={chartRef}
              echarts={echarts}
              option={option}
              notMerge
              lazyUpdate
              style={{ height: 420 }}
            />
          )}
        </div>

        <div className="space-y-4 rounded-[1.5rem] border border-white/15 bg-white/65 p-4 dark:bg-slate-950/35">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Conversion ladder</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Each stage reports its share of the top step and the conversion from the previous stage.</p>
            </div>
            <button
              type="button"
              onClick={() => exportChartImage(chartRef.current, dark, `${tableName}-funnel.png`)}
              disabled={stages.length === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-950/45 dark:text-slate-200 dark:hover:bg-slate-950/65"
            >
              <Download className="h-4 w-4" />
              Export PNG
            </button>
          </div>

          <div className="max-h-[340px] space-y-3 overflow-y-auto pr-1">
            {stages.map((stage, index) => (
              <div key={stage.name} className="rounded-2xl border border-white/15 bg-white/70 p-4 dark:bg-slate-950/45">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {index + 1}. {stage.name}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {stage.percentOfTop.toFixed(1)}% of the first stage
                    </p>
                  </div>
                  <span className="rounded-full px-3 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200" style={{ backgroundColor: `${stage.color.replace("rgb", "rgba").replace(")", ", 0.16)")}` }}>
                    {formatNumber(stage.value)}
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-800/70">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${stage.percentOfTop}%`,
                      backgroundColor: stage.color,
                    }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {stage.conversionFromPrevious == null
                    ? "Starting stage"
                    : `Conversion from previous: ${stage.conversionFromPrevious.toFixed(1)}%`}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
