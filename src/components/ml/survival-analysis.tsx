"use client";

import { useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Activity, Download, HeartPulse } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface SurvivalAnalysisProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface SurvivalObservation {
  time: number;
  event: 0 | 1;
}

interface SurvivalPoint {
  time: number;
  atRisk: number;
  events: number;
  censored: number;
  survival: number;
  hazard: number;
}

interface SurvivalResult {
  points: SurvivalPoint[];
  medianSurvival: number | null;
  eventCount: number;
  censoredCount: number;
}

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv(points: SurvivalPoint[]): string {
  const header = "time,at_risk,events,censored,survival,hazard";
  const body = points.map((point) =>
    [
      point.time,
      point.atRisk,
      point.events,
      point.censored,
      point.survival.toFixed(6),
      point.hazard.toFixed(6),
    ]
      .map(escapeCsv)
      .join(","),
  );
  return [header, ...body].join("\n");
}

function parseEventValue(value: unknown): 0 | 1 | null {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  const normalized = String(value ?? "").trim().toLowerCase();

  if (["1", "true", "yes", "event", "dead"].includes(normalized)) {
    return 1;
  }

  if (["0", "false", "no", "censored", "alive"].includes(normalized)) {
    return 0;
  }

  return null;
}

function buildKaplanMeier(observations: SurvivalObservation[]): SurvivalResult {
  const ordered = [...observations].sort((left, right) => left.time - right.time);
  const uniqueTimes = Array.from(new Set(ordered.map((row) => row.time))).sort((left, right) => left - right);
  let survival = 1;

  const points = uniqueTimes.map((time) => {
    const atRisk = ordered.filter((row) => row.time >= time).length;
    const events = ordered.filter((row) => row.time === time && row.event === 1).length;
    const censored = ordered.filter((row) => row.time === time && row.event === 0).length;
    const hazard = atRisk === 0 ? 0 : events / atRisk;

    survival *= atRisk === 0 ? 1 : 1 - hazard;

    return {
      time,
      atRisk,
      events,
      censored,
      survival,
      hazard,
    };
  });

  return {
    points,
    medianSurvival: points.find((point) => point.survival <= 0.5)?.time ?? null,
    eventCount: ordered.filter((row) => row.event === 1).length,
    censoredCount: ordered.filter((row) => row.event === 0).length,
  };
}

function buildSurvivalOption(result: SurvivalResult | null, dark: boolean): EChartsOption {
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";

  return {
    animationDuration: 420,
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const points = Array.isArray(params)
          ? params as Array<{ axisValue?: number; data?: number }>
          : [];
        const point = points[0];
        return `Time: ${point?.axisValue ?? 0}<br/>Survival: ${((point?.data ?? 0) * 100).toFixed(1)}%`;
      },
    },
    legend: {
      bottom: 0,
      textStyle: { color: textColor },
    },
    grid: {
      left: 56,
      right: 24,
      top: 24,
      bottom: 56,
    },
    xAxis: {
      type: "value",
      name: "Time",
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 1,
      name: "Survival",
      nameTextStyle: { color: textColor },
      axisLabel: {
        color: textColor,
        formatter: (value: number) => `${Math.round(value * 100)}%`,
      },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        name: "Kaplan-Meier",
        type: "line",
        step: "end",
        showSymbol: false,
        lineStyle: { color: "#06b6d4", width: 3 },
        data: result?.points.map((point) => [point.time, point.survival]) ?? [],
      },
    ],
  };
}

