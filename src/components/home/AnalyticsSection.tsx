"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";

import type { ColumnProfile, DatasetMeta } from "@/types/dataset";
import AIInsights from "@/components/ai/ai-insights";
import AnomalyHeatmap from "@/components/data/anomaly-heatmap";
import CohortAnalysis from "@/components/data/cohort-analysis";
import ColumnDetail from "@/components/data/column-detail";
import ColumnCorrelator from "@/components/data/column-correlator";
import ColumnStats from "@/components/data/column-stats";
import CorrelationFinder from "@/components/data/correlation-finder";
import CorrelationMatrix from "@/components/data/correlation-matrix";
import Crosstab from "@/components/data/crosstab";
import DataLineage from "@/components/data/data-lineage";
import DataLineageGraph from "@/components/data/data-lineage-graph";
import DataQualityDashboard from "@/components/data/data-quality-dashboard";
import DataScheduler from "@/components/data/data-scheduler";
import DataStory from "@/components/data/data-story";
import DataSummary from "@/components/data/data-summary";
import DataValidator from "@/components/data/data-validator";
import DataVersioning from "@/components/data/data-versioning";
import FrequencyTable from "@/components/data/frequency-table";
import MissingDataMap from "@/components/data/missing-data-map";
import OutlierDetector from "@/components/data/outlier-detector";
import RelationshipExplorer from "@/components/data/relationship-explorer";
import StatisticalTests from "@/components/data/statistical-tests";
import TimeSeriesAnalyzer from "@/components/data/time-series-analyzer";
import TrendAnalyzer from "@/components/analytics/trend-analyzer";
import DataStoryteller from "@/components/analytics/data-storyteller";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import {
  AnimatedWorkspaceSection,
  ToolSection,
} from "@/components/home/workspace-shared";

const AbTestAnalyzer = dynamic(
  () => import("@/components/analytics/ab-test-analyzer"),
  { ssr: false },
);
const ChurnPredictor = dynamic(
  () => import("@/components/analytics/churn-predictor"),
  { ssr: false },
);
const CohortRetention = dynamic(
  () => import("@/components/analytics/cohort-retention"),
  { ssr: false },
);
const CustomerLifetimeValue = dynamic(
  () => import("@/components/analytics/customer-lifetime-value"),
  { ssr: false },
);
const EngagementMetrics = dynamic(
  () => import("@/components/analytics/engagement-metrics"),
  { ssr: false },
);
const FunnelAnalysis = dynamic(
  () => import("@/components/analytics/funnel-analysis"),
  { ssr: false },
);
const GeographicAnalysis = dynamic(
  () => import("@/components/analytics/geographic-analysis"),
  { ssr: false },
);
const MarketBasketAnalysis = dynamic(
  () => import("@/components/analytics/market-basket-analysis"),
  { ssr: false },
);
const RevenueAnalysis = dynamic(
  () => import("@/components/analytics/revenue-analysis"),
  { ssr: false },
);
const RfmAnalysis = dynamic(
  () => import("@/components/analytics/rfm-analysis"),
  { ssr: false },
);
const SeasonalDecomposition = dynamic(
  () => import("@/components/analytics/seasonal-decomposition"),
  { ssr: false },
);
const SentimentAnalyzer = dynamic(
  () => import("@/components/analytics/sentiment-analyzer"),
  { ssr: false },
);

interface AnalyticsSectionProps {
  activeDataset: DatasetMeta;
  tableName: string;
  columns: ColumnProfile[];
}

