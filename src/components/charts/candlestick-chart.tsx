"use client";

import {
  Suspense,
  startTransition,
  use,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import {
  BarChart as EChartsBarChart,
  CandlestickChart as EChartsCandlestickChart,
  LineChart as EChartsLineChart,
} from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { CandlestickChart as CandlestickIcon, Download } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  dataUrlToBytes,
  isRecord,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  EChartsCandlestickChart,
  EChartsLineChart,
  EChartsBarChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

interface CandlestickChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface OhlcRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

interface CandlestickResult {
  rows: OhlcRow[];
  movingAverage: Array<number | "-">;
  error: string | null;
}

interface CandlestickReadyProps extends CandlestickChartProps {
  showVolume: boolean;
  maPeriod: number;
  promise: Promise<CandlestickResult>;
}

function computeMovingAverage(rows: OhlcRow[], period: number) {
  return rows.map<number | "-">((_row, index) => {
    if (index + 1 < period) {
      return "-";
    }

    const slice = rows.slice(index + 1 - period, index + 1);
    const average = slice.reduce((sum, item) => sum + item.close, 0) / slice.length;
    return Number(average.toFixed(2));
  });
}

async function loadCandlestickData(
  tableName: string,
  dateColumn: string,
  openColumn: string,
  highColumn: string,
  lowColumn: string,
  closeColumn: string,
  volumeColumn: string,
  maPeriod: number,
): Promise<CandlestickResult> {
  if (!dateColumn || !openColumn || !highColumn || !lowColumn || !closeColumn) {
    return {
      rows: [],
      movingAverage: [],
      error: "Choose date, open, high, low, and close columns.",
    };
  }

  try {
    const rows = await runQuery(`
      SELECT
        CAST(${quoteIdentifier(dateColumn)} AS VARCHAR) AS date_value,
        TRY_CAST(${quoteIdentifier(openColumn)} AS DOUBLE) AS open_value,
        TRY_CAST(${quoteIdentifier(highColumn)} AS DOUBLE) AS high_value,
        TRY_CAST(${quoteIdentifier(lowColumn)} AS DOUBLE) AS low_value,
        TRY_CAST(${quoteIdentifier(closeColumn)} AS DOUBLE) AS close_value,
        ${
          volumeColumn
            ? `TRY_CAST(${quoteIdentifier(volumeColumn)} AS DOUBLE) AS volume_value`
            : "NULL AS volume_value"
        }
      FROM ${quoteIdentifier(tableName)}
      WHERE ${quoteIdentifier(dateColumn)} IS NOT NULL
        AND TRY_CAST(${quoteIdentifier(openColumn)} AS DOUBLE) IS NOT NULL
        AND TRY_CAST(${quoteIdentifier(highColumn)} AS DOUBLE) IS NOT NULL
        AND TRY_CAST(${quoteIdentifier(lowColumn)} AS DOUBLE) IS NOT NULL
        AND TRY_CAST(${quoteIdentifier(closeColumn)} AS DOUBLE) IS NOT NULL
      ORDER BY ${quoteIdentifier(dateColumn)}
      LIMIT 240
    `);

    const normalizedRows = rows.flatMap<OhlcRow>((row) => {
      const open = toNumber(row.open_value);
      const high = toNumber(row.high_value);
      const low = toNumber(row.low_value);
      const close = toNumber(row.close_value);
      if (open === null || high === null || low === null || close === null) {
        return [];
      }

      return [
        {
          date: String(row.date_value ?? ""),
          open,
          high,
          low,
          close,
          volume: toNumber(row.volume_value),
        },
      ];
    });

    return {
      rows: normalizedRows,
      movingAverage: computeMovingAverage(normalizedRows, maPeriod),
      error:
        normalizedRows.length === 0
          ? "No OHLC rows were available for the selected fields."
          : null,
    };
  } catch (error) {
    return {
      rows: [],
      movingAverage: [],
      error: error instanceof Error ? error.message : "Candlestick query failed.",
    };
  }
}

function buildCandlestickOption(
  result: CandlestickResult,
  dark: boolean,
  showVolume: boolean,
): EChartsOption {
  const categories = result.rows.map((row) => row.date);
  const candlestickData = result.rows.map((row) => [row.open, row.close, row.low, row.high]);
  const volumeData = result.rows.map((row) => row.volume ?? 0);
  const series = [
    {
      name: "OHLC",
      type: "candlestick" as const,
      data: candlestickData,
      itemStyle: {
        color: "#10b981",
        color0: "#ef4444",
        borderColor: "#10b981",
        borderColor0: "#ef4444",
      },
    },
    {
      name: "MA",
      type: "line" as const,
      data: result.movingAverage,
      smooth: true,
      symbol: "none",
      lineStyle: {
        width: 2,
        color: "#38bdf8",
      },
    },
    ...(showVolume
      ? [
          {
            name: "Volume",
            type: "bar" as const,
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: volumeData,
            itemStyle: {
              color: "#94a3b8",
            },
          },
        ]
      : []),
  ] as NonNullable<EChartsOption["series"]>;

  return {
    animationDuration: 520,
    legend: {
      data: showVolume ? ["OHLC", "MA", "Volume"] : ["OHLC", "MA"],
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      formatter: (params: unknown) => {
        if (!Array.isArray(params)) return "OHLC";
        const first = params.find((item) => isRecord(item) && item.seriesType === "candlestick");
        if (!isRecord(first) || !Array.isArray(first.data)) {
          return "OHLC";
        }
        return [
          `<strong>${String(first.axisValueLabel ?? "")}</strong>`,
          `Open: ${formatNumber(toNumber(first.data[0]) ?? 0)}`,
          `Close: ${formatNumber(toNumber(first.data[1]) ?? 0)}`,
          `Low: ${formatNumber(toNumber(first.data[2]) ?? 0)}`,
          `High: ${formatNumber(toNumber(first.data[3]) ?? 0)}`,
        ].join("<br/>");
      },
    },
    grid: showVolume
      ? [
          { left: 56, right: 24, top: 52, height: "56%" },
          { left: 56, right: 24, top: "74%", height: "14%" },
        ]
      : [{ left: 56, right: 24, top: 52, bottom: 60 }],
    dataZoom: [{ type: "inside", xAxisIndex: showVolume ? [0, 1] : [0] }],
    xAxis: showVolume
      ? [
          { type: "category", data: categories, boundaryGap: true, axisLabel: { color: dark ? "#cbd5e1" : "#475569" } },
          { type: "category", data: categories, boundaryGap: true, axisLabel: { show: false }, gridIndex: 1 },
        ]
      : [{ type: "category", data: categories, boundaryGap: true, axisLabel: { color: dark ? "#cbd5e1" : "#475569" } }],
    yAxis: showVolume
      ? [
          { scale: true, axisLabel: { color: dark ? "#cbd5e1" : "#475569" } },
          { scale: true, gridIndex: 1, axisLabel: { color: dark ? "#cbd5e1" : "#475569" } },
        ]
      : [{ scale: true, axisLabel: { color: dark ? "#cbd5e1" : "#475569" } }],
    series,
  };
}

function buildCsv(rows: OhlcRow[]) {
  return [
    "date,open,high,low,close,volume",
    ...rows.map((row) => `${row.date},${row.open},${row.high},${row.low},${row.close},${row.volume ?? ""}`),
  ].join("\n");
}

function exportChartPng(chartRef: ReactEChartsCore | null, fileName: string, dark: boolean) {
  const instance = chartRef?.getEchartsInstance();
  if (!instance) return;
  const dataUrl = instance.getDataURL({
    type: "png",
    pixelRatio: 2,
    backgroundColor: dark ? "#020617" : "#f8fafc",
  });
  const output = dataUrlToBytes(dataUrl);
  downloadFile([output.bytes], fileName, output.mimeType);
}

function CandlestickLoadingState() {
  return (
    <div className={`${GLASS_CARD_CLASS} flex min-h-[24rem] items-center justify-center p-6 text-sm text-slate-600 dark:text-slate-300`}>
      Loading candlestick chart…
    </div>
  );
}

function CandlestickReady({
  tableName,
  showVolume,
  maPeriod,
  promise,
}: CandlestickReadyProps) {
  const dark = useDarkMode();
  const result = use(promise);
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const option = useMemo(
    () => buildCandlestickOption(result, dark, showVolume),
    [dark, result, showVolume],
  );

  if (result.error) {
    return (
      <div className={`${GLASS_CARD_CLASS} p-6 text-sm text-slate-600 dark:text-slate-300`}>
        {result.error}
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="space-y-4">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Trend summary
          </div>
          <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
            {formatNumber(result.rows.length)}
          </div>
          <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            candles loaded with MA({maPeriod}) overlay
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className={BUTTON_CLASS}
              onClick={() =>
                downloadFile(
                  buildCsv(result.rows),
                  `${tableName}-candlestick.csv`,
                  "text/csv;charset=utf-8;",
                )
              }
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
            <button
              type="button"
              className={BUTTON_CLASS}
              onClick={() => exportChartPng(chartRef.current, `${tableName}-candlestick.png`, dark)}
            >
              <Download className="h-4 w-4" />
              Export PNG
            </button>
          </div>
        </div>
      </div>

      <div className={`${GLASS_CARD_CLASS} p-4`}>
        <ReactEChartsCore ref={chartRef} option={option} style={{ height: 440 }} />
      </div>
    </div>
  );
}

export default function CandlestickChart({
  tableName,
  columns,
}: CandlestickChartProps) {
  const dateColumns = useMemo(
    () => columns.filter((column) => column.type === "date" || column.type === "string"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [dateColumn, setDateColumn] = useState(dateColumns[0]?.name ?? "");
  const [openColumn, setOpenColumn] = useState(numericColumns[0]?.name ?? "");
  const [highColumn, setHighColumn] = useState(numericColumns[1]?.name ?? "");
  const [lowColumn, setLowColumn] = useState(numericColumns[2]?.name ?? "");
  const [closeColumn, setCloseColumn] = useState(numericColumns[3]?.name ?? "");
  const [volumeColumn, setVolumeColumn] = useState(numericColumns[4]?.name ?? "");
  const [showVolume, setShowVolume] = useState(Boolean(numericColumns[4]));
  const [maPeriod, setMaPeriod] = useState(5);

  const promise = useMemo(
    () =>
      loadCandlestickData(
        tableName,
        dateColumn,
        openColumn,
        highColumn,
        lowColumn,
        closeColumn,
        volumeColumn,
        maPeriod,
      ),
    [
      closeColumn,
      dateColumn,
      highColumn,
      lowColumn,
      maPeriod,
      openColumn,
      tableName,
      volumeColumn,
    ],
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} p-6`}
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
            <CandlestickIcon className="h-4 w-4" />
            Candlestick Chart
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            Track OHLC movement with optional volume bars
          </h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <select className={FIELD_CLASS} value={dateColumn} onChange={(event) => startTransition(() => setDateColumn(event.target.value))}>
            {dateColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <select className={FIELD_CLASS} value={openColumn} onChange={(event) => startTransition(() => setOpenColumn(event.target.value))}>
            {numericColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <select className={FIELD_CLASS} value={closeColumn} onChange={(event) => startTransition(() => setCloseColumn(event.target.value))}>
            {numericColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-6 grid gap-2 sm:grid-cols-4">
        <select className={FIELD_CLASS} value={highColumn} onChange={(event) => startTransition(() => setHighColumn(event.target.value))}>
          {numericColumns.map((column) => (
            <option key={column.name} value={column.name}>
              {column.name}
            </option>
          ))}
        </select>
        <select className={FIELD_CLASS} value={lowColumn} onChange={(event) => startTransition(() => setLowColumn(event.target.value))}>
          {numericColumns.map((column) => (
            <option key={column.name} value={column.name}>
              {column.name}
            </option>
          ))}
        </select>
        <select className={FIELD_CLASS} value={volumeColumn} onChange={(event) => startTransition(() => setVolumeColumn(event.target.value))}>
          <option value="">no volume</option>
          {numericColumns.map((column) => (
            <option key={column.name} value={column.name}>
              {column.name}
            </option>
          ))}
        </select>
        <input
          className={FIELD_CLASS}
          type="number"
          min={2}
          max={30}
          value={maPeriod}
          onChange={(event) => setMaPeriod(Math.max(2, Number(event.target.value) || 5))}
        />
      </div>

      <label className="mb-6 flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          checked={showVolume}
          onChange={(event) => setShowVolume(event.target.checked)}
        />
        Show volume bars
      </label>

      <Suspense fallback={<CandlestickLoadingState />}>
        <CandlestickReady
          tableName={tableName}
          columns={columns}
          showVolume={showVolume && volumeColumn !== ""}
          maPeriod={maPeriod}
          promise={promise}
        />
      </Suspense>
    </motion.section>
  );
}