function buildHazardOption(result: SurvivalResult | null, dark: boolean): EChartsOption {
  const borderColor = dark ? "#334155" : "#cbd5e1";
  const textColor = dark ? "#cbd5e1" : "#475569";

  return {
    animationDuration: 420,
    tooltip: {
      trigger: "axis",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
    },
    grid: {
      left: 56,
      right: 24,
      top: 24,
      bottom: 56,
    },
    xAxis: {
      type: "category",
      data: result?.points.map((point) => String(point.time)) ?? [],
      axisLabel: { color: textColor },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: [
      {
        name: "Hazard estimate",
        type: "bar",
        barMaxWidth: 32,
        itemStyle: { color: "#f97316", borderRadius: [12, 12, 0, 0] },
        data: result?.points.map((point) => point.hazard) ?? [],
      },
    ],
  };
}

export default function SurvivalAnalysis({ tableName, columns }: SurvivalAnalysisProps) {
  const dark = useDarkMode();
  const timeCandidates = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const eventCandidates = useMemo(
    () => columns.filter((column) => column.uniqueCount === 2 || column.type === "boolean"),
    [columns],
  );
  const [timeColumn, setTimeColumn] = useState(timeCandidates[0]?.name ?? "");
  const [eventColumn, setEventColumn] = useState(eventCandidates[0]?.name ?? "");
  const [result, setResult] = useState<SurvivalResult | null>(null);
  const [status, setStatus] = useState("Choose a duration and event column to estimate the Kaplan-Meier survival curve.");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (timeCandidates.length === 0 || eventCandidates.length === 0) {
    return (
      <section className={`${GLASS_PANEL_CLASS} p-6`}>
        <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Survival analysis</h2>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          Survival analysis needs one numeric time column and one binary event column.
        </p>
      </section>
    );
  }

  async function handleEstimate(): Promise<void> {
    if (!timeColumn || !eventColumn) {
      setError("Choose both the time and event columns.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await runQuery(`
        SELECT
          TRY_CAST(${quoteIdentifier(timeColumn)} AS DOUBLE) AS observed_time,
          CAST(${quoteIdentifier(eventColumn)} AS VARCHAR) AS observed_event
        FROM ${quoteIdentifier(tableName)}
        WHERE ${quoteIdentifier(timeColumn)} IS NOT NULL
          AND ${quoteIdentifier(eventColumn)} IS NOT NULL
      `);

      const observations = rows.flatMap<SurvivalObservation>((row) => {
        const time = toNumber(row.observed_time);
        const event = parseEventValue(row.observed_event);

        if (time === null || event === null) {
          return [];
        }

        return [{ time, event }];
      });

      if (observations.length < 4) {
        throw new Error("At least 4 complete observations are required to estimate survival.");
      }

      const nextResult = buildKaplanMeier(observations);
      setResult(nextResult);
      setStatus(`Estimated survival from ${formatNumber(observations.length)} observations.`);
    } catch (estimateError) {
      setError(estimateError instanceof Error ? estimateError.message : "Unable to estimate survival.");
    } finally {
      setLoading(false);
    }
  }

  function handleExport(): void {
    if (!result) {
      setError("Estimate survival before exporting.");
      return;
    }

    downloadFile(
      buildCsv(result.points),
      `${tableName}-${timeColumn}-${eventColumn}-survival-analysis.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <motion.section
      className={`${GLASS_PANEL_CLASS} space-y-6 p-6`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: ANALYTICS_EASE }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-rose-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-rose-700 dark:text-rose-300">
            <HeartPulse className="h-3.5 w-3.5" />
            Time-to-event
          </div>
          <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
            Estimate survival probabilities and hazard over time
          </h2>
          <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">{status}</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button className={BUTTON_CLASS} disabled={loading} onClick={() => void handleEstimate()} type="button">
            <Activity className="h-4 w-4" />
            {loading ? "Estimating…" : "Estimate survival"}
          </button>
          <button className={BUTTON_CLASS} disabled={!result} onClick={handleExport} type="button">
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} space-y-4 p-4`}>
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Time column</p>
              <div className="mt-3 space-y-2">
                {timeCandidates.map((column) => (
                  <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200" key={column.name}>
                    <input checked={timeColumn === column.name} name="survival-time-column" onChange={() => setTimeColumn(column.name)} type="radio" />
                    <span>{column.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Event column</p>
              <div className="mt-3 space-y-2">
                {eventCandidates.map((column) => (
                  <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200" key={column.name}>
                    <input checked={eventColumn === column.name} name="survival-event-column" onChange={() => setEventColumn(column.name)} type="radio" />
                    <span>{column.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {result ? (
            <div className={`${GLASS_CARD_CLASS} grid gap-3 p-4`}>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Median survival</p>
                <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                  {result.medianSurvival === null ? "Not reached" : result.medianSurvival.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Events</p>
                <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{formatNumber(result.eventCount)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Censored</p>
                <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{formatNumber(result.censoredCount)}</p>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          ) : null}
        </aside>

        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={`${GLASS_CARD_CLASS} p-4`}>
              <ReactEChartsCore option={buildSurvivalOption(result, dark)} style={{ height: 300 }} />
            </div>
            <div className={`${GLASS_CARD_CLASS} p-4`}>
              <ReactEChartsCore option={buildHazardOption(result, dark)} style={{ height: 300 }} />
            </div>
          </div>

          {result ? (
            <div className={`${GLASS_CARD_CLASS} overflow-hidden`}>
              <div className="border-b border-white/10 px-4 py-3">
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Risk table
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-950/[0.03] dark:bg-white/[0.03]">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Time</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">At risk</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Events</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Censored</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Survival</th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Hazard</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.points.map((point) => (
                      <tr className="border-t border-white/10" key={point.time}>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{point.time.toFixed(2)}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{point.atRisk}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{point.events}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{point.censored}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{point.survival.toFixed(3)}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{point.hazard.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </motion.section>
  );
}
