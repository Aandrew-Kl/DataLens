"use client";

import { useMemo } from "react";
import { AlertTriangle, Table2, Rows3 } from "lucide-react";
import { GLASS_PANEL_CLASS } from "@/lib/utils/advanced-analytics";
import { sanitizeTableName } from "@/lib/utils/formatters";
import DataPreview from "@/components/data/data-preview";
import { useDatasetStore } from "@/stores/dataset-store";

const EMPTY_PREVIEW_ROWS: Array<Record<string, unknown>> = [];

export default function ExplorePage() {
  const activeDataset = useDatasetStore((state) => state.getActiveDataset());
  const tableName = useMemo(
    () => (activeDataset ? sanitizeTableName(activeDataset.fileName) : ""),
    [activeDataset],
  );

  return (
    <div className="space-y-5">
      <section className={`${GLASS_PANEL_CLASS} space-y-4 p-5 md:p-6`}>
        <div className="flex flex-col gap-2">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
            Explore
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Browse the active dataset with searchable, filterable, sortable,
            paginated rows and in-table column type indicators.
          </p>
        </div>

        {activeDataset ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/70 px-3 py-1.5 dark:bg-slate-950/50">
              <Table2 className="h-3.5 w-3.5" />
              {activeDataset.fileName}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/70 px-3 py-1.5 dark:bg-slate-950/50">
              <Rows3 className="h-3.5 w-3.5" />
              {activeDataset.rowCount.toLocaleString()} rows
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/70 px-3 py-1.5 dark:bg-slate-950/50">
              <AlertTriangle className="h-3.5 w-3.5" />
              {activeDataset.columnCount} columns
            </span>
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Select a dataset from the workspace sidebar to load an explorable
            table.
          </p>
        )}
      </section>

      <section className="rounded-3xl border border-white/15 bg-white/60 p-3 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45 md:p-5">
        {activeDataset ? (
          activeDataset.columns.length > 0 ? (
            <DataPreview
              tableName={tableName}
              columns={activeDataset.columns}
              previewRows={EMPTY_PREVIEW_ROWS}
            />
          ) : (
            <div className="rounded-2xl border border-white/20 bg-white/55 p-4 text-sm text-slate-600 dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-300">
              This dataset has no columns to display.
            </div>
          )
        ) : null}
      </section>
    </div>
  );
}
