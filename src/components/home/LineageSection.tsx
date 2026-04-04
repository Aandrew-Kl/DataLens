"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

import type { ColumnProfile, DatasetMeta } from "@/types/dataset";
import DataLineageGraph from "@/components/data/data-lineage-graph";
import DataNarrator from "@/components/data/data-narrator";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import { AnimatedWorkspaceSection } from "@/components/home/workspace-shared";

const DataLineageView = dynamic(
  () => import("@/components/data/data-lineage-view"),
  { ssr: false },
);
const SchemaEvolution = dynamic(
  () => import("@/components/data/schema-evolution"),
  { ssr: false },
);
const DataSnapshotManager = dynamic(
  () => import("@/components/data/data-snapshot-manager"),
  { ssr: false },
);

interface LineageSectionProps {
  activeDataset: DatasetMeta;
  tableName: string;
  columns: ColumnProfile[];
}

export default function LineageSection({
  activeDataset,
  tableName,
  columns,
}: LineageSectionProps) {
  const [showMoreLineage, setShowMoreLineage] = useState(false);

  return (
    <AnimatedWorkspaceSection>
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
          Data Lineage
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Trace transformations and generate narrative context for the active
          dataset.
        </p>
      </div>

      <ErrorBoundary>
        <DataLineageGraph tableName={tableName} />
      </ErrorBoundary>
      <ErrorBoundary>
        <DataNarrator
          tableName={tableName}
          columns={columns}
          rowCount={activeDataset.rowCount}
        />
      </ErrorBoundary>

      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowMoreLineage((current) => !current)}
          className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-sky-600 dark:text-slate-200"
        >
          {showMoreLineage ? "▾" : "▸"} More Lineage Tools (3 available)
        </button>
        {showMoreLineage && (
          <div className="mt-4 grid gap-6">
            <ErrorBoundary>
              <DataLineageView tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <SchemaEvolution tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <DataSnapshotManager tableName={tableName} columns={columns} />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </AnimatedWorkspaceSection>
  );
}
