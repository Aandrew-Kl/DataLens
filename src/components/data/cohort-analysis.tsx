"use client";

import {
  Suspense,
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { HeatmapChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  CalendarClock,
  Download,
  Flame,
  Layers3,
  Sigma,
  Users,
} from "lucide-react";
import { downloadFile } from "@/lib/utils/export";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
  dataUrlToBytes,
  quoteIdentifier,
  toCount,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import { runQuery } from "@/lib/duckdb/client";
import { cohortAnalysis } from "@/lib/api/analytics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

interface CohortAnalysisProps {
  tableName: string;
  columns: ColumnProfile[];
}

type CohortGranularity = "week" | "month";
type CohortAggregation = "count" | "sum" | "average";

interface CohortCell {
  cohortLabel: string;
  cohortBucket: string;
  periodIndex: number;
  periodLabel: string;
  metricValue: number;
  activeEntities: number;
  cohortSize: number;
  retentionRate: number;
}

interface CohortResult {
  entityColumn: string | null;
  cells: CohortCell[];
  periods: string[];
  cohorts: string[];
  matrixMax: number;
  totalEntities: number;
  cohortCount: number;
  modeLabel: string;
  error: string | null;
}

type BackendCohortCell =
  | number
  | string
  | {
      cohort_size?: unknown;
      active_entities?: unknown;
      retention_rate?: unknown;
      metric_value?: unknown;
      metric?: unknown;
      value?: unknown;
    };

interface BackendCohortResponse {
  cohorts: Record<string, Record<string, BackendCohortCell>>;
  periods: string[];
}

function buildCohortModeLabel(aggregation: CohortAggregation) {
  return aggregation === "count"
    ? "Retention"
    : aggregation === "sum"
      ? "Activity sum"
      : "Activity average";
}

function buildBackendError(
  entityColumn: string | null,
  aggregation: CohortAggregation,
  message: string,
): CohortResult {
  return {
    entityColumn,
    cells: [],
    periods: [],
    cohorts: [],
    matrixMax: 0,
    totalEntities: 0,
    cohortCount: 0,
    modeLabel: buildCohortModeLabel(aggregation),
    error: message,
  };
}

function toBackendNumber(value: unknown): number {
  return toNumber(
    isRecord(value)
      ? value.retention_rate ?? value.metric_value ?? value.metric ?? value.value
      : value,
  ) ?? 0;
}

function toBackendActiveCount(value: unknown): number {
  return toCount(
    isRecord(value) ? value.active_entities ?? value.cohort_size : value,
  );
}

function normalizeBackendResult(
  response: BackendCohortResponse,
  aggregation: CohortAggregation,
  entityColumn: string | null,
): CohortResult {
  const periods = response.periods.filter((value) => typeof value === "string");
  const cells = Object.entries(response.cohorts).flatMap((entry) => {
    const [cohortBucket, periodValues] = entry;
    const parsedCohortBucket = String(cohortBucket);

    if (!parsedCohortBucket || !isRecord(periodValues)) {
      return [];
    }

    return Object.entries(periodValues).flatMap(([periodKey, rawValue]) => {
      const parsedPeriod = Number(periodKey);
      const fallbackPeriod = Number(periodKey.replace(/\D+/g, ""));
      const periodIndex = Number.isFinite(parsedPeriod)
        ? parsedPeriod
        : Number.isFinite(fallbackPeriod)
          ? fallbackPeriod
          : periods.indexOf(periodKey);

      if (periodIndex < 0) {
        return [];
      }

      const metricValue = toBackendNumber(rawValue);
      const retentionRate =
        aggregation === "count"
          ? toBackendNumber(
              isRecord(rawValue)
                ? {
                    retention_rate:
                      rawValue.retention_rate ?? rawValue.value ?? rawValue.metric_value,
                    metric_value: rawValue.metric_value,
                    metric: rawValue.metric,
                    value: rawValue.value,
                  }
                : metricValue,
            )
          : 0;
      const active = toBackendActiveCount(rawValue);
      const cohortSize = toBackendActiveCount(rawValue) || toBackendNumber(rawValue);

      return {
        cohortLabel: formatCohortLabel(parsedCohortBucket),
        cohortBucket: parsedCohortBucket,
        periodIndex,
        periodLabel:
          periods[periodIndex] ??
          `${parsedPeriod >= 0 ? "Period" : "Offset"} ${periodIndex}`,
        metricValue,
        activeEntities: active,
        cohortSize: Math.max(1, cohortSize),
        retentionRate: aggregation === "count" ? retentionRate : 0,
      };
    });
  });

  const orderedCohorts = Array.from(new Set(cells.map((cell) => cell.cohortLabel))).sort(
    (left, right) => right.localeCompare(left),
  );
  const orderedPeriods = Array.from(new Set(cells.map((cell) => cell.periodLabel))).sort(
    (left, right) => {
      const leftIndex = periods.indexOf(left);
      const rightIndex = periods.indexOf(right);
      if (leftIndex !== -1 && rightIndex !== -1) {
        return leftIndex - rightIndex;
      }

      const parsePeriod = (value: string): number => {
        const candidate = Number(value.replace(/\D+/g, ""));
        return Number.isFinite(candidate) ? candidate : 0;
      };

      return parsePeriod(left) - parsePeriod(right);
    },
  );

  const matrixMax = Math.max(
    ...cells.map((cell) =>
      aggregation === "count" ? cell.retentionRate : cell.metricValue,
    ),
    1,
  );

  return {
    entityColumn,
    cells,
    periods: orderedPeriods,
    cohorts: orderedCohorts,
    matrixMax,
    totalEntities: Array.from(
      new Map(
        cells
          .filter((cell) => cell.periodIndex === 0)
          .map((cell) => [cell.cohortBucket, cell.cohortSize]),
      ).values(),
    ).reduce((sum, value) => sum + value, 0),
    cohortCount: orderedCohorts.length,
    modeLabel: buildCohortModeLabel(aggregation),
    error: cells.length === 0 ? "No cohort rows were returned from backend." : null,
  };
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
});

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
        {value}
      </div>
    </div>
  );
}

