"use client";

import { useMemo, useRef, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  ArrowRightLeft,
  Download,
  ImageDown,
  Loader2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
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

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface SlopeChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface SlopeRow {
  category: string;
  periodAValue: number;
  periodBValue: number;
  delta: number;
}

const SLOPE_COLORS = {
  up: "#10b981",
  down: "#f97316",
  flat: "#94a3b8",
} as const;

function buildCsv(rows: SlopeRow[], periodAColumn: string, periodBColumn: string) {
  return [
    `category,${periodAColumn},${periodBColumn},delta`,
    ...rows.map((row) => [row.category, row.periodAValue, row.periodBValue, row.delta].join(",")),
  ].join("\n");
}

function buildSlopeOption(
  rows: SlopeRow[],
  periodAColumn: string,
  periodBColumn: string,
  dark: boolean,
): EChartsOption {
  return {
    animationDuration: 420,
    grid: { left: 64, right: 96, top: 24, bottom: 42, containLabel: true },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
      formatter: (params: unknown) => {
        const record = params as { seriesName?: string; data?: number[] };
        const values = Array.isArray(record.data) ? record.data : [];
        return [
          String(record.seriesName ?? "Series"),
          `${periodAColumn}: ${formatNumber(Number(values[0] ?? 0))}`,
          `${periodBColumn}: ${formatNumber(Number(values[1] ?? 0))}`,
        ].join("<br/>");
      },
    },
    xAxis: {
      type: "category",
      data: [periodAColumn, periodBColumn],
      axisLabel: { color: dark ? "#cbd5e1" : "#475569" },
      axisLine: { lineStyle: { color: dark ? "#334155" : "#cbd5e1" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: dark ? "#cbd5e1" : "#475569" },
      splitLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" } },
    },
    series: rows.map((row) => {
      const color =
        row.delta > 0 ? SLOPE_COLORS.up : row.delta < 0 ? SLOPE_COLORS.down : SLOPE_COLORS.flat;
      return {
        name: row.category,
        type: "line",
        data: [row.periodAValue, row.periodBValue],
        lineStyle: { width: 2.75, color },
        itemStyle: { color },
        symbolSize: 10,
        endLabel: { show: true, formatter: row.category, color },
      };
    }),
  };
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof TrendingUp;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        {label}
      </div>
      <div className="mt-3 text-xl font-semibold text-slate-950 dark:text-white">{value}</div>
    </div>
  );
}

