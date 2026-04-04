"use client";

import { Suspense, use, useMemo, useRef, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { HeatmapChart as EChartsHeatmapChart } from "echarts/charts";
import {
  CalendarComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { CalendarRange, Download } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  dataUrlToBytes,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  EChartsHeatmapChart,
  CalendarComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

interface HeatCalendarProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface HeatCalendarPoint {
  date: string;
  value: number;
}

interface HeatCalendarResult {
  years: number[];
  points: HeatCalendarPoint[];
  total: number;
  activeDays: number;
  maxDate: string | null;
  maxValue: number;
  error: string | null;
}

interface HeatCalendarReadyProps {
  tableName: string;
  year: number;
  promise: Promise<HeatCalendarResult>;
}

async function loadHeatCalendarData(
  tableName: string,
  dateColumn: string,
  valueColumn: string,
  year: number,
): Promise<HeatCalendarResult> {
  if (!dateColumn || !valueColumn) {
    return {
      years: [],
      points: [],
      total: 0,
      activeDays: 0,
      maxDate: null,
      maxValue: 0,
      error: "Choose both a date column and a numeric value column.",
    };
  }

  try {
    const [yearRows, pointRows] = await Promise.all([
      runQuery(`
        SELECT DISTINCT CAST(EXTRACT(YEAR FROM TRY_CAST(${quoteIdentifier(dateColumn)} AS DATE)) AS INTEGER) AS year_value
        FROM ${quoteIdentifier(tableName)}
        WHERE TRY_CAST(${quoteIdentifier(dateColumn)} AS DATE) IS NOT NULL
        ORDER BY year_value DESC
      `),
      runQuery(`
        SELECT
          strftime(TRY_CAST(${quoteIdentifier(dateColumn)} AS DATE), '%Y-%m-%d') AS day_key,
          SUM(TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE)) AS total_value
        FROM ${quoteIdentifier(tableName)}
        WHERE TRY_CAST(${quoteIdentifier(dateColumn)} AS DATE) IS NOT NULL
          AND TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE) IS NOT NULL
          AND EXTRACT(YEAR FROM TRY_CAST(${quoteIdentifier(dateColumn)} AS DATE)) = ${year}
        GROUP BY 1
        ORDER BY 1
      `),
    ]);

    const years = yearRows
      .map((row) => toNumber(row.year_value))
      .filter((value): value is number => value !== null);
    const points = pointRows.flatMap<HeatCalendarPoint>((row) => {
      const date = String(row.day_key ?? "");
      const value = toNumber(row.total_value);
      if (!date || value === null) {
        return [];
      }
      return [{ date, value }];
    });

    const maxPoint = points.reduce<HeatCalendarPoint | null>((current, point) => {
      if (current === null || point.value > current.value) {
        return point;
      }
      return current;
    }, null);

    return {
      years,
      points,
      total: points.reduce((sum, point) => sum + point.value, 0),
      activeDays: points.length,
      maxDate: maxPoint?.date ?? null,
      maxValue: maxPoint?.value ?? 0,
      error: points.length === 0 ? "No daily values were found for the selected year." : null,
    };
  } catch (error) {
    return {
      years: [],
      points: [],
      total: 0,
      activeDays: 0,
      maxDate: null,
      maxValue: 0,
      error: error instanceof Error ? error.message : "Unable to render the heat calendar.",
    };
  }
}

function buildHeatCalendarOption(
  result: HeatCalendarResult,
  dark: boolean,
  year: number,
): EChartsOption {
  return {
    animationDuration: 420,
    tooltip: {
      position: "top",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
      formatter: (params: unknown) => {
        const record = params as unknown as { value?: [string, number] };
        const value = Array.isArray(record.value) ? record.value[1] : 0;
        const date = Array.isArray(record.value) ? record.value[0] : "";
        return `${date}<br/>Value: ${formatNumber(Number(value ?? 0))}`;
      },
    },
    visualMap: {
      min: 0,
      max: Math.max(...result.points.map((point) => point.value), 1),
      orient: "horizontal",
      left: "center",
      bottom: 0,
      textStyle: { color: dark ? "#cbd5e1" : "#334155" },
      inRange: {
        color: dark
          ? ["#0f172a", "#155e75", "#38bdf8"]
          : ["#dbeafe", "#7dd3fc", "#0f766e"],
      },
    },
    calendar: {
      top: 24,
      left: 24,
      right: 24,
      range: `${year}`,
      cellSize: ["auto", 18],
      itemStyle: {
        borderWidth: 2,
        borderColor: dark ? "#0f172a" : "#f8fafc",
      },
      splitLine: {
        show: true,
        lineStyle: { color: dark ? "#1e293b" : "#e2e8f0" },
      },
      dayLabel: { color: dark ? "#cbd5e1" : "#334155" },
      monthLabel: { color: dark ? "#cbd5e1" : "#334155" },
      yearLabel: { color: dark ? "#cbd5e1" : "#334155" },
    },
    series: [
      {
        type: "heatmap",
        coordinateSystem: "calendar",
        data: result.points.map((point) => [point.date, point.value]),
      },
    ],
  };
}

function exportChartPng(chartRef: ReactEChartsCore | null, dark: boolean, fileName: string) {
  const instance = chartRef?.getEchartsInstance();
  if (!instance) {
    return;
  }
  const output = dataUrlToBytes(
    instance.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: dark ? "#020617" : "#f8fafc",
    }),
  );
  downloadFile([output.bytes], fileName, output.mimeType);
}

