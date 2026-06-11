"use client";

import { useMemo } from "react";
import { formatNumber, sanitizeTableName } from "@/lib/utils/formatters";
import DataProfiler from "@/components/data/data-profiler";
import ColumnStats from "@/components/data/column-stats";
import CorrelationMatrix from "@/components/data/correlation-matrix";
import { useDatasetStore } from "@/stores/dataset-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

export default function ProfilePage() {
  const activeDataset = useDatasetStore((s) => s.getActiveDataset());
  const profileData = useWorkspaceStore((s) => s.profileData);
  const previewRows = useWorkspaceStore((s) => s.previewRows);
  const selectedAdvancedColumn = useWorkspaceStore((s) => s.selectedAdvancedColumn);
  const setSelectedAdvancedColumn = useWorkspaceStore(
    (s) => s.setSelectedAdvancedColumn,
  );

  const tableName = activeDataset
    ? sanitizeTableName(activeDataset.fileName)
    : "";
  const rowCount = activeDataset?.rowCount ?? previewRows.length;
  const hasNumericColumns = useMemo(
    () => profileData.some((column) => column.type === "number"),
    [profileData],
  );
  const selectedColumn = useMemo(() => {
    if (!selectedAdvancedColumn) {
      return null;
    }

    return (
      profileData.find((column) => column.name === selectedAdvancedColumn.name) ??
      selectedAdvancedColumn
    );
  }, [selectedAdvancedColumn, profileData]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/30 bg-white p-6 dark:border-white/10 dark:bg-slate-900">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Data Profile</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {activeDataset
            ? `${activeDataset.fileName} • ${formatNumber(rowCount)} rows`
            : "Select a dataset from the sidebar to view profiling results."}
        </p>
      </section>

      <section className="rounded-2xl border border-white/30 bg-white p-4 dark:border-white/10 dark:bg-slate-900">
        <DataProfiler
          columns={profileData}
          rowCount={rowCount}
          onColumnClick={setSelectedAdvancedColumn}
        />
      </section>

      {selectedColumn && activeDataset ? (
        <section className="rounded-2xl border border-white/30 bg-white p-4 dark:border-white/10 dark:bg-slate-900">
          <ColumnStats
            tableName={tableName}
            column={selectedColumn}
            rowCount={rowCount}
          />
        </section>
      ) : null}

      {activeDataset && hasNumericColumns ? (
        <section className="rounded-2xl border border-white/30 bg-white p-4 dark:border-white/10 dark:bg-slate-900">
          <CorrelationMatrix tableName={tableName} columns={profileData} />
        </section>
      ) : null}
    </div>
  );
}
