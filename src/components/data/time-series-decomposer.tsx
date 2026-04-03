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
  Calendar,
  Download,
  Gauge,
  TrendingUp,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toDate,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import { standardDeviation } from "@/lib/utils/statistics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface TimeSeriesDecomposerProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface TimeSeriesPoint {
  isoDate: string;
  original: number;
  trend: number;
  seasonal: number;
  residual: number;
}

interface StationaritySummary {
  label: "Likely stationary" | "Mixed signal" | "Non-stationary";
  score: number;
}

interface DecompositionResult {
  points: TimeSeriesPoint[];
  detectedPeriod: number;
  stationarity: StationaritySummary;
  seasonalStrength: number;
  error: string | null;
}

interface SummaryCardProps {
  icon: typeof Calendar;
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

function formatDateLabel(isoDate: string) {
  const parsed = new Date(`${isoDate}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function autocorrelation(values: number[], lag: number) {
  if (lag <= 0 || lag >= values.length) {
    return 0;
  }

  const left = values.slice(0, values.length - lag);
  const right = values.slice(lag);
  const meanLeft =
    left.reduce((sum, value) => sum + value, 0) / Math.max(left.length, 1);
  const meanRight =
    right.reduce((sum, value) => sum + value, 0) / Math.max(right.length, 1);
  let numerator = 0;
  let leftDenominator = 0;
  let rightDenominator = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - meanLeft;
    const rightDelta = right[index] - meanRight;
    numerator += leftDelta * rightDelta;
    leftDenominator += leftDelta * leftDelta;
    rightDenominator += rightDelta * rightDelta;
  }

  const denominator = Math.sqrt(leftDenominator * rightDenominator);
  return denominator === 0 ? 0 : numerator / denominator;
}

function detectPeriod(values: number[]) {
  if (values.length < 6) {
    return Math.max(2, Math.floor(values.length / 2));
  }

  const maxLag = Math.min(24, Math.floor(values.length / 2));
  let bestLag = 2;
  let bestScore = -1;

  for (let lag = 2; lag <= maxLag; lag += 1) {
    const score = autocorrelation(values, lag);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  return bestScore >= 0.2 ? bestLag : Math.min(7, maxLag);
}

function movingAverage(values: number[], period: number) {
  const radius = Math.max(1, Math.floor(period / 2));

  return values.map((_, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    const slice = values.slice(start, end + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

function buildSeasonalPattern(
  values: number[],
  trend: number[],
  period: number,
) {
  const buckets = Array.from({ length: period }, () => [] as number[]);

  values.forEach((value, index) => {
    buckets[index % period].push(value - trend[index]);
  });

  return buckets.map((bucket) =>
    bucket.length > 0
      ? bucket.reduce((sum, value) => sum + value, 0) / bucket.length
      : 0,
  );
}

function detectStationarity(values: number[], trend: number[]) {
  if (values.length < 3) {
    return { label: "Mixed signal", score: 50 } satisfies StationaritySummary;
  }

  const diffs = values.slice(1).map((value, index) => value - values[index]);
  const originalStd = Math.max(standardDeviation(values), 1e-6);
  const diffStd = standardDeviation(diffs);
  const slope = Math.abs(trend[trend.length - 1] - trend[0]) / originalStd;
  const lagOne = Math.abs(autocorrelation(values, 1));
  const score = Math.max(
    0,
    Math.min(100, 100 - slope * 30 - lagOne * 40 + (diffStd / originalStd) * 20),
  );

  if (score >= 70) {
    return {
      label: "Likely stationary",
      score,
    } satisfies StationaritySummary;
  }
  if (score >= 45) {
    return {
      label: "Mixed signal",
      score,
    } satisfies StationaritySummary;
  }
  return {
    label: "Non-stationary",
    score,
  } satisfies StationaritySummary;
}

async function loadTimeSeriesDecomposition(
  tableName: string,
  dateColumn: string,
  valueColumn: string,
): Promise<DecompositionResult> {
  if (!dateColumn || !valueColumn) {
    return {
      points: [],
      detectedPeriod: 0,
      stationarity: { label: "Mixed signal", score: 0 },
      seasonalStrength: 0,
      error: "Choose both a date column and a numeric column.",
    };
  }

  try {
    const rows = await runQuery(`
      WITH parsed AS (
        SELECT
          TRY_CAST(${quoteIdentifier(dateColumn)} AS TIMESTAMP) AS series_ts,
          TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE) AS series_value
        FROM ${quoteIdentifier(tableName)}
      )
      SELECT
        CAST(DATE_TRUNC('day', series_ts) AS DATE) AS bucket_date,
        AVG(series_value) AS bucket_value
      FROM parsed
      WHERE series_ts IS NOT NULL
        AND series_value IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `);

    const normalizedRows = rows
      .map((row) => {
        const dateValue = toDate(row.bucket_date);
        const numericValue = toNumber(row.bucket_value);

        if (!dateValue || numericValue === null) {
          return null;
        }

        return {
          isoDate: dateValue.toISOString().slice(0, 10),
          value: numericValue,
        };
      })
      .filter(
        (
          row,
        ): row is {
          isoDate: string;
          value: number;
        } => row !== null,
      );

    if (normalizedRows.length < 3) {
      return {
        points: [],
        detectedPeriod: 0,
        stationarity: { label: "Mixed signal", score: 0 },
        seasonalStrength: 0,
        error: "At least three dated observations are required to decompose a series.",
      };
    }

    const values = normalizedRows.map((row) => row.value);
    const detectedPeriod = detectPeriod(values);
    const trend = movingAverage(values, detectedPeriod);
    const seasonalPattern = buildSeasonalPattern(values, trend, detectedPeriod);
    const seasonal = values.map(
      (_, index) => seasonalPattern[index % detectedPeriod] ?? 0,
    );
    const residual = values.map(
      (value, index) => value - trend[index] - seasonal[index],
    );
    const points = normalizedRows.map((row, index) => ({
      isoDate: row.isoDate,
      original: row.value,
      trend: trend[index],
      seasonal: seasonal[index],
      residual: residual[index],
    }));

    const seasonalStd = standardDeviation(seasonal);
    const originalStd = Math.max(standardDeviation(values), 1e-6);

    return {
      points,
      detectedPeriod,
      stationarity: detectStationarity(values, trend),
      seasonalStrength: seasonalStd / originalStd,
      error: null,
    };
  } catch (error) {
    return {
      points: [],
      detectedPeriod: 0,
      stationarity: { label: "Mixed signal", score: 0 },
      seasonalStrength: 0,
      error:
        error instanceof Error
          ? error.message
          : "Time series decomposition failed.",
    };
  }
}

function buildExportCsv(result: DecompositionResult) {
  const header = ["date", "original", "trend", "seasonal", "residual"];
  const rows = result.points.map((point) => [
    point.isoDate,
    point.original,
    point.trend,
    point.seasonal,
    point.residual,
  ]);

  return [header, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
}

function buildChartOption(result: DecompositionResult): EChartsOption {
  return {
    animationDuration: 420,
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => {
        const points = Array.isArray(params)
          ? (params as Array<{
              axisValue?: string;
              data?: number;
              seriesName?: string;
            }>)
          : [];

        const title = points[0]?.axisValue ?? "";
        const lines = points.map((point) => {
          const value = typeof point.data === "number" ? point.data : 0;
          return `${point.seriesName ?? "Series"}: ${formatMetric(value)}`;
        });

        return [title, ...lines].join("<br/>");
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
      type: "category",
      data: result.points.map((point) => formatDateLabel(point.isoDate)),
    },
    yAxis: {
      type: "value",
      name: "Value",
    },
    series: [
      {
        name: "Original",
        type: "line",
        smooth: true,
        data: result.points.map((point) => point.original),
      },
      {
        name: "Trend",
        type: "line",
        smooth: true,
        data: result.points.map((point) => point.trend),
      },
      {
        name: "Residual",
        type: "line",
        smooth: true,
        data: result.points.map((point) => point.residual),
      },
    ],
  };
}

function TimeSeriesLoadingState() {
  return (
    <div
      className={`${GLASS_PANEL_CLASS} flex min-h-[22rem] items-center justify-center`}
    >
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Decomposing the time series…
      </div>
    </div>
  );
}

function TimeSeriesEmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <TrendingUp className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Time Series Decomposer
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

function TimeSeriesDecomposerPanel({
  resource,
  tableName,
  valueColumn,
}: {
  resource: Promise<DecompositionResult>;
  tableName: string;
  valueColumn: string;
}) {
  const result = use(resource);

  if (result.error) {
    return (
      <div className={`${GLASS_PANEL_CLASS} p-6`}>
        <p className="text-sm text-rose-600 dark:text-rose-300">
          {result.error}
        </p>
      </div>
    );
  }

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
              Decomposition Summary
            </div>
            <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              Auto-detected period: {result.detectedPeriod} observations
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Trend is estimated with a moving average, seasonality is derived
              from the period pattern, and residuals capture the remaining noise.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              downloadFile(
                buildExportCsv(result),
                `${tableName}-${valueColumn}-time-series-decomposition.csv`,
                "text/csv;charset=utf-8;",
              )
            }
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export decomposition CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          icon={Calendar}
          label="Detected period"
          value={`${result.detectedPeriod} obs`}
        />
        <SummaryCard
          icon={Gauge}
          label="Stationarity"
          value={`${result.stationarity.label} (${result.stationarity.score.toFixed(0)})`}
        />
        <SummaryCard
          icon={Activity}
          label="Seasonal strength"
          value={result.seasonalStrength.toFixed(2)}
        />
      </div>

      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            Original, trend, and residual series
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Residuals help isolate what the detected trend and seasonal pattern
            could not explain.
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

export default function TimeSeriesDecomposer({
  tableName,
  columns,
}: TimeSeriesDecomposerProps) {
  const dateColumns = useMemo(
    () => columns.filter((column) => column.type === "date"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );

  const [dateColumn, setDateColumn] = useState(dateColumns[0]?.name ?? "");
  const [valueColumn, setValueColumn] = useState(numericColumns[0]?.name ?? "");

  const resolvedDateColumn = useMemo(() => {
    if (dateColumns.some((column) => column.name === dateColumn)) {
      return dateColumn;
    }
    return dateColumns[0]?.name ?? "";
  }, [dateColumn, dateColumns]);

  const resolvedValueColumn = useMemo(() => {
    if (numericColumns.some((column) => column.name === valueColumn)) {
      return valueColumn;
    }
    return numericColumns[0]?.name ?? "";
  }, [numericColumns, valueColumn]);

  const resource = useMemo(
    () =>
      loadTimeSeriesDecomposition(
        tableName,
        resolvedDateColumn,
        resolvedValueColumn,
      ),
    [resolvedDateColumn, resolvedValueColumn, tableName],
  );

  if (dateColumns.length === 0 || numericColumns.length === 0) {
    return (
      <TimeSeriesEmptyState message="Time series decomposition requires at least one date column and one numeric column." />
    );
  }

  return (
    <section className="space-y-5">
      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
              <TrendingUp className="h-4 w-4" />
              Time Series Decomposer
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Separate trend, seasonality, and residual noise
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Aggregate a dated metric, detect an operating period, and inspect
              whether the remaining residuals look stable.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Date column
              </span>
              <select
                value={resolvedDateColumn}
                onChange={(event) => setDateColumn(event.target.value)}
                className={FIELD_CLASS}
              >
                {dateColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Numeric column
              </span>
              <select
                value={resolvedValueColumn}
                onChange={(event) => setValueColumn(event.target.value)}
                className={FIELD_CLASS}
              >
                {numericColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      <Suspense fallback={<TimeSeriesLoadingState />}>
        <TimeSeriesDecomposerPanel
          resource={resource}
          tableName={tableName}
          valueColumn={resolvedValueColumn}
        />
      </Suspense>
    </section>
  );
}
