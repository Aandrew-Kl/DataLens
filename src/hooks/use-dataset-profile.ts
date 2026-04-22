"use client";

import { useMemo } from "react";
import { quoteIdentifier } from "@/lib/utils/sql";
import { useQuery } from "@/hooks/use-query";

export interface DatasetProfileColumn {
  name: string;
  type: string;
}

export interface DatasetProfileResult {
  columns: DatasetProfileColumn[];
  rowCount: number;
  nullCounts: Record<string, number>;
  typeDistribution: Record<string, number>;
  loading: boolean;
  error: string | null;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function buildNullAnalysisSql(
  tableName: string | null,
  columns: DatasetProfileColumn[],
): string | null {
  if (!tableName || columns.length === 0) {
    return null;
  }

  const nullSelects = columns.map(
    (column) =>
      `COUNT(*) FILTER (WHERE ${quoteIdentifier(column.name)} IS NULL) AS ${quoteIdentifier(column.name)}`,
  );

  return `SELECT ${nullSelects.join(", ")} FROM ${quoteIdentifier(tableName)}`;
}

export function useDatasetProfile(tableName: string | null): DatasetProfileResult {
  const safeTable = tableName ? quoteIdentifier(tableName) : null;
  const describeSql = safeTable ? `DESCRIBE ${safeTable}` : null;
  const rowCountSql = safeTable ? `SELECT COUNT(*) AS row_count FROM ${safeTable}` : null;

  const describeQuery = useQuery(describeSql);
  const rowCountQuery = useQuery(rowCountSql);

  const columns = useMemo<DatasetProfileColumn[]>(
    () =>
      (describeQuery.data ?? []).map((row) => ({
        name: String(row.column_name ?? row.name ?? ""),
        type: String(row.column_type ?? row.type ?? "UNKNOWN"),
      })).filter((column) => column.name.length > 0),
    [describeQuery.data],
  );

  const nullAnalysisSql = useMemo(
    () => buildNullAnalysisSql(tableName, columns),
    [columns, tableName],
  );
  const nullCountsQuery = useQuery(nullAnalysisSql);

  return useMemo(() => {
    const rowCount = toNumber(rowCountQuery.data?.[0]?.row_count);
    const nullRow = nullCountsQuery.data?.[0] ?? {};
    const nullCounts = columns.reduce<Record<string, number>>((acc, column) => {
      acc[column.name] = toNumber(nullRow[column.name]);
      return acc;
    }, {});
    const typeDistribution = columns.reduce<Record<string, number>>((acc, column) => {
      acc[column.type] = (acc[column.type] ?? 0) + 1;
      return acc;
    }, {});

    return {
      columns,
      rowCount,
      nullCounts,
      typeDistribution,
      loading:
        describeQuery.loading ||
        rowCountQuery.loading ||
        nullCountsQuery.loading,
      error: describeQuery.error ?? rowCountQuery.error ?? nullCountsQuery.error,
    };
  }, [
    columns,
    describeQuery.error,
    describeQuery.loading,
    nullCountsQuery.data,
    nullCountsQuery.error,
    nullCountsQuery.loading,
    rowCountQuery.data,
    rowCountQuery.error,
    rowCountQuery.loading,
  ]);
}
