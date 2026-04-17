import { quoteIdentifier } from "@/lib/utils/sql";
import { useEffect, useMemo, useState } from "react";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

export interface HealthIssue {
  severity: "critical" | "warning" | "info";
  column: string;
  message: string;
  metric: string;
  value: number;
}

export interface DataHealth {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  issues: HealthIssue[];
  loading: boolean;
}

const DEFAULT_HEALTH: DataHealth = {
  score: 0,
  grade: "F",
  issues: [],
  loading: false,
};

const healthCache = new Map<string, Omit<DataHealth, "loading">>();

interface HealthState {
  key: string;
  value: Omit<DataHealth, "loading">;
}
function asNumber(value: unknown) {
  const numeric = value == null ? Number.NaN : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function getGrade(score: number): DataHealth["grade"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function looksLikeIdentifier(name: string) {
  return /(^id$|_id$|uuid|guid|code$|key$)/i.test(name);
}

export function useDataHealth(
  tableName: string,
  columns: ColumnProfile[],
): DataHealth {
  const signature = useMemo(
    () =>
      JSON.stringify({
        tableName,
        columns: columns.map((column) => ({
          name: column.name,
          type: column.type,
          nullCount: column.nullCount,
          uniqueCount: column.uniqueCount,
        })),
      }),
    [columns, tableName],
  );

  const cachedHealth = useMemo(
    () => healthCache.get(signature) ?? null,
    [signature],
  );

  const [healthState, setHealthState] = useState<HealthState>(() => {
    if (!tableName || columns.length === 0) {
      return {
        key: "",
        value: {
          score: DEFAULT_HEALTH.score,
          grade: DEFAULT_HEALTH.grade,
          issues: DEFAULT_HEALTH.issues,
        },
      };
    }

    return cachedHealth
      ? { key: signature, value: cachedHealth }
      : {
          key: "",
          value: {
            score: DEFAULT_HEALTH.score,
            grade: DEFAULT_HEALTH.grade,
            issues: DEFAULT_HEALTH.issues,
          },
        };
  });

  useEffect(() => {
    let cancelled = false;

    if (!tableName || columns.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    if (cachedHealth) {
      return () => {
        cancelled = true;
      };
    }

    async function computeHealth() {
      try {
        const countRows = await runQuery(
          `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tableName)}`,
        );
        const rowCount = asNumber(countRows[0]?.row_count);

        if (rowCount === 0) {
          const emptyState = { ...DEFAULT_HEALTH, loading: false };
          healthCache.set(signature, {
            score: emptyState.score,
            grade: emptyState.grade,
            issues: emptyState.issues,
          });
          if (!cancelled) {
            setHealthState({
              key: signature,
              value: {
                score: emptyState.score,
                grade: emptyState.grade,
                issues: emptyState.issues,
              },
            });
          }
          return;
        }

        const typedColumns = columns.filter((column) =>
          ["number", "date", "boolean"].includes(column.type),
        );
        const numericColumns = columns.filter((column) => column.type === "number");
        const issues: HealthIssue[] = [];

        let completenessScore = 0;
        let uniquenessScore = 100;

        for (const column of columns) {
          const nonNullCount = Math.max(rowCount - column.nullCount, 0);
          const completeness = nonNullCount / rowCount;
          completenessScore += completeness * 100;

          if (column.nullCount > 0) {
            const severity =
              completeness <= 0.5 ? "critical" : completeness <= 0.85 ? "warning" : "info";
            issues.push({
              severity,
              column: column.name,
              message: `${((1 - completeness) * 100).toFixed(1)}% of values are missing.`,
              metric: "null_ratio",
              value: Number((1 - completeness).toFixed(4)),
            });
          }

          if (nonNullCount > 1 && column.uniqueCount <= 1) {
            uniquenessScore -= 10;
            issues.push({
              severity: "warning",
              column: column.name,
              message: "Column is effectively constant across populated rows.",
              metric: "cardinality",
              value: column.uniqueCount,
            });
          } else if (
            looksLikeIdentifier(column.name) &&
            nonNullCount > 0 &&
            column.uniqueCount < nonNullCount
          ) {
            uniquenessScore -= 18;
            issues.push({
              severity: "critical",
              column: column.name,
              message: "Identifier-like column contains duplicate values.",
              metric: "uniqueness_ratio",
              value: Number((column.uniqueCount / nonNullCount).toFixed(4)),
            });
          }
        }

        completenessScore /= Math.max(columns.length, 1);

        let consistencyScore = 100;
        if (typedColumns.length > 0) {
          const consistencyQuery = typedColumns
            .map((column) => {
              const identifier = quoteIdentifier(column.name);
              const targetType =
                column.type === "number"
                  ? "DOUBLE"
                  : column.type === "date"
                    ? "TIMESTAMP"
                    : "BOOLEAN";

              return `SELECT '${column.name.replaceAll("'", "''")}' AS column_name, COUNT(*) FILTER (WHERE ${identifier} IS NOT NULL AND TRY_CAST(${identifier} AS ${targetType}) IS NULL) AS invalid_count FROM ${quoteIdentifier(tableName)}`;
            })
            .join(" UNION ALL ");

          const consistencyRows = await runQuery(consistencyQuery);

          for (const row of consistencyRows) {
            const invalidCount = asNumber(row.invalid_count);
            if (invalidCount <= 0) {
              continue;
            }

            const ratio = invalidCount / rowCount;
            consistencyScore -= ratio * 100;
            issues.push({
              severity: ratio >= 0.1 ? "critical" : "warning",
              column: String(row.column_name ?? "unknown"),
              message: `${(ratio * 100).toFixed(1)}% of values fail the expected type cast.`,
              metric: "type_consistency",
              value: Number(ratio.toFixed(4)),
            });
          }
        }

        let outlierScore = 100;
        if (numericColumns.length > 0) {
          const outlierQuery = numericColumns
            .map((column) => {
              const identifier = quoteIdentifier(column.name);
              const safeName = column.name.replaceAll("'", "''");

              return `WITH bounds AS (
                SELECT
                  quantile_cont(CAST(${identifier} AS DOUBLE), 0.25) AS q1,
                  quantile_cont(CAST(${identifier} AS DOUBLE), 0.75) AS q3
                FROM ${quoteIdentifier(tableName)}
                WHERE ${identifier} IS NOT NULL
              )
              SELECT
                '${safeName}' AS column_name,
                COUNT(*) FILTER (
                  WHERE ${identifier} IS NOT NULL
                    AND (
                      CAST(${identifier} AS DOUBLE) < bounds.q1 - ((bounds.q3 - bounds.q1) * 1.5)
                      OR CAST(${identifier} AS DOUBLE) > bounds.q3 + ((bounds.q3 - bounds.q1) * 1.5)
                    )
                ) AS outlier_count
              FROM ${quoteIdentifier(tableName)}, bounds`;
            })
            .join(" UNION ALL ");

          const outlierRows = await runQuery(outlierQuery);

          for (const row of outlierRows) {
            const outlierCount = asNumber(row.outlier_count);
            if (outlierCount <= 0) {
              continue;
            }

            const ratio = outlierCount / rowCount;
            outlierScore -= Math.min(ratio * 120, 18);
            issues.push({
              severity: ratio >= 0.08 ? "warning" : "info",
              column: String(row.column_name ?? "unknown"),
              message: `${(ratio * 100).toFixed(1)}% of rows look like IQR outliers.`,
              metric: "outlier_ratio",
              value: Number(ratio.toFixed(4)),
            });
          }
        }

        const score = clampScore(
          completenessScore * 0.4 +
            Math.max(uniquenessScore, 0) * 0.2 +
            Math.max(consistencyScore, 0) * 0.2 +
            Math.max(outlierScore, 0) * 0.2,
        );

        const nextHealth = {
          score,
          grade: getGrade(score),
          issues: issues
            .sort((left, right) => {
              const severityRank = { critical: 0, warning: 1, info: 2 };
              return (
                severityRank[left.severity] - severityRank[right.severity] ||
                right.value - left.value
              );
            })
            .slice(0, 12),
        } satisfies Omit<DataHealth, "loading">;

        healthCache.set(signature, nextHealth);

        if (!cancelled) {
          setHealthState({ key: signature, value: nextHealth });
        }
      } catch {
        if (!cancelled) {
          setHealthState({
            key: signature,
            value: {
              score: 62,
              grade: "D",
              issues: [
                {
                  severity: "warning",
                  column: "dataset",
                  message: "Health diagnostics partially failed; showing a conservative fallback score.",
                  metric: "query_error",
                  value: 1,
                },
              ],
            },
          });
        }
      }
    }

    void computeHealth();

    return () => {
      cancelled = true;
    };
  }, [cachedHealth, columns, signature, tableName]);

  if (!tableName || columns.length === 0) {
    return DEFAULT_HEALTH;
  }

  const resolved = cachedHealth ?? (healthState.key === signature ? healthState.value : null);

  if (!resolved) {
    return { ...DEFAULT_HEALTH, loading: true };
  }

  return { ...resolved, loading: false };
}