export default function SlopeChart({ tableName, columns }: SlopeChartProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const categoryColumns = useMemo(
    () => columns.filter((column) => column.type !== "number"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [categoryColumn, setCategoryColumn] = useState(categoryColumns[0]?.name ?? "");
  const [periodAColumn, setPeriodAColumn] = useState(numericColumns[0]?.name ?? "");
  const [periodBColumn, setPeriodBColumn] = useState(numericColumns[1]?.name ?? numericColumns[0]?.name ?? "");
  const [rows, setRows] = useState<SlopeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(
    "Pick a category and two measure columns to compare before-versus-after movement.",
  );

  const option = useMemo(
    () => buildSlopeOption(rows, periodAColumn, periodBColumn, dark),
    [dark, periodAColumn, periodBColumn, rows],
  );
  const increasing = rows.filter((row) => row.delta > 0).length;
  const decreasing = rows.filter((row) => row.delta < 0).length;
  const averageShift =
    rows.length > 0
      ? rows.reduce((sum, row) => sum + row.delta, 0) / rows.length
      : 0;

  async function handleBuild() {
    if (!categoryColumn || !periodAColumn || !periodBColumn) {
      setNotice("Choose a category and two numeric period columns.");
      return;
    }

    setLoading(true);
    setNotice("Building slope chart...");

    try {
      const resultRows = await runQuery(`
        SELECT
          CAST(${quoteIdentifier(categoryColumn)} AS VARCHAR) AS category_label,
          AVG(TRY_CAST(${quoteIdentifier(periodAColumn)} AS DOUBLE)) AS period_a_value,
          AVG(TRY_CAST(${quoteIdentifier(periodBColumn)} AS DOUBLE)) AS period_b_value
        FROM ${quoteIdentifier(tableName)}
        WHERE ${quoteIdentifier(categoryColumn)} IS NOT NULL
        GROUP BY 1
        HAVING AVG(TRY_CAST(${quoteIdentifier(periodAColumn)} AS DOUBLE)) IS NOT NULL
          AND AVG(TRY_CAST(${quoteIdentifier(periodBColumn)} AS DOUBLE)) IS NOT NULL
        ORDER BY ABS(AVG(TRY_CAST(${quoteIdentifier(periodBColumn)} AS DOUBLE)) - AVG(TRY_CAST(${quoteIdentifier(periodAColumn)} AS DOUBLE))) DESC
        LIMIT 18
      `);

      const nextRows = resultRows.flatMap<SlopeRow>((row) => {
        const category =
          typeof row.category_label === "string"
            ? row.category_label
            : String(row.category_label ?? "");
        const periodAValue = toNumber(row.period_a_value);
        const periodBValue = toNumber(row.period_b_value);
        if (!category || periodAValue == null || periodBValue == null) return [];
        return [
          {
            category,
            periodAValue,
            periodBValue,
            delta: periodBValue - periodAValue,
          },
        ];
      });

      setRows(nextRows);
      setNotice(`Rendered ${formatNumber(nextRows.length)} slope lines.`);
    } catch (error) {
      setRows([]);
      setNotice(error instanceof Error ? error.message : "Slope chart query failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleExportCsv() {
    downloadFile(
      buildCsv(rows, periodAColumn, periodBColumn),
      `${tableName}-slope-chart.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  function handleExportPng() {
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance) return;
    const output = dataUrlToBytes(
      instance.getDataURL({
        type: "png",
        pixelRatio: 2,
        backgroundColor: dark ? "#020617" : "#ffffff",
      }),
    );
    downloadFile([output.bytes], `${tableName}-slope-chart.png`, output.mimeType);
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} space-y-6 p-6`}
    >
      <div className="flex flex-col gap-4 border-b border-white/20 pb-6 dark:border-white/10 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
            <ArrowRightLeft className="h-3.5 w-3.5" />
            Slope Chart
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
              Compare before-and-after movement between two periods
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Each category becomes a line connecting period A to period B. Growth and decline
              are color-coded so shifts stand out immediately.
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <select aria-label="Slope category column" value={categoryColumn} onChange={(event) => setCategoryColumn(event.currentTarget.value)} className={FIELD_CLASS}>
            {categoryColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <select aria-label="Slope period A column" value={periodAColumn} onChange={(event) => setPeriodAColumn(event.currentTarget.value)} className={FIELD_CLASS}>
            {numericColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <select aria-label="Slope period B column" value={periodBColumn} onChange={(event) => setPeriodBColumn(event.currentTarget.value)} className={FIELD_CLASS}>
            {numericColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={handleBuild} className={BUTTON_CLASS}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
          Build slope chart
        </button>
        <button type="button" onClick={handleExportCsv} disabled={rows.length === 0} className={BUTTON_CLASS}>
          <Download className="h-4 w-4" />
          Export CSV
        </button>
        <button type="button" onClick={handleExportPng} disabled={rows.length === 0} className={BUTTON_CLASS}>
          <ImageDown className="h-4 w-4" />
          Export PNG
        </button>
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-300">{notice}</p>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Increasing" value={formatNumber(increasing)} icon={TrendingUp} />
        <MetricCard label="Decreasing" value={formatNumber(decreasing)} icon={TrendingDown} />
        <MetricCard label="Average Shift" value={formatNumber(averageShift)} icon={ArrowRightLeft} />
      </div>

      <div className={`${GLASS_CARD_CLASS} p-5`}>
        <ReactEChartsCore
          ref={chartRef}
          echarts={echarts}
          option={option}
          notMerge
          lazyUpdate
          style={{ height: 420 }}
        />
      </div>
    </motion.section>
  );
}
