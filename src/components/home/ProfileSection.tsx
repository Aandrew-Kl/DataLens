"use client";

import { useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";

import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";
import ColumnProfilerAdvanced from "@/components/data/column-profiler-advanced";
import DataAlerts from "@/components/data/data-alerts";
import DataOverview from "@/components/data/data-overview";
import DataProfiler from "@/components/data/data-profiler";
import DataProfilerAI from "@/components/data/data-profiler-ai";
import DataProfilerFull from "@/components/data/data-profiler-full";
import DataProfilerSummary from "@/components/data/data-profiler-summary";
import DataTour from "@/components/ui/data-tour";
import EmptyState from "@/components/ui/empty-state";
import SearchInput from "@/components/ui/search-input";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import DataTableSection from "@/components/home/DataTableSection";
import {
  AnimatedWorkspaceSection,
  ToolSection,
} from "@/components/home/workspace-shared";

interface ProfileSectionProps {
  activeDataset: DatasetMeta;
  tableName: string;
  columns: ColumnProfile[];
  completenessPct: number;
  onRefreshDataset: (title?: string, message?: string) => Promise<void> | void;
  onOpenExportWizard: () => void;
}

export default function ProfileSection({
  activeDataset,
  tableName,
  columns,
  completenessPct,
  onRefreshDataset,
  onOpenExportWizard,
}: ProfileSectionProps) {
  const [selectedAdvancedColumn, setSelectedAdvancedColumn] =
    useState<ColumnProfile | null>(null);
  const [columnSearch, setColumnSearch] = useState("");

  const columnSearchQuery = columnSearch.trim().toLowerCase();
  const matchingColumns = useMemo(
    () =>
      columns.filter((column) => {
        if (!columnSearchQuery) {
          return true;
        }

        const haystack = [
          column.name,
          column.type,
          ...column.sampleValues.map((value) => String(value ?? "")),
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(columnSearchQuery);
      }),
    [columnSearchQuery, columns],
  );

  return (
    <>
      <AnimatedWorkspaceSection>
        <ErrorBoundary>
          <DataAlerts
            tableName={tableName}
            columns={columns}
            rowCount={activeDataset.rowCount}
          />
        </ErrorBoundary>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
              Column Profiles
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Automated data profiling for {columns.length} columns across{" "}
              {formatNumber(activeDataset.rowCount)} rows
            </p>
          </div>
          <button
            onClick={() =>
              void onRefreshDataset(
                "Profile refreshed",
                `Re-profiled ${tableName}.`,
              )
            }
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh Metadata
          </button>
        </div>

        <ErrorBoundary>
          <DataOverview
            tableName={tableName}
            columns={columns}
            rowCount={activeDataset.rowCount}
          />
        </ErrorBoundary>

        <ErrorBoundary>
          <DataProfilerSummary
            tableName={tableName}
            columns={columns}
            rowCount={activeDataset.rowCount}
          />
        </ErrorBoundary>

        <ErrorBoundary>
          <DataProfilerAI
            tableName={tableName}
            columns={columns}
            rowCount={activeDataset.rowCount}
          />
        </ErrorBoundary>

        <ErrorBoundary>
          <DataProfiler
            columns={columns}
            rowCount={activeDataset.rowCount}
            onColumnClick={setSelectedAdvancedColumn}
          />
        </ErrorBoundary>

        <ToolSection
          title="Full Profile Report"
          description="Run a broader profiling pass with quality scoring, missingness heatmaps, and export-ready dataset diagnostics."
        >
          <ErrorBoundary>
            <DataProfilerFull
              tableName={tableName}
              columns={columns}
              rowCount={activeDataset.rowCount}
            />
          </ErrorBoundary>
        </ToolSection>

        <ToolSection
          title="Guided Data Tour"
          description="Walk through the dataset shape, strongest signals, missingness hotspots, and recommended next steps in a narrative-first tour."
        >
          <ErrorBoundary>
            <DataTour tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </ToolSection>

        <ToolSection
          title="Column Finder"
          description="Search the active schema by name, type, or sampled values, then jump straight into the detailed column drawer."
        >
          <ErrorBoundary>
            <div className="space-y-4 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
              <SearchInput
                value={columnSearch}
                onChange={setColumnSearch}
                placeholder="Search columns, types, or sampled values..."
                debounceMs={120}
              />
              {columnSearchQuery && matchingColumns.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="No matching columns"
                  description="Try a broader search or clear the current filter to browse the full schema."
                  action={{
                    label: "Clear Search",
                    onClick: () => setColumnSearch(""),
                  }}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(columnSearchQuery ? matchingColumns : columns.slice(0, 12)).map(
                    (column) => (
                      <button
                        key={column.name}
                        type="button"
                        onClick={() => setSelectedAdvancedColumn(column)}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <span>{column.name}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          {column.type}
                        </span>
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          </ErrorBoundary>
        </ToolSection>

        <DataTableSection
          tableName={tableName}
          columns={columns}
          fileName={activeDataset.fileName}
          rowCount={activeDataset.rowCount}
          sizeBytes={activeDataset.sizeBytes}
          completenessPct={completenessPct}
          onOpenExportWizard={onOpenExportWizard}
        />
      </AnimatedWorkspaceSection>

      {selectedAdvancedColumn && (
        <ColumnProfilerAdvanced
          tableName={tableName}
          column={selectedAdvancedColumn}
          rowCount={activeDataset.rowCount}
          onClose={() => setSelectedAdvancedColumn(null)}
        />
      )}
    </>
  );
}
