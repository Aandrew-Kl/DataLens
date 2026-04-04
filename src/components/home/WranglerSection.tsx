"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";

import type { ColumnProfile, DatasetMeta } from "@/types/dataset";
import DataPreview from "@/components/data/data-preview";
import DataSummarizer from "@/components/data/data-summarizer";
import DataWrangler from "@/components/data/data-wrangler";
import PivotConfigurator from "@/components/data/pivot-configurator";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import { AnimatedWorkspaceSection } from "@/components/home/workspace-shared";

const RowEditor = dynamic(() => import("@/components/data/row-editor"), {
  ssr: false,
});
const RowSamplerAdvanced = dynamic(
  () => import("@/components/data/row-sampler-advanced"),
  { ssr: false },
);
const DataSamplerStratified = dynamic(
  () => import("@/components/data/data-sampler-stratified"),
  { ssr: false },
);
const DataRecipeBuilder = dynamic(
  () => import("@/components/data/data-recipe-builder"),
  { ssr: false },
);
const TextMiningTool = dynamic(
  () => import("@/components/data/text-mining-tool"),
  { ssr: false },
);
const DataEnrichTool = dynamic(
  () => import("@/components/data/data-enrich-tool"),
  { ssr: false },
);
const DataMergeTool = dynamic(
  () => import("@/components/data/data-merge-tool"),
  { ssr: false },
);

interface WranglerSectionProps {
  activeDataset: DatasetMeta;
  tableName: string;
  columns: ColumnProfile[];
  onRefreshDataset: (title?: string, message?: string) => Promise<void> | void;
}

export default function WranglerSection({
  activeDataset,
  tableName,
  columns,
  onRefreshDataset,
}: WranglerSectionProps) {
  const [showMoreWrangler, setShowMoreWrangler] = useState(false);

  return (
    <AnimatedWorkspaceSection>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
            Data Wrangler
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Reshape, summarize, preview, and configure pivots for the active
            dataset from one focused workspace.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            void onRefreshDataset(
              "Wrangler metadata refreshed",
              `Re-profiled ${tableName} after wrangling changes.`,
            )
          }
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh Metadata
        </button>
      </div>

      <ErrorBoundary>
        <DataWrangler tableName={tableName} columns={columns} />
      </ErrorBoundary>
      <ErrorBoundary>
        <DataSummarizer
          tableName={tableName}
          columns={columns}
          rowCount={activeDataset.rowCount}
        />
      </ErrorBoundary>
      <ErrorBoundary>
        <DataPreview tableName={tableName} columns={columns} previewRows={[]} />
      </ErrorBoundary>
      <ErrorBoundary>
        <PivotConfigurator tableName={tableName} columns={columns} />
      </ErrorBoundary>

      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowMoreWrangler((current) => !current)}
          className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-sky-600 dark:text-slate-200"
        >
          {showMoreWrangler ? "▾" : "▸"} More Wrangler Tools (7 available)
        </button>
        {showMoreWrangler && (
          <div className="mt-4 grid gap-6">
            <ErrorBoundary>
              <RowEditor tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <RowSamplerAdvanced tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <DataSamplerStratified tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <DataRecipeBuilder tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <TextMiningTool tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <DataEnrichTool tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <DataMergeTool tableName={tableName} columns={columns} />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </AnimatedWorkspaceSection>
  );
}
