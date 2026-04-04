"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

import type { ColumnProfile } from "@/types/dataset";
import DataQualityRules from "@/components/data/data-quality-rules";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import { AnimatedWorkspaceSection } from "@/components/home/workspace-shared";

const DataProfilerLite = dynamic(
  () => import("@/components/data/data-profiler-lite"),
  { ssr: false },
);
const DataImportPreview = dynamic(
  () => import("@/components/data/data-import-preview"),
  { ssr: false },
);
const DataExportWizard = dynamic(
  () => import("@/components/data/data-export-wizard"),
  { ssr: false },
);
const DataCatalogBrowser = dynamic(
  () => import("@/components/data/data-catalog-browser"),
  { ssr: false },
);
const DataPipelineBuilder = dynamic(
  () => import("@/components/data/data-pipeline-builder"),
  { ssr: false },
);
const DataBookmarkManager = dynamic(
  () => import("@/components/data/data-bookmark-manager"),
  { ssr: false },
);

interface QualitySectionProps {
  tableName: string;
  columns: ColumnProfile[];
}

export default function QualitySection({
  tableName,
  columns,
}: QualitySectionProps) {
  const [showMoreQuality, setShowMoreQuality] = useState(false);

  return (
    <AnimatedWorkspaceSection>
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
          Data Quality Rules
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Define reusable validation rules, quantify failures, and track dataset
          quality from a dedicated workspace.
        </p>
      </div>
      <ErrorBoundary>
        <DataQualityRules tableName={tableName} columns={columns} />
      </ErrorBoundary>
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowMoreQuality((current) => !current)}
          className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-sky-600 dark:text-slate-200"
        >
          {showMoreQuality ? "▾" : "▸"} More Quality Tools (6 available)
        </button>
        {showMoreQuality && (
          <div className="mt-4 grid gap-6">
            <ErrorBoundary>
              <DataProfilerLite tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <DataImportPreview tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <DataExportWizard tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <DataCatalogBrowser tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <DataPipelineBuilder tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <DataBookmarkManager tableName={tableName} columns={columns} />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </AnimatedWorkspaceSection>
  );
}
