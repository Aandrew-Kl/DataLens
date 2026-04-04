"use client";

import { AnimatePresence } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import type { DatasetMeta, ColumnProfile } from "@/types/dataset";
import type { NotificationInput } from "@/components/ui/notification-center";
import DashboardView from "@/components/data/dashboard-view";
import DataCatalog from "@/components/data/data-catalog";
import DataSampler from "@/components/data/data-sampler";
import BinAnalyzer from "@/components/data/bin-analyzer";
import ChangeImpactAnalyzer from "@/components/data/change-impact-analyzer";
import ColumnDependencyFinder from "@/components/data/column-dependency-finder";
import CrossTabulation from "@/components/data/cross-tabulation";
import DataSnapshotCompare from "@/components/data/data-snapshot-compare";
import DateExplorer from "@/components/data/date-explorer";
import DistributionAnalyzer from "@/components/data/distribution-analyzer";
import OutlierReport from "@/components/data/outlier-report";
import PercentileExplorer from "@/components/data/percentile-explorer";
import PivotAnalysis from "@/components/data/pivot-analysis";
import TextColumnAnalyzer from "@/components/data/text-column-analyzer";
import TimeSeriesDecomposer from "@/components/data/time-series-decomposer";
import SegmentComparison from "@/components/analytics/segment-comparison";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import type { Command as CommandBarCommand } from "@/components/ui/command-bar";
import type { SavedChartSnapshot } from "@/components/charts/chart-builder";

import AnalyticsSection from "@/components/home/AnalyticsSection";
import BuilderSection from "@/components/home/BuilderSection";
import ChartBuilderSection from "@/components/home/ChartBuilderSection";
import CleanSection from "@/components/home/CleanSection";
import CompareSection from "@/components/home/CompareSection";
import ConnectorsSection from "@/components/home/ConnectorsSection";
import ExploreSection from "@/components/home/ExploreSection";
import ForecastSection from "@/components/home/ForecastSection";
import LineageSection from "@/components/home/LineageSection";
import MlSection from "@/components/home/MlSection";
import PivotSection from "@/components/home/PivotSection";
import ProfileSection from "@/components/home/ProfileSection";
import QualitySection from "@/components/home/QualitySection";
import QuerySection from "@/components/home/QuerySection";
import ReportsSection from "@/components/home/ReportsSection";
import SettingsPanelSection from "@/components/home/SettingsPanelSection";
import SqlEditorSection from "@/components/home/SqlEditorSection";
import TransformsSection from "@/components/home/TransformsSection";
import WranglerSection from "@/components/home/WranglerSection";
import type { AppTab } from "@/components/home/types";
import { AnimatedWorkspaceSection } from "@/components/home/workspace-shared";

interface HomeTabPanelsProps {
  activeTab: AppTab;
  activeDataset: DatasetMeta;
  datasets: DatasetMeta[];
  tableName: string;
  profileData: ColumnProfile[];
  completenessPct: number;
  savedCharts: SavedChartSnapshot[];
  workspaceTabItems: Array<{
    id: AppTab;
    label: string;
    icon: LucideIcon;
    badge?: number | string;
  }>;
  commandBarCommands: CommandBarCommand[];
  onTabChange: (tab: AppTab) => void;
  onExecuteCommand: (command: CommandBarCommand) => void;
  onAddNotification: (input: NotificationInput) => string;
  onConnectorDataLoaded: (result: {
    tableName: string;
    columns: ColumnProfile[];
  }) => void;
  onRegisterMergedDataset: (nextTableName: string) => void;
  onSqlJoinComplete: (result: {
    tableName: string;
    sql: string;
    columns: string[];
  }) => void;
  onRefreshDataset: (title?: string, message?: string) => Promise<void> | void;
  onFormulaSave: (name: string, expression: string) => Promise<void> | void;
  onSavedChartRemove: (chartId: string) => void;
  onSavedChartEdit: (chart: {
    title: string;
    xAxis?: string;
    yAxis?: string;
    groupBy?: string;
    aggregation?: string;
  }) => void | Promise<void>;
  onOpenExportWizard: () => void;
}

