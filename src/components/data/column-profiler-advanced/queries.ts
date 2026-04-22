import { runQuery } from "@/lib/duckdb/client";
import { quoteIdentifier } from "@/lib/utils/sql";
import type { ColumnProfile } from "@/types/dataset";

import { clamp, formatMetric, toNumber, toText } from "./lib";
import {
  WEEKDAYS,
  type ColumnStatistics,
  type FrequencyRow,
  type HistogramBin,
  type OutlierMetrics,
  type PatternMetrics,
  type QualityMetrics,
  type TemporalMetrics,
  type AdvancedProfileData,
} from "./types";

export async function loadBaseStatistics(
  tableName: string,
  column: ColumnProfile,
): Promise<ColumnStatistics> {
  const table = quoteIdentifier(tableName);
  const field = quoteIdentifier(column.name);

  if (column.type === "number") {
    const row = (await runQuery(`
      SELECT
        COUNT(${field}) AS value_count,
        COUNT(*) - COUNT(${field}) AS null_count,
        COUNT(DISTINCT ${field}) AS unique_count,
        MIN(${field}) AS min_value,
        MAX(${field}) AS max_value,
        AVG(${field}) AS mean_value,
        MEDIAN(${field}) AS median_value,
        STDDEV_SAMP(${field}) AS stddev_value,
        VAR_SAMP(${field}) AS variance_value,
        SKEWNESS(${field}) AS skewness_value,
        KURTOSIS(${field}) AS kurtosis_value
      FROM ${table}
    `))[0] ?? {};

    return {
      count: toNumber(row.value_count) ?? 0,
      nulls: toNumber(row.null_count) ?? 0,
      unique: toNumber(row.unique_count) ?? 0,
      min: toNumber(row.min_value),
      max: toNumber(row.max_value),
      mean: toNumber(row.mean_value),
      median: toNumber(row.median_value),
      stddev: toNumber(row.stddev_value),
      variance: toNumber(row.variance_value),
      skewness: toNumber(row.skewness_value),
      kurtosis: toNumber(row.kurtosis_value),
    };
  }

  if (column.type === "date") {
    const parsed = `TRY_CAST(${field} AS TIMESTAMP)`;
    const row = (await runQuery(`
      WITH parsed_values AS (
        SELECT ${field} AS raw_value, ${parsed} AS parsed_value
        FROM ${table}
      )
      SELECT
        COUNT(parsed_value) AS value_count,
        COUNT(*) - COUNT(raw_value) AS null_count,
        COUNT(DISTINCT parsed_value) AS unique_count,
        CAST(MIN(parsed_value) AS VARCHAR) AS min_value,
        CAST(MAX(parsed_value) AS VARCHAR) AS max_value
      FROM parsed_values
    `))[0] ?? {};

    return {
      count: toNumber(row.value_count) ?? 0,
      nulls: toNumber(row.null_count) ?? 0,
      unique: toNumber(row.unique_count) ?? 0,
      min: toText(row.min_value),
      max: toText(row.max_value),
      mean: null,
      median: null,
      stddev: null,
      variance: null,
      skewness: null,
      kurtosis: null,
    };
  }

  const row = (await runQuery(`
    SELECT
      COUNT(${field}) AS value_count,
      COUNT(*) - COUNT(${field}) AS null_count,
      COUNT(DISTINCT ${field}) AS unique_count,
      MIN(CAST(${field} AS VARCHAR)) AS min_value,
      MAX(CAST(${field} AS VARCHAR)) AS max_value
    FROM ${table}
  `))[0] ?? {};

  return {
    count: toNumber(row.value_count) ?? 0,
    nulls: toNumber(row.null_count) ?? 0,
    unique: toNumber(row.unique_count) ?? 0,
    min: toText(row.min_value),
    max: toText(row.max_value),
    mean: null,
    median: null,
    stddev: null,
    variance: null,
    skewness: null,
    kurtosis: null,
  };
}

