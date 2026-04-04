"use client";

import dynamic from "next/dynamic";

import type { ColumnProfile, DatasetMeta } from "@/types/dataset";
import DataNarrator from "@/components/data/data-narrator";
import DataStory from "@/components/data/data-story";
import DataSummarizer from "@/components/data/data-summarizer";
import ReportBuilder from "@/components/report/report-builder";
import ReportHistory from "@/components/report/report-history";
import ReportScheduler from "@/components/report/report-scheduler";
import ReportTemplates from "@/components/report/report-templates";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import {
  AnimatedWorkspaceSection,
  ToolSection,
} from "@/components/home/workspace-shared";

const ReportAnnotations = dynamic(
  () => import("@/components/report/report-annotations"),
  { ssr: false },
);
const ReportChartInserter = dynamic(
  () => import("@/components/report/report-chart-inserter"),
  { ssr: false },
);
const ReportDesigner = dynamic(
  () => import("@/components/report/report-designer"),
  { ssr: false },
);
const ReportExportPanel = dynamic(
  () => import("@/components/report/report-export-panel"),
  { ssr: false },
);
const ReportNarrativeBuilder = dynamic(
  () => import("@/components/report/report-narrative-builder"),
  { ssr: false },
);

interface ReportsSectionProps {
  activeDataset: DatasetMeta;
  tableName: string;
  columns: ColumnProfile[];
}

export default function ReportsSection({
  activeDataset,
  tableName,
  columns,
}: ReportsSectionProps) {
  return (
    <AnimatedWorkspaceSection>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
              Reports
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Assemble narrative summaries, chart-backed stories, and reusable
              report outputs for the active dataset.
            </p>
          </div>
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-400 transition-colors disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
          >
            Generate Full Report
          </button>
        </div>

        <ErrorBoundary>
          <ReportBuilder dataset={activeDataset} columns={columns} />
        </ErrorBoundary>
        <ErrorBoundary>
          <ReportTemplates />
        </ErrorBoundary>
        <ErrorBoundary>
          <ReportHistory />
        </ErrorBoundary>
        <ErrorBoundary>
          <ReportScheduler />
        </ErrorBoundary>

        <ToolSection
          title="Dataset Summarizer"
          description="Generate concise written summaries, key findings, and recommendation exports for the current table in one pass."
        >
          <ErrorBoundary>
            <DataSummarizer
              tableName={tableName}
              columns={columns}
              rowCount={activeDataset.rowCount}
            />
          </ErrorBoundary>
        </ToolSection>

        <ToolSection
          title="Narrative Report"
          description="Turn statistical readouts into a richer narrative with chart-backed sections covering distributions, correlations, and recommendations."
        >
          <ErrorBoundary>
            <DataNarrator
              tableName={tableName}
              columns={columns}
              rowCount={activeDataset.rowCount}
            />
          </ErrorBoundary>
        </ToolSection>

        <ErrorBoundary>
          <DataStory
            tableName={tableName}
            columns={columns}
            rowCount={activeDataset.rowCount}
          />
        </ErrorBoundary>

        <details className="group mt-6 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
          <summary className="cursor-pointer list-none">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Report Tools
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Annotate, design, insert charts, export, and build narratives
                  for polished reports.
                </p>
              </div>
              <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                Expand
              </span>
            </div>
          </summary>
          <div className="mt-4 space-y-6">
            <ErrorBoundary>
              <ReportAnnotations tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <ReportChartInserter tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <ReportDesigner tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <ReportExportPanel tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <ReportNarrativeBuilder tableName={tableName} columns={columns} />
            </ErrorBoundary>
          </div>
        </details>
      </div>
    </AnimatedWorkspaceSection>
  );
}
