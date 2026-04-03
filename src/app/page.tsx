"use client";

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { AnimatePresence, motion } from "framer-motion";
import {
  BrainCircuit,
  Database,
  Table,
  BarChart3,
  MessageSquare,
  Moon,
  Sun,
  Rows3,
  Columns3,
  Upload,
  Code2,
  Settings,
  Menu,
  X,
  Shield,
  Zap,
  Lock,
  Sparkles,
  ExternalLink as GithubIcon,
  Wand2,
  PieChart,
  FileText,
  GitMerge,
  RefreshCw,
  Share2,
  LayoutGrid,
  Compass,
  Eraser,
  Plug,
  Wrench,
  GitBranch,
  Search,
  FlaskConical,
} from "lucide-react";

import { loadCSVIntoDB, runQuery, getTableRowCount } from "@/lib/duckdb/client";
import { profileTable } from "@/lib/duckdb/profiler";
import { useDatasetStore } from "@/stores/dataset-store";
import { useQueryStore } from "@/stores/query-store";
import { useUIStore } from "@/stores/ui-store";
import {
  formatNumber,
  formatBytes,
  sanitizeTableName,
  generateId,
} from "@/lib/utils/formatters";
import type { DatasetMeta, ColumnProfile } from "@/types/dataset";

// Components
import FileDropzone from "@/components/data/file-dropzone";
import DataBookmarks from "@/components/data/data-bookmarks";
import DataChangelog from "@/components/data/data-changelog";
import DataProfiler from "@/components/data/data-profiler";
import DataTable from "@/components/data/data-table";
import DashboardView from "@/components/data/dashboard-view";
import ChatInterface from "@/components/query/chat-interface";
import SQLEditor from "@/components/query/sql-editor";
import SettingsPanel from "@/components/settings/settings-panel";
import CommandPalette from "@/components/layout/command-palette";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import ChartBuilder, {
  CHART_SAVED_EVENT,
  SAVED_CHARTS_STORAGE_KEY,
  type SavedChartSnapshot,
} from "@/components/charts/chart-builder";
import ChartRenderer from "@/components/charts/chart-renderer";
import TransformPanel from "@/components/data/transform-panel";
import CorrelationMatrix from "@/components/data/correlation-matrix";
import OutlierDetector from "@/components/data/outlier-detector";
import MissingDataMap from "@/components/data/missing-data-map";
import ReportBuilder from "@/components/report/report-builder";
import ColumnGrouper from "@/components/data/column-grouper";
import JoinBuilder from "@/components/data/join-builder";
import QueryHistory from "@/components/query/query-history";
import SavedQueries from "@/components/query/saved-queries";
import DataSummary from "@/components/data/data-summary";
import SampleDatasets from "@/components/data/sample-datasets";
import KeyboardShortcutsDialog from "@/components/ui/keyboard-shortcuts-dialog";
import PivotTable from "@/components/data/pivot-table";
import PivotTableAdvanced from "@/components/data/pivot-table-advanced";
import SchemaViewer from "@/components/data/schema-viewer";
import ExportWizard from "@/components/data/export-wizard";
import TemplatePicker from "@/components/query/template-picker";
import NotificationCenter, {
  useNotifications,
} from "@/components/ui/notification-center";
import NaturalLanguageBar from "@/components/query/natural-language-bar";
import SharePanel from "@/components/data/share-panel";
import SnapshotManager from "@/components/data/snapshot-manager";
import RowDetailModal from "@/components/data/row-detail-modal";
import AIInsights from "@/components/ai/ai-insights";
import ColumnStats from "@/components/data/column-stats";
import Crosstab from "@/components/data/crosstab";
import FrequencyTable from "@/components/data/frequency-table";
import TimeSeriesAnalyzer from "@/components/data/time-series-analyzer";
import DataValidator from "@/components/data/data-validator";
import AnomalyHeatmap from "@/components/data/anomaly-heatmap";
import ChartAnnotator from "@/components/charts/chart-annotator";
import ChartRecommendations from "@/components/charts/chart-recommendations";
import ChartGallery from "@/components/charts/chart-gallery";
import ChartExport from "@/components/charts/chart-export";
import WaterfallChart from "@/components/charts/waterfall-chart";
import FunnelChart from "@/components/charts/funnel-chart";
import RadarChart from "@/components/charts/radar-chart";
import SankeyChart from "@/components/charts/sankey-chart";
import TreemapChart from "@/components/charts/treemap-chart";
import ChartTemplates from "@/components/charts/chart-templates";
import SparklineGrid from "@/components/charts/sparkline-grid";
import ScatterMatrix from "@/components/charts/scatter-matrix";
import ClusteringView from "@/components/ml/clustering-view";
import ColumnDetail from "@/components/data/column-detail";
import DataDictionary from "@/components/data/data-dictionary";
import VirtualDataGrid from "@/components/data/virtual-data-grid";
import MetricCard from "@/components/data/metric-card";
import ColumnRenamer from "@/components/data/column-renamer";
import NullHandler from "@/components/data/null-handler";
import TypeConverter from "@/components/data/type-converter";
import DuplicateFinder from "@/components/data/duplicate-finder";
import DataSampler from "@/components/data/data-sampler";
import FormulaEditor from "@/components/data/formula-editor";
import OnboardingTour from "@/components/ui/onboarding-tour";
import DataQualityDashboard from "@/components/data/data-quality-dashboard";
import LoadingOverlay from "@/components/ui/loading-overlay";
import DataLineage from "@/components/data/data-lineage";
import DataAlerts from "@/components/data/data-alerts";
import DataStory from "@/components/data/data-story";
import DataDiff from "@/components/data/data-diff";
import DataEnrichment from "@/components/data/data-enrichment";
import DataForecast from "@/components/data/data-forecast";
import DataOverview from "@/components/data/data-overview";
import DataProfilerSummary from "@/components/data/data-profiler-summary";
import DataProfilerFull from "@/components/data/data-profiler-full";
import ColumnProfilerAdvanced from "@/components/data/column-profiler-advanced";
import ColumnTransformer from "@/components/data/column-transformer";
import QueryBuilder from "@/components/query/query-builder";
import RelationshipExplorer from "@/components/data/relationship-explorer";
import DataCleaner from "@/components/data/data-cleaner";
import DataComparison from "@/components/data/data-comparison";
import DataConnector from "@/components/data/data-connector";
import DataJoinWizard from "@/components/data/data-join-wizard";
import MergeDatasets from "@/components/data/merge-datasets";
import DataPipeline from "@/components/data/data-pipeline";
import DataScheduler from "@/components/data/data-scheduler";
import DataVersioning from "@/components/data/data-versioning";
import DashboardBuilder from "@/components/charts/dashboard-builder";
import AiAssistant from "@/components/ai/ai-assistant";
import ColumnCorrelator from "@/components/data/column-correlator";
import DataComparisonAdvanced from "@/components/data/data-comparison-advanced";
import DataFaker from "@/components/data/data-faker";
import RegressionView from "@/components/ml/regression-view";
import SQLPlayground from "@/components/query/sql-playground";
import RegexTester from "@/components/data/regex-tester";
import StatisticalTests from "@/components/data/statistical-tests";
import GeoChart from "@/components/charts/geo-chart";
import SmartFilter from "@/components/data/smart-filter";
import DataQualityRules from "@/components/data/data-quality-rules";
import AnomalyDetector from "@/components/data/anomaly-detector";
import DataCatalog from "@/components/data/data-catalog";
import DataProfilerAI from "@/components/data/data-profiler-ai";
import AccessibilityPanel from "@/components/ui/accessibility-panel";
import ThemeCustomizer from "@/components/layout/theme-customizer";
import AreaChart from "@/components/charts/area-chart";
import BoxplotChart from "@/components/charts/boxplot-chart";
import DonutChart from "@/components/charts/donut-chart";
import GaugeChart from "@/components/charts/gauge-chart";
import HeatmapChart from "@/components/charts/heatmap-chart";
import ParallelCoordinates from "@/components/charts/parallel-coordinates";
import CohortAnalysis from "@/components/data/cohort-analysis";
import DistributionAnalyzer from "@/components/data/distribution-analyzer";
import TextColumnAnalyzer from "@/components/data/text-column-analyzer";
import DateExplorer from "@/components/data/date-explorer";
import CorrelationFinder from "@/components/data/correlation-finder";
import DataLineageGraph from "@/components/data/data-lineage-graph";
import DataNarrator from "@/components/data/data-narrator";
import DataPreview from "@/components/data/data-preview";
import DataSummarizer from "@/components/data/data-summarizer";
import DataWrangler from "@/components/data/data-wrangler";
import PivotConfigurator from "@/components/data/pivot-configurator";
import ChangeImpactAnalyzer from "@/components/data/change-impact-analyzer";
import ColumnDependencyFinder from "@/components/data/column-dependency-finder";
import DataSnapshotCompare from "@/components/data/data-snapshot-compare";
import OutlierReport from "@/components/data/outlier-report";
import PivotAnalysis from "@/components/data/pivot-analysis";
import PercentileExplorer from "@/components/data/percentile-explorer";
import TimeSeriesDecomposer from "@/components/data/time-series-decomposer";
import CrossTabulation from "@/components/data/cross-tabulation";
import BinAnalyzer from "@/components/data/bin-analyzer";
import SegmentComparison from "@/components/analytics/segment-comparison";
import Breadcrumb from "@/components/layout/breadcrumb";
import NotFoundPage from "@/components/layout/not-found";
import WorkspaceTabs from "@/components/layout/workspace-tabs";
import CommandBar, {
  type Command as CommandBarCommand,
} from "@/components/ui/command-bar";
import DataTour from "@/components/ui/data-tour";
import Dropdown from "@/components/ui/dropdown";
import EmptyState from "@/components/ui/empty-state";
import SearchInput from "@/components/ui/search-input";
import ShortcutOverlay from "@/components/ui/shortcut-overlay";
import {
  SkeletonCard,
  SkeletonChart,
  SkeletonTable,
} from "@/components/ui/skeleton";
import { ToastProvider, useToast } from "@/components/ui/toast";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type AppTab =
  | "profile"
  | "dashboard"
  | "connectors"
  | "catalog"
  | "query"
  | "sql"
  | "charts"
  | "forecast"
  | "ml"
  | "explore"
  | "builder"
  | "transforms"
  | "wrangler"
  | "lineage"
  | "quality"
  | "clean"
  | "advanced"
  | "analytics"
  | "reports"
  | "pivot"
  | "compare";

interface FileDropResult {
  fileName: string;
  csvContent: string;
  sizeBytes: number;
}

function readSavedChartsFromStorage(): SavedChartSnapshot[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(SAVED_CHARTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SavedChartSnapshot[]) : [];
  } catch {
    return [];
  }
}

function ToolSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">
          {title}
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