export default function HomeTabPanels({
  activeTab,
  activeDataset,
  datasets,
  tableName,
  profileData,
  completenessPct,
  savedCharts,
  workspaceTabItems,
  commandBarCommands,
  onTabChange,
  onExecuteCommand,
  onAddNotification,
  onConnectorDataLoaded,
  onRegisterMergedDataset,
  onSqlJoinComplete,
  onRefreshDataset,
  onFormulaSave,
  onSavedChartRemove,
  onSavedChartEdit,
  onOpenExportWizard,
}: HomeTabPanelsProps) {
  return (
    <AnimatePresence mode="wait">
      {activeTab === "profile" && (
        <ProfileSection
          key="profile"
          activeDataset={activeDataset}
          tableName={tableName}
          columns={profileData}
          completenessPct={completenessPct}
          onRefreshDataset={onRefreshDataset}
          onOpenExportWizard={onOpenExportWizard}
        />
      )}

      {activeTab === "dashboard" && (
        <AnimatedWorkspaceSection key="dashboard" className="">
          <ErrorBoundary>
            <DashboardView dataset={activeDataset} columns={profileData} />
          </ErrorBoundary>
        </AnimatedWorkspaceSection>
      )}

      {activeTab === "connectors" && (
        <ConnectorsSection
          key="connectors"
          onConnectorDataLoaded={onConnectorDataLoaded}
          onRegisterMergedDataset={onRegisterMergedDataset}
        />
      )}

      {activeTab === "catalog" && (
        <AnimatedWorkspaceSection key="catalog">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
              Dataset Catalog
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Browse loaded DuckDB relations, inspect schema metadata, and manage
              the active workspace inventory from one tab.
            </p>
          </div>
          <ErrorBoundary>
            <DataCatalog />
          </ErrorBoundary>
        </AnimatedWorkspaceSection>
      )}

      {activeTab === "query" && (
        <QuerySection
          key="query"
          activeDataset={activeDataset}
          tableName={tableName}
          columns={profileData}
          onAddNotification={onAddNotification}
        />
      )}

      {activeTab === "sql" && (
        <SqlEditorSection
          key="sql"
          tableName={tableName}
          columns={profileData}
          datasetId={activeDataset.id}
          datasets={datasets}
          onJoinComplete={onSqlJoinComplete}
        />
      )}

      {activeTab === "charts" && (
        <ChartBuilderSection
          key="charts"
          tableName={tableName}
          columns={profileData}
          rowCount={activeDataset.rowCount}
          fileName={activeDataset.fileName}
          savedCharts={savedCharts}
          completenessPct={completenessPct}
          onRemove={onSavedChartRemove}
          onEdit={onSavedChartEdit}
        />
      )}

      {activeTab === "forecast" && (
        <ForecastSection key="forecast" tableName={tableName} columns={profileData} />
      )}

      {activeTab === "ml" && (
        <MlSection
          key="ml"
          tableName={tableName}
          columns={profileData}
          rowCount={activeDataset.rowCount}
        />
      )}

      {activeTab === "explore" && (
        <ExploreSection
          key="explore"
          tableName={tableName}
          columns={profileData}
          rowCount={activeDataset.rowCount}
        />
      )}

      {activeTab === "builder" && (
        <BuilderSection
          key="builder"
          activeTab={activeTab}
          onTabChange={onTabChange}
          tabs={workspaceTabItems}
          commands={commandBarCommands}
          onExecuteCommand={onExecuteCommand}
          tableName={tableName}
          columns={profileData}
          rowCount={activeDataset.rowCount}
        />
      )}

      {activeTab === "transforms" && (
        <TransformsSection
          key="transforms"
          tableName={tableName}
          columns={profileData}
          datasets={datasets}
          onRefreshDataset={onRefreshDataset}
          onFormulaSave={onFormulaSave}
        />
      )}

      {activeTab === "quality" && (
        <QualitySection key="quality" tableName={tableName} columns={profileData} />
      )}

      {activeTab === "clean" && (
        <CleanSection
          key="clean"
          tableName={tableName}
          columns={profileData}
          onRefreshDataset={onRefreshDataset}
        />
      )}

      {activeTab === "analytics" && (
        <AnalyticsSection
          key="analytics"
          activeDataset={activeDataset}
          tableName={tableName}
          columns={profileData}
        />
      )}

      {activeTab === "advanced" && (
        <AnimatedWorkspaceSection key="advanced">
          <ErrorBoundary>
            <DistributionAnalyzer tableName={tableName} columns={profileData} />
          </ErrorBoundary>
          <ErrorBoundary>
            <TextColumnAnalyzer tableName={tableName} columns={profileData} />
          </ErrorBoundary>
          <ErrorBoundary>
            <DateExplorer tableName={tableName} columns={profileData} />
          </ErrorBoundary>
          <ErrorBoundary>
            <SegmentComparison tableName={tableName} columns={profileData} />
          </ErrorBoundary>
          <ErrorBoundary>
            <ChangeImpactAnalyzer tableName={tableName} columns={profileData} />
          </ErrorBoundary>
          <ErrorBoundary>
            <ColumnDependencyFinder tableName={tableName} columns={profileData} />
          </ErrorBoundary>
          <ErrorBoundary>
            <DataSnapshotCompare tableName={tableName} columns={profileData} />
          </ErrorBoundary>
          <ErrorBoundary>
            <OutlierReport tableName={tableName} columns={profileData} />
          </ErrorBoundary>
          <ErrorBoundary>
            <PivotAnalysis tableName={tableName} columns={profileData} />
          </ErrorBoundary>
          <ErrorBoundary>
            <PercentileExplorer tableName={tableName} columns={profileData} />
          </ErrorBoundary>
          <ErrorBoundary>
            <TimeSeriesDecomposer tableName={tableName} columns={profileData} />
          </ErrorBoundary>
          <ErrorBoundary>
            <CrossTabulation tableName={tableName} columns={profileData} />
          </ErrorBoundary>
          <ErrorBoundary>
            <DataSampler tableName={tableName} columns={profileData} />
          </ErrorBoundary>
          <ErrorBoundary>
            <BinAnalyzer tableName={tableName} columns={profileData} />
          </ErrorBoundary>
        </AnimatedWorkspaceSection>
      )}

      {activeTab === "wrangler" && (
        <WranglerSection
          key="wrangler"
          activeDataset={activeDataset}
          tableName={tableName}
          columns={profileData}
          onRefreshDataset={onRefreshDataset}
        />
      )}

      {activeTab === "lineage" && (
        <LineageSection
          key="lineage"
          activeDataset={activeDataset}
          tableName={tableName}
          columns={profileData}
        />
      )}

      {activeTab === "compare" && (
        <CompareSection
          key="compare"
          datasets={datasets}
          tableName={tableName}
          columns={profileData}
        />
      )}

      {activeTab === "reports" && (
        <ReportsSection
          key="reports"
          activeDataset={activeDataset}
          tableName={tableName}
          columns={profileData}
        />
      )}

      {activeTab === "pivot" && (
        <PivotSection key="pivot" tableName={tableName} columns={profileData} />
      )}

      {activeTab === "settings" && (
        <SettingsPanelSection
          key="settings"
          tableName={tableName}
          columns={profileData}
        />
      )}
    </AnimatePresence>
  );
}
