"use client";

import type { ColumnProfile, DatasetMeta } from "@/types/dataset";
import DataComparison from "@/components/data/data-comparison";
import DataComparisonAdvanced from "@/components/data/data-comparison-advanced";
import DataDiff from "@/components/data/data-diff";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import {
  AnimatedWorkspaceSection,
  ToolSection,
} from "@/components/home/workspace-shared";

interface CompareSectionProps {
  datasets: DatasetMeta[];
  tableName: string;
  columns: ColumnProfile[];
}

export default function CompareSection({
  datasets,
  tableName,
  columns,
}: CompareSectionProps) {
  return (
    <AnimatedWorkspaceSection className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
          Dataset Comparison
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Compare loaded datasets side by side for schema, quality, and
          distribution differences.
        </p>
      </div>
      {datasets.length < 2 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          Load at least one more dataset for the most useful comparisons. Until
          then, you can still inspect the current dataset against itself.
        </div>
      )}
      <ErrorBoundary>
        <DataComparison datasets={datasets} />
      </ErrorBoundary>
      <ErrorBoundary>
        <DataComparisonAdvanced
          datasets={datasets.map((dataset) => ({
            tableName: dataset.name,
            columns: dataset.columns,
            rowCount: dataset.rowCount,
          }))}
        />
      </ErrorBoundary>
      <ToolSection
        title="Snapshot Diff"
        description="Compare the active table against snapshots or sibling relations to surface added, removed, and modified rows."
      >
        <ErrorBoundary>
          <DataDiff tableName={tableName} columns={columns} />
        </ErrorBoundary>
      </ToolSection>
    </AnimatedWorkspaceSection>
  );
}