function WorkspacePolishLab({
  activeTab,
  onTabChange,
  tabs,
  commands,
  onExecuteCommand,
}: {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  tabs: Array<{
    id: AppTab;
    label: string;
    icon: typeof Database;
    badge?: number | string;
  }>;
  commands: CommandBarCommand[];
  onExecuteCommand: (command: CommandBarCommand) => void;
}) {
  const { toast } = useToast();
  const [showCommandBar, setShowCommandBar] = useState(false);

  const dropdownItems = useMemo(
    () => [
      {
        label: "Jump to Profile",
        icon: Table,
        onClick: () => onTabChange("profile"),
      },
      {
        label: "Jump to Charts",
        icon: PieChart,
        onClick: () => onTabChange("charts"),
      },
      {
        label: showCommandBar ? "Hide Command Bar" : "Show Command Bar",
        icon: Code2,
        onClick: () => setShowCommandBar((current) => !current),
      },
      { type: "separator" as const },
      {
        label: "Preview Success Toast",
        icon: Sparkles,
        onClick: () =>
          toast("Workspace polish preview is ready.", "success", 3200),
      },
      {
        label: "Preview Warning Toast",
        icon: Shield,
        onClick: () =>
          toast(
            "Review the route and empty states before shipping the shell.",
            "warning",
            3600
          ),
      },
    ],
    [onTabChange, showCommandBar, toast]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <ErrorBoundary>
          <Dropdown
            trigger={
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Menu className="h-4 w-4" />
                Quick Menu
              </button>
            }
            items={dropdownItems}
          />
        </ErrorBoundary>
        <button
          type="button"
          onClick={() => toast("Builder tab controls are connected.", "info", 2600)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Sparkles className="h-4 w-4" />
          Fire Toast
        </button>
        <button
          type="button"
          onClick={() => setShowCommandBar((current) => !current)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Code2 className="h-4 w-4" />
          {showCommandBar ? "Hide Command Bar" : "Show Command Bar"}
        </button>
      </div>

      <ErrorBoundary>
        <WorkspaceTabs
          tabs={tabs}
          activeTab={activeTab}
          onChange={(id) => onTabChange(id as AppTab)}
        />
      </ErrorBoundary>

      {showCommandBar ? (
        <ErrorBoundary>
          <CommandBar commands={commands} onExecute={onExecuteCommand} />
        </ErrorBoundary>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
          Enable the advanced command bar to preview the richer search-driven
          command surface without replacing the existing command palette.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ErrorBoundary>
          <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-2 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
            <EmptyState
              icon={LayoutGrid}
              title="No preview selected"
              description="Use the workspace tabs or quick menu to jump to a feature area from this builder-side lab."
              action={{
                label: "Go to Profile",
                onClick: () => onTabChange("profile"),
              }}
            />
          </div>
        </ErrorBoundary>
        <ErrorBoundary>
          <SkeletonCard className="h-full" />
        </ErrorBoundary>
        <ErrorBoundary>
          <SkeletonChart className="h-full" />
        </ErrorBoundary>
      </div>

      <ErrorBoundary>
        <SkeletonTable rows={4} columns={5} />
      </ErrorBoundary>

      <details className="group rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Route Fallback Preview
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Preview the shared not-found experience inside the builder lab
                without changing the active route.
              </p>
            </div>
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
              Expand
            </span>
          </div>
        </summary>
        <div className="mt-4 max-h-[36rem] overflow-auto rounded-[1.75rem] border border-slate-200/70 bg-slate-50 dark:border-slate-700/60 dark:bg-slate-950/70">
          <ErrorBoundary>
            <NotFoundPage />
          </ErrorBoundary>
        </div>
      </details>
    </div>
  );
}

// ─────────────────────────────────────────────
// Tab config
// ─────────────────────────────────────────────

const TABS: { id: AppTab; label: string; icon: typeof Database }[] = [
  { id: "profile", label: "Profile", icon: Table },
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "connectors", label: "Connectors", icon: Plug },
  { id: "catalog", label: "Catalog", icon: Database },
  { id: "query", label: "Ask AI", icon: MessageSquare },
  { id: "sql", label: "SQL Editor", icon: Code2 },
  { id: "charts", label: "Charts", icon: PieChart },
  { id: "forecast", label: "Forecast", icon: RefreshCw },
  { id: "ml", label: "ML", icon: BrainCircuit },
  { id: "explore", label: "Explore", icon: Compass },
  { id: "builder", label: "Builder", icon: LayoutGrid },
  { id: "transforms", label: "Transforms", icon: Wand2 },
  { id: "quality", label: "Quality", icon: Shield },
  { id: "clean", label: "Clean", icon: Eraser },
  { id: "advanced", label: "Advanced", icon: FlaskConical },
  { id: "analytics", label: "Analytics", icon: GitMerge },
  { id: "compare", label: "Compare", icon: RefreshCw },
  { id: "pivot", label: "Pivot", icon: Table },
  { id: "wrangler", label: "Wrangler", icon: Wrench },
  { id: "lineage", label: "Lineage", icon: GitBranch },
  { id: "reports", label: "Reports", icon: FileText },
];

// ─────────────────────────────────────────────
// Feature list for landing page
// ─────────────────────────────────────────────

const FEATURES = [
  {
    icon: Database,
    label: "DuckDB-WASM",
    description: "Analytical SQL engine runs in your browser",
  },
  {
    icon: Sparkles,
    label: "AI-Powered",
    description: "Local AI via Ollama — no API keys needed",
  },
  {
    icon: Lock,
    label: "100% Private",
    description: "Your data never leaves your machine",
  },
  {
    icon: Zap,
    label: "Zero Cost",
    description: "Free and open source forever",
  },
];

const LANDING_FEATURES = [
  {
    icon: BarChart3,
    title: "Auto-Dashboards",
    description:
      "Drop a file and get instant charts, KPIs, and insights — no configuration needed.",
  },
  {
    icon: MessageSquare,
    title: "Natural Language Queries",
    description:
      'Ask questions like "What are total sales by region?" and get instant SQL + results.',
  },
  {
    icon: Code2,
    title: "SQL Editor",
    description:
      "Full SQL editor with syntax highlighting, auto-complete, and instant execution.",
  },
  {
    icon: Shield,
    title: "Data Profiling",
    description:
      "Automatic column analysis, type detection, distributions, and quality scoring.",
  },
];

// ─────────────────────────────────────────────
// Sidebar Dataset List
// ─────────────────────────────────────────────

function DatasetSidebar({
  isOpen,
  onToggle,
  onNewDataset,
}: {
  isOpen: boolean;
  onToggle: () => void;
  onNewDataset: () => void;
}) {
  const { datasets, activeDatasetId, setActiveDataset, removeDataset } =
    useDatasetStore();

  if (!isOpen) {
    return (
      <div className="w-14 shrink-0 border-r border-slate-200 dark:border-slate-700/50 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl flex flex-col items-center py-4 gap-3">
        <button
          onClick={onToggle}
          className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Expand sidebar"
        >
          <Menu className="h-4 w-4 text-slate-500" />
        </button>
        <div className="h-px w-6 bg-slate-200 dark:bg-slate-700" />
        {datasets.map((ds) => (
          <button
            key={ds.id}
            onClick={() => setActiveDataset(ds.id)}
            className={`p-2 rounded-lg transition-colors ${
              ds.id === activeDatasetId
                ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400"
                : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
            }`}
            title={ds.fileName}
          >
            <Database className="h-4 w-4" />
          </button>
        ))}
        <button
          onClick={onNewDataset}
          className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-indigo-500 transition-colors mt-auto"
          title="Upload new dataset"
        >
          <Upload className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 240, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="w-60 shrink-0 border-r border-slate-200 dark:border-slate-700/50 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl flex flex-col overflow-hidden"
    >
      {/* Sidebar header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600">
            <Database className="h-3 w-3 text-white" />
          </div>
          <span className="text-sm font-semibold text-slate-900 dark:text-white">
            DataLens
          </span>
        </div>
        <button
          onClick={onToggle}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="h-3.5 w-3.5 text-slate-400" />
        </button>
      </div>

      {/* Dataset list */}
      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-3 mb-2">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 dark:text-slate-500">
            Datasets ({datasets.length})
          </p>
        </div>

        {datasets.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <Database className="h-8 w-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
            <p className="text-xs text-slate-400 dark:text-slate-500">
              No datasets loaded
            </p>
          </div>
        ) : (
          <div className="space-y-0.5 px-2">
            {datasets.map((ds) => (
              <div
                key={ds.id}
                onClick={() => setActiveDataset(ds.id)}
                className={`
                  flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer
                  transition-colors group
                  ${
                    ds.id === activeDatasetId
                      ? "bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-800/40"
                      : "hover:bg-slate-50 dark:hover:bg-slate-800/50 border border-transparent"
                  }
                `}
              >
                <Database
                  className={`h-3.5 w-3.5 shrink-0 ${
                    ds.id === activeDatasetId
                      ? "text-indigo-500"
                      : "text-slate-400"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-xs font-medium truncate ${
                      ds.id === activeDatasetId
                        ? "text-indigo-700 dark:text-indigo-300"
                        : "text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {ds.fileName}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                    {formatNumber(ds.rowCount)} rows &middot;{" "}
                    {ds.columnCount} cols
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeDataset(ds.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
                  title="Remove dataset"
                >
                  <X className="h-3 w-3 text-slate-400" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sidebar footer */}
      <div className="border-t border-slate-100 dark:border-slate-800 px-3 py-3">
        <button
          onClick={onNewDataset}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-xs font-medium text-slate-500 dark:text-slate-400 hover:border-indigo-400 dark:hover:border-indigo-600 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
        >
          <Upload className="h-3.5 w-3.5" />
          Upload Dataset
        </button>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────
// Table Preview Component
// ─────────────────────────────────────────────

function TablePreview({
  tableName,
  columns,
  onRowsLoaded,
  onRowClick,
}: {
  tableName: string;
  columns: ColumnProfile[];
  onRowsLoaded?: (rows: Record<string, unknown>[]) => void;
  onRowClick?: (row: Record<string, unknown>, index: number) => void;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await runQuery(
          `SELECT * FROM "${tableName}" LIMIT 200`
        );
        if (!cancelled) {
          setRows(data);
          onRowsLoaded?.(data);
        }
      } catch (err) {
        console.error("Failed to load table preview:", err);
        if (!cancelled) {
          onRowsLoaded?.([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onRowsLoaded, tableName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  const colNames = columns.map((c) => c.name);
  const columnTypes: Record<string, "string" | "number" | "date" | "boolean" | "unknown"> = {};
  columns.forEach((c) => {
    columnTypes[c.name] = c.type;
  });

  return (
    <DataTable
      data={rows}
      columns={colNames}
      pageSize={50}
      searchable
      sortable
      exportable
      stickyHeader
      columnTypes={columnTypes}
      onRowClick={onRowClick}
    />
  );
}

// ─────────────────────────────────────────────
// SQL Editor Wrapper
// ─────────────────────────────────────────────

function buildDefaultSQL(tableName: string) {
  return `SELECT *\nFROM "${tableName}"\nLIMIT 100;`;
}

function SQLEditorTab({
  tableName,
  columns,
  datasetId,
}: {
  tableName: string;
  columns: ColumnProfile[];
  datasetId: string;
}) {
  const [lastResult, setLastResult] = useState<{
    data: Record<string, unknown>[];
    columns: string[];
    sql: string;
    executionTimeMs: number;
  } | null>(null);
  const [editorDefaultSQL, setEditorDefaultSQL] = useState(() =>
    buildDefaultSQL(tableName)
  );
  const [editorInstanceKey, setEditorInstanceKey] = useState(0);
  const [showQueryBuilder, setShowQueryBuilder] = useState(true);
  const [showPlayground, setShowPlayground] = useState(false);

  const handleSelectSQL = useCallback((sql: string) => {
    setEditorDefaultSQL(sql);
    setEditorInstanceKey((current) => current + 1);
    setLastResult(null);
    setShowPlayground(false);
  }, []);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
      <div className="space-y-6 lg:col-span-3">
        <div className="rounded-xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Query Composer
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Build SQL visually, then switch between the classic editor and
                the multi-tab playground.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowQueryBuilder((current) => !current)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                {showQueryBuilder ? "Hide Builder" : "Show Builder"}
              </button>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
                <button
                  onClick={() => setShowPlayground(false)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    showPlayground
                      ? "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                      : "bg-indigo-500 text-white shadow-sm"
                  }`}
                >
                  SQL Editor
                </button>
                <button
                  onClick={() => setShowPlayground(true)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    showPlayground
                      ? "bg-indigo-500 text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  SQL Playground
                </button>
              </div>
            </div>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {showQueryBuilder && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <QueryBuilder
                tableName={tableName}
                columns={columns}
                onQueryGenerated={handleSelectSQL}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className={showPlayground ? "hidden" : "space-y-6"}>
          <SQLEditor
            key={`${tableName}-${editorInstanceKey}`}
            tableName={tableName}
            columns={columns}
            defaultSQL={editorDefaultSQL}
            onQueryResult={setLastResult}
          />

          {lastResult && lastResult.data.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Results
                </h3>
                <span className="text-xs text-slate-400">
                  {lastResult.data.length} rows &middot;{" "}
                  {lastResult.executionTimeMs.toFixed(1)}ms
                </span>
              </div>
              <DataTable
                data={lastResult.data}
                columns={lastResult.columns}
                pageSize={50}
                searchable
                sortable
                exportable
              />
            </motion.div>
          )}
        </div>

        <div className={showPlayground ? "block" : "hidden"}>
          <SQLPlayground tableName={tableName} columns={columns} />
        </div>
      </div>

      <div className="space-y-4">
        <ErrorBoundary>
          <TemplatePicker
            tableName={tableName}
            columns={columns}
            onSelectSQL={handleSelectSQL}
          />
        </ErrorBoundary>
        <ErrorBoundary>
          <QueryHistory datasetId={datasetId} onSelectQuery={handleSelectSQL} />
        </ErrorBoundary>
        <ErrorBoundary>
          <SavedQueries onSelectQuery={handleSelectSQL} />
        </ErrorBoundary>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────

export default function Home() {
  const { theme, toggleTheme } = useUIStore();
  const { addDataset, setActiveDataset } = useDatasetStore();
  const lastQueryResult = useQueryStore((s) => s.lastResult);
  const activeDataset = useDatasetStore((s) =>
    s.datasets.find((d) => d.id === s.activeDatasetId)
  );
  const datasetCount = useDatasetStore((s) => s.datasets.length);
  const tableName = activeDataset
    ? sanitizeTableName(activeDataset.fileName)
    : "";
  const {
    notifications,
    addNotification,
    removeNotification,
    clearAll,
  } = useNotifications();

  const [activeTab, setActiveTab] = useState<AppTab>("profile");
  const [profileData, setProfileData] = useState<ColumnProfile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showUploader, setShowUploader] = useState(false);
  const [selectedAdvancedColumn, setSelectedAdvancedColumn] =
    useState<ColumnProfile | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [showExportWizard, setShowExportWizard] = useState(false);
  const [showSharePanel, setShowSharePanel] = useState(false);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [showColumnDetail, setShowColumnDetail] = useState(false);
  const [columnSearch, setColumnSearch] = useState("");
  const [selectedPreviewRow, setSelectedPreviewRow] = useState<Record<string, unknown> | null>(null);
  const [selectedPreviewRowIndex, setSelectedPreviewRowIndex] = useState<number | null>(null);
  const [analyticsColumnName, setAnalyticsColumnName] = useState("");
  const [savedCharts, setSavedCharts] = useState<SavedChartSnapshot[]>([]);
  const [pivotView, setPivotView] = useState<"standard" | "advanced">("standard");
  const queryTabRef = useRef<HTMLDivElement>(null);
  const chartExportProxyRef = useRef<ReactEChartsCore | null>(
    {
      getEchartsInstance: () => {
        if (typeof document === "undefined") {
          return null;
        }

        const chartHost = document.querySelector<HTMLElement>(".echarts-for-react");
        return chartHost ? echarts.getInstanceByDom(chartHost) : null;
      },
    } as unknown as ReactEChartsCore
  );
  const datasets = useDatasetStore((s) => s.datasets);

  // Initialize theme from system preference
  useEffect(() => {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    const stored = localStorage.getItem("datalens-theme");
    const initial =
      stored === "dark" || (!stored && prefersDark) ? "dark" : "light";
    useUIStore.getState().setTheme(initial);
  }, []);

  // Save theme to localStorage
  useEffect(() => {
    localStorage.setItem("datalens-theme", theme);
  }, [theme]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Ignore when in input/textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        // Allow Cmd+K even in inputs
        if (!(mod && e.key === "k")) return;
      }

      if (mod && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
      } else if (mod && e.key === "d") {
        e.preventDefault();
        toggleTheme();
      } else if (mod && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
      } else if (mod && e.key === "n") {
        e.preventDefault();
        if (activeDataset) {
          setShowUploader(true);
        }
      } else if (mod && e.key === "/") {
        e.preventDefault();
        setShowKeyboardShortcuts((v) => !v);
      } else if (e.key === "Escape") {
        setShowCommandPalette(false);
        setShowSettings(false);
        setSelectedAdvancedColumn(null);
        setShowUploader(false);
        setShowKeyboardShortcuts(false);
        setShowSharePanel(false);
        setSelectedPreviewRow(null);
        setSelectedPreviewRowIndex(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleTheme, activeDataset]);

  const handleFileLoaded = useCallback(
    async (result: FileDropResult) => {
      setIsLoading(true);
      setLoadError(null);
      setShowUploader(false);
      try {
        const tableName = sanitizeTableName(result.fileName);

        // 1. Load CSV into DuckDB
        await loadCSVIntoDB(tableName, result.csvContent);

        // 2. Profile the table
        const columns = await profileTable(tableName);

        // 3. Get row count
        const rowCount = await getTableRowCount(tableName);

        // 4. Create dataset metadata
        const meta: DatasetMeta = {
          id: generateId(),
          name: tableName,
          fileName: result.fileName,
          rowCount,
          columnCount: columns.length,
          columns,
          uploadedAt: Date.now(),
          sizeBytes: result.sizeBytes,
        };

        // 5. Store in state
        addDataset(meta);
        setProfileData(columns);
        setActiveTab("profile");
        addNotification({
          type: "success",
          title: "Dataset loaded",
          message: `${result.fileName} is ready with ${formatNumber(
            rowCount
          )} rows and ${columns.length} columns.`,
        });

        // Save to recent datasets in localStorage
        try {
          const recent = JSON.parse(
            localStorage.getItem("datalens-recent") || "[]"
          ) as Array<{ fileName: string; tableName: string; rowCount: number; uploadedAt: number }>;
          recent.unshift({
            fileName: result.fileName,
            tableName,
            rowCount,
            uploadedAt: Date.now(),
          });
          localStorage.setItem(
            "datalens-recent",
            JSON.stringify(recent.slice(0, 10))
          );
        } catch {
          // localStorage errors are non-critical
        }
      } catch (err) {
        console.error("Failed to load dataset:", err);
        const message =
          err instanceof Error ? err.message : "Failed to load dataset";
        setLoadError(message);
        addNotification({
          type: "error",
          title: "Dataset load failed",
          message,
        });
      } finally {
        setIsLoading(false);
      }
    },
    [addDataset, addNotification]
  );

  const handleGeneratedData = useCallback(
    (csvContent: string, fileName: string) => {
      void handleFileLoaded({
        fileName,
        csvContent,
        sizeBytes: new Blob([csvContent]).size,
      });
    },
    [handleFileLoaded]
  );

  // Update profile data when active dataset changes
  useEffect(() => {
    if (activeDataset) {
      setProfileData(activeDataset.columns);
    }
  }, [activeDataset]);

  useEffect(() => {
    if (!profileData.length) {
      setAnalyticsColumnName("");
      return;
    }

    if (!profileData.some((column) => column.name === analyticsColumnName)) {
      const fallback =
        profileData.find((column) => column.type === "number")?.name ??
        profileData[0]?.name ??
        "";
      setAnalyticsColumnName(fallback);
    }
  }, [analyticsColumnName, profileData]);

  useEffect(() => {
    setPreviewRows([]);
    setSelectedAdvancedColumn(null);
    setShowColumnDetail(false);
    setSelectedPreviewRow(null);
    setSelectedPreviewRowIndex(null);
    setColumnSearch("");
  }, [activeDataset?.id, setColumnSearch]);

  useEffect(() => {
    if (activeTab !== "analytics") {
      setShowColumnDetail(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!activeDataset) {
      setSavedCharts([]);
      return;
    }

    const syncSavedCharts = () => {
      setSavedCharts(
        readSavedChartsFromStorage().filter(
          (chart) => chart.tableName === tableName
        )
      );
    };

    const handleChartSaved = (event: Event) => {
      syncSavedCharts();
      const detail = (event as CustomEvent<SavedChartSnapshot>).detail;
      if (detail?.tableName === tableName) {
        addNotification({
          type: "success",
          title: "Chart saved",
          message: `${
            detail.config.title || "Untitled chart"
          } was added to the gallery.`,
        });
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === SAVED_CHARTS_STORAGE_KEY) {
        syncSavedCharts();
      }
    };

    syncSavedCharts();
    window.addEventListener(CHART_SAVED_EVENT, handleChartSaved as EventListener);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(
        CHART_SAVED_EVENT,
        handleChartSaved as EventListener
      );
      window.removeEventListener("storage", handleStorage);
    };
  }, [activeDataset, addNotification, tableName]);

  const refreshActiveDataset = useCallback(
    async (title = "Dataset refreshed", message?: string) => {
      if (!activeDataset) {
        return;
      }

      try {
        const datasetId = activeDataset.id;
        const [columns, rowCount] = await Promise.all([
          profileTable(tableName),
          getTableRowCount(tableName),
        ]);

        setProfileData(columns);
        setPreviewRows([]);
        setSelectedPreviewRow(null);
        setSelectedPreviewRowIndex(null);

        useDatasetStore.setState((state) => ({
          datasets: state.datasets.map((dataset) =>
            dataset.id === datasetId
              ? {
                  ...dataset,
                  rowCount,
                  columnCount: columns.length,
                  columns,
                }
              : dataset
          ),
        }));

        addNotification({
          type: "success",
          title,
          message:
            message ??
            `${tableName} now has ${formatNumber(rowCount)} rows and ${
              columns.length
            } columns.`,
        });
      } catch (error) {
        addNotification({
          type: "error",
          title: "Refresh failed",
          message:
            error instanceof Error
              ? error.message
              : "Unable to refresh the dataset metadata.",
        });
      }
    },
    [activeDataset, addNotification, tableName]
  );

  const registerDerivedDataset = useCallback(
    async ({
      tableName: nextTableName,
      columns,
      fileName = nextTableName,
      nextTab = "profile",
      notificationTitle,
      notificationMessage,
      sizeBytes,
    }: {
      tableName: string;
      columns?: ColumnProfile[];
      fileName?: string;
      nextTab?: AppTab;
      notificationTitle: string;
      notificationMessage?: string;
      sizeBytes?: number;
    }) => {
      try {
        const [resolvedColumns, rowCount] = await Promise.all([
          columns ? Promise.resolve(columns) : profileTable(nextTableName),
          getTableRowCount(nextTableName),
        ]);

        const existingDataset = datasets.find(
          (dataset) => sanitizeTableName(dataset.fileName) === nextTableName
        );
        const nextMeta: DatasetMeta = {
          id: existingDataset?.id ?? generateId(),
          name: nextTableName,
          fileName,
          rowCount,
          columnCount: resolvedColumns.length,
          columns: resolvedColumns,
          uploadedAt: existingDataset?.uploadedAt ?? Date.now(),
          sizeBytes: sizeBytes ?? existingDataset?.sizeBytes ?? 0,
        };

        if (existingDataset) {
          useDatasetStore.setState((state) => ({
            datasets: state.datasets.map((dataset) =>
              dataset.id === existingDataset.id ? nextMeta : dataset
            ),
            activeDatasetId: existingDataset.id,
          }));
        } else {
          addDataset(nextMeta);
        }

        setProfileData(resolvedColumns);
        setActiveTab(nextTab);
        addNotification({
          type: "success",
          title: notificationTitle,
          message:
            notificationMessage ??
            `${fileName} is ready with ${formatNumber(rowCount)} rows and ${resolvedColumns.length} columns.`,
        });
      } catch (error) {
        addNotification({
          type: "error",
          title: "Dataset registration failed",
          message:
            error instanceof Error
              ? error.message
              : "Unable to register the imported dataset.",
        });
      }
    },
    [addDataset, addNotification, datasets]
  );

  const handleConnectorDataLoaded = useCallback(
    (result: { tableName: string; columns: ColumnProfile[] }) => {
      const nextTableName = sanitizeTableName(result.tableName);
      void registerDerivedDataset({
        tableName: nextTableName,
        columns: result.columns,
        fileName: result.tableName,
        nextTab: "profile",
        notificationTitle: "Connector dataset ready",
        notificationMessage: `${result.tableName} was imported through the connectors workspace and is ready to explore.`,
      });
    },
    [registerDerivedDataset]
  );

  const handleSqlJoinComplete = useCallback(
    (result: { tableName: string; sql: string; columns: string[] }) => {
      void registerDerivedDataset({
        tableName: result.tableName,
        fileName: result.tableName,
        nextTab: "sql",
        notificationTitle: "Join materialized",
        notificationMessage: `${result.tableName} was created from the join wizard and is now available in the SQL workspace.`,
      });
    },
    [registerDerivedDataset]
  );

  useEffect(() => {
    if (!activeDataset) {
      return;
    }

    const handleComputedColumnCreated = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          tableName?: string;
          columnName?: string;
        }>
      ).detail;

      if (detail?.tableName !== tableName) {
        return;
      }

      void refreshActiveDataset(
        "Computed column created",
        detail.columnName
          ? `Updated ${tableName} after adding ${detail.columnName}.`
          : `Updated ${tableName} after creating a computed column.`
      );
    };

    window.addEventListener(
      "datalens:computed-column-created",
      handleComputedColumnCreated as EventListener
    );

    return () => {
      window.removeEventListener(
        "datalens:computed-column-created",
        handleComputedColumnCreated as EventListener
      );
    };
  }, [activeDataset, refreshActiveDataset, tableName]);

  const submitNaturalLanguageQuestion = useCallback(
    (question: string) => {
      const container = queryTabRef.current;
      const input = container?.querySelector<HTMLInputElement>(
        'input[placeholder="Ask anything about your data..."]'
      );
      const form = input?.closest("form");

      if (!input || !(form instanceof HTMLFormElement)) {
        addNotification({
          type: "warning",
          title: "Query input unavailable",
          message: "The chat input is not mounted yet.",
        });
        return;
      }

      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;

      setter?.call(input, question);
      input.dispatchEvent(new Event("input", { bubbles: true }));

      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true })
        );
      }
    },
    [addNotification]
  );

  const handlePreviewRowsLoaded = useCallback(
    (rows: Record<string, unknown>[]) => {
      setPreviewRows(rows);
      setSelectedPreviewRow(null);
      setSelectedPreviewRowIndex(null);
    },
    []
  );

  const handlePreviewRowClick = useCallback(
    (row: Record<string, unknown>) => {
      const nextIndex = previewRows.indexOf(row);
      setSelectedPreviewRow(row);
      setSelectedPreviewRowIndex(nextIndex >= 0 ? nextIndex : null);
    },
    [previewRows]
  );

  const handleOpenPreviousPreviewRow = useCallback(() => {
    if (selectedPreviewRowIndex == null || selectedPreviewRowIndex <= 0) {
      return;
    }

    const nextIndex = selectedPreviewRowIndex - 1;
    setSelectedPreviewRowIndex(nextIndex);
    setSelectedPreviewRow(previewRows[nextIndex] ?? null);
  }, [previewRows, selectedPreviewRowIndex]);

  const handleOpenNextPreviewRow = useCallback(() => {
    if (
      selectedPreviewRowIndex == null ||
      selectedPreviewRowIndex >= previewRows.length - 1
    ) {
      return;
    }

    const nextIndex = selectedPreviewRowIndex + 1;
    setSelectedPreviewRowIndex(nextIndex);
    setSelectedPreviewRow(previewRows[nextIndex] ?? null);
  }, [previewRows, selectedPreviewRowIndex]);

  const handleSavedChartRemove = useCallback(
    (chartId: string) => {
      const nextCharts = readSavedChartsFromStorage().filter(
        (entry) => entry.config.id !== chartId
      );

      try {
        window.localStorage.setItem(
          SAVED_CHARTS_STORAGE_KEY,
          JSON.stringify(nextCharts)
        );
      } catch {
        // localStorage failures are non-critical
      }

      setSavedCharts(nextCharts.filter((entry) => entry.tableName === tableName));
      addNotification({
        type: "info",
        title: "Chart removed",
        message: "The saved chart was removed from the gallery.",
      });
    },
    [addNotification, tableName]
  );

  const handleSavedChartEdit = useCallback(
    async (chart: {
      title: string;
      xAxis?: string;
      yAxis?: string;
      groupBy?: string;
      aggregation?: string;
    }) => {
      const summary = JSON.stringify(chart, null, 2);

      try {
        await navigator.clipboard.writeText(summary);
        addNotification({
          type: "info",
          title: "Chart config copied",
          message:
            "ChartBuilder does not expose external edit props, so the saved config was copied to the clipboard.",
        });
      } catch {
        addNotification({
          type: "warning",
          title: "Clipboard unavailable",
          message: "The saved chart config could not be copied.",
        });
      }
    },
    [addNotification]
  );

  const handleFormulaSave = useCallback(
    async (name: string, expression: string) => {
      const stamp = Date.now();
      const escapedTableName = tableName.replace(/"/g, '""');
      const sourceSql = `"${escapedTableName}"`;
      const tempSql = `"${escapedTableName}__formula_${stamp}"`;
      const backupSql = `"${escapedTableName}__formula_backup_${stamp}"`;
      const aliasSql = `"${name.replace(/"/g, '""')}"`;

      try {
        await runQuery(`DROP TABLE IF EXISTS ${tempSql}`);
        await runQuery(`DROP TABLE IF EXISTS ${backupSql}`);
        await runQuery(
          `CREATE TABLE ${tempSql} AS SELECT *, ${expression} AS ${aliasSql} FROM ${sourceSql}`
        );
        await runQuery(`ALTER TABLE ${sourceSql} RENAME TO ${backupSql}`);

        try {
          await runQuery(`ALTER TABLE ${tempSql} RENAME TO ${sourceSql}`);
          await runQuery(`DROP TABLE ${backupSql}`);
        } catch (swapError) {
          await runQuery(`ALTER TABLE ${backupSql} RENAME TO ${sourceSql}`).catch(
            () => undefined
          );
          await runQuery(`DROP TABLE IF EXISTS ${tempSql}`).catch(
            () => undefined
          );
          throw swapError;
        }

        await refreshActiveDataset(
          "Computed column added",
          `${name} was added to ${tableName}.`
        );
      } catch (error) {
        addNotification({
          type: "error",
          title: "Computed column failed",
          message:
            error instanceof Error
              ? error.message
              : "Unable to save the computed column.",
        });
      }
    },
    [addNotification, refreshActiveDataset, tableName]
  );

  const handleNewDataset = useCallback(() => {
    if (datasetCount > 0) {
      setShowUploader(true);
    } else {
      setActiveDataset(null);
      setProfileData([]);
      setActiveTab("profile");
      setLoadError(null);
    }
  }, [setActiveDataset, datasetCount]);

  const handleCommandAction = useCallback(
    (action: string) => {
      setShowCommandPalette(false);
      switch (action) {
        case "new-dataset":
          handleNewDataset();
          break;
        case "toggle-theme":
          toggleTheme();
          break;
        case "settings":
          setShowSettings(true);
          break;
        case "export-csv":
          if (activeDataset) {
            const tableName = sanitizeTableName(activeDataset.fileName);
            runQuery(`SELECT * FROM "${tableName}" LIMIT 10000`).then(
              (data) => {
                import("@/lib/utils/export").then(({ exportToCSV }) => {
                  exportToCSV(data, activeDataset.fileName.replace(/\.\w+$/, ""));
                });
              }
            );
          }
          break;
        case "export-json":
          if (activeDataset) {
            const tableName = sanitizeTableName(activeDataset.fileName);
            runQuery(`SELECT * FROM "${tableName}" LIMIT 10000`).then(
              (data) => {
                import("@/lib/utils/export").then(({ exportToJSON }) => {
                  exportToJSON(data, activeDataset.fileName.replace(/\.\w+$/, ""));
                });
              }
            );
          }
          break;
        case "github":
          window.open(
            "https://github.com/Aandrew-Kl/DataLens",
            "_blank"
          );
          break;
      }
    },
    [handleNewDataset, toggleTheme, activeDataset]
  );

  // ─── Landing State (no dataset loaded) ───

  if (!activeDataset && !showUploader) {
    return (
      <ToastProvider>
        <ErrorBoundary>
          <LoadingOverlay
            visible={isLoading}
            message="Loading and profiling dataset..."
          />
          <OnboardingTour />
          <div className="flex flex-1 flex-col min-h-screen">
          {/* Top bar */}
          <header className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 shadow-md shadow-indigo-500/20">
                <Database className="h-4 w-4 text-white" />
              </div>
              <span className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                DataLens
              </span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="https://github.com/Aandrew-Kl/DataLens"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="View on GitHub"
              >
                <GithubIcon className="h-5 w-5" />
              </a>
              <button
                onClick={toggleTheme}
                className="rounded-lg p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="Toggle dark mode"
              >
                {theme === "dark" ? (
                  <Sun className="h-5 w-5" />
                ) : (
                  <Moon className="h-5 w-5" />
                )}
              </button>
            </div>
          </header>

          {/* Hero section */}
          <main className="flex flex-1 flex-col items-center justify-center px-6 pb-16">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="w-full max-w-2xl text-center space-y-8"
            >
              {/* Branding */}
              <div className="space-y-4">
                <motion.div
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 200, damping: 15 }}
                  className="inline-flex items-center gap-3 mb-2"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-xl shadow-indigo-500/25">
                    <Database className="h-7 w-7 text-white" />
                  </div>
                  <h1 className="text-5xl font-bold tracking-tight text-slate-900 dark:text-white">
                    DataLens
                  </h1>
                </motion.div>
                <p className="text-xl font-medium text-slate-700 dark:text-slate-200">
                  Drop a file. Ask anything. See everything.
                </p>
                <p className="text-base text-slate-500 dark:text-slate-400 max-w-lg mx-auto">
                  Open source AI-powered data explorer. No SQL needed. Runs
                  100% locally.
                </p>
              </div>

              {/* File drop zone */}
              <FileDropzone onFileLoaded={handleFileLoaded} />

              {/* Loading overlay */}
              {isLoading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center justify-center gap-3 text-sm text-slate-500"
                >
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                  Loading and profiling data...
                </motion.div>
              )}

              {/* Load error */}
              {loadError && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-400"
                >
                  {loadError}
                </motion.div>
              )}

              {/* Sample datasets */}
              <div className="pt-2">
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
                  Or try a sample dataset:
                </p>
                <ErrorBoundary>
                  <SampleDatasets
                    onLoad={(fileName, csvContent) => {
                      handleFileLoaded({
                        fileName,
                        csvContent,
                        sizeBytes: new Blob([csvContent]).size,
                      });
                    }}
                  />
                </ErrorBoundary>
              </div>

              {/* Feature badges */}
              <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
                {FEATURES.map((feat) => (
                  <div
                    key={feat.label}
                    className="flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 backdrop-blur-sm"
                  >
                    <feat.icon className="h-3.5 w-3.5" />
                    {feat.label}
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="w-full max-w-6xl px-4 pt-10"
            >
              <ErrorBoundary>
                <DataFaker onDataGenerated={handleGeneratedData} />
              </ErrorBoundary>
            </motion.div>

            {/* Feature cards below */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="w-full max-w-4xl mt-16 px-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {LANDING_FEATURES.map((feat, i) => (
                  <motion.div
                    key={feat.title}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + i * 0.08 }}
                    className="rounded-xl border border-slate-200/60 dark:border-slate-700/50 bg-white/60 dark:bg-gray-900/40 backdrop-blur-sm p-5 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                        <feat.icon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        {feat.title}
                      </h3>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {feat.description}
                    </p>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </main>

          {/* Footer */}
          <footer className="text-center py-4 text-xs text-slate-400 dark:text-slate-600">
            <a
              href="https://github.com/Aandrew-Kl/DataLens"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-600 dark:hover:text-slate-400 transition-colors"
            >
              MIT License &middot; Star on GitHub
            </a>
          </footer>
          </div>
        </ErrorBoundary>
      </ToastProvider>
    );
  }

  // ─── Workspace State ───
  const analyticsColumn =
    profileData.find((column) => column.name === analyticsColumnName) ??
    profileData.find((column) => column.type === "number") ??
    profileData[0] ??
    null;
  const totalNulls = activeDataset
    ? profileData.reduce((sum, column) => sum + column.nullCount, 0)
    : 0;
  const completenessPct =
    activeDataset && activeDataset.rowCount > 0 && profileData.length > 0
      ? ((activeDataset.rowCount * profileData.length - totalNulls) /
          (activeDataset.rowCount * profileData.length)) *
        100
      : 100;
  const savedChartConfigs = savedCharts.map((chart) => chart.config);
  const savedChartData = Object.fromEntries(
    savedCharts.map((chart) => [chart.config.id, chart.data])
  );
  const columnSearchQuery = columnSearch.trim().toLowerCase();
  const matchingColumns = profileData.filter((column) => {
    if (!columnSearchQuery) {
      return true;
    }

    const haystack = [
      column.name,
      column.type,
      ...column.sampleValues.map((value) => String(value ?? "")),
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(columnSearchQuery);
  });
  const currentTabLabel =
    TABS.find((tab) => tab.id === activeTab)?.label ?? "Workspace";
  const workspaceTabItems = TABS.map((tab) => ({
    ...tab,
    badge:
      tab.id === "charts"
        ? savedCharts.length || undefined
        : tab.id === "catalog"
          ? datasetCount
          : tab.id === "quality"
            ? profileData.filter((column) => column.nullCount > 0).length ||
              undefined
            : undefined,
  }));
  const commandBarCommands: CommandBarCommand[] = [
    {
      id: "new-dataset",
      label: "Upload dataset",
      category: "File",
      description: "Load a new file into the current workspace.",
      keywords: ["import", "csv", "dataset", "file"],
      icon: Upload,
    },
    {
      id: "settings",
      label: "Open settings",
      category: "Edit",
      description: "Adjust theme and workspace preferences.",
      keywords: ["preferences", "theme"],
      icon: Settings,
    },
    {
      id: "export-csv",
      label: "Export CSV",
      category: "Export",
      description: "Download the current dataset as CSV.",
      keywords: ["download", "csv", "export"],
      icon: Upload,
    },
    {
      id: "export-json",
      label: "Export JSON",
      category: "Export",
      description: "Download the current dataset as JSON.",
      keywords: ["download", "json", "export"],
      icon: FileText,
    },
    {
      id: "github",
      label: "Open GitHub",
      category: "View",
      description: "Open the DataLens repository.",
      keywords: ["repo", "source", "issues"],
      icon: GithubIcon,
    },
    ...TABS.map((tab) => ({
      id: `tab:${tab.id}`,
      label: `Open ${tab.label}`,
      category: "View" as const,
      description: `Jump to the ${tab.label.toLowerCase()} workspace.`,
      keywords: [tab.id, tab.label.toLowerCase(), "workspace"],
      icon: tab.icon,
    })),
  ];
  const handleCommandBarExecute = (command: CommandBarCommand) => {
    if (command.id.startsWith("tab:")) {
      setActiveTab(command.id.replace("tab:", "") as AppTab);
      return;
    }

    handleCommandAction(command.id);
  };

  return (
    <ToastProvider>
      <ErrorBoundary>
        <LoadingOverlay
          visible={isLoading}
          message="Loading and profiling dataset..."
        />
        <OnboardingTour />
        <div className="flex min-h-screen">
        {/* Sidebar */}
        <AnimatePresence>
          {datasetCount > 0 && (
            <DatasetSidebar
              isOpen={sidebarOpen}
              onToggle={() => setSidebarOpen((v) => !v)}
              onNewDataset={handleNewDataset}
            />
          )}
        </AnimatePresence>

        {/* Main content */}
        <div className="flex flex-1 flex-col min-w-0">
          {/* Top bar */}
          <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/80 dark:bg-gray-900/80 border-b border-slate-200 dark:border-slate-700/50">
            <div className="flex items-center justify-between px-4 sm:px-6 py-3">
              {/* Left: dataset info */}
              <div className="flex items-center gap-3 min-w-0">
                {datasetCount === 0 && (
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600">
                    <Database className="h-4 w-4 text-white" />
                  </div>
                )}
                {activeDataset && (
                  <div className="flex items-center gap-3 min-w-0">
                    <h1 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {activeDataset.fileName}
                    </h1>
                    <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Rows3 className="h-3 w-3" />
                        {formatNumber(activeDataset.rowCount)} rows
                      </span>
                      <span className="text-slate-300 dark:text-slate-600">
                        |
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Columns3 className="h-3 w-3" />
                        {activeDataset.columnCount} cols
                      </span>
                      <span className="text-slate-300 dark:text-slate-600">
                        |
                      </span>
                      <span>{formatBytes(activeDataset.sizeBytes)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Right: actions */}
              <div className="flex items-center gap-2">
                {/* Command palette trigger */}
                <button
                  onClick={() => setShowCommandPalette(true)}
                  className="hidden sm:flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400 transition-colors"
                >
                  <span>Search...</span>
                  <kbd className="text-[10px] font-mono bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">
                    {typeof navigator !== "undefined" &&
                    navigator.platform?.includes("Mac")
                      ? "⌘"
                      : "Ctrl+"}
                    K
                  </kbd>
                </button>
                <button
                  onClick={handleNewDataset}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">New Dataset</span>
                </button>
                <button
                  onClick={() => setShowSharePanel(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Share</span>
                </button>
                <button
                  onClick={() => setShowSettings(true)}
                  className="rounded-lg p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  aria-label="Settings"
                >
                  <Settings className="h-4 w-4" />
                </button>
                <button
                  onClick={toggleTheme}
                  className="rounded-lg p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  aria-label="Toggle dark mode"
                >
                  {theme === "dark" ? (
                    <Sun className="h-4 w-4" />
                  ) : (
                    <Moon className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Tab navigation */}
            {activeDataset && (
              <div className="flex px-4 sm:px-6 gap-1 -mb-px overflow-x-auto">
                {TABS.map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`
                        flex items-center gap-2 px-4 py-2.5 text-sm font-medium
                        border-b-2 transition-colors whitespace-nowrap
                        ${
                          isActive
                            ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                            : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600"
                        }
                      `}
                    >
                      <tab.icon className="h-4 w-4" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            )}
          </header>

          {/* Tab content */}
          <main className="flex-1 px-4 sm:px-6 py-6">
            {activeDataset && (
              <div className="mb-4">
                <ErrorBoundary>
                  <Breadcrumb
                    items={[
                      {
                        label: "Workspace",
                        onClick: () => setActiveTab("profile"),
                      },
                      { label: activeDataset.fileName },
                      { label: currentTabLabel },
                    ]}
                  />
                </ErrorBoundary>
              </div>
            )}

            {activeDataset && (
              <div className="mb-6">
                <ErrorBoundary>
                  <DataBookmarks tableName={tableName} columns={profileData} />
                </ErrorBoundary>
              </div>
            )}

            {/* Upload modal overlay */}
            {showUploader && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
                onClick={() => setShowUploader(false)}
              >
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="bg-white dark:bg-gray-900 rounded-2xl p-8 max-w-xl w-full mx-4 shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                      Upload New Dataset
                    </h2>
                    <button
                      onClick={() => setShowUploader(false)}
                      className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      <X className="h-5 w-5 text-slate-400" />
                    </button>
                  </div>
                  <FileDropzone onFileLoaded={handleFileLoaded} />

                  {isLoading && (
                    <div className="flex items-center justify-center gap-3 text-sm text-slate-500 mt-4">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                      Loading and profiling...
                    </div>
                  )}
                </motion.div>
              </motion.div>
            )}

            {/* No dataset selected state */}
            {!activeDataset && !showUploader && (
              <div className="flex flex-col items-center justify-center py-24 gap-4">
                <Database className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                <p className="text-slate-500 dark:text-slate-400">
                  Select a dataset from the sidebar or upload a new one
                </p>
                <button
                  onClick={handleNewDataset}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-colors"
                >
                  <Upload className="h-4 w-4" />
                  Upload Dataset
                </button>
              </div>
            )}

            {/* Active dataset tabs */}
            {activeDataset && (
              <AnimatePresence mode="wait">
                {activeTab === "profile" && (
                  <motion.div
                    key="profile"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    <ErrorBoundary>
                      <DataAlerts
                        tableName={tableName}
                        columns={profileData}
                        rowCount={activeDataset.rowCount}
                      />
                    </ErrorBoundary>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                          Column Profiles
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          Automated data profiling for{" "}
                          {profileData.length} columns across{" "}
                          {formatNumber(activeDataset.rowCount)} rows
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          void refreshActiveDataset(
                            "Profile refreshed",
                            `Re-profiled ${tableName}.`
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Refresh Metadata
                      </button>
                    </div>
                    <ErrorBoundary>
                      <DataOverview
                        tableName={tableName}
                        columns={profileData}
                        rowCount={activeDataset.rowCount}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <DataProfilerSummary
                        tableName={tableName}
                        columns={profileData}
                        rowCount={activeDataset.rowCount}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <DataProfilerAI
                        tableName={tableName}
                        columns={profileData}
                        rowCount={activeDataset.rowCount}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <DataProfiler
                        columns={profileData}
                        rowCount={activeDataset.rowCount}
                        onColumnClick={(col) =>
                          setSelectedAdvancedColumn(col)
                        }
                      />
                    </ErrorBoundary>
                    <ToolSection
                      title="Full Profile Report"
                      description="Run a broader profiling pass with quality scoring, missingness heatmaps, and export-ready dataset diagnostics."
                    >
                      <ErrorBoundary>
                        <DataProfilerFull
                          tableName={tableName}
                          columns={profileData}
                          rowCount={activeDataset.rowCount}
                        />
                      </ErrorBoundary>
                    </ToolSection>
                    <ToolSection
                      title="Guided Data Tour"
                      description="Walk through the dataset shape, strongest signals, missingness hotspots, and recommended next steps in a narrative-first tour."
                    >
                      <ErrorBoundary>
                        <DataTour
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                    </ToolSection>
                    <ToolSection
                      title="Column Finder"
                      description="Search the active schema by name, type, or sampled values, then jump straight into the detailed column drawer."
                    >
                      <ErrorBoundary>
                        <div className="space-y-4 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
                          <SearchInput
                            value={columnSearch}
                            onChange={setColumnSearch}
                            placeholder="Search columns, types, or sampled values..."
                            debounceMs={120}
                          />
                          {columnSearchQuery && matchingColumns.length === 0 ? (
                            <EmptyState
                              icon={Search}
                              title="No matching columns"
                              description="Try a broader search or clear the current filter to browse the full schema."
                              action={{
                                label: "Clear Search",
                                onClick: () => setColumnSearch(""),
                              }}
                            />
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {(columnSearchQuery
                                ? matchingColumns
                                : profileData.slice(0, 12)
                              ).map((column) => (
                                <button
                                  key={column.name}
                                  type="button"
                                  onClick={() => setSelectedAdvancedColumn(column)}
                                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                  <span>{column.name}</span>
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                    {column.type}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </ErrorBoundary>
                    </ToolSection>

                    <div className="pt-4">
                      <div className="flex items-center justify-between mb-1">
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                          Data Preview
                        </h2>
                        <button
                          onClick={() => setShowExportWizard(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                        >
                          <Upload className="h-3.5 w-3.5 rotate-180" />
                          Export
                        </button>
                      </div>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                        First 200 rows
                      </p>
                      <ErrorBoundary>
                        <TablePreview
                          tableName={tableName}
                          columns={profileData}
                          onRowsLoaded={handlePreviewRowsLoaded}
                          onRowClick={handlePreviewRowClick}
                        />
                      </ErrorBoundary>
                    </div>
                    <ToolSection
                      title="Interactive Preview"
                      description="Browse a paginated preview with sortable headers, inline filtering, and column-level quick stats beyond the first 200 rows."
                    >
                      <ErrorBoundary>
                        <DataPreview
                          tableName={tableName}
                          columns={profileData}
                          previewRows={previewRows}
                        />
                      </ErrorBoundary>
                    </ToolSection>

                    <div className="pt-4">
                      <ErrorBoundary>
                        <SchemaViewer
                          tableName={tableName}
                          columns={profileData}
                          rowCount={activeDataset.rowCount}
                        />
                      </ErrorBoundary>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <MetricCard label="Rows" value={activeDataset.rowCount} emoji="📄" />
                      <MetricCard label="Columns" value={profileData.length} emoji="🧱" />
                      <MetricCard
                        label="Completeness"
                        value={`${completenessPct.toFixed(1)}%`}
                        emoji="✅"
                      />
                      <MetricCard
                        label="Dataset Size"
                        value={formatBytes(activeDataset.sizeBytes)}
                        emoji="💾"
                      />
                    </div>
                    <ToolSection
                      title="Readiness Gauge"
                      description="Track dataset completeness as a single operational KPI before you pivot into cleaning, reporting, or modeling work."
                    >
                      <ErrorBoundary>
                        <GaugeChart
                          value={Math.max(0, Math.min(100, completenessPct))}
                          min={0}
                          max={100}
                          title={`${activeDataset.fileName} completeness`}
                          thresholds={{ green: 75, yellow: 90, red: 100 }}
                        />
                      </ErrorBoundary>
                    </ToolSection>

                    <ErrorBoundary>
                      <DataDictionary
                        tableName={tableName}
                        columns={profileData}
                        rowCount={activeDataset.rowCount}
                      />
                    </ErrorBoundary>

                    <ErrorBoundary>
                      <VirtualDataGrid
                        tableName={tableName}
                        columns={profileData}
                        totalRows={activeDataset.rowCount}
                      />
                    </ErrorBoundary>

                    <ErrorBoundary>
                      <SnapshotManager
                        tableName={tableName}
                        columns={profileData}
                        rowCount={activeDataset.rowCount}
                      />
                    </ErrorBoundary>
                  </motion.div>
                )}

                {activeTab === "dashboard" && (
                  <motion.div
                    key="dashboard"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ErrorBoundary>
                      <DashboardView
                        dataset={activeDataset}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                  </motion.div>
                )}

                {activeTab === "connectors" && (
                  <motion.div
                    key="connectors"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                        Data Connectors
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Import additional datasets from files, URLs, pasted
                        content, and curated samples without leaving the active
                        workspace.
                      </p>
                    </div>
                    <ToolSection
                      title="Connector Workspace"
                      description="Bring in CSV, JSON, parquet, remote, and sample sources as new DataLens datasets."
                    >
                      <ErrorBoundary>
                        <DataConnector onDataLoaded={handleConnectorDataLoaded} />
                      </ErrorBoundary>
                    </ToolSection>
                    <ToolSection
                      title="Merge Datasets"
                      description="Append, union, or join multiple loaded sources into a new dataset without leaving the import workspace."
                    >
                      <ErrorBoundary>
                        <MergeDatasets
                          onMergeComplete={(nextTableName) =>
                            void registerDerivedDataset({
                              tableName: sanitizeTableName(nextTableName),
                              fileName: nextTableName,
                              nextTab: "profile",
                              notificationTitle: "Merged dataset ready",
                              notificationMessage: `${nextTableName} was materialized from the merge workspace and is ready to explore.`,
                            })
                          }
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
                  </motion.div>
                )}

                {activeTab === "catalog" && (
                  <motion.div
                    key="catalog"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                        Dataset Catalog
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Browse loaded DuckDB relations, inspect schema metadata,
                        and manage the active workspace inventory from one tab.
                      </p>
                    </div>
                    <ErrorBoundary>
                      <DataCatalog />
                    </ErrorBoundary>
                  </motion.div>
                )}

                {activeTab === "query" && (
                  <motion.div
                    key="query"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="max-w-4xl mx-auto"
                  >
                    <div ref={queryTabRef} className="space-y-4">
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                        Ask Your Data
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Ask questions in plain English — AI generates SQL and
                        shows results instantly
                      </p>
                      <ErrorBoundary>
                        <NaturalLanguageBar
                          tableName={tableName}
                          columns={profileData}
                          onSubmit={submitNaturalLanguageQuestion}
                        />
                      </ErrorBoundary>
                      <ErrorBoundary>
                        <ChatInterface
                          datasetId={activeDataset.id}
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                    </div>
                  </motion.div>
                )}

                {activeTab === "sql" && (
                  <motion.div
                    key="sql"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    <div className="mb-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                            SQL Editor
                          </h2>
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            Write and execute SQL queries directly against your
                            data with DuckDB
                          </p>
                        </div>
                      </div>
                    </div>
                    <ErrorBoundary>
                      <SQLEditorTab
                        key={tableName}
                        tableName={tableName}
                        columns={profileData}
                        datasetId={activeDataset.id}
                      />
                    </ErrorBoundary>
                    <details className="group rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
                      <summary className="cursor-pointer list-none">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
                              <GitMerge className="h-4 w-4" />
                            </div>
                            <div>
                              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                                Data Join Wizard
                              </h3>
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                Build and materialize multi-table joins in a
                                guided workflow without leaving the SQL tab.
                              </p>
                            </div>
                          </div>
                          <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                            Expand
                          </span>
                        </div>
                      </summary>
                      <div className="mt-4">
                        {datasets.length > 1 ? (
                          <ErrorBoundary>
                            <DataJoinWizard
                              tables={datasets.map((dataset) =>
                                sanitizeTableName(dataset.fileName)
                              )}
                              onJoinComplete={handleSqlJoinComplete}
                            />
                          </ErrorBoundary>
                        ) : (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                            Load at least one more dataset to use the join
                            wizard.
                          </div>
                        )}
                      </div>
                    </details>
                  </motion.div>
                )}

                {activeTab === "charts" && (
                  <motion.div
                    key="charts"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="mb-4">
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                        Chart Builder
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Create custom visualizations with drag-and-drop chart
                        configuration
                      </p>
                    </div>
                    <ErrorBoundary>
                      <ChartBuilder
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                    <div className="mt-6">
                      <ToolSection
                        title="Chart Templates"
                        description="Start from reusable visual patterns with auto-mapped fields and saved template presets."
                      >
                        <ErrorBoundary>
                          <ChartTemplates
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                    </div>
                    <details className="group mt-6 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
                      <summary className="cursor-pointer list-none">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                              Chart Export Utility
                            </h3>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              Export the current chart focus or batch-export
                              every mounted chart from this workspace.
                            </p>
                          </div>
                          <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                            Expand
                          </span>
                        </div>
                      </summary>
                      <div className="mt-4">
                        <ErrorBoundary>
                          <ChartExport
                            chartRef={chartExportProxyRef}
                            chartTitle={activeDataset.fileName}
                          />
                        </ErrorBoundary>
                      </div>
                    </details>
                    <div className="mt-6 space-y-6">
                      <ErrorBoundary>
                        <ChartAnnotator
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                      <ErrorBoundary>
                        <ChartRecommendations
                          tableName={tableName}
                          columns={profileData}
                          rowCount={activeDataset.rowCount}
                        />
                      </ErrorBoundary>
                      <ErrorBoundary>
                        <ChartGallery
                          charts={savedChartConfigs}
                          chartData={savedChartData}
                          onRemove={handleSavedChartRemove}
                          onEdit={handleSavedChartEdit}
                        />
                      </ErrorBoundary>
                      <ToolSection
                        title="Standalone Renderer"
                        description="Preview the shared chart renderer against a saved chart configuration without leaving the charts workspace."
                      >
                        <ErrorBoundary>
                          {savedCharts[0] ? (
                            <ChartRenderer
                              config={savedCharts[0].config}
                              data={
                                savedChartData[savedCharts[0].config.id] ??
                                savedCharts[0].data
                              }
                            />
                          ) : (
                            <div className="rounded-xl border border-dashed border-slate-200 bg-white/70 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
                              Save a chart from the builder to preview it in the
                              standalone renderer.
                            </div>
                          )}
                        </ErrorBoundary>
                      </ToolSection>
                      <ErrorBoundary>
                        <SparklineGrid
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                      <ErrorBoundary>
                        <GeoChart
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                      <ErrorBoundary>
                        <ScatterMatrix
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                      <ToolSection
                        title="Area Chart"
                        description="Layer aggregate trends over time or category buckets and compare grouped series with a stacked or standard area view."
                      >
                        <ErrorBoundary>
                          <AreaChart
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                      <ToolSection
                        title="Donut Chart"
                        description="Summarize categorical composition with configurable labels, top-slice grouping, and share-driven narrative cues."
                      >
                        <ErrorBoundary>
                          <DonutChart
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                      <ToolSection
                        title="Heatmap Chart"
                        description="Compare density and magnitude across paired dimensions with color-driven matrix views that work well for compact dashboards."
                      >
                        <ErrorBoundary>
                          <HeatmapChart
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                      <ToolSection
                        title="Parallel Coordinates"
                        description="Inspect multi-metric record shape, filter by grouped cohorts, and reveal cluster separation across many axes at once."
                      >
                        <ErrorBoundary>
                          <ParallelCoordinates
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                      <ToolSection
                        title="Box Plot"
                        description="Review quartiles, whiskers, and outlier points for one or more numeric columns before publishing summary statistics."
                      >
                        <ErrorBoundary>
                          <BoxplotChart
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                      <ToolSection
                        title="Waterfall Chart"
                        description="Track additive and subtractive contributions across ordered categories and export the result as a polished narrative chart."
                      >
                        <ErrorBoundary>
                          <WaterfallChart
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                      <ToolSection
                        title="Funnel Chart"
                        description="Visualize stage conversion, identify the largest drop-offs, and inspect throughput between each step."
                      >
                        <ErrorBoundary>
                          <FunnelChart
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                      <ToolSection
                        title="Treemap Chart"
                        description="Compare hierarchical category share with an area-based layout that works well for dense breakdowns."
                      >
                        <ErrorBoundary>
                          <TreemapChart
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                      <ToolSection
                        title="Radar Chart"
                        description="Overlay normalized metric performance across multiple axes to compare segments or the whole dataset at a glance."
                      >
                        <ErrorBoundary>
                          <RadarChart
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                      <ToolSection
                        title="Sankey Chart"
                        description="Aggregate flow between source and target dimensions to understand movement, drop-off, and throughput across categories."
                      >
                        <ErrorBoundary>
                          <SankeyChart
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                      <ToolSection
                        title="Chart Completeness Gauge"
                        description="Keep a single KPI-style readout of dataset completeness inside the charting workspace."
                      >
                        <ErrorBoundary>
                          <GaugeChart
                            value={completenessPct}
                            min={0}
                            max={100}
                            title="Dataset completeness"
                          />
                        </ErrorBoundary>
                      </ToolSection>
                    </div>
                  </motion.div>
                )}

                {activeTab === "forecast" && (
                  <motion.div
                    key="forecast"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                        Forecasting
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Project future values from time-series columns with
                        confidence bands and exportable forecast outputs.
                      </p>
                    </div>
                    <ErrorBoundary>
                      <DataForecast
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                  </motion.div>
                )}

                {activeTab === "ml" && (
                  <motion.div
                    key="ml"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                        Machine Learning
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Explore unsupervised clustering and regression workflows
                        directly against the active dataset.
                      </p>
                    </div>
                    <ToolSection
                      title="Clustering"
                      description="Group similar records into data-driven segments and inspect cluster size, centroids, and variance."
                    >
                      <ErrorBoundary>
                        <ClusteringView
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                    </ToolSection>
                    <ToolSection
                      title="Regression"
                      description="Fit regression models, inspect fitted curves, and review residual behavior from the same workspace."
                    >
                      <ErrorBoundary>
                        <RegressionView
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                    </ToolSection>
                  </motion.div>
                )}

                {activeTab === "explore" && (
                  <motion.div
                    key="explore"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                        Explore Relationships
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        A curated set of tools for finding structure, patterns,
                        anomalies, and multivariate relationships in your data.
                      </p>
                    </div>
                    <ToolSection
                      title="Relationship Explorer"
                      description="Inspect column pairings and structural links to understand how fields move together."
                    >
                      <ErrorBoundary>
                        <RelationshipExplorer
                          tableName={tableName}
                          columns={profileData}
                          rowCount={activeDataset.rowCount}
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
                          columns={profileData}
                          rowCount={activeDataset.rowCount}
                        />
                      </ErrorBoundary>
                    </ToolSection>
                    <ToolSection
                      title="Correlation Finder"
                      description="Drill into numeric pairings with ranked correlation scans, a matrix heatmap, and a scatter preview for the strongest relationships."
                    >
                      <ErrorBoundary>
                        <CorrelationFinder
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                    </ToolSection>
                    <ToolSection
                      title="Anomaly Heatmap"
                      description="Scan the dataset for unusual combinations, sparse regions, and suspicious concentrations."
                    >
                      <ErrorBoundary>
                        <AnomalyHeatmap
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                    </ToolSection>
                    <ToolSection
                      title="Scatter Matrix"
                      description="Compare multiple numeric dimensions at once to reveal clusters, trends, and outliers."
                    >
                      <ErrorBoundary>
                        <ScatterMatrix
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                    </ToolSection>
                  </motion.div>
                )}

                {activeTab === "builder" && (
                  <motion.div
                    key="builder"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="mb-4">
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                        Dashboard Builder
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Compose a custom dashboard layout with charts, tables,
                        KPI cards, and notes.
                      </p>
                    </div>
                    <ErrorBoundary>
                      <DashboardBuilder
                        tableName={tableName}
                        columns={profileData}
                        rowCount={activeDataset.rowCount}
                      />
                    </ErrorBoundary>
                    <div className="mt-6">
                      <ToolSection
                        title="Workspace Polish Lab"
                        description="Exercise shared navigation, command, state, and fallback primitives from a contained builder-side integration surface."
                      >
                        <WorkspacePolishLab
                          activeTab={activeTab}
                          onTabChange={setActiveTab}
                          tabs={workspaceTabItems}
                          commands={commandBarCommands}
                          onExecuteCommand={handleCommandBarExecute}
                        />
                      </ToolSection>
                    </div>
                  </motion.div>
                )}

                {activeTab === "transforms" && (
                  <motion.div
                    key="transforms"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="mb-4">
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                        Data Transforms
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Filter, sort, group, and create computed columns on
                        your data
                      </p>
                    </div>
                    <div className="space-y-6">
                      <ErrorBoundary>
                        <DataPipeline
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                      <ErrorBoundary>
                        <ColumnTransformer
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                      <ToolSection
                        title="Smart Filters"
                        description="Build reusable multi-condition filter logic and turn it into SQL-ready predicates for downstream analysis."
                      >
                        <ErrorBoundary>
                          <SmartFilter
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                      <ErrorBoundary>
                        <DataCleaner
                          tableName={tableName}
                          columns={profileData}
                          onCleanComplete={() =>
                            void refreshActiveDataset(
                              "Cleaning complete",
                              `Updated ${tableName} after cleaning operations.`
                            )
                          }
                        />
                      </ErrorBoundary>
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <ErrorBoundary>
                          <TransformPanel
                            tableName={tableName}
                            columns={profileData}
                            onTransformComplete={() =>
                              void refreshActiveDataset(
                                "Transform complete",
                                `Updated ${tableName} after the transform run.`
                              )
                            }
                          />
                        </ErrorBoundary>
                        {datasets.length > 1 && (
                          <ErrorBoundary>
                            <JoinBuilder
                              datasets={datasets}
                              onJoinComplete={() =>
                                void refreshActiveDataset(
                                  "Join complete",
                                  `Re-profiled ${tableName} after the join finished.`
                                )
                              }
                            />
                          </ErrorBoundary>
                        )}
                      </div>
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <ErrorBoundary>
                          <ColumnRenamer
                            tableName={tableName}
                            columns={profileData}
                            onComplete={() =>
                              void refreshActiveDataset(
                                "Columns renamed",
                                `Updated column names for ${tableName}.`
                              )
                            }
                          />
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <NullHandler
                            tableName={tableName}
                            columns={profileData}
                            onComplete={() =>
                              void refreshActiveDataset(
                                "Null handling applied",
                                `Updated null handling rules for ${tableName}.`
                              )
                            }
                          />
                        </ErrorBoundary>
                      </div>
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <ErrorBoundary>
                          <TypeConverter
                            tableName={tableName}
                            columns={profileData}
                            onConvert={() =>
                              void refreshActiveDataset(
                                "Types converted",
                                `Column types were refreshed for ${tableName}.`
                              )
                            }
                          />
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <DuplicateFinder
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </div>
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <ErrorBoundary>
                          <ColumnGrouper
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <DataChangelog tableName={tableName} />
                        </ErrorBoundary>
                      </div>
                      <ErrorBoundary>
                        <DataSampler
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                      <ErrorBoundary>
                        <FormulaEditor
                          tableName={tableName}
                          columns={profileData}
                          onSave={handleFormulaSave}
                        />
                      </ErrorBoundary>
                      <ToolSection
                        title="Data Enrichment"
                        description="Generate derived fields with date parts, ranking, lag/lead, binning, and running aggregates before downstream analysis."
                      >
                        <ErrorBoundary>
                          <DataEnrichment
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                      <ErrorBoundary>
                        <RegexTester
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                      <ToolSection
                        title="Data Quality Rules"
                        description="Define validation rules, persist reusable rule sets, and quantify violations before publishing downstream assets."
                      >
                        <ErrorBoundary>
                          <DataQualityRules
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                      <ToolSection
                        title="Anomaly Detector"
                        description="Run statistical anomaly detection with multiple methods to surface unexpected records and time-series spikes."
                      >
                        <ErrorBoundary>
                          <AnomalyDetector
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                    </div>
                  </motion.div>
                )}

                {activeTab === "quality" && (
                  <motion.div
                    key="quality"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                        Data Quality Rules
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Define reusable validation rules, quantify failures,
                        and track dataset quality from a dedicated workspace.
                      </p>
                    </div>
                    <ErrorBoundary>
                      <DataQualityRules
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                  </motion.div>
                )}

                {activeTab === "clean" && (
                  <motion.div
                    key="clean"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                        Data Cleaning
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Normalize, validate, and repair the active dataset with
                        focused cleanup tools in one place.
                      </p>
                    </div>
                    <ToolSection
                      title="Cleaner"
                      description="Run broad cleanup passes to standardize rows and remove common data quality issues."
                    >
                      <ErrorBoundary>
                        <DataCleaner
                          tableName={tableName}
                          columns={profileData}
                          onCleanComplete={() =>
                            void refreshActiveDataset(
                              "Cleaning complete",
                              `Updated ${tableName} after cleaning operations.`
                            )
                          }
                        />
                      </ErrorBoundary>
                    </ToolSection>
                    <ToolSection
                      title="Duplicate Finder"
                      description="Detect repeated records and inspect likely duplicate clusters before taking action."
                    >
                      <ErrorBoundary>
                        <DuplicateFinder
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                    </ToolSection>
                    <ToolSection
                      title="Null Handling"
                      description="Profile missing values and apply fill, drop, or imputation strategies by column."
                    >
                      <ErrorBoundary>
                        <NullHandler
                          tableName={tableName}
                          columns={profileData}
                          onComplete={() =>
                            void refreshActiveDataset(
                              "Null handling applied",
                              `Updated null handling rules for ${tableName}.`
                            )
                          }
                        />
                      </ErrorBoundary>
                    </ToolSection>
                    <ToolSection
                      title="Type Conversion"
                      description="Convert columns to the right storage and semantic types before downstream analysis."
                    >
                      <ErrorBoundary>
                        <TypeConverter
                          tableName={tableName}
                          columns={profileData}
                          onConvert={() =>
                            void refreshActiveDataset(
                              "Types converted",
                              `Column types were refreshed for ${tableName}.`
                            )
                          }
                        />
                      </ErrorBoundary>
                    </ToolSection>
                    <ToolSection
                      title="Validation"
                      description="Check business rules, schema assumptions, and inconsistent values before reporting."
                    >
                      <ErrorBoundary>
                        <DataValidator
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                    </ToolSection>
                  </motion.div>
                )}

                {activeTab === "analytics" && (
                  <motion.div
                    key="analytics"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="mb-4">
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                        Advanced Analytics
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Correlation analysis, outlier detection, and data
                        quality assessment
                      </p>
                    </div>
                    <div className="space-y-6">
                      <ErrorBoundary>
                        <DataSummary
                          dataset={activeDataset}
                          columns={profileData}
                        />
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
                          columns={profileData}
                          rowCount={activeDataset.rowCount}
                        />
                      </ErrorBoundary>
                      <ErrorBoundary>
                        <ColumnCorrelator
                          tableName={tableName}
                          columns={profileData}
                          rowCount={activeDataset.rowCount}
                        />
                      </ErrorBoundary>
                      <ErrorBoundary>
                        <CorrelationFinder
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                      <ErrorBoundary>
                        <StatisticalTests
                          tableName={tableName}
                          columns={profileData}
                          rowCount={activeDataset.rowCount}
                        />
                      </ErrorBoundary>
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <ErrorBoundary>
                          <CorrelationMatrix
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <OutlierDetector
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </div>
                      <ErrorBoundary>
                        <MissingDataMap
                          tableName={tableName}
                          columns={profileData}
                          rowCount={activeDataset.rowCount}
                        />
                      </ErrorBoundary>
                      <ErrorBoundary>
                        <AIInsights
                          tableName={tableName}
                          columns={profileData}
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
                                Drill into distribution, quality, and trend details for one field.
                              </p>
                            </div>
                            <select
                              value={analyticsColumn.name}
                              onChange={(event) =>
                                setAnalyticsColumnName(event.target.value)
                              }
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-cyan-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                            >
                              {profileData.map((column) => (
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
                        <Crosstab
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                      <ErrorBoundary>
                        <FrequencyTable
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                      <ErrorBoundary>
                        <TimeSeriesAnalyzer
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                      <ToolSection
                        title="Cohort Analysis"
                        description="Measure retention and repeat behavior by cohort over time using weekly or monthly buckets and heatmap-driven summaries."
                      >
                        <ErrorBoundary>
                          <CohortAnalysis
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                      <ErrorBoundary>
                        <DataValidator
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                      <ErrorBoundary>
                        <AnomalyHeatmap
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                      <ErrorBoundary>
                        <DataQualityDashboard
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                      <ErrorBoundary>
                        <DataStory
                          tableName={tableName}
                          columns={profileData}
                          rowCount={activeDataset.rowCount}
                        />
                      </ErrorBoundary>
                      <ToolSection
                        title="Automation Scheduler"
                        description="Schedule refreshes, pipeline runs, report generation, and alert checks for the active dataset."
                      >
                        <ErrorBoundary>
                          <DataScheduler
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                      <ToolSection
                        title="Dataset Versioning"
                        description="Capture named snapshots, branch working states, and compare row-level differences before major transformations."
                      >
                        <ErrorBoundary>
                          <DataVersioning
                            tableName={tableName}
                            columns={profileData}
                            rowCount={activeDataset.rowCount}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                    </div>
                  </motion.div>
                )}

                {activeTab === "advanced" && (
                  <motion.div
                    key="advanced"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    <ErrorBoundary>
                      <CohortAnalysis tableName={tableName} columns={profileData} />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <DistributionAnalyzer
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <TextColumnAnalyzer
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <DateExplorer tableName={tableName} columns={profileData} />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <SegmentComparison
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <ChangeImpactAnalyzer
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <ColumnDependencyFinder
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <DataSnapshotCompare
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <OutlierReport
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <PivotAnalysis
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <PercentileExplorer
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <TimeSeriesDecomposer
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <CrossTabulation
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <DataSampler
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <BinAnalyzer
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                  </motion.div>
                )}

                {activeTab === "wrangler" && (
                  <motion.div
                    key="wrangler"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                          Data Wrangler
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          Reshape, summarize, preview, and configure pivots for
                          the active dataset from one focused workspace.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void refreshActiveDataset(
                            "Wrangler metadata refreshed",
                            `Re-profiled ${tableName} after wrangling changes.`
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Refresh Metadata
                      </button>
                    </div>
                    <ErrorBoundary>
                      <DataWrangler
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <DataSummarizer
                        tableName={tableName}
                        columns={profileData}
                        rowCount={activeDataset.rowCount}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <DataPreview
                        tableName={tableName}
                        columns={profileData}
                        previewRows={previewRows}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <PivotConfigurator
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                  </motion.div>
                )}

                {activeTab === "lineage" && (
                  <motion.div
                    key="lineage"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                        Data Lineage
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Trace transformations and generate narrative context for
                        the active dataset.
                      </p>
                    </div>
                    <ErrorBoundary>
                      <DataLineageGraph tableName={tableName} />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <DataNarrator
                        tableName={tableName}
                        columns={profileData}
                        rowCount={activeDataset.rowCount}
                      />
                    </ErrorBoundary>
                  </motion.div>
                )}

                {activeTab === "compare" && (
                  <motion.div
                    key="compare"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-4"
                  >
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                        Dataset Comparison
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Compare loaded datasets side by side for schema, quality,
                        and distribution differences.
                      </p>
                    </div>
                    {datasets.length < 2 && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                        Load at least one more dataset for the most useful
                        comparisons. Until then, you can still inspect the
                        current dataset against itself.
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
                        <DataDiff
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                    </ToolSection>
                  </motion.div>
                )}

                {activeTab === "reports" && (
                  <motion.div
                    key="reports"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="space-y-6">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                            Reports
                          </h2>
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            Assemble narrative summaries, chart-backed stories,
                            and reusable report outputs for the active dataset.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-400 transition-colors disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Generate Full Report
                        </button>
                      </div>
                      <ErrorBoundary>
                        <ReportBuilder
                          dataset={activeDataset}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                      <ToolSection
                        title="Dataset Summarizer"
                        description="Generate concise written summaries, key findings, and recommendation exports for the current table in one pass."
                      >
                        <ErrorBoundary>
                          <DataSummarizer
                            tableName={tableName}
                            columns={profileData}
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
                            columns={profileData}
                            rowCount={activeDataset.rowCount}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                      <ErrorBoundary>
                        <DataStory
                          tableName={tableName}
                          columns={profileData}
                          rowCount={activeDataset.rowCount}
                        />
                      </ErrorBoundary>
                    </div>
                  </motion.div>
                )}

                {activeTab === "pivot" && (
                  <motion.div
                    key="pivot"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="mb-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                            Pivot Table
                          </h2>
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            Cross-tabulate your data with custom aggregations
                            and switch between the standard and advanced pivot
                            builders.
                          </p>
                        </div>
                        <div className="inline-flex w-fit rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
                          <button
                            onClick={() => setPivotView("standard")}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                              pivotView === "standard"
                                ? "bg-indigo-500 text-white"
                                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                            }`}
                          >
                            Standard
                          </button>
                          <button
                            onClick={() => setPivotView("advanced")}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                              pivotView === "advanced"
                                ? "bg-indigo-500 text-white"
                                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                            }`}
                          >
                            Advanced
                          </button>
                        </div>
                      </div>
                    </div>
                    <ErrorBoundary>
                      {pivotView === "advanced" ? (
                        <PivotTableAdvanced
                          tableName={tableName}
                          columns={profileData}
                        />
                      ) : (
                        <PivotTable
                          tableName={tableName}
                          columns={profileData}
                        />
                      )}
                    </ErrorBoundary>
                    <div className="mt-6">
                      <ToolSection
                        title="Pivot Configurator"
                        description="Build saved pivot recipes with drag-and-drop rows, columns, measures, filters, calculated fields, and conditional formatting."
                      >
                        <ErrorBoundary>
                          <PivotConfigurator
                            tableName={tableName}
                            columns={profileData}
                          />
                        </ErrorBoundary>
                      </ToolSection>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </main>
        </div>

        {activeDataset && selectedAdvancedColumn && (
          <ColumnProfilerAdvanced
            tableName={tableName}
            column={selectedAdvancedColumn}
            rowCount={activeDataset.rowCount}
            onClose={() => setSelectedAdvancedColumn(null)}
          />
        )}

        {activeDataset && analyticsColumn && (
          <ErrorBoundary>
            <ColumnDetail
              column={analyticsColumn}
              tableName={tableName}
              open={showColumnDetail}
              onClose={() => setShowColumnDetail(false)}
            />
          </ErrorBoundary>
        )}

        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-x-4 bottom-4 z-[80] max-h-[calc(100vh-6rem)] overflow-y-auto lg:left-20 lg:right-[26rem]"
            >
              <ErrorBoundary>
                <ThemeCustomizer />
              </ErrorBoundary>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Settings panel */}
        <SettingsPanel
          open={showSettings}
          onClose={() => setShowSettings(false)}
        />

        {/* Command palette */}
        <CommandPalette
          open={showCommandPalette}
          onClose={() => setShowCommandPalette(false)}
          onAction={handleCommandAction}
        />

        {/* Keyboard shortcuts dialog */}
        <KeyboardShortcutsDialog
          open={showKeyboardShortcuts}
          onClose={() => setShowKeyboardShortcuts(false)}
        />

        {/* Export wizard */}
        {activeDataset && (
          <ExportWizard
            open={showExportWizard}
            onClose={() => setShowExportWizard(false)}
            tableName={tableName}
            columns={profileData}
            rowCount={activeDataset.rowCount}
          />
        )}

        {activeDataset && (
          <SharePanel
            open={showSharePanel}
            onClose={() => setShowSharePanel(false)}
            dataset={activeDataset}
            currentTab={activeTab}
            currentSQL={lastQueryResult?.sql}
          />
        )}

        <RowDetailModal
          open={selectedPreviewRow !== null}
          onClose={() => {
            setSelectedPreviewRow(null);
            setSelectedPreviewRowIndex(null);
          }}
          row={selectedPreviewRow ?? {}}
          columns={profileData}
          onPrevious={
            selectedPreviewRowIndex != null && selectedPreviewRowIndex > 0
              ? handleOpenPreviousPreviewRow
              : undefined
          }
          onNext={
            selectedPreviewRowIndex != null &&
            selectedPreviewRowIndex < previewRows.length - 1
              ? handleOpenNextPreviewRow
              : undefined
          }
          hasPrevious={selectedPreviewRowIndex != null && selectedPreviewRowIndex > 0}
          hasNext={
            selectedPreviewRowIndex != null &&
            selectedPreviewRowIndex < previewRows.length - 1
          }
          rowIndex={selectedPreviewRowIndex ?? undefined}
          totalRows={previewRows.length || undefined}
        />

        {activeDataset && (
          <AiAssistant
            tableName={tableName}
            columns={profileData}
            rowCount={activeDataset.rowCount}
          />
        )}

        <ErrorBoundary>
          <ShortcutOverlay />
        </ErrorBoundary>

        <ErrorBoundary>
          <AccessibilityPanel />
        </ErrorBoundary>

        <NotificationCenter
          notifications={notifications}
          removeNotification={removeNotification}
          clearAll={clearAll}
        />
      </div>
      </ErrorBoundary>
    </ToastProvider>
  );
}