function CohortLoading() {
  return (
    <div
      className={`${GLASS_PANEL_CLASS} flex min-h-[30rem] items-center justify-center`}
    >
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Loading cohort analysis…
      </div>
    </div>
  );
}

function inferEntityColumn(columns: ColumnProfile[]) {
  const candidates = columns.filter(
    (column) => column.type === "string" || column.type === "number",
  );

  const ranked = [...candidates].sort((left, right) => {
    const leftNameScore = /(user|customer|account|member|client|visitor|id)$/i.test(
      left.name,
    )
      ? 3
      : 0;
    const rightNameScore = /(user|customer|account|member|client|visitor|id)$/i.test(
      right.name,
    )
      ? 3
      : 0;
    const leftScore =
      leftNameScore * 10 +
      left.uniqueCount -
      left.nullCount -
      (left.type === "string" ? 0 : 1);
    const rightScore =
      rightNameScore * 10 +
      right.uniqueCount -
      right.nullCount -
      (right.type === "string" ? 0 : 1);
    return rightScore - leftScore || left.name.localeCompare(right.name);
  });

  return ranked[0]?.name ?? null;
}

function periodLabel(granularity: CohortGranularity, index: number) {
  return `${granularity === "week" ? "Week" : "Month"} ${index}`;
}

function formatCohortLabel(bucket: string) {
  const parsed = new Date(bucket);
  if (Number.isNaN(parsed.getTime())) {
    return bucket;
  }
  return DATE_FORMAT.format(parsed);
}

