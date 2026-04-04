"use client";
import type { ColumnProfile } from "@/types/dataset";
import DataCatalog from "@/components/data/data-catalog";
import DataConnector from "@/components/data/data-connector";
import MergeDatasets from "@/components/data/merge-datasets";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import {
  AnimatedWorkspaceSection,
  ToolSection,
} from "@/components/home/workspace-shared";

interface ConnectorsSectionProps {
  onConnectorDataLoaded: (result: {
    tableName: string;
    columns: ColumnProfile[];
  }) => void;
  onRegisterMergedDataset: (nextTableName: string) => void;
}

export default function ConnectorsSection({
  onConnectorDataLoaded,
  onRegisterMergedDataset,
}: ConnectorsSectionProps) {
  return (
    <AnimatedWorkspaceSection>
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
          Data Connectors
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Import additional datasets from files, URLs, pasted content, and
          curated samples without leaving the active workspace.
        </p>
      </div>

      <ToolSection
        title="Connector Workspace"
        description="Bring in CSV, JSON, parquet, remote, and sample sources as new DataLens datasets."
      >
        <ErrorBoundary>
          <DataConnector onDataLoaded={onConnectorDataLoaded} />
        </ErrorBoundary>
      </ToolSection>

      <ToolSection
        title="Merge Datasets"
        description="Append, union, or join multiple loaded sources into a new dataset without leaving the import workspace."
      >
        <ErrorBoundary>
          <MergeDatasets
            onMergeComplete={onRegisterMergedDataset}
          />
        </ErrorBoundary>
      </ToolSection>

      <ToolSection
        title="Catalog"
        description="Inspect every loaded DuckDB relation, browse schema details, and manage table-level metadata from one place."
      >
        <ErrorBoundary>
          <DataCatalog />
        </ErrorBoundary>
      </ToolSection>
    </AnimatedWorkspaceSection>
  );
}
