import { useCallback } from "react";

import type { AppTab, FileDropResult } from "@/components/home/types";
import { getTableRowCount, loadCSVIntoDB, runQuery } from "@/lib/duckdb/client";
import { profileTable } from "@/lib/duckdb/profiler";
import {
  formatNumber,
  generateId,
  sanitizeTableName,
} from "@/lib/utils/formatters";
import { useDatasetStore } from "@/stores/dataset-store";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";

import type { AddNotificationFn } from "./use-notifications-adapter";

interface DatasetActionsInput {
  addNotification: AddNotificationFn;
  activeDataset: DatasetMeta | undefined;
  tableName: string;
  setActiveTab: (tab: AppTab) => void;
  setIsLoading: (loading: boolean) => void;
  setLoadError: (error: string | null) => void;
  setShowUploader: (open: boolean) => void;
}

export function useDatasetActions({
  addNotification,
  activeDataset,
  tableName,
  setActiveTab,
  setIsLoading,
  setLoadError,
  setShowUploader,
}: DatasetActionsInput) {
  const { addDataset } = useDatasetStore();
  const datasets = useDatasetStore((state) => state.datasets);

  const handleFileLoaded = useCallback(
    async (result: FileDropResult) => {
      setIsLoading(true);
      setLoadError(null);
      setShowUploader(false);

      try {
        const nextTableName = sanitizeTableName(result.fileName);
        await loadCSVIntoDB(nextTableName, result.csvContent);

        const columns = await profileTable(nextTableName);
        const rowCount = await getTableRowCount(nextTableName);

        const meta: DatasetMeta = {
          id: generateId(),
          name: nextTableName,
          fileName: result.fileName,
          rowCount,
          columnCount: columns.length,
          columns,
          uploadedAt: Date.now(),
          sizeBytes: result.sizeBytes,
        };

        addDataset(meta);
        setActiveTab("profile");
        addNotification({
          type: "success",
          title: "Dataset loaded",
          message: `${result.fileName} is ready with ${formatNumber(
            rowCount,
          )} rows and ${columns.length} columns.`,
        });

        try {
          const recent = JSON.parse(
            localStorage.getItem("datalens-recent") || "[]",
          ) as Array<{
            fileName: string;
            tableName: string;
            rowCount: number;
            uploadedAt: number;
          }>;

          recent.unshift({
            fileName: result.fileName,
            tableName: nextTableName,
            rowCount,
            uploadedAt: Date.now(),
          });

          localStorage.setItem(
            "datalens-recent",
            JSON.stringify(recent.slice(0, 10)),
          );
        } catch {
          // localStorage failures are non-critical
        }
      } catch (error) {
        console.error("Failed to load dataset:", error);
        const message =
          error instanceof Error ? error.message : "Failed to load dataset";
        setLoadError(message);
        addNotification({
          type: "error",
          title: "Dataset load failed",
          message,
        });
      } finally {
        setIsLoading(false);
      }
    },
    [
      addDataset,
      addNotification,
      setActiveTab,
      setIsLoading,
      setLoadError,
      setShowUploader,
    ],
  );

  const refreshActiveDataset = useCallback(
    async (title = "Dataset refreshed", message?: string) => {
      if (!activeDataset) {
        return;
      }

      try {
        const datasetId = activeDataset.id;
        const [columns, rowCount] = await Promise.all([
          profileTable(tableName),
          getTableRowCount(tableName),
        ]);

        useDatasetStore.setState((state) => ({
          datasets: state.datasets.map((dataset) =>
            dataset.id === datasetId
              ? {
                  ...dataset,
                  rowCount,
                  columnCount: columns.length,
                  columns,
                }
              : dataset,
          ),
        }));

        addNotification({
          type: "success",
          title,
          message:
            message ??
            `${tableName} now has ${formatNumber(rowCount)} rows and ${
              columns.length
            } columns.`,
        });
      } catch (error) {
        addNotification({
          type: "error",
          title: "Refresh failed",
          message:
            error instanceof Error
              ? error.message
              : "Unable to refresh the dataset metadata.",
        });
      }
    },
    [activeDataset, addNotification, tableName],
  );

  const registerDerivedDataset = useCallback(
    async ({
      tableName: nextTableName,
      columns,
      fileName = nextTableName,
      nextTab = "profile",
      notificationTitle,
      notificationMessage,
      sizeBytes,
    }: {
      tableName: string;
      columns?: ColumnProfile[];
      fileName?: string;
      nextTab?: AppTab;
      notificationTitle: string;
      notificationMessage?: string;
      sizeBytes?: number;
    }) => {
      try {
        const [resolvedColumns, rowCount] = await Promise.all([
          columns ? Promise.resolve(columns) : profileTable(nextTableName),
          getTableRowCount(nextTableName),
        ]);

        const existingDataset = datasets.find(
          (dataset) => sanitizeTableName(dataset.fileName) === nextTableName,
        );
        const nextMeta: DatasetMeta = {
          id: existingDataset?.id ?? generateId(),
          name: nextTableName,
          fileName,
          rowCount,
          columnCount: resolvedColumns.length,
          columns: resolvedColumns,
          uploadedAt: existingDataset?.uploadedAt ?? Date.now(),
          sizeBytes: sizeBytes ?? existingDataset?.sizeBytes ?? 0,
        };

        if (existingDataset) {
          useDatasetStore.setState((state) => ({
            datasets: state.datasets.map((dataset) =>
              dataset.id === existingDataset.id ? nextMeta : dataset,
            ),
            activeDatasetId: existingDataset.id,
          }));
        } else {
          addDataset(nextMeta);
        }

        setActiveTab(nextTab);
        addNotification({
          type: "success",
          title: notificationTitle,
          message:
            notificationMessage ??
            `${fileName} is ready with ${formatNumber(rowCount)} rows and ${
              resolvedColumns.length
            } columns.`,
        });
      } catch (error) {
        addNotification({
          type: "error",
          title: "Dataset registration failed",
          message:
            error instanceof Error
              ? error.message
              : "Unable to register the imported dataset.",
        });
      }
    },
    [addDataset, addNotification, datasets, setActiveTab],
  );

  const handleFormulaSave = useCallback(
    async (name: string, expression: string) => {
      const stamp = Date.now();
      const escapedTableName = tableName.replace(/"/g, '""');
      const sourceSql = `"${escapedTableName}"`;
      const tempSql = `"${escapedTableName}__formula_${stamp}"`;
      const backupSql = `"${escapedTableName}__formula_backup_${stamp}"`;
      const aliasSql = `"${name.replace(/"/g, '""')}"`;

      try {
        await runQuery(`DROP TABLE IF EXISTS ${tempSql}`);
        await runQuery(`DROP TABLE IF EXISTS ${backupSql}`);
        await runQuery(
          `CREATE TABLE ${tempSql} AS SELECT *, ${expression} AS ${aliasSql} FROM ${sourceSql}`,
        );
        await runQuery(`ALTER TABLE ${sourceSql} RENAME TO ${backupSql}`);

        try {
          await runQuery(`ALTER TABLE ${tempSql} RENAME TO ${sourceSql}`);
          await runQuery(`DROP TABLE ${backupSql}`);
        } catch (swapError) {
          await runQuery(`ALTER TABLE ${backupSql} RENAME TO ${sourceSql}`).catch(
            () => undefined,
          );
          await runQuery(`DROP TABLE IF EXISTS ${tempSql}`).catch(
            () => undefined,
          );
          throw swapError;
        }

        await refreshActiveDataset(
          "Computed column added",
          `${name} was added to ${tableName}.`,
        );
      } catch (error) {
        addNotification({
          type: "error",
          title: "Computed column failed",
          message:
            error instanceof Error
              ? error.message
              : "Unable to save the computed column.",
        });
      }
    },
    [addNotification, refreshActiveDataset, tableName],
  );

  return {
    handleFileLoaded,
    refreshActiveDataset,
    registerDerivedDataset,
    handleFormulaSave,
  };
}