export default function AnalyticsSection({
  activeDataset,
  tableName,
  columns,
}: AnalyticsSectionProps) {
  const [analyticsColumnName, setAnalyticsColumnName] = useState("");
  const [showColumnDetail, setShowColumnDetail] = useState(false);
  const [showAdvancedAnalytics, setShowAdvancedAnalytics] = useState(false);

  const derivedColumnName = useMemo(() => {
    if (!columns.length) return "";
    if (columns.some((column) => column.name === analyticsColumnName)) {
      return analyticsColumnName;
    }
    return (
      columns.find((column) => column.type === "number")?.name ??
      columns[0]?.name ??
      ""
    );
  }, [analyticsColumnName, columns]);

  useEffect(() => {
    if (derivedColumnName !== analyticsColumnName) {
      setAnalyticsColumnName(derivedColumnName);
    }
  }, [derivedColumnName, analyticsColumnName]);

  const analyticsColumn = useMemo(
    () =>
      columns.find((column) => column.name === analyticsColumnName) ??
      columns.find((column) => column.type === "number") ??
      columns[0] ??
      null,
    [analyticsColumnName, columns],
  );

  return (
    <>
      <AnimatedWorkspaceSection>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
            Advanced Analytics
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Correlation analysis, outlier detection, and data quality assessment
          </p>
        </div>

        <div className="space-y-6">
          <ErrorBoundary>
            <DataSummary dataset={activeDataset} columns={columns} />
          </ErrorBoundary>
          <ErrorBoundary>
            <DataLineage tableName={tableName} />
          </ErrorBoundary>

          <ToolSection
            title="Lineage Graph"
            description="Trace uploads, joins, transforms, and query steps in a graph-oriented lineage view with exportable session history."
          >
            <ErrorBoundary>
              <DataLineageGraph tableName={tableName} />
            </ErrorBoundary>
          </ToolSection>

          <ErrorBoundary>
            <RelationshipExplorer
              tableName={tableName}
              columns={columns}
              rowCount={activeDataset.rowCount}
            />
          </ErrorBoundary>
          <ErrorBoundary>
            <ColumnCorrelator
              tableName={tableName}
              columns={columns}
              rowCount={activeDataset.rowCount}
            />
          </ErrorBoundary>
          <ErrorBoundary>
            <CorrelationFinder tableName={tableName} columns={columns} />
          </ErrorBoundary>
          <ErrorBoundary>
            <StatisticalTests
              tableName={tableName}
              columns={columns}
              rowCount={activeDataset.rowCount}
            />
          </ErrorBoundary>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <ErrorBoundary>
              <CorrelationMatrix tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <OutlierDetector tableName={tableName} columns={columns} />
            </ErrorBoundary>
          </div>

          <ErrorBoundary>
            <MissingDataMap
              tableName={tableName}
              columns={columns}
              rowCount={activeDataset.rowCount}
            />
          </ErrorBoundary>
          <ErrorBoundary>
            <AIInsights
              tableName={tableName}
              columns={columns}
              rowCount={activeDataset.rowCount}
            />
          </ErrorBoundary>

          {analyticsColumn && (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-800/80 dark:bg-slate-950/55 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Focused Column Statistics
                  </h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Drill into distribution, quality, and trend details for one
                    field.
                  </p>
                </div>
                <select
                  value={analyticsColumn.name}
                  onChange={(event) => setAnalyticsColumnName(event.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-cyan-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {columns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowColumnDetail(true)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Open detail drawer
                </button>
              </div>
              <ErrorBoundary>
                <ColumnStats
                  tableName={tableName}
                  column={analyticsColumn}
                  rowCount={activeDataset.rowCount}
                />
              </ErrorBoundary>
            </div>
          )}

          <ErrorBoundary>
            <Crosstab tableName={tableName} columns={columns} />
          </ErrorBoundary>
          <ErrorBoundary>
            <FrequencyTable tableName={tableName} columns={columns} />
          </ErrorBoundary>
          <ErrorBoundary>
            <TimeSeriesAnalyzer tableName={tableName} columns={columns} />
          </ErrorBoundary>
          <ErrorBoundary>
            <TrendAnalyzer tableName={tableName} columns={columns} />
          </ErrorBoundary>

          <ToolSection
            title="Cohort Analysis"
            description="Measure retention and repeat behavior by cohort over time using weekly or monthly buckets and heatmap-driven summaries."
          >
            <ErrorBoundary>
              <CohortAnalysis tableName={tableName} columns={columns} />
            </ErrorBoundary>
          </ToolSection>

          <ErrorBoundary>
            <DataValidator tableName={tableName} columns={columns} />
          </ErrorBoundary>
          <ErrorBoundary>
            <AnomalyHeatmap tableName={tableName} columns={columns} />
          </ErrorBoundary>
          <ErrorBoundary>
            <DataQualityDashboard tableName={tableName} columns={columns} />
          </ErrorBoundary>
          <ErrorBoundary>
            <DataStory
              tableName={tableName}
              columns={columns}
              rowCount={activeDataset.rowCount}
            />
          </ErrorBoundary>
          <ErrorBoundary>
            <DataStoryteller tableName={tableName} columns={columns} />
          </ErrorBoundary>

          <ToolSection
            title="Automation Scheduler"
            description="Schedule refreshes, pipeline runs, report generation, and alert checks for the active dataset."
          >
            <ErrorBoundary>
              <DataScheduler tableName={tableName} columns={columns} />
            </ErrorBoundary>
          </ToolSection>

          <ToolSection
            title="Dataset Versioning"
            description="Capture named snapshots, branch working states, and compare row-level differences before major transformations."
          >
            <ErrorBoundary>
              <DataVersioning
                tableName={tableName}
                columns={columns}
                rowCount={activeDataset.rowCount}
              />
            </ErrorBoundary>
          </ToolSection>

          <div className="overflow-hidden rounded-2xl border border-slate-200/70 dark:border-slate-800/80">
            <button
              type="button"
              onClick={() =>
                setShowAdvancedAnalytics((current) => !current)
              }
              className="flex w-full items-center justify-between gap-2 bg-slate-50/80 px-4 py-3 text-left transition-colors hover:bg-slate-100 dark:bg-slate-900/60 dark:hover:bg-slate-800/60"
            >
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Advanced Analytics
                </h3>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  Customer, business, and statistical analysis tools
                </p>
              </div>
              {showAdvancedAnalytics ? (
                <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />
              ) : (
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
              )}
            </button>

            {showAdvancedAnalytics && (
              <div className="space-y-6 p-4">
                <ToolSection
                  title="Customer Analytics"
                  description="Predict churn, measure lifetime value, and segment users by behavior."
                >
                  <div className="space-y-4">
                    <ErrorBoundary>
                      <ChurnPredictor tableName={tableName} columns={columns} />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <CustomerLifetimeValue
                        tableName={tableName}
                        columns={columns}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <CohortRetention tableName={tableName} columns={columns} />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <RfmAnalysis tableName={tableName} columns={columns} />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <EngagementMetrics tableName={tableName} columns={columns} />
                    </ErrorBoundary>
                  </div>
                </ToolSection>

                <ToolSection
                  title="Business Analytics"
                  description="A/B testing, funnels, revenue breakdowns, and market basket analysis."
                >
                  <div className="space-y-4">
                    <ErrorBoundary>
                      <AbTestAnalyzer tableName={tableName} columns={columns} />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <FunnelAnalysis tableName={tableName} columns={columns} />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <RevenueAnalysis tableName={tableName} columns={columns} />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <MarketBasketAnalysis
                        tableName={tableName}
                        columns={columns}
                      />
                    </ErrorBoundary>
                  </div>
                </ToolSection>

                <ToolSection
                  title="Statistical Analysis"
                  description="Seasonal patterns, geographic distributions, and text sentiment."
                >
                  <div className="space-y-4">
                    <ErrorBoundary>
                      <SeasonalDecomposition
                        tableName={tableName}
                        columns={columns}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <GeographicAnalysis
                        tableName={tableName}
                        columns={columns}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <SentimentAnalyzer
                        tableName={tableName}
                        columns={columns}
                      />
                    </ErrorBoundary>
                  </div>
                </ToolSection>
              </div>
            )}
          </div>
        </div>
      </AnimatedWorkspaceSection>

      {analyticsColumn && (
        <ErrorBoundary>
          <ColumnDetail
            column={analyticsColumn}
            tableName={tableName}
            open={showColumnDetail}
            onClose={() => setShowColumnDetail(false)}
          />
        </ErrorBoundary>
      )}
    </>
  );
}
