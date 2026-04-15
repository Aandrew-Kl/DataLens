"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { runQuery } from "@/lib/duckdb/client";
import { useDatasetStore } from "@/stores/dataset-store";
import type { DatasetMeta } from "@/types/dataset";

export interface TableMetadata {
  tableName: string;
  columnCount: number;
  rowCountEstimate: number;
  datasetMeta: DatasetMeta | null;
  refreshedAt: number;
}

export type TableMetadataResult = TableMetadata[] & {
  loading: boolean;
  refreshedAt: number;
  error: string | null;
};

interface TableMetadataState {
  tables: TableMetadata[];
  loading: boolean;
  refreshedAt: number;
  error: string | null;
}

const EMPTY_STATE: TableMetadataState = {
  tables: [],
  loading: false,
  refreshedAt: 0,
  error: null,
};
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

async function queryTableMetadata(datasets: DatasetMeta[]): Promise<TableMetadata[]> {
  const datasetByName = new Map(datasets.map((dataset) => [dataset.name, dataset]));
  const rows = await runQuery(`
    SELECT
      tables.table_name,
      COUNT(columns.column_name) AS column_count
    FROM information_schema.tables AS tables
    LEFT JOIN information_schema.columns AS columns
      ON tables.table_schema = columns.table_schema
      AND tables.table_name = columns.table_name
    WHERE tables.table_schema = current_schema()
      AND tables.table_type = 'BASE TABLE'
    GROUP BY tables.table_name
    ORDER BY tables.table_name
  `);

  const timestamp = Date.now();
  const tableMetadata = await Promise.all(
    rows.map(async (row) => {
      const tableName = String(row.table_name ?? "");
      const datasetMeta = datasetByName.get(tableName) ?? null;
      const countRows = datasetMeta
        ? [{ row_count: datasetMeta.rowCount }]
        : await runQuery(
            `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tableName)}`,
          );

      return {
        tableName,
        columnCount: toNumber(row.column_count),
        rowCountEstimate: toNumber(countRows[0]?.row_count),
        datasetMeta,
        refreshedAt: timestamp,
      } satisfies TableMetadata;
    }),
  );

  return tableMetadata;
}

export function useTableMetadata(): TableMetadataResult {
  const datasets = useDatasetStore((state) => state.datasets);
  const [state, setState] = useState<TableMetadataState>({
    ...EMPTY_STATE,
    loading: true,
  });
  const datasetSignature = useMemo(
    () =>
      JSON.stringify(
        datasets.map((dataset) => ({
          id: dataset.id,
          name: dataset.name,
          rowCount: dataset.rowCount,
          columnCount: dataset.columnCount,
          uploadedAt: dataset.uploadedAt,
        })),
      ),
    [datasets],
  );

  const refresh = useEffectEvent(async () => {
    setState((current) => ({
      ...current,
      loading: true,
      error: null,
    }));

    try {
      const tables = await queryTableMetadata(datasets);
      setState({
        tables,
        loading: false,
        refreshedAt: Date.now(),
        error: null,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        refreshedAt: Date.now(),
        error:
          error instanceof Error
            ? error.message
            : "Failed to load DuckDB table metadata.",
      }));
    }
  });

  useEffect(() => {
    void refresh();

    const intervalId = window.setInterval(() => {
      void refresh();
    }, 30_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [datasetSignature]);

  return useMemo(
    () =>
      Object.assign([...state.tables], {
        loading: state.loading,
        refreshedAt: state.refreshedAt,
        error: state.error,
      }) as TableMetadataResult,
    [state.error, state.loading, state.refreshedAt, state.tables],
  );
}
