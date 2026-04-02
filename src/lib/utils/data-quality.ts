/**
 * Data quality assessment utilities.
 *
 * Analyzes column profiles to produce an overall quality score and a list of
 * actionable issues. The score ranges from 0 (worst) to 100 (best).
 */

import type { ColumnProfile } from "@/types/dataset";

/** Severity level for a data-quality issue. */
export type IssueSeverity = "low" | "medium" | "high";

/** A single data-quality issue tied to a specific column. */
export interface DataQualityIssue {
  column: string;
  severity: IssueSeverity;
  message: string;
}

/** Result of a data-quality assessment. */
export interface DataQualityResult {
  /** Overall quality score from 0 (worst) to 100 (best). */
  overallScore: number;
  /** Individual issues discovered during analysis. */
  issues: DataQualityIssue[];
  /** A short human-readable summary sentence. */
  summary: string;
}

/** Threshold above which a null rate is considered problematic. */
const HIGH_NULL_THRESHOLD = 0.2;

/**
 * Penalty weights by severity.
 * Each issue deducts points from the initial perfect score of 100.
 */
const SEVERITY_PENALTY: Record<IssueSeverity, number> = {
  low: 3,
  medium: 7,
  high: 12,
};

/**
 * Names (lowercased) that strongly suggest a column is intended to be a
 * unique identifier.
 */
const ID_PATTERNS = ["id", "_id", "uuid", "guid", "key", "code"];

/**
 * Returns `true` when the column name looks like it should hold unique
 * identifiers (e.g. "user_id", "orderID", "uuid").
 */
function looksLikeIdColumn(name: string): boolean {
  const lower = name.toLowerCase();
  return ID_PATTERNS.some(
    (p) => lower === p || lower.endsWith(p) || lower.startsWith(p + "_"),
  );
}

/**
 * Assess the overall quality of a dataset based on its column profiles.
 *
 * The function checks for:
 * - **High null rates** (> 20 % of rows) in any column.
 * - **Low uniqueness** in columns whose name suggests they should be unique identifiers.
 * - **Completely empty columns** (100 % nulls).
 * - **Data type mismatches** (columns typed as `"unknown"`).
 *
 * @param columns  - The column profiles produced by the data profiler.
 * @param rowCount - Total number of rows in the dataset.
 * @returns An object containing the score, issues, and a summary.
 */
export function assessDataQuality(
  columns: ColumnProfile[],
  rowCount: number,
): DataQualityResult {
  const issues: DataQualityIssue[] = [];

  if (columns.length === 0 || rowCount === 0) {
    return {
      overallScore: 0,
      issues: [],
      summary: "No data available to assess.",
    };
  }

  for (const col of columns) {
    const nullRate = rowCount > 0 ? col.nullCount / rowCount : 0;

    // ---- Completely empty column ----
    if (col.nullCount === rowCount) {
      issues.push({
        column: col.name,
        severity: "high",
        message: `Column is entirely empty (${rowCount} null values).`,
      });
      continue; // No point checking further for this column.
    }

    // ---- High null rate ----
    if (nullRate > HIGH_NULL_THRESHOLD) {
      const pct = (nullRate * 100).toFixed(1);
      issues.push({
        column: col.name,
        severity: nullRate >= 0.5 ? "high" : "medium",
        message: `High null rate: ${pct}% of values are missing.`,
      });
    }

    // ---- Low uniqueness in ID-like columns ----
    if (looksLikeIdColumn(col.name)) {
      const nonNullCount = rowCount - col.nullCount;
      if (nonNullCount > 0 && col.uniqueCount < nonNullCount) {
        const dupCount = nonNullCount - col.uniqueCount;
        issues.push({
          column: col.name,
          severity: "high",
          message: `Expected unique values but found ${dupCount} duplicate(s).`,
        });
      }
    }

    // ---- Data type mismatch ----
    if (col.type === "unknown") {
      issues.push({
        column: col.name,
        severity: "medium",
        message: "Column data type could not be determined.",
      });
    }
  }

  // ---- Compute score ----
  const totalPenalty = issues.reduce(
    (sum, issue) => sum + SEVERITY_PENALTY[issue.severity],
    0,
  );
  const overallScore = Math.max(0, Math.min(100, 100 - totalPenalty));

  // ---- Build summary ----
  const summary = buildSummary(overallScore, issues);

  return { overallScore, issues, summary };
}

/**
 * Produce a short human-readable summary line.
 */
function buildSummary(score: number, issues: DataQualityIssue[]): string {
  if (issues.length === 0) {
    return "Excellent data quality. No issues detected.";
  }

  const highCount = issues.filter((i) => i.severity === "high").length;
  const mediumCount = issues.filter((i) => i.severity === "medium").length;
  const lowCount = issues.filter((i) => i.severity === "low").length;

  const parts: string[] = [];
  if (highCount > 0) parts.push(`${highCount} high`);
  if (mediumCount > 0) parts.push(`${mediumCount} medium`);
  if (lowCount > 0) parts.push(`${lowCount} low`);

  const qualifier =
    score >= 80 ? "Good" : score >= 50 ? "Fair" : "Poor";

  return `${qualifier} data quality (score: ${score}/100). Found ${issues.length} issue(s): ${parts.join(", ")}.`;
}
