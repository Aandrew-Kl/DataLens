"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { runQuery } from "@/lib/duckdb/client";
import type { ColumnProfile } from "@/types/dataset";

export interface Issue {
  id: string;
  column: string;
  severity: "low" | "medium" | "high";
  type: "high_null_rate" | "low_uniqueness" | "type_mismatch" | "outlier_column";
  message: string;
  value: number;
}

export interface Suggestion {
  id: string;
  column?: string;
  priority: "low" | "medium" | "high";
  message: string;
}

export interface DataHealth {
  score: number;
  issues: Issue[];
  suggestions: Suggestion[];
  refreshedAt: number;
  loading: boolean;
}

interface ComputedHealth {
  score: number;
  issues: Issue[];
  suggestions: Suggestion[];
  refreshedAt: number;
}

const CACHE_PREFIX = "datalens:data-health:";
const EMPTY_HEALTH: DataHealth = {
  score: 0,
  issues: [],
  suggestions: [],
  refreshedAt: 0,
  loading: false,
};

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function readNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildSignature(tableName: string, columns: ColumnProfile[]): string {
  return JSON.stringify({
    tableName,
    columns: columns.map((column) => ({
      name: column.name,
      type: column.type,
      nullCount: column.nullCount,
      uniqueCount: column.uniqueCount,
    })),
  });
}

function readCachedHealth(signature: string): ComputedHealth | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(`${CACHE_PREFIX}${signature}`);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<ComputedHealth>;
    if (
      typeof parsed.score !== "number" ||
      !Array.isArray(parsed.issues) ||
      !Array.isArray(parsed.suggestions) ||
      typeof parsed.refreshedAt !== "number"
    ) {
      return null;
    }

    return {
      score: parsed.score,
      issues: parsed.issues as Issue[],
      suggestions: parsed.suggestions as Suggestion[],
      refreshedAt: parsed.refreshedAt,
    };
  } catch {
    return null;
  }
}

function writeCachedHealth(signature: string, health: ComputedHealth): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(`${CACHE_PREFIX}${signature}`, JSON.stringify(health));
  } catch {
    // Ignore storage quota or privacy-mode failures.
  }
}

function buildTypeMismatchQuery(tableName: string, columns: ColumnProfile[]): string | null {
  const typedColumns = columns.filter(
    (column) => column.type === "number" || column.type === "date" || column.type === "boolean",
  );

  if (typedColumns.length === 0) {
    return null;
  }

  return typedColumns
    .map((column) => {
      const identifier = quoteIdentifier(column.name);
      const safeColumnName = column.name.replaceAll("'", "''");
      const expectedType =
        column.type === "number"
          ? "DOUBLE"
          : column.type === "date"
            ? "TIMESTAMP"
            : "BOOLEAN";

      return `SELECT
        '${safeColumnName}' AS column_name,
        COUNT(*) FILTER (
          WHERE ${identifier} IS NOT NULL
            AND TRY_CAST(${identifier} AS ${expectedType}) IS NULL
        ) AS invalid_count
      FROM ${quoteIdentifier(tableName)}`;
    })
    .join(" UNION ALL ");
}

function buildOutlierQuery(tableName: string, columns: ColumnProfile[]): string | null {
  const numericColumns = columns.filter((column) => column.type === "number");

  if (numericColumns.length === 0) {
    return null;
  }

  return numericColumns
    .map((column) => {
      const identifier = quoteIdentifier(column.name);
      const safeColumnName = column.name.replaceAll("'", "''");

      return `WITH values AS (
        SELECT TRY_CAST(${identifier} AS DOUBLE) AS value
        FROM ${quoteIdentifier(tableName)}
        WHERE ${identifier} IS NOT NULL
      ),
      bounds AS (
        SELECT
          QUANTILE_CONT(value, 0.25) AS q1,
          QUANTILE_CONT(value, 0.75) AS q3
        FROM values
      )
      SELECT
        '${safeColumnName}' AS column_name,
        COUNT(*) FILTER (
          WHERE value < bounds.q1 - (1.5 * (bounds.q3 - bounds.q1))
             OR value > bounds.q3 + (1.5 * (bounds.q3 - bounds.q1))
        ) AS outlier_count
      FROM values, bounds`;
    })
    .join(" UNION ALL ");
}

