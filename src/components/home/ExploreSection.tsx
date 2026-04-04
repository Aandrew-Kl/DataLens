"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

import type { ColumnProfile } from "@/types/dataset";
import AnomalyHeatmap from "@/components/data/anomaly-heatmap";
import ColumnCorrelator from "@/components/data/column-correlator";
import CorrelationFinder from "@/components/data/correlation-finder";
import RelationshipExplorer from "@/components/data/relationship-explorer";
import ScatterMatrix from "@/components/charts/scatter-matrix";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import {
  AnimatedWorkspaceSection,
  ToolSection,
} from "@/components/home/workspace-shared";

const ColumnHistogram = dynamic(
  () => import("@/components/data/column-histogram"),
  { ssr: false },
);
const ColumnStatistics = dynamic(
  () => import("@/components/data/column-statistics"),
  { ssr: false },
);
const ColumnDependencyGraph = dynamic(
  () => import("@/components/data/column-dependency-graph"),
  { ssr: false },
);
const ColumnProfiler = dynamic(
  () => import("@/components/data/column-profiler"),
  { ssr: false },
);
const CorrelationExplorer = dynamic(
  () => import("@/components/data/correlation-explorer"),
  { ssr: false },
);
const ValueFrequency = dynamic(
  () => import("@/components/data/value-frequency"),
  { ssr: false },
);
const NumericSummary = dynamic(
  () => import("@/components/data/numeric-summary"),
  { ssr: false },
);
const StringAnalyzer = dynamic(
  () => import("@/components/data/string-analyzer"),
  { ssr: false },
);
const DateAnalyzer = dynamic(() => import("@/components/data/date-analyzer"), {
  ssr: false,
});
const DataTypeOverview = dynamic(
  () => import("@/components/data/data-type-overview"),
  { ssr: false },
);
const NullPatternAnalyzer = dynamic(
  () => import("@/components/data/null-pattern-analyzer"),
  { ssr: false },
);
const OutlierExplorer = dynamic(
  () => import("@/components/data/outlier-explorer"),
  { ssr: false },
);
const DataQualityScore = dynamic(
  () => import("@/components/data/data-quality-score"),
  { ssr: false },
);

interface ExploreSectionProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

export default function ExploreSection({
  tableName,
  columns,
  rowCount,
}: ExploreSectionProps) {
  const [showMoreExplore, setShowMoreExplore] = useState(false);

  return (
    <AnimatedWorkspaceSection>
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
          Explore Relationships
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          A curated set of tools for finding structure, patterns, anomalies, and
          multivariate relationships in your data.
        </p>
      </div>

      <ToolSection
        title="Relationship Explorer"
        description="Inspect column pairings and structural links to understand how fields move together."
      >
        <ErrorBoundary>
          <RelationshipExplorer
            tableName={tableName}
            columns={columns}
            rowCount={rowCount}
          />
        </ErrorBoundary>
      </ToolSection>

      <ToolSection
        title="Column Correlator"
        description="Surface high-signal numeric correlations and rank the strongest associations."
      >
        <ErrorBoundary>
          <ColumnCorrelator
            tableName={tableName}
            columns={columns}
            rowCount={rowCount}
          />
        </ErrorBoundary>
      </ToolSection>

      <ToolSection
        title="Correlation Finder"
        description="Drill into numeric pairings with ranked correlation scans, a matrix heatmap, and a scatter preview for the strongest relationships."
      >
        <ErrorBoundary>
          <CorrelationFinder tableName={tableName} columns={columns} />
        </ErrorBoundary>
      </ToolSection>

      <ToolSection
        title="Anomaly Heatmap"
        description="Scan the dataset for unusual combinations, sparse regions, and suspicious concentrations."
      >
        <ErrorBoundary>
          <AnomalyHeatmap tableName={tableName} columns={columns} />
        </ErrorBoundary>
      </ToolSection>

      <ToolSection
        title="Scatter Matrix"
        description="Compare multiple numeric dimensions at once to reveal clusters, trends, and outliers."
      >
        <ErrorBoundary>
          <ScatterMatrix tableName={tableName} columns={columns} />
        </ErrorBoundary>
      </ToolSection>

      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowMoreExplore((current) => !current)}
          className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-sky-600 dark:text-slate-200"
        >
          {showMoreExplore ? "▾" : "▸"} More Explore Tools (13 available)
        </button>
        {showMoreExplore && (
          <div className="mt-4 grid gap-6">
            <ErrorBoundary>
              <ColumnHistogram tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <ColumnStatistics tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <ColumnDependencyGraph tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <ColumnProfiler tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <CorrelationExplorer tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <ValueFrequency tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <NumericSummary tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <StringAnalyzer tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <DateAnalyzer tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <DataTypeOverview tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <NullPatternAnalyzer tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <OutlierExplorer tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <DataQualityScore tableName={tableName} columns={columns} />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </AnimatedWorkspaceSection>
  );
}