async function loadCohortResult(
  tableName: string,
  columns: ColumnProfile[],
  dateColumn: string,
  metricColumn: string,
  granularity: CohortGranularity,
  aggregation: CohortAggregation,
): Promise<CohortResult> {
  const entityColumn = inferEntityColumn(columns);

  if (!dateColumn) {
    return {
      entityColumn,
      cells: [],
      periods: [],
      cohorts: [],
      matrixMax: 0,
      totalEntities: 0,
      cohortCount: 0,
      modeLabel: "Retention",
      error: "Choose a date column to generate cohorts.",
    };
  }

  if (!entityColumn) {
    return {
      entityColumn,
      cells: [],
      periods: [],
      cohorts: [],
      matrixMax: 0,
      totalEntities: 0,
      cohortCount: 0,
      modeLabel: "Retention",
      error:
        "A stable entity column could not be inferred. Add an ID-like column to run cohort retention.",
    };
  }

  const safeTable = quoteIdentifier(tableName);
  const safeDate = quoteIdentifier(dateColumn);
  const safeEntity = quoteIdentifier(entityColumn);
  const useCountMode = aggregation === "count" || metricColumn === "__active_users__";
  const safeMetric = useCountMode ? null : quoteIdentifier(metricColumn);
  const metricProjection = useCountMode
    ? ""
    : `, TRY_CAST(${safeMetric} AS DOUBLE) AS metric_value`;
  const metricFilter = useCountMode
    ? ""
    : `AND ${safeMetric} IS NOT NULL AND TRY_CAST(${safeMetric} AS DOUBLE) IS NOT NULL`;
  const metricExpression = useCountMode
    ? "COUNT(DISTINCT bucketed.entity_key)"
    : aggregation === "sum"
      ? "SUM(metric_value)"
      : "AVG(metric_value)";

  const rows = await runQuery(`
    WITH base AS (
      SELECT
        CAST(${safeEntity} AS VARCHAR) AS entity_key,
        TRY_CAST(${safeDate} AS TIMESTAMP) AS activity_ts
        ${metricProjection}
      FROM ${safeTable}
      WHERE ${safeEntity} IS NOT NULL
        AND ${safeDate} IS NOT NULL
        AND TRY_CAST(${safeDate} AS TIMESTAMP) IS NOT NULL
        ${metricFilter}
    ),
    bucketed AS (
      SELECT
        entity_key,
        CAST(DATE_TRUNC('${granularity}', activity_ts) AS DATE) AS activity_bucket,
        metric_value
      FROM base
    ),
    cohorts AS (
      SELECT entity_key, MIN(activity_bucket) AS cohort_bucket
      FROM bucketed
      GROUP BY 1
    ),
    scoped AS (
      SELECT
        cohorts.cohort_bucket,
        DATE_DIFF('${granularity}', cohorts.cohort_bucket, bucketed.activity_bucket) AS period_index,
        bucketed.entity_key,
        bucketed.metric_value
      FROM bucketed
      JOIN cohorts
        ON cohorts.entity_key = bucketed.entity_key
      WHERE DATE_DIFF('${granularity}', cohorts.cohort_bucket, bucketed.activity_bucket) BETWEEN 0 AND 15
    ),
    cohort_sizes AS (
      SELECT cohort_bucket, COUNT(*) AS cohort_size
      FROM cohorts
      GROUP BY 1
    )
    SELECT
      scoped.cohort_bucket,
      scoped.period_index,
      ${metricExpression} AS metric_value,
      COUNT(DISTINCT scoped.entity_key) AS active_entities,
      cohort_sizes.cohort_size
    FROM scoped
    JOIN cohort_sizes
      ON cohort_sizes.cohort_bucket = scoped.cohort_bucket
    GROUP BY 1, 2, 5
    HAVING ${metricExpression} IS NOT NULL
    ORDER BY 1, 2
  `);

  const cells = rows.flatMap<CohortCell>((row) => {
    const bucket = String(row.cohort_bucket ?? "");
    const periodIndex = toCount(row.period_index);
    const cohortSize = Math.max(1, toCount(row.cohort_size));
    const activeEntities = toCount(row.active_entities);
    const metricValue = toNumber(row.metric_value) ?? 0;

    if (!bucket) {
      return [];
    }

    return [
      {
        cohortLabel: formatCohortLabel(bucket),
        cohortBucket: bucket,
        periodIndex,
        periodLabel: periodLabel(granularity, periodIndex),
        metricValue,
        activeEntities,
        cohortSize,
        retentionRate: cohortSize === 0 ? 0 : (activeEntities / cohortSize) * 100,
      },
    ];
  });

  if (cells.length === 0) {
    return {
      entityColumn,
      cells: [],
      periods: [],
      cohorts: [],
      matrixMax: 0,
      totalEntities: 0,
      cohortCount: 0,
      modeLabel: useCountMode ? "Retention" : aggregation === "sum" ? "Activity sum" : "Activity average",
      error:
        "No cohort activity was produced for the selected settings. Try a different metric or date field.",
    };
  }

  const periods = Array.from(
    new Set(cells.map((cell) => cell.periodLabel)),
  ).sort(
    (left, right) =>
      Number(left.split(" ").at(-1) ?? "0") -
      Number(right.split(" ").at(-1) ?? "0"),
  );
  const cohorts = Array.from(
    new Set(cells.map((cell) => cell.cohortLabel)),
  ).sort((left, right) => right.localeCompare(left));
  const matrixMax = Math.max(
    ...cells.map((cell) => (useCountMode ? cell.retentionRate : cell.metricValue)),
  );

  return {
    entityColumn,
    cells,
    periods,
    cohorts,
    matrixMax,
    totalEntities: Array.from(
      new Map(
        cells
          .filter((cell) => cell.periodIndex === 0)
          .map((cell) => [cell.cohortBucket, cell.cohortSize]),
      ).values(),
    ).reduce((sum, value) => sum + value, 0),
    cohortCount: cohorts.length,
    modeLabel: useCountMode
      ? "Retention"
      : aggregation === "sum"
        ? "Activity sum"
        : "Activity average",
    error: null,
  };
}