function uniquePenalty(column: ColumnProfile, nonNullCount: number): number {
  if (nonNullCount <= 1) {
    return 0;
  }

  const uniquenessRatio = column.uniqueCount / nonNullCount;
  const looksLikeIdentifier = /(^id$|_id$|uuid|guid|code$|key$)/i.test(column.name);

  if (looksLikeIdentifier) {
    return (1 - Math.min(uniquenessRatio, 1)) * 32;
  }

  if (column.type === "boolean") {
    return 0;
  }

  if (column.uniqueCount <= 1) {
    return 22;
  }

  if (column.type === "number" && uniquenessRatio < 0.04) {
    return (0.04 - uniquenessRatio) * 300;
  }

  return 0;
}

function dedupeSuggestions(suggestions: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  const orderedPriority = { high: 0, medium: 1, low: 2 } as const;

  return suggestions
    .sort((left, right) => {
      return (
        orderedPriority[left.priority] - orderedPriority[right.priority] ||
        left.message.localeCompare(right.message)
      );
    })
    .filter((suggestion) => {
      const key = `${suggestion.column ?? "dataset"}:${suggestion.message}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

async function computeHealth(tableName: string, columns: ColumnProfile[]): Promise<ComputedHealth> {
  const countRows = await runQuery(`SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tableName)}`);
  const rowCount = readNumber(countRows[0]?.row_count);

  if (!tableName || columns.length === 0 || rowCount === 0) {
    return {
      score: 0,
      issues: [],
      suggestions: [],
      refreshedAt: Date.now(),
    };
  }

  const mismatchQuery = buildTypeMismatchQuery(tableName, columns);
  const outlierQuery = buildOutlierQuery(tableName, columns);

  const [mismatchRows, outlierRows] = await Promise.all([
    mismatchQuery ? runQuery(mismatchQuery) : Promise.resolve<Record<string, unknown>[]>([]),
    outlierQuery ? runQuery(outlierQuery) : Promise.resolve<Record<string, unknown>[]>([]),
  ]);

  const mismatchMap = new Map<string, number>();
  mismatchRows.forEach((row) => {
    mismatchMap.set(String(row.column_name ?? ""), readNumber(row.invalid_count));
  });

  const outlierMap = new Map<string, number>();
  outlierRows.forEach((row) => {
    outlierMap.set(String(row.column_name ?? ""), readNumber(row.outlier_count));
  });

  const issues: Issue[] = [];
  const suggestions: Suggestion[] = [];
  const perColumnScores = columns.map((column) => {
    const nonNullCount = Math.max(rowCount - column.nullCount, 0);
    const nullRatio = rowCount === 0 ? 0 : column.nullCount / rowCount;
    const mismatchCount = mismatchMap.get(column.name) ?? 0;
    const mismatchRatio = rowCount === 0 ? 0 : mismatchCount / rowCount;
    const outlierCount = outlierMap.get(column.name) ?? 0;
    const outlierRatio = rowCount === 0 ? 0 : outlierCount / rowCount;
    const nullPenalty = Math.min(52, nullRatio * 64);
    const uniquenessPenalty = uniquePenalty(column, nonNullCount);
    const consistencyPenalty = Math.min(34, mismatchRatio * 100);

    if (nullRatio >= 0.25) {
      issues.push({
        id: `${column.name}:nulls`,
        column: column.name,
        severity: nullRatio >= 0.65 ? "high" : nullRatio >= 0.4 ? "medium" : "low",
        type: "high_null_rate",
        message: `${column.name} is ${Math.round(nullRatio * 100)}% null and is dragging completeness down.`,
        value: Number(nullRatio.toFixed(4)),
      });
      suggestions.push({
        id: `${column.name}:null-suggestion`,
        column: column.name,
        priority: nullRatio >= 0.65 ? "high" : "medium",
        message:
          nullRatio >= 0.9
            ? `Consider removing ${column.name}; it is mostly empty.`
            : `Backfill or impute ${column.name} before downstream analysis.`,
      });
    }

    if (uniquenessPenalty >= 12) {
      const uniquenessRatio = nonNullCount <= 1 ? 0 : column.uniqueCount / nonNullCount;
      issues.push({
        id: `${column.name}:uniqueness`,
        column: column.name,
        severity: uniquenessPenalty >= 24 ? "high" : "medium",
        type: "low_uniqueness",
        message: `${column.name} has limited uniqueness for its apparent role.`,
        value: Number(uniquenessRatio.toFixed(4)),
      });
      suggestions.push({
        id: `${column.name}:uniqueness-suggestion`,
        column: column.name,
        priority: uniquenessPenalty >= 24 ? "high" : "medium",
        message: /(^id$|_id$|uuid|guid|code$|key$)/i.test(column.name)
          ? `Deduplicate ${column.name} or choose a stronger key before joining datasets.`
          : `Review whether ${column.name} should be grouped, bucketed, or removed as a constant-like field.`,
      });
    }

    if (mismatchRatio >= 0.03) {
      issues.push({
        id: `${column.name}:type`,
        column: column.name,
        severity: mismatchRatio >= 0.12 ? "high" : "medium",
        type: "type_mismatch",
        message: `${column.name} has values that fail ${column.type} casting checks.`,
        value: Number(mismatchRatio.toFixed(4)),
      });
      suggestions.push({
        id: `${column.name}:type-suggestion`,
        column: column.name,
        priority: mismatchRatio >= 0.12 ? "high" : "medium",
        message: `Column ${column.name} may need type conversion or value normalization.`,
      });
    }

    if (outlierRatio >= 0.05) {
      issues.push({
        id: `${column.name}:outliers`,
        column: column.name,
        severity: outlierRatio >= 0.12 ? "high" : "low",
        type: "outlier_column",
        message: `${column.name} contains a visible concentration of outliers.`,
        value: Number(outlierRatio.toFixed(4)),
      });
      suggestions.push({
        id: `${column.name}:outlier-suggestion`,
        column: column.name,
        priority: outlierRatio >= 0.12 ? "high" : "medium",
        message: `Inspect ${column.name} for winsorization, trimming, or data-entry anomalies.`,
      });
    }

    return clampScore(100 - nullPenalty - uniquenessPenalty - consistencyPenalty);
  });

  const overallScore =
    perColumnScores.length > 0
      ? clampScore(perColumnScores.reduce((total, value) => total + value, 0) / perColumnScores.length)
      : 0;

  const orderedIssues = issues.sort((left, right) => {
    const severityRank = { high: 0, medium: 1, low: 2 } as const;
    return severityRank[left.severity] - severityRank[right.severity] || right.value - left.value;
  });

  return {
    score: overallScore,
    issues: orderedIssues.slice(0, 12),
    suggestions: dedupeSuggestions(suggestions).slice(0, 10),
    refreshedAt: Date.now(),
  };
}

export function useDataHealth(tableName: string, columns: ColumnProfile[]): DataHealth {
  const signature = useMemo(() => buildSignature(tableName, columns), [columns, tableName]);
  const cached = useMemo(() => readCachedHealth(signature), [signature]);
  const [health, setHealth] = useState<ComputedHealth>(() => cached ?? {
    score: 0,
    issues: [],
    suggestions: [],
    refreshedAt: 0,
  });
  const [loading, setLoading] = useState<boolean>(() => !cached && Boolean(tableName) && columns.length > 0);

  const refresh = useEffectEvent(async () => {
    if (!tableName || columns.length === 0) {
      setHealth({
        score: 0,
        issues: [],
        suggestions: [],
        refreshedAt: Date.now(),
      });
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const nextHealth = await computeHealth(tableName, columns);
      writeCachedHealth(signature, nextHealth);
      setHealth(nextHealth);
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void refresh();

    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }, 30_000);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [signature]);

  return useMemo(
    () => ({
      ...EMPTY_HEALTH,
      ...health,
      loading,
    }),
    [health, loading],
  );
}
