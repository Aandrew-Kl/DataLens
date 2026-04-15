"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { startTransition, useEffect, useEffectEvent, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Layers3,
  Shield,
  Sigma,
  Sparkles,
  Table2,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { SkeletonCard, SkeletonChart, SkeletonTable } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface DataQualityDashboardProps {
  tableName: string;
  columns: ColumnProfile[];
}

type DimensionKey =
  | "completeness"
  | "uniqueness"
  | "validity"
  | "consistency"
  | "timeliness";

interface ColumnQualityRow {
  name: string;
  type: ColumnProfile["type"];
  nonNullCount: number;
  distinctCount: number;
  invalidCount: number;
  whitespaceCount: number;
  blankLikeCount: number;
  normalizedDistinctCount: number;
  latestTimestamp: string | null;
  earliestTimestamp: string | null;
  completeness: number;
  uniqueness: number;
  validity: number;
  consistency: number;
  timeliness: number | null;
  overall: number;
  flag: string;
}

interface ChartDatum {
  label: string;
  value: number;
}

interface DimensionSummary {
  key: DimensionKey;
  label: string;
  score: number;
  detailLabel: string;
  detailValue: string;
  helper: string;
  details: string[];
  chartData: ChartDatum[];
}

interface DashboardMetrics {
  rowCount: number;
  overallScore: number;
  dimensions: Record<DimensionKey, DimensionSummary>;
  columnRows: ColumnQualityRow[];
  evaluatedAt: number;
}

const HIGH_CARDINALITY_THRESHOLD = 0.8;

const DIMENSION_META: Record<
  DimensionKey,
  {
    icon: LucideIcon;
    tone: string;
    color: string;
    accent: string;
  }
> = {
  completeness: {
    icon: CheckCircle2,
    tone:
      "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    color: "#10b981",
    accent:
      "from-emerald-500/22 via-emerald-400/12 to-transparent dark:from-emerald-500/18 dark:via-emerald-400/8 dark:to-transparent",
  },
  uniqueness: {
    icon: Sigma,
    tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    color: "#06b6d4",
    accent:
      "from-cyan-500/22 via-cyan-400/12 to-transparent dark:from-cyan-500/18 dark:via-cyan-400/8 dark:to-transparent",
  },
  validity: {
    icon: Shield,
    tone:
      "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    color: "#8b5cf6",
    accent:
      "from-violet-500/22 via-violet-400/12 to-transparent dark:from-violet-500/18 dark:via-violet-400/8 dark:to-transparent",
  },
  consistency: {
    icon: Layers3,
    tone:
      "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    color: "#f59e0b",
    accent:
      "from-amber-500/22 via-amber-400/12 to-transparent dark:from-amber-500/18 dark:via-amber-400/8 dark:to-transparent",
  },
  timeliness: {
    icon: Clock3,
    tone: "border-sky-400/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    color: "#0ea5e9",
    accent:
      "from-sky-500/22 via-sky-400/12 to-transparent dark:from-sky-500/18 dark:via-sky-400/8 dark:to-transparent",
  },
};

const TYPE_BADGE: Record<
  ColumnProfile["type"],
  {
    label: string;
    className: string;
  }
> = {
  string: {
    label: "String",
    className: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  },
  number: {
    label: "Number",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  date: {
    label: "Date",
    className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300",
  },
  boolean: {
    label: "Boolean",
    className:
      "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/50 dark:text-fuchsia-300",
  },
  unknown: {
    label: "Unknown",
    className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
};

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.35, ease: "easeOut" as const },
  },
};
function getColumnAlias(index: number, suffix: string) {
  return `c${index}_${suffix}`;
}

