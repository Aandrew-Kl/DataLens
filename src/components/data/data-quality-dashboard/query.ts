import { quoteIdentifier } from "@/lib/utils/sql";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

import {
  asNumber,
  asText,
  average,
  clampScore,
  formatDateTime,
  formatPercent,
  getColumnAlias,
} from "./lib";
import {
  HIGH_CARDINALITY_THRESHOLD,
  type ChartDatum,
  type ColumnQualityRow,
  type DashboardMetrics,
  type DimensionKey,
  type DimensionSummary,
} from "./types";

export function buildMetricQuery(tableName: string, columns: ColumnProfile[]) {
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
      [completeness, uniqueness, validity, consistency, timeliness].filter(
        (value): value is number => value != null,
      ),
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
      value: key === "timeliness" ? row.timeliness : row[key],
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

export function buildDashboardMetrics(
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