export async function loadHistogram(
  tableName: string,
  column: ColumnProfile,
): Promise<HistogramBin[]> {
  const table = quoteIdentifier(tableName);
  const field = quoteIdentifier(column.name);

  if (column.type === "number") {
    const rows = await runQuery(`
      WITH clean AS (
        SELECT CAST(${field} AS DOUBLE) AS value
        FROM ${table}
        WHERE ${field} IS NOT NULL
      ),
      bounds AS (
        SELECT MIN(value) AS min_value, MAX(value) AS max_value
        FROM clean
      ),
      bins AS (
        SELECT range AS bucket FROM range(0, 30)
      ),
      grouped AS (
        SELECT
          CASE
            WHEN bounds.max_value = bounds.min_value THEN 0
            ELSE LEAST(
              CAST(FLOOR(((clean.value - bounds.min_value) / NULLIF(bounds.max_value - bounds.min_value, 0)) * 30) AS INTEGER),
              29
            )
          END AS bucket,
          COUNT(*) AS bucket_count
        FROM clean, bounds
        GROUP BY 1
      )
      SELECT
        bins.bucket AS bucket,
        bounds.min_value + ((bounds.max_value - bounds.min_value) / 30.0) * bins.bucket AS start_value,
        CASE
          WHEN bins.bucket = 29 THEN bounds.max_value
          ELSE bounds.min_value + ((bounds.max_value - bounds.min_value) / 30.0) * (bins.bucket + 1)
        END AS end_value,
        COALESCE(grouped.bucket_count, 0) AS bucket_count
      FROM bins, bounds
      LEFT JOIN grouped USING (bucket)
      ORDER BY bucket
    `);

    return rows.map((row) => ({
      label: `${formatMetric(toNumber(row.start_value), 1)}–${formatMetric(toNumber(row.end_value), 1)}`,
      count: toNumber(row.bucket_count) ?? 0,
    }));
  }

  if (column.type === "date") {
    const parsed = `TRY_CAST(${field} AS TIMESTAMP)`;
    const rows = await runQuery(`
      WITH clean AS (
        SELECT DATE_TRUNC('month', ${parsed}) AS bucket
        FROM ${table}
        WHERE ${parsed} IS NOT NULL
      )
      SELECT STRFTIME(bucket, '%Y-%m') AS label, COUNT(*) AS bucket_count
      FROM clean
      GROUP BY 1
      ORDER BY label
      LIMIT 20
    `);

    return rows.map((row) => ({
      label: String(row.label ?? ""),
      count: toNumber(row.bucket_count) ?? 0,
    }));
  }

  const rows = await runQuery(`
    WITH ranked AS (
      SELECT CAST(${field} AS VARCHAR) AS value_label, COUNT(*) AS bucket_count
      FROM ${table}
      WHERE ${field} IS NOT NULL
      GROUP BY 1
    )
    SELECT value_label, bucket_count
    FROM ranked
    ORDER BY bucket_count DESC, value_label
    LIMIT 20
  `);

  return rows.map((row) => ({
    label: String(row.value_label ?? "null"),
    count: toNumber(row.bucket_count) ?? 0,
  }));
}

export async function loadFrequencyRows(
  tableName: string,
  columnName: string,
): Promise<FrequencyRow[]> {
  const table = quoteIdentifier(tableName);
  const field = quoteIdentifier(columnName);
  const rows = await runQuery(`
    WITH ranked AS (
      SELECT CAST(${field} AS VARCHAR) AS value_label, COUNT(*) AS value_count
      FROM ${table}
      WHERE ${field} IS NOT NULL
      GROUP BY 1
    )
    SELECT
      value_label,
      value_count,
      value_count * 100.0 / NULLIF(SUM(value_count) OVER (), 0) AS percentage
    FROM ranked
    ORDER BY value_count DESC, value_label
    LIMIT 50
  `);

  return rows.map((row) => ({
    value: String(row.value_label ?? "null"),
    count: toNumber(row.value_count) ?? 0,
    percentage: toNumber(row.percentage) ?? 0,
  }));
}

export async function loadPatternMetrics(
  tableName: string,
  columnName: string,
): Promise<PatternMetrics> {
  const table = quoteIdentifier(tableName);
  const field = quoteIdentifier(columnName);
  const row = (await runQuery(String.raw`
    WITH clean AS (
      SELECT CAST(${field} AS VARCHAR) AS value
      FROM ${table}
      WHERE ${field} IS NOT NULL
    )
    SELECT
      COUNT(*) AS non_null_count,
      SUM(CASE WHEN regexp_matches(value, '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') THEN 1 ELSE 0 END) AS email_count,
      SUM(CASE WHEN regexp_matches(value, '^(\+?\d[\d\-\s().]{6,}\d)$') THEN 1 ELSE 0 END) AS phone_count,
      SUM(CASE WHEN regexp_matches(value, '^(https?://|www\.)') THEN 1 ELSE 0 END) AS url_count,
      SUM(CASE WHEN TRIM(value) = '' THEN 1 ELSE 0 END) AS blank_count,
      SUM(CASE WHEN value = TRIM(value) THEN 1 ELSE 0 END) AS trimmed_count
    FROM clean
  `))[0] ?? {};

  return {
    nonNull: toNumber(row.non_null_count) ?? 0,
    emailCount: toNumber(row.email_count) ?? 0,
    phoneCount: toNumber(row.phone_count) ?? 0,
    urlCount: toNumber(row.url_count) ?? 0,
    blankCount: toNumber(row.blank_count) ?? 0,
    trimmedCount: toNumber(row.trimmed_count) ?? 0,
  };
}