function buildHeatmapOption(
  result: CohortResult,
  dark: boolean,
  aggregation: CohortAggregation,
): EChartsOption {
  const xIndex = new Map(result.periods.map((label, index) => [label, index]));
  const yIndex = new Map(result.cohorts.map((label, index) => [label, index]));
  const useRetentionScale = aggregation === "count";

  return {
    animationDuration: 520,
    grid: {
      left: 124,
      right: 32,
      top: 20,
      bottom: 78,
    },
    tooltip: {
      position: "top",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params;
        const raw = item as {
          data?: {
            name: string;
            value: [number, number, number];
            activity: number;
            cohortSize: number;
            activeEntities: number;
          };
        };
        const payload = raw.data;
        if (!payload) return "";
        return [
          `<strong>${payload.name}</strong>`,
          `${result.modeLabel}: ${
            useRetentionScale
              ? formatPercent(payload.value[2], 1)
              : formatNumber(payload.activity)
          }`,
          `Active entities: ${formatNumber(payload.activeEntities)}`,
          `Cohort size: ${formatNumber(payload.cohortSize)}`,
        ].join("<br/>");
      },
    },
    xAxis: {
      type: "category",
      data: result.periods,
      axisLabel: { color: dark ? "#cbd5e1" : "#475569" },
      axisLine: { lineStyle: { color: dark ? "#334155" : "#cbd5e1" } },
    },
    yAxis: {
      type: "category",
      data: result.cohorts,
      axisLabel: { color: dark ? "#cbd5e1" : "#475569" },
      axisLine: { lineStyle: { color: dark ? "#334155" : "#cbd5e1" } },
    },
    visualMap: {
      min: 0,
      max: useRetentionScale ? 100 : Math.max(result.matrixMax, 1),
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 12,
      textStyle: { color: dark ? "#cbd5e1" : "#475569" },
      inRange: {
        color: ["#dbeafe", "#38bdf8", "#2563eb", "#f97316", "#dc2626"],
      },
    },
    series: [
      {
        type: "heatmap",
        data: result.cells
          .map((cell) => {
            const x = xIndex.get(cell.periodLabel);
            const y = yIndex.get(cell.cohortLabel);
            if (typeof x !== "number" || typeof y !== "number") {
              return null;
            }
            return {
              name: `${cell.cohortLabel} • ${cell.periodLabel}`,
              value: [
                x,
                y,
                aggregation === "count" ? cell.retentionRate : cell.metricValue,
              ] as [number, number, number],
              activity: cell.metricValue,
              activeEntities: cell.activeEntities,
              cohortSize: cell.cohortSize,
            };
          })
          .filter(
            (
              item,
            ): item is {
              name: string;
              value: [number, number, number];
              activity: number;
              activeEntities: number;
              cohortSize: number;
            } => item !== null,
          ),
        label: {
          show: true,
          color: dark ? "#f8fafc" : "#0f172a",
          fontSize: 11,
          formatter: (params) => {
            const raw = params as { data?: { value?: [number, number, number] } };
            return aggregation === "count"
              ? `${Math.round(raw.data?.value?.[2] ?? 0)}%`
              : formatNumber(Number(raw.data?.value?.[2] ?? 0));
          },
        },
        itemStyle: {
          borderColor: dark ? "#0f172a" : "#ffffff",
          borderWidth: 1,
          borderRadius: 8,
        },
      },
    ],
  };
}

