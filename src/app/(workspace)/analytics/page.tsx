"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import TimeSeriesForecast from "@/components/data/time-series-forecast";
import TrendAnalyzer from "@/components/analytics/trend-analyzer";
import SegmentComparison from "@/components/analytics/segment-comparison";
import DataStoryteller from "@/components/analytics/data-storyteller";
import AbTestAnalyzer from "@/components/analytics/ab-test-analyzer";
import ChurnPredictor from "@/components/analytics/churn-predictor";
import CohortRetention from "@/components/analytics/cohort-retention";
import CustomerLifetimeValue from "@/components/analytics/customer-lifetime-value";
import EngagementMetrics from "@/components/analytics/engagement-metrics";
import FunnelAnalysis from "@/components/analytics/funnel-analysis";
import GeographicAnalysis from "@/components/analytics/geographic-analysis";
import MarketBasketAnalysis from "@/components/analytics/market-basket-analysis";
import RevenueAnalysis from "@/components/analytics/revenue-analysis";
import RfmAnalysis from "@/components/analytics/rfm-analysis";
import SeasonalDecomposition from "@/components/analytics/seasonal-decomposition";
import SentimentAnalyzer from "@/components/analytics/sentiment-analyzer";
import { useDatasetStore } from "@/stores/dataset-store";

function GlassSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/30 bg-white/55 p-4 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/55 sm:p-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export default function AnalyticsPage() {
  const [showAdvancedAnalytics, setShowAdvancedAnalytics] = useState(true);
  const activeDataset = useDatasetStore((state) => state.getActiveDataset());
  const tableName = activeDataset?.name ?? "";
  const columns = activeDataset?.columns ?? [];

  if (!activeDataset) {
    return (
      <div className="rounded-2xl border border-white/30 bg-white/55 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/55">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Select a dataset from the sidebar to unlock the analytics workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/30 bg-white/55 p-4 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/55 sm:p-5">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Advanced analytical tooling for the active dataset.
        </p>
        <div className="mt-3 inline-flex flex-wrap gap-2 rounded-xl border border-white/25 bg-white/60 px-3 py-2 text-xs text-slate-700 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-300">
          <span className="rounded-md bg-white/75 px-2 py-1 dark:bg-slate-950/45">
            Dataset: {activeDataset.fileName}
          </span>
          <span className="rounded-md bg-white/75 px-2 py-1 dark:bg-slate-950/45">
            Rows: {activeDataset.rowCount.toLocaleString()}
          </span>
          <span className="rounded-md bg-white/75 px-2 py-1 dark:bg-slate-950/45">
            Columns: {activeDataset.columnCount}
          </span>
        </div>
      </section>

      <GlassSection
        title="Forecast"
        description="Project future values from time-series fields with forecast preview and exportable output."
      >
        <ErrorBoundary>
          <TimeSeriesForecast tableName={tableName} columns={columns} />
        </ErrorBoundary>
      </GlassSection>

      <GlassSection
        title="Descriptive Analytics"
        description="Trend decomposition and comparative segment insights from the active dataset."
      >
        <ErrorBoundary>
          <TrendAnalyzer tableName={tableName} columns={columns} />
        </ErrorBoundary>
        <ErrorBoundary>
          <SegmentComparison tableName={tableName} columns={columns} />
        </ErrorBoundary>
        <ErrorBoundary>
          <DataStoryteller tableName={tableName} columns={columns} />
        </ErrorBoundary>
      </GlassSection>

      <section className="overflow-hidden rounded-2xl border border-white/30 bg-white/55 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/55">
        <button
          type="button"
          onClick={() => setShowAdvancedAnalytics((value) => !value)}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Advanced Analytics</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Customer, business, and statistical modules in one place.
            </p>
          </div>
          {showAdvancedAnalytics ? (
            <ChevronDown className="h-5 w-5 text-slate-400" />
          ) : (
            <ChevronRight className="h-5 w-5 text-slate-400" />
          )}
        </button>

        {showAdvancedAnalytics && (
          <div className="space-y-6 border-t border-white/30 p-4 dark:border-white/10">
            <div className="space-y-4 rounded-2xl border border-white/25 bg-white/45 p-4 dark:border-white/10 dark:bg-slate-950/35">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Customer Analytics
              </h3>
              <div className="space-y-4">
                <ErrorBoundary>
                  <ChurnPredictor tableName={tableName} columns={columns} />
                </ErrorBoundary>
                <ErrorBoundary>
                  <CustomerLifetimeValue tableName={tableName} columns={columns} />
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
            </div>

            <div className="space-y-4 rounded-2xl border border-white/25 bg-white/45 p-4 dark:border-white/10 dark:bg-slate-950/35">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Business Analytics
              </h3>
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
                  <MarketBasketAnalysis tableName={tableName} columns={columns} />
                </ErrorBoundary>
              </div>
            </div>

            <div className="space-y-4 rounded-2xl border border-white/25 bg-white/45 p-4 dark:border-white/10 dark:bg-slate-950/35">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Statistical & Text Analytics
              </h3>
              <div className="space-y-4">
                <ErrorBoundary>
                  <SeasonalDecomposition tableName={tableName} columns={columns} />
                </ErrorBoundary>
                <ErrorBoundary>
                  <GeographicAnalysis tableName={tableName} columns={columns} />
                </ErrorBoundary>
                <ErrorBoundary>
                  <SentimentAnalyzer tableName={tableName} columns={columns} />
                </ErrorBoundary>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