export async function loadTemporalMetrics(
  tableName: string,
  columnName: string,
): Promise<TemporalMetrics> {
  const table = quoteIdentifier(tableName);
  const field = quoteIdentifier(columnName);
  const parsed = `TRY_CAST(${field} AS TIMESTAMP)`;

  const [summaryRow, weekdayRows, gapRows] = await Promise.all([
    runQuery(`
      WITH clean AS (
        SELECT ${parsed} AS value
        FROM ${table}
        WHERE ${parsed} IS NOT NULL
      )
      SELECT
        CAST(MIN(value) AS VARCHAR) AS min_date,
        CAST(MAX(value) AS VARCHAR) AS max_date,
        DATE_DIFF('day', CAST(MIN(value) AS DATE), CAST(MAX(value) AS DATE)) AS range_days
      FROM clean
    `),
    runQuery(`
      WITH clean AS (
        SELECT ${parsed} AS value
        FROM ${table}
        WHERE ${parsed} IS NOT NULL
      )
      SELECT STRFTIME(value, '%A') AS label, COUNT(*) AS bucket_count
      FROM clean
      GROUP BY 1
      ORDER BY CAST(STRFTIME(MIN(value), '%w') AS INTEGER)
    `),
    runQuery(`
      WITH distinct_days AS (
        SELECT DISTINCT CAST(${parsed} AS DATE) AS day_value
        FROM ${table}
        WHERE ${parsed} IS NOT NULL
      ),
      lagged AS (
        SELECT
          LAG(day_value) OVER (ORDER BY day_value) AS previous_day,
          day_value AS current_day,
          DATE_DIFF('day', LAG(day_value) OVER (ORDER BY day_value), day_value) AS gap_days
        FROM distinct_days
      )
      SELECT
        CAST(previous_day AS VARCHAR) AS start_date,
        CAST(current_day AS VARCHAR) AS end_date,
        gap_days
      FROM lagged
      WHERE previous_day IS NOT NULL AND gap_days > 1
      ORDER BY gap_days DESC, current_day
      LIMIT 8
    `),
  ]);

  const weekdayMap = new Map(
    weekdayRows.map((row) => [String(row.label ?? ""), toNumber(row.bucket_count) ?? 0]),
  );
  const summary = summaryRow[0] ?? {};

  return {
    minDate: toText(summary.min_date),
    maxDate: toText(summary.max_date),
    rangeDays: toNumber(summary.range_days) ?? 0,
    dayOfWeek: WEEKDAYS.map((day) => ({
      label: day,
      count: weekdayMap.get(day) ?? 0,
    })),
    gaps: gapRows.map((row) => ({
      start: String(row.start_date ?? ""),
      end: String(row.end_date ?? ""),
      days: toNumber(row.gap_days) ?? 0,
    })),
  };
}