function CohortAnalysisReady({ tableName, columns }: CohortAnalysisProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const dateColumns = useMemo(
    () => columns.filter((column) => column.type === "date"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [dateColumn, setDateColumn] = useState(dateColumns[0]?.name ?? "");
  const [metricColumn, setMetricColumn] = useState(
    numericColumns[0]?.name ?? "__active_users__",
  );
  const [granularity, setGranularity] = useState<CohortGranularity>("month");
  const [aggregation, setAggregation] = useState<CohortAggregation>(
    numericColumns[0] ? "sum" : "count",
  );

  const safeDateColumn = dateColumns.some((column) => column.name === dateColumn)
    ? dateColumn
    : dateColumns[0]?.name ?? "";
  const safeMetricColumn =
    metricColumn === "__active_users__" ||
    numericColumns.some((column) => column.name === metricColumn)
      ? metricColumn
      : numericColumns[0]?.name ?? "__active_users__";
  const safeAggregation =
    safeMetricColumn === "__active_users__" ? "count" : aggregation;
  const [useBackend, setUseBackend] = useState(true);
  const [backendFailed, setBackendFailed] = useState(false);
  const [result, setResult] = useState<CohortResult>(() =>
    buildBackendError(
      inferEntityColumn(columns),
      safeAggregation,
      safeDateColumn
        ? "No rows processed yet."
        : "Choose a date column to generate cohorts.",
    ),
  );

  const analyze = useEffectEvent(async () => {
    const userIdColumn = inferEntityColumn(columns);
    const timestampColumn = safeDateColumn;

    if (!timestampColumn) {
      startTransition(() => {
        setResult(
          buildBackendError(
            userIdColumn,
            safeAggregation,
            "Choose a date column to generate cohorts.",
          ),
        );
      });
      return;
    }

    if (!userIdColumn) {
      startTransition(() => {
        setResult(
          buildBackendError(
            null,
            safeAggregation,
            "A stable entity column could not be inferred. Add an ID-like column to run cohort retention.",
          ),
        );
      });
      return;
    }

    try {
      if (useBackend && !backendFailed) {
        try {
          const rows = await runQuery(`
            SELECT
              CAST(${quoteIdentifier(userIdColumn)} AS VARCHAR) AS user_id,
              CAST(${quoteIdentifier(timestampColumn)} AS VARCHAR) AS timestamp
            FROM ${quoteIdentifier(tableName)}
            WHERE ${quoteIdentifier(userIdColumn)} IS NOT NULL AND ${quoteIdentifier(timestampColumn)} IS NOT NULL
          `);
          const data = rows.flatMap<{ userId: string; timestamp: string }>((row) => {
            const userId = String(row.user_id ?? "");
            const timestamp = String(row.timestamp ?? "");

            if (!userId || !timestamp) {
              return [];
            }

            return [{ userId, timestamp }];
          });

          if (data.length === 0) {
            throw new Error("No valid rows were found for backend cohort analysis.");
          }

          const recordData = data.map((d) => ({
            [userIdColumn ?? "user_id"]: d.userId,
            [safeDateColumn]: d.timestamp,
          }));
          const response = await cohortAnalysis(
            recordData,
            safeDateColumn,
            userIdColumn ?? "user_id",
          );
          // Convert API CohortResult to component CohortResult
          const periods = Object.keys(
            Object.values(response.cohorts)[0] ?? {},
          ).sort();
          const adaptedResponse: BackendCohortResponse = {
            cohorts: response.cohorts,
            periods,
          };
          const nextResult = normalizeBackendResult(
            adaptedResponse,
            safeAggregation,
            userIdColumn ?? null,
          );
          startTransition(() => {
            setResult(nextResult);
          });
          return;
        } catch {
          startTransition(() => {
            setBackendFailed(true);
          });
        }
      }

      const nextResult = await loadCohortResult(
        tableName,
        columns,
        safeDateColumn,
        safeMetricColumn,
        granularity,
        safeAggregation,
      ).catch((error) =>
        buildBackendError(
          userIdColumn,
          safeAggregation,
          error instanceof Error
            ? error.message
            : "Failed to load cohort matrix.",
        ),
      );
      startTransition(() => {
        setResult(nextResult);
      });
    } catch (error) {
      startTransition(() => {
        setResult(
          buildBackendError(
            userIdColumn,
            safeAggregation,
            error instanceof Error ? error.message : "Cohort analysis failed.",
          ),
        );
      });
    }
  });

  useEffect(() => {
    void analyze();
  }, [columns, safeAggregation, safeDateColumn, safeMetricColumn, granularity, tableName, useBackend, backendFailed]);

  const option = useMemo(
    () => buildHeatmapOption(result, dark, safeAggregation),
    [dark, result, safeAggregation],
  );

  function exportPng() {
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance || result.cells.length === 0) return;
    const { bytes, mimeType } = dataUrlToBytes(
      instance.getDataURL({
        type: "png",
        pixelRatio: 2,
        backgroundColor: dark ? "#020617" : "#f8fafc",
      }),
    );
    downloadFile(
      bytes,
      `${tableName}-cohort-analysis.png`,
      mimeType,
    );
  }

  function exportCsv() {
    if (result.cells.length === 0) return;
    const lines = [
      "cohort_bucket,cohort_label,period_index,period_label,active_entities,cohort_size,retention_pct,metric_value",
      ...result.cells.map((cell) =>
        [
          cell.cohortBucket,
          `"${cell.cohortLabel}"`,
          cell.periodIndex,
          `"${cell.periodLabel}"`,
          cell.activeEntities,
          cell.cohortSize,
          cell.retentionRate.toFixed(2),
          cell.metricValue.toFixed(4),
        ].join(","),
      ),
    ];
    downloadFile(
      lines.join("\n"),
      `${tableName}-cohort-analysis.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">
              <Layers3 className="h-4 w-4" />
              Cohort Retention Matrix
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Track how cohorts stay active over time
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Cohorts are anchored on each entity&apos;s first observed{" "}
              {granularity} and compared against later periods with a hot-to-cold
              heatmap.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() =>
                setUseBackend((previous) => {
                  if (!previous) {
                    setBackendFailed(false);
                  }
                  return !previous;
                })
              }
              className={`${BUTTON_CLASS} px-3 text-xs ${
                useBackend && !backendFailed
                  ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                  : ""
              }`}
              title="Toggle backend cohort analysis"
            >
              Backend: {useBackend ? "On" : "Off"}
            </button>
            <button
              type="button"
              onClick={exportPng}
              className={BUTTON_CLASS}
            >
              <Download className="h-4 w-4" />
              Export PNG
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className={BUTTON_CLASS}
            >
              <Sigma className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-4">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Cohort date
            </label>
            <select
              aria-label="Cohort date"
              value={safeDateColumn}
              onChange={(event) =>
                startTransition(() => setDateColumn(event.target.value))
              }
              className={FIELD_CLASS}
            >
              {dateColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Metric
            </label>
            <select
              aria-label="Metric"
              value={safeMetricColumn}
              onChange={(event) =>
                startTransition(() => setMetricColumn(event.target.value))
              }
              className={FIELD_CLASS}
            >
              <option value="__active_users__">Active users</option>
              {numericColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Granularity
            </label>
            <select
              aria-label="Granularity"
              value={granularity}
              onChange={(event) =>
                startTransition(() =>
                  setGranularity(event.target.value as CohortGranularity),
                )
              }
              className={FIELD_CLASS}
            >
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Aggregation
            </label>
            <select
              aria-label="Aggregation"
              value={safeAggregation}
              onChange={(event) =>
                startTransition(() =>
                  setAggregation(event.target.value as CohortAggregation),
                )
              }
              className={FIELD_CLASS}
              disabled={safeMetricColumn === "__active_users__"}
            >
              <option value="count">Count</option>
              <option value="sum">Sum</option>
              <option value="average">Average</option>
            </select>
          </div>
        </div>

        {result.entityColumn ? (
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-900 dark:text-cyan-100">
            Inferred cohort entity: <strong>{result.entityColumn}</strong>
          </div>
        ) : null}

        {result.error ? (
          <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-5 text-sm text-rose-700 dark:text-rose-300">
            {result.error}
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[0.95fr_2.05fr]">
            <div className="grid gap-4">
              <SummaryCard
                icon={Users}
                label="Entities"
                value={formatNumber(result.totalEntities)}
              />
              <SummaryCard
                icon={CalendarClock}
                label="Cohorts"
                value={formatNumber(result.cohortCount)}
              />
              <SummaryCard
                icon={Flame}
                label="Metric mode"
                value={result.modeLabel}
              />
            </div>

            <div className={`${GLASS_CARD_CLASS} p-4`}>
              <ReactEChartsCore
                ref={chartRef}
                echarts={echarts}
                option={option}
                notMerge
                lazyUpdate
                style={{ height: 440 }}
              />
            </div>
          </div>
        )}
      </div>
    </motion.section>
  );
}

export default function CohortAnalysis(
  props: CohortAnalysisProps,
): React.ReactNode {
  return (
    <Suspense fallback={<CohortLoading />}>
      <CohortAnalysisReady {...props} />
    </Suspense>
  );
}