function HeatCalendarLoading() {
  return (
    <div className={`${GLASS_CARD_CLASS} flex min-h-[24rem] items-center justify-center p-6 text-sm text-slate-600 dark:text-slate-300`}>
      Loading calendar heatmap…
    </div>
  );
}

function HeatCalendarReady({ tableName, year, promise }: HeatCalendarReadyProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const result = use(promise);
  const option = useMemo(() => buildHeatCalendarOption(result, dark, year), [dark, result, year]);

  if (result.error) {
    return (
      <div className={`${GLASS_CARD_CLASS} p-6 text-sm text-slate-600 dark:text-slate-300`}>
        {result.error}
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
      <div className={`${GLASS_CARD_CLASS} p-5`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Show daily values as a calendar intensity grid
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Hover to inspect any day in {year}.
            </p>
          </div>
          <button
            type="button"
            onClick={() => exportChartPng(chartRef.current, dark, `${tableName}-${year}-calendar.png`)}
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export PNG
          </button>
        </div>

        <div className="mt-5 h-[24rem]">
          <ReactEChartsCore
            ref={chartRef}
            echarts={echarts}
            option={option}
            notMerge
            lazyUpdate
            style={{ height: "100%", width: "100%" }}
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Active days
          </div>
          <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
            {formatNumber(result.activeDays)}
          </div>
        </div>
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Total value
          </div>
          <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
            {formatNumber(result.total)}
          </div>
        </div>
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Peak day
          </div>
          <div className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">
            {result.maxDate ?? "—"}
          </div>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {formatNumber(result.maxValue)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HeatCalendar({ tableName, columns }: HeatCalendarProps) {
  const dateColumns = useMemo(
    () => columns.filter((column) => column.type === "date"),
    [columns],
  );
  const valueColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [dateColumn, setDateColumn] = useState("");
  const [valueColumn, setValueColumn] = useState("");
  const [yearInput, setYearInput] = useState(`${new Date().getFullYear()}`);

  const activeDateColumn =
    dateColumns.find((column) => column.name === dateColumn)?.name ??
    dateColumns[0]?.name ??
    "";
  const activeValueColumn =
    valueColumns.find((column) => column.name === valueColumn)?.name ??
    valueColumns[0]?.name ??
    "";
  const selectedYear = Number.parseInt(yearInput, 10);
  const activeYear = Number.isFinite(selectedYear) ? selectedYear : new Date().getFullYear();
  const promise = useMemo(
    () => loadHeatCalendarData(tableName, activeDateColumn, activeValueColumn, activeYear),
    [activeDateColumn, activeValueColumn, activeYear, tableName],
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
              <CalendarRange className="h-4 w-4" />
              Heat Calendar
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Render daily values in a calendar grid
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Select the date and metric columns, choose a year, and inspect how values
              move across the days in that calendar.
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <label>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Date column
            </span>
            <select
              aria-label="Date column"
              value={activeDateColumn}
              onChange={(event) => setDateColumn(event.target.value)}
              className={FIELD_CLASS}
            >
              {dateColumns.length === 0 ? <option value="">No date columns</option> : null}
              {dateColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Value column
            </span>
            <select
              aria-label="Value column"
              value={activeValueColumn}
              onChange={(event) => setValueColumn(event.target.value)}
              className={FIELD_CLASS}
            >
              {valueColumns.length === 0 ? <option value="">No numeric columns</option> : null}
              {valueColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Year
            </span>
            <input
              aria-label="Calendar year"
              value={yearInput}
              onChange={(event) => setYearInput(event.target.value)}
              className={FIELD_CLASS}
              inputMode="numeric"
            />
          </label>
        </div>

        <Suspense fallback={<HeatCalendarLoading />}>
          <HeatCalendarReady tableName={tableName} year={activeYear} promise={promise} />
        </Suspense>
      </div>
    </motion.section>
  );
}