export async function loadOutlierMetrics(
  tableName: string,
  columnName: string,
): Promise<OutlierMetrics> {
  const table = quoteIdentifier(tableName);
  const field = quoteIdentifier(columnName);

  const [summaryRows, outlierRows] = await Promise.all([
    runQuery(`
      WITH bounds AS (
        SELECT
          QUANTILE_CONT(${field}, 0.25) AS q1,
          MEDIAN(${field}) AS median_value,
          QUANTILE_CONT(${field}, 0.75) AS q3
        FROM ${table}
        WHERE ${field} IS NOT NULL
      )
      SELECT
        q1,
        median_value,
        q3,
        q1 - 1.5 * (q3 - q1) AS lower_bound,
        q3 + 1.5 * (q3 - q1) AS upper_bound,
        MIN(${field}) FILTER (WHERE ${field} >= q1 - 1.5 * (q3 - q1)) AS whisker_low,
        MAX(${field}) FILTER (WHERE ${field} <= q3 + 1.5 * (q3 - q1)) AS whisker_high,
        COUNT(*) FILTER (
          WHERE ${field} IS NOT NULL
            AND (
              ${field} < q1 - 1.5 * (q3 - q1)
              OR ${field} > q3 + 1.5 * (q3 - q1)
            )
        ) AS outlier_count
      FROM ${table}, bounds
    `),
    runQuery(`
      WITH bounds AS (
        SELECT
          QUANTILE_CONT(${field}, 0.25) AS q1,
          QUANTILE_CONT(${field}, 0.75) AS q3
        FROM ${table}
        WHERE ${field} IS NOT NULL
      ),
      grouped AS (
        SELECT CAST(${field} AS VARCHAR) AS value_label, COUNT(*) AS value_count
        FROM ${table}, bounds
        WHERE ${field} IS NOT NULL
          AND (
            ${field} < q1 - 1.5 * (q3 - q1)
            OR ${field} > q3 + 1.5 * (q3 - q1)
          )
        GROUP BY 1
      )
      SELECT
        value_label,
        value_count,
        value_count * 100.0 / NULLIF(SUM(value_count) OVER (), 0) AS percentage
      FROM grouped
      ORDER BY value_count DESC, value_label
      LIMIT 12
    `),
  ]);

  const summary = summaryRows[0] ?? {};

  return {
    q1: toNumber(summary.q1),
    median: toNumber(summary.median_value),
    q3: toNumber(summary.q3),
    lowerBound: toNumber(summary.lower_bound),
    upperBound: toNumber(summary.upper_bound),
    whiskerLow: toNumber(summary.whisker_low),
    whiskerHigh: toNumber(summary.whisker_high),
    outlierCount: toNumber(summary.outlier_count) ?? 0,
    topOutliers: outlierRows.map((row) => ({
      value: String(row.value_label ?? ""),
      count: toNumber(row.value_count) ?? 0,
      percentage: toNumber(row.percentage) ?? 0,
    })),
  };
}

export function buildQualityMetrics(
  column: ColumnProfile,
  rowCount: number,
  statistics: ColumnStatistics,
  patterns: PatternMetrics | null,
): QualityMetrics {
  const completeness = rowCount > 0 ? (statistics.count / rowCount) * 100 : 0;
  const uniqueness = statistics.count > 0 ? (statistics.unique / statistics.count) * 100 : 0;

  if (column.type === "string" && patterns) {
    const dominantCount = Math.max(patterns.emailCount, patterns.phoneCount, patterns.urlCount);
    const dominantLabel =
      dominantCount === patterns.emailCount
        ? "Email format"
        : dominantCount === patterns.phoneCount
          ? "Phone format"
          : dominantCount === patterns.urlCount
            ? "URL format"
            : "Whitespace hygiene";
    const conformityBase = dominantCount > 0 ? dominantCount : patterns.trimmedCount - patterns.blankCount;
    const patternConformity =
      patterns.nonNull > 0 ? clamp((conformityBase / patterns.nonNull) * 100, 0, 100) : 100;

    return {
      completeness,
      uniqueness,
      patternConformity,
      conformityLabel: dominantCount > 0 ? dominantLabel : "Clean trimmed text",
    };
  }

  return {
    completeness,
    uniqueness,
    patternConformity: 100,
    conformityLabel: column.type === "date" ? "Valid temporal parse" : "Type-consistent values",
  };
}

export async function loadAdvancedProfile(
  tableName: string,
  column: ColumnProfile,
  rowCount: number,
): Promise<AdvancedProfileData> {
  const statistics = await loadBaseStatistics(tableName, column);

  const [histogram, frequencyRows, patterns, temporal, outliers] = await Promise.all([
    loadHistogram(tableName, column),
    loadFrequencyRows(tableName, column.name),
    column.type === "string" ? loadPatternMetrics(tableName, column.name) : Promise.resolve(null),
    column.type === "date" ? loadTemporalMetrics(tableName, column.name) : Promise.resolve(null),
    column.type === "number" ? loadOutlierMetrics(tableName, column.name) : Promise.resolve(null),
  ]);

  return {
    statistics,
    histogram,
    frequencyRows,
    patterns,
    temporal,
    outliers,
    quality: buildQualityMetrics(column, rowCount, statistics, patterns),
  };
}