function asNumber(value: unknown) {
  const numeric = value == null ? Number.NaN : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function asText(value: unknown) {
  return value == null ? null : String(value);
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function formatPercent(value: number, digits = 1) {
  return `${clampScore(value).toFixed(digits)}%`;
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function getGaugeColor(score: number) {
  if (score >= 90) return "#10b981";
  if (score >= 75) return "#f59e0b";
  return "#f97316";
}

function getScoreTone(score: number) {
  if (score >= 90) {
    return "text-emerald-600 dark:text-emerald-300";
  }
  if (score >= 75) {
    return "text-amber-600 dark:text-amber-300";
  }
  return "text-orange-600 dark:text-orange-300";
}

function getQualityLabel(score: number) {
  if (score >= 94) return "Exceptional";
  if (score >= 86) return "Strong";
  if (score >= 74) return "Watchlist";
  if (score > 0) return "Needs attention";
  return "No data";
}

function buildMetricQuery(tableName: string, columns: ColumnProfile[]) {
  const parts: string[] = ["COUNT(*) AS row_count"];
  const table = quoteIdentifier(tableName);

  columns.forEach((column, index) => {
    const identifier = quoteIdentifier(column.name);
    const invalidAlias = getColumnAlias(index, "invalid");
    const whitespaceAlias = getColumnAlias(index, "whitespace");
    const blankAlias = getColumnAlias(index, "blank");
    const normalizedAlias = getColumnAlias(index, "normalized_distinct");
    const latestAlias = getColumnAlias(index, "latest_ts");
    const earliestAlias = getColumnAlias(index, "earliest_ts");

    parts.push(`COUNT(${identifier}) AS ${getColumnAlias(index, "non_null")}`);
    parts.push(`COUNT(DISTINCT ${identifier}) AS ${getColumnAlias(index, "distinct")}`);

    if (column.type === "number") {
      parts.push(
        `SUM(CASE WHEN ${identifier} IS NOT NULL AND TRY_CAST(${identifier} AS DOUBLE) IS NULL THEN 1 ELSE 0 END) AS ${invalidAlias}`,
      );
    } else if (column.type === "date") {
      parts.push(
        `SUM(CASE WHEN ${identifier} IS NOT NULL AND TRY_CAST(${identifier} AS TIMESTAMP) IS NULL THEN 1 ELSE 0 END) AS ${invalidAlias}`,
      );
      parts.push(
        `CAST(MAX(TRY_CAST(${identifier} AS TIMESTAMP)) AS VARCHAR) AS ${latestAlias}`,
      );
      parts.push(
        `CAST(MIN(TRY_CAST(${identifier} AS TIMESTAMP)) AS VARCHAR) AS ${earliestAlias}`,
      );
    } else if (column.type === "boolean") {
      parts.push(
        `SUM(CASE WHEN ${identifier} IS NOT NULL AND TRY_CAST(CAST(${identifier} AS VARCHAR) AS BOOLEAN) IS NULL THEN 1 ELSE 0 END) AS ${invalidAlias}`,
      );
    } else {
      parts.push(`0 AS ${invalidAlias}`);
    }

    if (column.type === "string" || column.type === "unknown") {
      parts.push(
        `SUM(CASE WHEN ${identifier} IS NOT NULL AND CAST(${identifier} AS VARCHAR) <> TRIM(CAST(${identifier} AS VARCHAR)) THEN 1 ELSE 0 END) AS ${whitespaceAlias}`,
      );
      parts.push(
        `SUM(CASE WHEN ${identifier} IS NOT NULL AND TRIM(CAST(${identifier} AS VARCHAR)) = '' THEN 1 ELSE 0 END) AS ${blankAlias}`,
      );
      parts.push(
        `COUNT(DISTINCT CASE WHEN ${identifier} IS NOT NULL AND TRIM(CAST(${identifier} AS VARCHAR)) <> '' THEN LOWER(TRIM(CAST(${identifier} AS VARCHAR))) END) AS ${normalizedAlias}`,
      );
    } else {
      parts.push(`0 AS ${whitespaceAlias}`);
      parts.push(`0 AS ${blankAlias}`);
      parts.push(`0 AS ${normalizedAlias}`);
    }

    if (column.type !== "date") {
      parts.push(`NULL AS ${latestAlias}`);
      parts.push(`NULL AS ${earliestAlias}`);
    }
  });

  return `SELECT\n  ${parts.join(",\n  ")}\nFROM ${table}`;
}

function getValidityScore(
  type: ColumnProfile["type"],
  nonNullCount: number,
  invalidCount: number,
) {
  if (nonNullCount === 0) return 100;
  if (type === "number" || type === "date" || type === "boolean") {
    return clampScore(((nonNullCount - invalidCount) / nonNullCount) * 100);
  }
  if (type === "unknown") {
    return 72;
  }
  return 100;
}

function getConsistencyScore(
  type: ColumnProfile["type"],
  nonNullCount: number,
  distinctCount: number,
  normalizedDistinctCount: number,
  whitespaceCount: number,
  blankLikeCount: number,
) {
  if (type !== "string" && type !== "unknown") {
    return 100;
  }
  if (nonNullCount === 0) return 100;

  const whitespaceRate = whitespaceCount / nonNullCount;
  const blankRate = blankLikeCount / nonNullCount;
  const normalizationDrift =
    distinctCount > 0
      ? Math.max(distinctCount - normalizedDistinctCount, 0) / distinctCount
      : 0;

  const penalty =
    whitespaceRate * 35 + blankRate * 25 + normalizationDrift * 40;

  return clampScore(100 - penalty * 100 - (type === "unknown" ? 4 : 0));
}

function getTimelinessScore(
  type: ColumnProfile["type"],
  latestTimestamp: string | null,
  nonNullCount: number,
  rowCount: number,
) {
  if (type !== "date") return null;
  if (!latestTimestamp || rowCount === 0) return 0;

  const parsed = new Date(latestTimestamp);
  if (Number.isNaN(parsed.getTime())) return 0;

  const diffMs = Date.now() - parsed.getTime();
  const diffDays = Math.max(0, diffMs / 86_400_000);

  let freshness = 25;
  if (diffDays <= 1) freshness = 100;
  else if (diffDays <= 7) freshness = 96;
  else if (diffDays <= 30) freshness = 88;
  else if (diffDays <= 90) freshness = 75;
  else if (diffDays <= 365) freshness = 58;
  else if (diffDays <= 730) freshness = 42;

  const coverage = clampScore((nonNullCount / Math.max(rowCount, 1)) * 100);
  return clampScore(freshness * 0.75 + coverage * 0.25);
}

function average(values: number[]) {
  if (!values.length) return 100;
  return clampScore(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function buildColumnFlag(row: ColumnQualityRow) {
  if (row.completeness < 80) {
    return `${formatPercent(100 - row.completeness)} missing`;
  }
  if (row.validity < 90 && row.invalidCount > 0) {
    return `${formatNumber(row.invalidCount)} invalid typed values`;
  }
  if (row.consistency < 88 && row.whitespaceCount > 0) {
    return `${formatNumber(row.whitespaceCount)} whitespace anomalies`;
  }
  if (row.timeliness != null && row.timeliness < 70) {
    return `latest value ${formatDateTime(row.latestTimestamp)}`;
  }
  if (row.uniqueness < 50) {
    return "heavy duplication footprint";
  }
  return "healthy";
}

function buildColumnRows(
  row: Record<string, unknown>,
  columns: ColumnProfile[],
): { rowCount: number; columnRows: ColumnQualityRow[] } {
  const rowCount = asNumber(row.row_count);

  const columnRows = columns.map((column, index) => {
    const nonNullCount = asNumber(row[getColumnAlias(index, "non_null")]);
    const distinctCount = asNumber(row[getColumnAlias(index, "distinct")]);
    const invalidCount = asNumber(row[getColumnAlias(index, "invalid")]);
    const whitespaceCount = asNumber(row[getColumnAlias(index, "whitespace")]);
    const blankLikeCount = asNumber(row[getColumnAlias(index, "blank")]);
    const normalizedDistinctCount = asNumber(
      row[getColumnAlias(index, "normalized_distinct")],
    );
    const latestTimestamp = asText(row[getColumnAlias(index, "latest_ts")]);
    const earliestTimestamp = asText(row[getColumnAlias(index, "earliest_ts")]);

    const completeness =
      rowCount > 0 ? clampScore((nonNullCount / rowCount) * 100) : 0;
    const uniqueness =
      nonNullCount > 0
        ? clampScore((Math.min(distinctCount, nonNullCount) / nonNullCount) * 100)
        : 100;
    const validity = getValidityScore(column.type, nonNullCount, invalidCount);
    const consistency = getConsistencyScore(
      column.type,
      nonNullCount,
      distinctCount,
      normalizedDistinctCount,
      whitespaceCount,
      blankLikeCount,
    );
    const timeliness = getTimelinessScore(
      column.type,
      latestTimestamp,
      nonNullCount,
      rowCount,
    );

    const overall = average(
      [
        completeness,
        uniqueness,
        validity,
        consistency,
        timeliness,
      ].filter((value): value is number => value != null),
    );

    return {
      name: column.name,
      type: column.type,
      nonNullCount,
      distinctCount,
      invalidCount,
      whitespaceCount,
      blankLikeCount,
      normalizedDistinctCount,
      latestTimestamp,
      earliestTimestamp,
      completeness,
      uniqueness,
      validity,
      consistency,
      timeliness,
      overall,
      flag: "",
    };
  });

  columnRows.forEach((columnRow) => {
    columnRow.flag = buildColumnFlag(columnRow);
  });

  return { rowCount, columnRows };
}

function takeWeakestRows(
  columnRows: ColumnQualityRow[],
  key: DimensionKey,
): ChartDatum[] {
  const data = columnRows
    .map((row) => ({
      label: row.name,
      value:
        key === "timeliness"
          ? row.timeliness
          : row[key],
    }))
    .filter((item): item is ChartDatum => item.value != null)
    .sort((left, right) => left.value - right.value)
    .slice(0, 6);

  return data;
}

function buildDimensionSummaries(
  rowCount: number,
  columnRows: ColumnQualityRow[],
): Record<DimensionKey, DimensionSummary> {
  const totalCells = rowCount * Math.max(columnRows.length, 1);
  const totalNonNull = columnRows.reduce((sum, column) => sum + column.nonNullCount, 0);
  const completenessScore =
    totalCells > 0 ? clampScore((totalNonNull / totalCells) * 100) : 0;
  const mostMissing =
    [...columnRows].sort((left, right) => left.completeness - right.completeness)[0] ??
    null;
  const completeColumns = columnRows.filter((column) => column.completeness >= 95).length;

  const highCardinalityColumns = columnRows.filter(
    (column) =>
      rowCount > 0 &&
      Math.min(column.distinctCount, rowCount) / rowCount >= HIGH_CARDINALITY_THRESHOLD,
  ).length;
  const duplicateHeavyColumns = columnRows.filter((column) => column.uniqueness < 50).length;
  const leastUnique =
    [...columnRows].sort((left, right) => left.uniqueness - right.uniqueness)[0] ?? null;
  const uniquenessScore =
    columnRows.length > 0
      ? clampScore((highCardinalityColumns / columnRows.length) * 100)
      : 0;

  const validityMeasured = columnRows.filter(
    (column) =>
      column.type === "number" ||
      column.type === "date" ||
      column.type === "boolean" ||
      column.type === "unknown",
  );
  const typedValues = validityMeasured.reduce((sum, column) => sum + column.nonNullCount, 0);
  const invalidValues = validityMeasured.reduce((sum, column) => sum + column.invalidCount, 0);
  const unknownColumns = validityMeasured.filter((column) => column.type === "unknown").length;
  const leastValid =
    [...validityMeasured].sort((left, right) => left.validity - right.validity)[0] ?? null;
  const validityScore = validityMeasured.length
    ? average(validityMeasured.map((column) => column.validity))
    : 100;

  const consistencyMeasured = columnRows.filter(
    (column) => column.type === "string" || column.type === "unknown",
  );
  const whitespaceAnomalies = consistencyMeasured.reduce(
    (sum, column) => sum + column.whitespaceCount,
    0,
  );
  const normalizationDriftColumns = consistencyMeasured.filter(
    (column) => column.normalizedDistinctCount < column.distinctCount,
  ).length;
  const leastConsistent =
    [...consistencyMeasured].sort(
      (left, right) => left.consistency - right.consistency,
    )[0] ?? null;
  const consistencyScore = consistencyMeasured.length
    ? average(consistencyMeasured.map((column) => column.consistency))
    : 100;

  const dateColumns = columnRows.filter((column) => column.type === "date");
  const freshestDate =
    [...dateColumns]
      .filter((column) => column.latestTimestamp)
      .sort((left, right) => {
        const leftTime = new Date(left.latestTimestamp ?? 0).getTime();
        const rightTime = new Date(right.latestTimestamp ?? 0).getTime();
        return rightTime - leftTime;
      })[0] ?? null;
  const staleDateColumns = dateColumns.filter((column) => {
    if (!column.latestTimestamp) return true;
    const parsed = new Date(column.latestTimestamp);
    if (Number.isNaN(parsed.getTime())) return true;
    return Date.now() - parsed.getTime() > 365 * 86_400_000;
  }).length;
  const timelinessScore = dateColumns.length
    ? average(
        dateColumns
          .map((column) => column.timeliness)
          .filter((value): value is number => value != null),
      )
    : 100;

  return {
    completeness: {
      key: "completeness",
      label: "Completeness",
      score: completenessScore,
      detailLabel: "Populated cells",
      detailValue: totalCells > 0 ? `${formatNumber(totalNonNull)} / ${formatNumber(totalCells)}` : "0 / 0",
      helper: "Non-null coverage across every column in the table.",
      details: [
        `${completeColumns} of ${columnRows.length} columns are at least 95% populated.`,
        mostMissing
          ? `${mostMissing.name} is the sparsest field at ${formatPercent(mostMissing.completeness)} coverage.`
          : "No sparsity signal is available yet.",
        `${formatNumber(totalCells - totalNonNull)} cells are currently missing.`,
      ],
      chartData: takeWeakestRows(columnRows, "completeness"),
    },
    uniqueness: {
      key: "uniqueness",
      label: "Uniqueness",
      score: uniquenessScore,
      detailLabel: "High-cardinality columns",
      detailValue: `${highCardinalityColumns} / ${columnRows.length}`,
      helper: "Columns whose distinct count stays close to total row count.",
      details: [
        `${highCardinalityColumns} columns clear the ${formatPercent(HIGH_CARDINALITY_THRESHOLD * 100, 0)} cardinality threshold.`,
        `${duplicateHeavyColumns} columns show heavy duplication pressure.`,
        leastUnique
          ? `${leastUnique.name} has the weakest uniqueness ratio at ${formatPercent(leastUnique.uniqueness)}.`
          : "No uniqueness signal is available yet.",
      ],
      chartData: takeWeakestRows(columnRows, "uniqueness"),
    },
    validity: {
      key: "validity",
      label: "Validity",
      score: validityScore,
      detailLabel: "Type-conformant values",
      detailValue: typedValues > 0 ? `${formatNumber(typedValues - invalidValues)} / ${formatNumber(typedValues)}` : "n/a",
      helper: "Checks numeric, date, boolean, and unresolved typed fields for parseability.",
      details: [
        `${formatNumber(invalidValues)} typed values failed a conformance check.`,
        `${unknownColumns} columns remain type-ambiguous and reduce confidence.`,
        leastValid
          ? `${leastValid.name} is the least conformant typed field at ${formatPercent(leastValid.validity)}.`
          : "No typed columns required conformance checks.",
      ],
      chartData: takeWeakestRows(columnRows, "validity"),
    },
    consistency: {
      key: "consistency",
      label: "Consistency",
      score: consistencyScore,
      detailLabel: "Text fields reviewed",
      detailValue: `${consistencyMeasured.length}`,
      helper: "Flags whitespace drift, blank-like values, and normalization collisions.",
      details: [
        `${formatNumber(whitespaceAnomalies)} values contain leading or trailing whitespace.`,
        `${normalizationDriftColumns} columns collapse after trim/lower normalization.`,
        leastConsistent
          ? `${leastConsistent.name} is the least consistent text field at ${formatPercent(leastConsistent.consistency)}.`
          : "No textual consistency risks were detected.",
      ],
      chartData: takeWeakestRows(columnRows, "consistency"),
    },
    timeliness: {
      key: "timeliness",
      label: "Timeliness",
      score: timelinessScore,
      detailLabel: "Date columns tracked",
      detailValue: `${dateColumns.length}`,
      helper: "Freshness is based on the most recent timestamp observed in each date column.",
      details: dateColumns.length
        ? [
            freshestDate
              ? `${freshestDate.name} is freshest with data through ${formatDateTime(freshestDate.latestTimestamp)}.`
              : "Temporal fields are present, but freshness could not be established.",
            `${staleDateColumns} date columns are older than one year or missing.`,
            `${dateColumns.length - staleDateColumns} date columns still look current enough for active monitoring.`,
          ]
        : [
            "No temporal columns were detected in this table.",
            "Timeliness stays neutral until date fields are available.",
            "Add date or timestamp columns to unlock freshness scoring.",
          ],
      chartData: takeWeakestRows(columnRows, "timeliness"),
    },
  };
}

function buildDashboardMetrics(
  row: Record<string, unknown>,
  columns: ColumnProfile[],
): DashboardMetrics {
  const { rowCount, columnRows } = buildColumnRows(row, columns);

  if (rowCount === 0) {
    const emptySummary = (key: DimensionKey, label: string): DimensionSummary => ({
      key,
      label,
      score: 0,
      detailLabel: "Status",
      detailValue: "No rows",
      helper: "This dimension needs at least one row before it can be assessed.",
      details: [
        "The current table is empty, so there is no quality signal to measure yet.",
        "Load or create rows before relying on any score from this dashboard.",
        "Once data exists, DuckDB will recompute this metric automatically.",
      ],
      chartData: [],
    });

    return {
      rowCount,
      overallScore: 0,
      dimensions: {
        completeness: emptySummary("completeness", "Completeness"),
        uniqueness: emptySummary("uniqueness", "Uniqueness"),
        validity: emptySummary("validity", "Validity"),
        consistency: emptySummary("consistency", "Consistency"),
        timeliness: emptySummary("timeliness", "Timeliness"),
      },
      columnRows: [...columnRows].sort((left, right) => left.name.localeCompare(right.name)),
      evaluatedAt: Date.now(),
    };
  }

  const dimensions = buildDimensionSummaries(rowCount, columnRows);

  const overallScore = clampScore(
    dimensions.completeness.score * 0.28 +
      dimensions.uniqueness.score * 0.18 +
      dimensions.validity.score * 0.24 +
      dimensions.consistency.score * 0.16 +
      dimensions.timeliness.score * 0.14,
  );

  return {
    rowCount,
    overallScore,
    dimensions,
    columnRows: [...columnRows].sort((left, right) => left.overall - right.overall),
    evaluatedAt: Date.now(),
  };
}

function buildGaugeOption(score: number, dark: boolean): EChartsOption {
  return {
    animationDuration: 900,
    series: [
      {
        type: "gauge",
        startAngle: 215,
        endAngle: -35,
        min: 0,
        max: 100,
        splitNumber: 5,
        progress: {
          show: true,
          width: 18,
          roundCap: true,
          itemStyle: { color: getGaugeColor(score) },
        },
        axisLine: {
          lineStyle: {
            width: 18,
            color: [[1, dark ? "rgba(51,65,85,0.48)" : "rgba(148,163,184,0.26)"]],
          },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        anchor: { show: false },
        title: {
          show: true,
          offsetCenter: [0, "48%"],
          color: dark ? "#94a3b8" : "#64748b",
          fontSize: 14,
        },
        detail: {
          valueAnimation: true,
          formatter: "{value}%",
          offsetCenter: [0, "-6%"],
          color: dark ? "#f8fafc" : "#0f172a",
          fontSize: 44,
          fontWeight: 700,
        },
        data: [{ value: Number(score.toFixed(1)), name: "overall quality" }],
      },
    ],
  };
}

function buildDimensionOption(
  data: ChartDatum[],
  color: string,
  dark: boolean,
): EChartsOption {
  return {
    animationDuration: 500,
    grid: {
      left: 10,
      right: 14,
      top: 12,
      bottom: 4,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: dark ? "#0f172ae8" : "#ffffffea",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
      formatter: "{b}<br/>{c}%",
    },
    xAxis: {
      type: "value",
      max: 100,
      axisLabel: {
        color: dark ? "#94a3b8" : "#64748b",
        fontSize: 10,
        formatter: "{value}%",
      },
      splitLine: {
        lineStyle: {
          color: dark ? "rgba(51,65,85,0.45)" : "rgba(203,213,225,0.6)",
          type: "dashed",
        },
      },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: data.map((item) => item.label),
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: {
        color: dark ? "#cbd5e1" : "#334155",
        fontSize: 11,
        width: 88,
        overflow: "truncate",
      },
    },
    series: [
      {
        type: "bar",
        data: data.map((item) => Number(item.value.toFixed(1))),
        barMaxWidth: 14,
        showBackground: true,
        backgroundStyle: {
          color: dark ? "rgba(30,41,59,0.55)" : "rgba(226,232,240,0.75)",
          borderRadius: 999,
        },
        itemStyle: {
          color,
          borderRadius: [0, 999, 999, 0],
        },
      },
    ],
  };
}

function ScorePill({ score }: { score: number }) {
  return (
    <div
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-[0.16em] uppercase ${getScoreTone(score)} bg-white/65 dark:bg-slate-950/50`}
    >
      {formatPercent(score)}
    </div>
  );
}

function ScoreBar({
  value,
  color,
}: {
  value: number | null;
  color: string;
}) {
  if (value == null) {
    return <span className="text-xs text-slate-400 dark:text-slate-500">n/a</span>;
  }

  return (
    <div className="min-w-[88px]">
      <div className="flex items-center justify-between gap-3 text-xs font-medium text-slate-600 dark:text-slate-300">
        <span>{formatPercent(value)}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800/80">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(4, clampScore(value))}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6 px-6 py-6">
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SkeletonChart className="min-h-[340px] rounded-[28px] border-white/20 bg-white/50 dark:bg-slate-950/45" />
        <SkeletonCard className="min-h-[340px] rounded-[28px] border-white/20 bg-white/50 dark:bg-slate-950/45" />
      </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <SkeletonChart
            key={index}
            className="min-h-[320px] rounded-[26px] border-white/20 bg-white/50 dark:bg-slate-950/45"
          />
        ))}
      </div>
      <SkeletonTable
        rows={6}
        columns={8}
        className="rounded-[28px] border-white/20 bg-white/50 dark:bg-slate-950/45"
      />
    </div>
  );
}

function EmptyState({ tableName }: { tableName: string }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-slate-200/80 bg-white/80 text-slate-400 shadow-sm dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-500">
        <Database className="h-7 w-7" />
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          No profiled columns for {tableName}
        </h3>
        <p className="max-w-md text-sm leading-6 text-slate-600 dark:text-slate-400">
          Load or profile a dataset first so the dashboard can compute completeness,
          uniqueness, validity, consistency, and timeliness.
        </p>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="px-6 py-6">
      <div className="flex items-start gap-3 rounded-[24px] border border-orange-300/40 bg-orange-500/10 p-4 text-sm text-orange-800 dark:border-orange-500/20 dark:bg-orange-500/10 dark:text-orange-300">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-semibold">Quality metrics failed to load</p>
          <p className="mt-1 leading-6">{message}</p>
        </div>
      </div>
    </div>
  );
}

function DimensionCard({
  dark,
  summary,
}: {
  dark: boolean;
  summary: DimensionSummary;
}) {
  const meta = DIMENSION_META[summary.key];
  const Icon = meta.icon;

  return (
    <motion.article
      variants={itemVariants}
      className="group relative overflow-hidden rounded-[28px] border border-white/30 bg-white/65 p-5 shadow-[0_24px_80px_-42px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/48"
    >
      <div className={`absolute inset-x-0 top-0 h-24 bg-linear-to-br ${meta.accent}`} />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${meta.tone}`}>
              <Icon className="h-3.5 w-3.5" />
              {summary.label}
            </div>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {formatPercent(summary.score)}
            </p>
          </div>
          <div className="rounded-2xl border border-white/40 bg-white/65 px-3 py-2 text-right shadow-sm dark:border-white/10 dark:bg-slate-950/55">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {summary.detailLabel}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
              {summary.detailValue}
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-400">
          {summary.helper}
        </p>

        <div className="mt-5 h-[170px] overflow-hidden rounded-[22px] border border-white/35 bg-white/55 p-2 shadow-inner dark:border-white/10 dark:bg-slate-950/52">
          {summary.chartData.length ? (
            <ReactECharts
              option={buildDimensionOption(summary.chartData, meta.color, dark)}
              notMerge
              lazyUpdate
              opts={{ renderer: "svg" }}
              style={{ width: "100%", height: "100%" }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              no columns to chart
            </div>
          )}
        </div>

        <div className="mt-5 space-y-3">
          {summary.details.map((detail) => (
            <div
              key={detail}
              className="flex items-start gap-2 rounded-2xl border border-white/35 bg-white/55 px-3 py-3 text-sm leading-6 text-slate-700 dark:border-white/10 dark:bg-slate-950/46 dark:text-slate-300"
            >
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: meta.color }}
              />
              <span>{detail}</span>
            </div>
          ))}
        </div>
      </div>
    </motion.article>
  );
}

export default function DataQualityDashboard({
  tableName,
  columns,
}: DataQualityDashboardProps) {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(false);

  const signature = useMemo(
    () =>
      `${tableName}:${columns
        .map(
          (column) =>
            `${column.name}:${column.type}:${column.nullCount}:${column.uniqueCount}`,
        )
        .join("|")}`,
    [columns, tableName],
  );

  const syncDarkMode = useEffectEvent(() => {
    setDark(document.documentElement.classList.contains("dark"));
  });

  useEffect(() => {
    syncDarkMode();
    const observer = new MutationObserver(() => syncDarkMode());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!columns.length) {
      setMetrics(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    async function loadMetrics() {
      setLoading(true);
      setError(null);

      try {
        const sql = buildMetricQuery(tableName, columns);
        const row = (await runQuery(sql))[0] ?? {};
        if (cancelled) return;
        const nextMetrics = buildDashboardMetrics(row, columns);
        startTransition(() => setMetrics(nextMetrics));
      } catch (nextError) {
        if (cancelled) return;
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to compute data quality metrics.",
        );
        startTransition(() => setMetrics(null));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadMetrics();

    return () => {
      cancelled = true;
    };
  }, [columns, signature, tableName]);

  const dimensionList = metrics
    ? [
        metrics.dimensions.completeness,
        metrics.dimensions.uniqueness,
        metrics.dimensions.validity,
        metrics.dimensions.consistency,
        metrics.dimensions.timeliness,
      ]
    : [];

  const weakestColumn = metrics?.columnRows[0] ?? null;
  const healthiestColumns = metrics
    ? metrics.columnRows.filter((column) => column.overall >= 90).length
    : 0;

  return (
    <section className="overflow-hidden rounded-[32px] border border-slate-200/70 bg-linear-to-br from-slate-50/95 via-white/85 to-slate-100/80 shadow-[0_28px_100px_-46px_rgba(15,23,42,0.52)] backdrop-blur-2xl dark:border-slate-800/80 dark:from-slate-950 dark:via-slate-950/95 dark:to-slate-900/92">
      <div className="border-b border-slate-200/80 px-6 py-5 dark:border-slate-800/80">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
              <Shield className="h-3.5 w-3.5" />
              Data Quality Dashboard
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Comprehensive quality overview for {tableName}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                DuckDB computes completeness, uniqueness, validity, consistency,
                and freshness directly from the active table so the quality story
                is query-backed rather than inferred from static metadata.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/55">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Columns
              </p>
              <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
                {formatNumber(columns.length)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/55">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Engine
              </p>
              <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
                DuckDB
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/55">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                View
              </p>
              <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
                Live
              </p>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <LoadingState />
          </motion.div>
        ) : error ? (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <ErrorState message={error} />
          </motion.div>
        ) : !metrics ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <EmptyState tableName={tableName} />
          </motion.div>
        ) : (
          <motion.div
            key="ready"
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="space-y-6 px-6 py-6"
          >
            <div className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
              <motion.div
                variants={itemVariants}
                className="relative overflow-hidden rounded-[30px] border border-white/30 bg-white/68 p-6 shadow-[0_26px_90px_-44px_rgba(15,23,42,0.58)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/48"
              >
                <div className="absolute inset-y-0 left-0 w-40 bg-linear-to-br from-cyan-500/16 via-cyan-400/6 to-transparent" />
                <div className="relative flex h-full flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex justify-center">
                    <div className="h-[300px] w-[300px]">
                      <ReactECharts
                        option={buildGaugeOption(metrics.overallScore, dark)}
                        notMerge
                        lazyUpdate
                        opts={{ renderer: "svg" }}
                        style={{ width: "100%", height: "100%" }}
                      />
                    </div>
                  </div>

                  <div className="max-w-xl space-y-5">
                    <div>
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/65 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 shadow-sm dark:border-white/10 dark:bg-slate-950/55 dark:text-slate-300">
                        <Sparkles className="h-3.5 w-3.5" />
                        {getQualityLabel(metrics.overallScore)}
                      </div>
                      <h3 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                        {getQualityLabel(metrics.overallScore)} quality posture
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                        {metrics.rowCount > 0
                          ? `${formatNumber(metrics.rowCount)} rows were evaluated across ${formatNumber(columns.length)} columns. ${healthiestColumns} columns already clear a 90% overall score threshold.`
                          : "This table has no rows yet, so quality scoring remains unassessed."}
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/35 bg-white/60 px-4 py-3 dark:border-white/10 dark:bg-slate-950/50">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                          Rows checked
                        </p>
                        <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
                          {formatNumber(metrics.rowCount)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/35 bg-white/60 px-4 py-3 dark:border-white/10 dark:bg-slate-950/50">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                          Weakest column
                        </p>
                        <p className="mt-1 truncate text-xl font-semibold text-slate-900 dark:text-slate-100">
                          {weakestColumn?.name ?? "—"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/35 bg-white/60 px-4 py-3 dark:border-white/10 dark:bg-slate-950/50">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                          Evaluated
                        </p>
                        <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
                          {formatDateTime(new Date(metrics.evaluatedAt).toISOString())}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/35 bg-white/60 px-4 py-3 dark:border-white/10 dark:bg-slate-950/50">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                          Quality tier
                        </p>
                        <p className={`mt-1 text-xl font-semibold ${getScoreTone(metrics.overallScore)}`}>
                          {getQualityLabel(metrics.overallScore)}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-[24px] border border-white/35 bg-white/60 p-4 dark:border-white/10 dark:bg-slate-950/50">
                      {dimensionList.map((summary) => (
                        <div
                          key={summary.key}
                          className="flex items-center gap-4"
                        >
                          <div className="w-28 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                            {summary.label}
                          </div>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800/85">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.max(4, summary.score)}%`,
                                backgroundColor: DIMENSION_META[summary.key].color,
                              }}
                            />
                          </div>
                          <div className={`w-16 text-right text-sm font-semibold ${getScoreTone(summary.score)}`}>
                            {formatPercent(summary.score)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>

              <motion.div
                variants={itemVariants}
                className="overflow-hidden rounded-[30px] border border-white/30 bg-white/68 p-6 shadow-[0_26px_90px_-44px_rgba(15,23,42,0.58)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/48"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
                      <Activity className="h-3.5 w-3.5" />
                      Executive Readout
                    </div>
                    <h3 className="mt-4 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                      Dimension balance at a glance
                    </h3>
                  </div>
                  <ScorePill score={metrics.overallScore} />
                </div>

                <div className="mt-5 space-y-4">
                  {dimensionList.map((summary) => {
                    const Icon = DIMENSION_META[summary.key].icon;
                    return (
                      <div
                        key={summary.key}
                        className="rounded-[22px] border border-white/35 bg-white/60 p-4 dark:border-white/10 dark:bg-slate-950/48"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div className={`rounded-2xl border px-3 py-3 ${DIMENSION_META[summary.key].tone}`}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {summary.label}
                              </p>
                              <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
                                {summary.details[0]}
                              </p>
                            </div>
                          </div>
                          <div className={`text-sm font-semibold ${getScoreTone(summary.score)}`}>
                            {formatPercent(summary.score)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5 rounded-[24px] border border-white/35 bg-white/60 p-4 dark:border-white/10 dark:bg-slate-950/48">
                  <div className="flex items-center gap-2">
                    {weakestColumn?.overall && weakestColumn.overall >= 75 ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    )}
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Lead remediation target
                    </p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
                    {weakestColumn
                      ? `${weakestColumn.name} is currently the lowest-scoring column at ${formatPercent(weakestColumn.overall)} overall. The main flag is ${weakestColumn.flag}.`
                      : "No remediation target is available yet."}
                  </p>
                </div>
              </motion.div>
            </div>

            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {dimensionList.map((summary) => (
                <DimensionCard key={summary.key} dark={dark} summary={summary} />
              ))}
            </div>

            <motion.div
              variants={itemVariants}
              className="overflow-hidden rounded-[30px] border border-white/30 bg-white/68 shadow-[0_26px_90px_-44px_rgba(15,23,42,0.58)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/48"
            >
              <div className="flex flex-col gap-4 border-b border-slate-200/80 px-6 py-5 dark:border-slate-800/80 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">
                    <Table2 className="h-3.5 w-3.5" />
                    Column-level Detail
                  </div>
                  <h3 className="mt-3 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                    Individual column quality scores
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                    Each column gets its own completeness, uniqueness, validity,
                    consistency, and timeliness score so remediation can focus on
                    the weakest dimensions first.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      Healthy columns
                    </p>
                    <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
                      {healthiestColumns}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/55">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      Flagged columns
                    </p>
                    <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
                      {metrics.columnRows.filter((column) => column.overall < 80).length}
                    </p>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-[1120px] w-full">
                  <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur-xl dark:bg-slate-950/90">
                    <tr className="border-b border-slate-200/80 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:border-slate-800/80 dark:text-slate-400">
                      {[
                        "Column",
                        "Type",
                        "Overall",
                        "Completeness",
                        "Uniqueness",
                        "Validity",
                        "Consistency",
                        "Timeliness",
                        "Flag",
                      ].map((label) => (
                        <th key={label} className="px-4 py-3">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                    {metrics.columnRows.map((column) => (
                      <tr
                        key={column.name}
                        className="bg-white/55 transition-colors hover:bg-white/78 dark:bg-slate-950/34 dark:hover:bg-slate-950/52"
                      >
                        <td className="px-4 py-4 align-top">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {column.name}
                            </p>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {formatNumber(column.nonNullCount)} populated / {formatNumber(metrics.rowCount)} rows
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${TYPE_BADGE[column.type].className}`}>
                            {TYPE_BADGE[column.type].label}
                          </span>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <ScoreBar value={column.overall} color={getGaugeColor(column.overall)} />
                        </td>
                        <td className="px-4 py-4 align-top">
                          <ScoreBar value={column.completeness} color={DIMENSION_META.completeness.color} />
                        </td>
                        <td className="px-4 py-4 align-top">
                          <ScoreBar value={column.uniqueness} color={DIMENSION_META.uniqueness.color} />
                        </td>
                        <td className="px-4 py-4 align-top">
                          <ScoreBar value={column.validity} color={DIMENSION_META.validity.color} />
                        </td>
                        <td className="px-4 py-4 align-top">
                          <ScoreBar value={column.consistency} color={DIMENSION_META.consistency.color} />
                        </td>
                        <td className="px-4 py-4 align-top">
                          <ScoreBar value={column.timeliness} color={DIMENSION_META.timeliness.color} />
                        </td>
                        <td className="px-4 py-4 align-top">
                          <div className="max-w-[220px] rounded-2xl border border-slate-200/80 bg-white/72 px-3 py-2 text-xs leading-5 text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
                            {column.flag}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
