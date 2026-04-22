"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  BrainCircuit,
  Code2,
  Columns3,
  Compass,
  Database,
  Eraser,
  ExternalLink as GithubIcon,
  FileText,
  FlaskConical,
  GitBranch,
  GitMerge,
  LayoutGrid,
  Lock,
  Menu,
  MessageSquare,
  Moon,
  PieChart,
  Plug,
  RefreshCw,
  Rows3,
  Settings,
  Share2,
  Shield,
  Sparkles,
  Sun,
  Table,
  Upload,
  Wand2,
  Wrench,
  X,
  Zap,
} from "lucide-react";

import { getTableRowCount, loadCSVIntoDB, runQuery } from "@/lib/duckdb/client";
import { profileTable } from "@/lib/duckdb/profiler";
import {
  formatBytes,
  formatNumber,
  generateId,
  sanitizeTableName,
} from "@/lib/utils/formatters";
import type { ColumnProfile, DatasetMeta } from "@/types/dataset";
import AiAssistant from "@/components/ai/ai-assistant";
import DataBookmarks from "@/components/data/data-bookmarks";
import FileDropzone from "@/components/data/file-dropzone";
import HeroSection from "@/components/home/HeroSection";
import FeatureShowcase from "@/components/home/FeatureShowcase";
import DataUploadSection from "@/components/home/DataUploadSection";
import QuickStartGuide from "@/components/home/QuickStartGuide";
import HomeTabPanels from "@/components/home/HomeTabPanels";
import SampleDatasetsGallery from "@/components/onboarding/sample-datasets-gallery";
import type {
  AppTab,
  FileDropResult,
  HomeFeatureBadge,
  HomeFeatureCard,
} from "@/components/home/types";
import Breadcrumb from "@/components/layout/breadcrumb";
import CommandPalette from "@/components/layout/command-palette";
import ThemeCustomizer from "@/components/layout/theme-customizer";
import type { Command as CommandBarCommand } from "@/components/ui/command-bar";
import KeyboardShortcutsDialog from "@/components/ui/keyboard-shortcuts-dialog";
import LoadingOverlay from "@/components/ui/loading-overlay";
import NotificationCenter, {
  useNotifications,
} from "@/components/ui/notification-center";
import ShortcutOverlay from "@/components/ui/shortcut-overlay";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { ToastProvider } from "@/components/ui/toast";
import OnboardingTour from "@/components/ui/onboarding-tour";
import AccessibilityPanel from "@/components/ui/accessibility-panel";
import ExportWizard from "@/components/data/export-wizard";
import SharePanel from "@/components/data/share-panel";
import SettingsPanel from "@/components/settings/settings-panel";
import {
  CHART_SAVED_EVENT,
  SAVED_CHARTS_STORAGE_KEY,
  type SavedChartSnapshot,
} from "@/components/charts/chart-builder";
import { useDatasetStore } from "@/stores/dataset-store";
import { useQueryStore } from "@/stores/query-store";
import { useUIStore } from "@/stores/ui-store";

const TABS: Array<{
  id: AppTab;
  label: string;
  icon: typeof Database;
}> = [
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
  { id: "settings", label: "Settings", icon: Settings },
];

const FEATURES: HomeFeatureBadge[] = [
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

const LANDING_FEATURES: HomeFeatureCard[] = [
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

// Internal event dispatched when this tab mutates localStorage's saved-charts
// entry. The browser's native "storage" event only fires in *other* tabs, so
// we dispatch this manually to keep the current tab's useSyncExternalStore in
// sync.
const SAVED_CHARTS_LOCAL_MUTATION_EVENT = "datalens:saved-charts-mutated";

// useSyncExternalStore helpers for saved charts backed by localStorage.
// getSnapshot returns the raw string (stable reference when unchanged) to
// keep re-render churn low; the component parses+filters inside a useMemo.
function getSavedChartsSnapshot(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return window.localStorage.getItem(SAVED_CHARTS_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function getSavedChartsServerSnapshot(): string {
  return "";
}

function subscribeToSavedCharts(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const chartHandler = () => onStoreChange();
  const storageHandler = (event: StorageEvent) => {
    if (event.key === null || event.key === SAVED_CHARTS_STORAGE_KEY) {
      onStoreChange();
    }
  };
  const mutationHandler = () => onStoreChange();
  window.addEventListener(CHART_SAVED_EVENT, chartHandler as EventListener);
  window.addEventListener("storage", storageHandler);
  window.addEventListener(
    SAVED_CHARTS_LOCAL_MUTATION_EVENT,
    mutationHandler as EventListener,
  );
  return () => {
    window.removeEventListener(
      CHART_SAVED_EVENT,
      chartHandler as EventListener,
    );
    window.removeEventListener("storage", storageHandler);
    window.removeEventListener(
      SAVED_CHARTS_LOCAL_MUTATION_EVENT,
      mutationHandler as EventListener,
    );
  };
}

function parseSavedCharts(raw: string): SavedChartSnapshot[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SavedChartSnapshot[]) : [];
  } catch {
    return [];
  }
}

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
      <div className="flex w-14 shrink-0 flex-col items-center gap-3 border-r border-slate-200 bg-white/80 py-4 backdrop-blur-xl dark:border-slate-700/50 dark:bg-gray-900/80">
        <button
          onClick={onToggle}
          className="rounded-lg p-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
          title="Expand sidebar"
        >
          <Menu className="h-4 w-4 text-slate-500" />
        </button>
        <div className="h-px w-6 bg-slate-200 dark:bg-slate-700" />
        {datasets.map((dataset) => (
          <button
            key={dataset.id}
            onClick={() => setActiveDataset(dataset.id)}
            className={`rounded-lg p-2 transition-colors ${
              dataset.id === activeDatasetId
                ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400"
                : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
            title={dataset.fileName}
          >
            <Database className="h-4 w-4" />
          </button>
        ))}
        <button
          onClick={onNewDataset}
          className="mt-auto rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-indigo-500 dark:hover:bg-slate-800"
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
      className="flex w-60 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white/80 backdrop-blur-xl dark:border-slate-700/50 dark:bg-gray-900/80"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
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
          className="rounded p-1 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="h-3.5 w-3.5 text-slate-400" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        <div className="mb-2 px-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Datasets ({datasets.length})
          </p>
        </div>

        {datasets.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <Database className="mx-auto mb-2 h-8 w-8 text-slate-300 dark:text-slate-600" />
            <p className="text-xs text-slate-400 dark:text-slate-500">
              No datasets loaded
            </p>
          </div>
        ) : (
          <div className="space-y-0.5 px-2">
            {datasets.map((dataset) => (
              <div
                key={dataset.id}
                className={`group flex items-center gap-3 rounded-lg border px-2 py-2 transition-colors ${
                  dataset.id === activeDatasetId
                    ? "border-indigo-200/60 bg-indigo-50 dark:border-indigo-800/40 dark:bg-indigo-950/30"
                    : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveDataset(dataset.id)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left"
                >
                  <Database
                    className={`h-3.5 w-3.5 shrink-0 ${
                      dataset.id === activeDatasetId
                        ? "text-indigo-500"
                        : "text-slate-400"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-xs font-medium ${
                        dataset.id === activeDatasetId
                          ? "text-indigo-700 dark:text-indigo-300"
                          : "text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {dataset.fileName}
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                      {formatNumber(dataset.rowCount)} rows &middot;{" "}
                      {dataset.columnCount} cols
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeDataset(dataset.id);
                  }}
                  className="rounded p-1 opacity-0 transition-all hover:bg-slate-200 group-hover:opacity-100 dark:hover:bg-slate-700"
                  title="Remove dataset"
                >
                  <X className="h-3 w-3 text-slate-400" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 px-3 py-3 dark:border-slate-800">
        <button
          onClick={onNewDataset}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-500 transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-indigo-600 dark:hover:text-indigo-400"
        >
          <Upload className="h-3.5 w-3.5" />
          Upload Dataset
        </button>
      </div>
    </motion.div>
  );
}

export default function HomePageClient() {
  const { theme, toggleTheme } = useUIStore();
  const { addDataset, setActiveDataset } = useDatasetStore();
  const activeDataset = useDatasetStore((state) =>
    state.datasets.find((dataset) => dataset.id === state.activeDatasetId),
  );
  const datasets = useDatasetStore((state) => state.datasets);
  const datasetCount = useDatasetStore((state) => state.datasets.length);
  const lastQueryResult = useQueryStore((state) => state.lastResult);
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
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showUploader, setShowUploader] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [showExportWizard, setShowExportWizard] = useState(false);
  const [showSharePanel, setShowSharePanel] = useState(false);

  // Derive profileData directly from activeDataset.columns during render
  // (was previously synced via useEffect -> setProfileData, which triggers
  // react-you-might-not-need-an-effect/no-chained-state). Refresh flows
  // update the dataset in the store, which flows into activeDataset.columns
  // automatically — so no separate profileData state is needed. Memoised to
  // give a stable reference for downstream hook dependencies when the
  // columns value hasn't changed.
  const profileData = useMemo<ColumnProfile[]>(
    () => activeDataset?.columns ?? [],
    [activeDataset?.columns],
  );

  useEffect(() => {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const stored = localStorage.getItem("datalens-theme");
    const initial =
      stored === "dark" || (!stored && prefersDark) ? "dark" : "light";
    useUIStore.getState().setTheme(initial);
  }, []);

  useEffect(() => {
    localStorage.setItem("datalens-theme", theme);
  }, [theme]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;

      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        if (!(mod && event.key === "k")) {
          return;
        }
      }

      if (mod && event.key === "k") {
        event.preventDefault();
        setShowCommandPalette((current) => !current);
      } else if (mod && event.key === "d") {
        event.preventDefault();
        toggleTheme();
      } else if (mod && event.key === ",") {
        event.preventDefault();
        setShowSettings(true);
      } else if (mod && event.key === "n") {
        event.preventDefault();
        if (activeDataset) {
          setShowUploader(true);
        }
      } else if (mod && event.key === "/") {
        event.preventDefault();
        setShowKeyboardShortcuts((current) => !current);
      } else if (event.key === "Escape") {
        setShowCommandPalette(false);
        setShowSettings(false);
        setShowUploader(false);
        setShowKeyboardShortcuts(false);
        setShowSharePanel(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeDataset, toggleTheme]);

  const handleFileLoaded = useCallback(
    async (result: FileDropResult) => {
      setIsLoading(true);
      setLoadError(null);
      setShowUploader(false);

      try {
        const nextTableName = sanitizeTableName(result.fileName);
        await loadCSVIntoDB(nextTableName, result.csvContent);

        const columns = await profileTable(nextTableName);
        const rowCount = await getTableRowCount(nextTableName);

        const meta: DatasetMeta = {
          id: generateId(),
          name: nextTableName,
          fileName: result.fileName,
          rowCount,
          columnCount: columns.length,
          columns,
          uploadedAt: Date.now(),
          sizeBytes: result.sizeBytes,
        };

        addDataset(meta);
        setActiveTab("profile");
        addNotification({
          type: "success",
          title: "Dataset loaded",
          message: `${result.fileName} is ready with ${formatNumber(
            rowCount,
          )} rows and ${columns.length} columns.`,
        });

        try {
          const recent = JSON.parse(
            localStorage.getItem("datalens-recent") || "[]",
          ) as Array<{
            fileName: string;
            tableName: string;
            rowCount: number;
            uploadedAt: number;
          }>;

          recent.unshift({
            fileName: result.fileName,
            tableName: nextTableName,
            rowCount,
            uploadedAt: Date.now(),
          });

          localStorage.setItem(
            "datalens-recent",
            JSON.stringify(recent.slice(0, 10)),
          );
        } catch {
          // localStorage failures are non-critical
        }
      } catch (error) {
        console.error("Failed to load dataset:", error);
        const message =
          error instanceof Error ? error.message : "Failed to load dataset";
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
    [addDataset, addNotification],
  );

  const handleGeneratedData = useCallback(
    (csvContent: string, fileName: string) => {
      void handleFileLoaded({
        fileName,
        csvContent,
        sizeBytes: new Blob([csvContent]).size,
      });
    },
    [handleFileLoaded],
  );

  // Subscribe to saved-charts in localStorage via useSyncExternalStore,
  // then derive the filtered list per-tableName during render. This avoids
  // the old useEffect -> setSavedCharts pattern that tripped
  // react-you-might-not-need-an-effect/no-chained-state.
  const savedChartsSnapshot = useSyncExternalStore(
    subscribeToSavedCharts,
    getSavedChartsSnapshot,
    getSavedChartsServerSnapshot,
  );
  const savedCharts = useMemo<SavedChartSnapshot[]>(() => {
    if (!activeDataset) {
      return [];
    }
    return parseSavedCharts(savedChartsSnapshot).filter(
      (chart) => chart.tableName === tableName,
    );
  }, [activeDataset, savedChartsSnapshot, tableName]);

  // Separately: fire the "Chart saved" toast when the CHART_SAVED_EVENT
  // custom event targets the current table. Pure side-effect (no state).
  useEffect(() => {
    if (!activeDataset) {
      return;
    }
    const handleChartSaved = (event: Event) => {
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
    window.addEventListener(CHART_SAVED_EVENT, handleChartSaved as EventListener);
    return () => {
      window.removeEventListener(
        CHART_SAVED_EVENT,
        handleChartSaved as EventListener,
      );
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

        useDatasetStore.setState((state) => ({
          datasets: state.datasets.map((dataset) =>
            dataset.id === datasetId
              ? {
                  ...dataset,
                  rowCount,
                  columnCount: columns.length,
                  columns,
                }
              : dataset,
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
    [activeDataset, addNotification, tableName],
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
          (dataset) => sanitizeTableName(dataset.fileName) === nextTableName,
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
              dataset.id === existingDataset.id ? nextMeta : dataset,
            ),
            activeDatasetId: existingDataset.id,
          }));
        } else {
          addDataset(nextMeta);
        }

        setActiveTab(nextTab);
        addNotification({
          type: "success",
          title: notificationTitle,
          message:
            notificationMessage ??
            `${fileName} is ready with ${formatNumber(rowCount)} rows and ${
              resolvedColumns.length
            } columns.`,
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
    [addDataset, addNotification, datasets],
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
    [registerDerivedDataset],
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
    [registerDerivedDataset],
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
          : `Updated ${tableName} after creating a computed column.`,
      );
    };

    window.addEventListener(
      "datalens:computed-column-created",
      handleComputedColumnCreated as EventListener,
    );

    return () => {
      window.removeEventListener(
        "datalens:computed-column-created",
        handleComputedColumnCreated as EventListener,
      );
    };
  }, [activeDataset, refreshActiveDataset, tableName]);

  const handleSavedChartRemove = useCallback(
    (chartId: string) => {
      const nextCharts = readSavedChartsFromStorage().filter(
        (entry) => entry.config.id !== chartId,
      );

      try {
        window.localStorage.setItem(
          SAVED_CHARTS_STORAGE_KEY,
          JSON.stringify(nextCharts),
        );
        // Notify the useSyncExternalStore subscriber in the same tab
        // (native "storage" events don't fire for the writing tab).
        window.dispatchEvent(new Event(SAVED_CHARTS_LOCAL_MUTATION_EVENT));
      } catch {
        // localStorage failures are non-critical
      }

      addNotification({
        type: "info",
        title: "Chart removed",
        message: "The saved chart was removed from the gallery.",
      });
    },
    [addNotification],
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
    [addNotification],
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
          `CREATE TABLE ${tempSql} AS SELECT *, ${expression} AS ${aliasSql} FROM ${sourceSql}`,
        );
        await runQuery(`ALTER TABLE ${sourceSql} RENAME TO ${backupSql}`);

        try {
          await runQuery(`ALTER TABLE ${tempSql} RENAME TO ${sourceSql}`);
          await runQuery(`DROP TABLE ${backupSql}`);
        } catch (swapError) {
          await runQuery(`ALTER TABLE ${backupSql} RENAME TO ${sourceSql}`).catch(
            () => undefined,
          );
          await runQuery(`DROP TABLE IF EXISTS ${tempSql}`).catch(
            () => undefined,
          );
          throw swapError;
        }

        await refreshActiveDataset(
          "Computed column added",
          `${name} was added to ${tableName}.`,
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
    [addNotification, refreshActiveDataset, tableName],
  );

  const handleNewDataset = useCallback(() => {
    if (datasetCount > 0) {
      setShowUploader(true);
    } else {
      setActiveDataset(null);
      // profileData derives from activeDataset.columns; no separate reset needed
      setActiveTab("profile");
      setLoadError(null);
    }
  }, [datasetCount, setActiveDataset]);

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
            const nextTableName = sanitizeTableName(activeDataset.fileName);
            runQuery(`SELECT * FROM "${nextTableName}" LIMIT 10000`).then(
              (data) => {
                import("@/lib/utils/export").then(({ exportToCSV }) => {
                  exportToCSV(data, activeDataset.fileName.replace(/\.\w+$/, ""));
                });
              },
            );
          }
          break;
        case "export-json":
          if (activeDataset) {
            const nextTableName = sanitizeTableName(activeDataset.fileName);
            runQuery(`SELECT * FROM "${nextTableName}" LIMIT 10000`).then(
              (data) => {
                import("@/lib/utils/export").then(({ exportToJSON }) => {
                  exportToJSON(data, activeDataset.fileName.replace(/\.\w+$/, ""));
                });
              },
            );
          }
          break;
        case "github":
          window.open("https://github.com/Aandrew-Kl/DataLens", "_blank");
          break;
        default:
          break;
      }
    },
    [activeDataset, handleNewDataset, toggleTheme],
  );

  const totalNulls = useMemo(
    () => profileData.reduce((sum, column) => sum + column.nullCount, 0),
    [profileData],
  );
  const completenessPct =
    activeDataset && activeDataset.rowCount > 0 && profileData.length > 0
      ? ((activeDataset.rowCount * profileData.length - totalNulls) /
          (activeDataset.rowCount * profileData.length)) *
        100
      : 100;
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
      category: "File" as const,
      description: "Load a new file into the current workspace.",
      keywords: ["import", "csv", "dataset", "file"],
      icon: Upload,
    },
    {
      id: "settings",
      label: "Open settings",
      category: "Edit" as const,
      description: "Adjust theme and workspace preferences.",
      keywords: ["preferences", "theme"],
      icon: Settings,
    },
    {
      id: "export-csv",
      label: "Export CSV",
      category: "Export" as const,
      description: "Download the current dataset as CSV.",
      keywords: ["download", "csv", "export"],
      icon: Upload,
    },
    {
      id: "export-json",
      label: "Export JSON",
      category: "Export" as const,
      description: "Download the current dataset as JSON.",
      keywords: ["download", "json", "export"],
      icon: FileText,
    },
    {
      id: "github",
      label: "Open GitHub",
      category: "View" as const,
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

  const handleCommandBarExecute = useCallback(
    (command: CommandBarCommand) => {
      if (command.id.startsWith("tab:")) {
        setActiveTab(command.id.replace("tab:", "") as AppTab);
        return;
      }

      handleCommandAction(command.id);
    },
    [handleCommandAction],
  );

  if (!activeDataset && !showUploader) {
    return (
      <ToastProvider>
        <ErrorBoundary>
          <LoadingOverlay
            visible={isLoading}
            message="Loading and profiling dataset..."
          />
          <OnboardingTour />
          <div className="flex min-h-screen flex-1 flex-col">
            <header className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 shadow-md shadow-indigo-500/20">
                  <Database className="h-4 w-4 text-white" />
                </div>
                <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                  DataLens
                </span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href="https://github.com/Aandrew-Kl/DataLens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  aria-label="View on GitHub"
                >
                  <GithubIcon className="h-5 w-5" />
                </a>
                <button
                  onClick={toggleTheme}
                  className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
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

            <main className="flex flex-1 flex-col items-center justify-center px-6 pb-16">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="w-full max-w-2xl space-y-8 text-center"
              >
                <HeroSection
                  title="DataLens"
                  tagline="Drop a file. Ask anything. See everything."
                  description="Open source AI-powered data explorer. No SQL needed. Runs 100% locally."
                />

                <DataUploadSection
                  isLoading={isLoading}
                  loadError={loadError}
                  onFileLoaded={handleFileLoaded}
                />

                <QuickStartGuide
                  features={FEATURES}
                  onSampleLoad={(fileName, csvContent) => {
                    void handleFileLoaded({
                      fileName,
                      csvContent,
                      sizeBytes: new Blob([csvContent]).size,
                    });
                  }}
                />
              </motion.div>

              <FeatureShowcase
                features={LANDING_FEATURES}
                onDataGenerated={handleGeneratedData}
              />
            </main>

            <footer className="py-4 text-center text-xs text-slate-400 dark:text-slate-600">
              <a
                href="https://github.com/Aandrew-Kl/DataLens"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-slate-600 dark:hover:text-slate-400"
              >
                MIT License &middot; Star on GitHub
              </a>
            </footer>
          </div>
        </ErrorBoundary>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <ErrorBoundary>
        <LoadingOverlay
          visible={isLoading}
          message="Loading and profiling dataset..."
        />
        <OnboardingTour />
        <div className="flex min-h-screen">
          <AnimatePresence>
            {datasetCount > 0 && (
              <DatasetSidebar
                isOpen={sidebarOpen}
                onToggle={() => setSidebarOpen((current) => !current)}
                onNewDataset={handleNewDataset}
              />
            )}
          </AnimatePresence>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur-xl dark:border-slate-700/50 dark:bg-gray-900/80">
              <div className="flex items-center justify-between px-4 py-3 sm:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  {datasetCount === 0 && (
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600">
                      <Database className="h-4 w-4 text-white" />
                    </div>
                  )}
                  {activeDataset && (
                    <div className="flex min-w-0 items-center gap-3">
                      <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {activeDataset.fileName}
                      </h1>
                      <div className="hidden items-center gap-2 text-xs text-slate-500 dark:text-slate-400 sm:flex">
                        <span className="inline-flex items-center gap-1">
                          <Rows3 className="h-3 w-3" />
                          {formatNumber(activeDataset.rowCount)} rows
                        </span>
                        <span className="text-slate-300 dark:text-slate-600">|</span>
                        <span className="inline-flex items-center gap-1">
                          <Columns3 className="h-3 w-3" />
                          {activeDataset.columnCount} cols
                        </span>
                        <span className="text-slate-300 dark:text-slate-600">|</span>
                        <span>{formatBytes(activeDataset.sizeBytes)}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowCommandPalette(true)}
                    className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-400 transition-colors hover:text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500 dark:hover:text-slate-400 sm:flex"
                  >
                    <span>Search...</span>
                    <kbd className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono dark:bg-slate-700">
                      {typeof navigator !== "undefined" &&
                      navigator.platform?.includes("Mac")
                        ? "⌘"
                        : "Ctrl+"}
                      K
                    </kbd>
                  </button>
                  <button
                    onClick={handleNewDataset}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">New Dataset</span>
                  </button>
                  <button
                    onClick={() => setShowSharePanel(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Share</span>
                  </button>
                  <button
                    onClick={() => setShowSettings(true)}
                    className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    aria-label="Settings"
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                  <button
                    onClick={toggleTheme}
                    className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
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

              <div className="flex gap-1 overflow-x-auto px-4 sm:px-6">
                {TABS.map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                        isActive
                          ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                          : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-300"
                      }`}
                    >
                      <tab.icon className="h-4 w-4" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </header>

            <main className="flex-1 px-4 py-6 sm:px-6">
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

              <AnimatePresence>
                {showUploader && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
                    onClick={() => setShowUploader(false)}
                  >
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="mx-4 w-full max-w-xl rounded-2xl bg-white p-8 shadow-xl dark:bg-gray-900"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="mb-6 flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                          Upload New Dataset
                        </h2>
                        <button
                          onClick={() => setShowUploader(false)}
                          className="rounded-lg p-1 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <X className="h-5 w-5 text-slate-400" />
                        </button>
                      </div>

                      <FileDropzone onFileLoaded={handleFileLoaded} />
                      <div className="mt-4">
                        <SampleDatasetsGallery
                          onDatasetLoaded={async ({
                            tableName,
                            fileName,
                            rowCount,
                            columnCount,
                          }) => {
                            addDataset({
                              id: generateId(),
                              name: tableName,
                              fileName,
                              rowCount,
                              columnCount,
                              columns: [],
                              uploadedAt: Date.now(),
                              sizeBytes: 0,
                            });
                          }}
                        />
                      </div>

                      {isLoading && (
                        <div className="mt-4 flex items-center justify-center gap-3 text-sm text-slate-500">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                          Loading and profiling...
                        </div>
                      )}
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {!activeDataset && !showUploader && (
                <div className="flex flex-col items-center justify-center gap-4 py-24">
                  <Database className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                  <p className="text-slate-500 dark:text-slate-400">
                    Select a dataset from the sidebar or upload a new one
                  </p>
                  <button
                    onClick={handleNewDataset}
                    className="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-600"
                  >
                    <Upload className="h-4 w-4" />
                    Upload Dataset
                  </button>
                </div>
              )}

              {activeDataset && (
                <HomeTabPanels
                  activeTab={activeTab}
                  activeDataset={activeDataset}
                  datasets={datasets}
                  tableName={tableName}
                  profileData={profileData}
                  completenessPct={completenessPct}
                  savedCharts={savedCharts}
                  workspaceTabItems={workspaceTabItems}
                  commandBarCommands={commandBarCommands}
                  onTabChange={setActiveTab}
                  onExecuteCommand={handleCommandBarExecute}
                  onAddNotification={addNotification}
                  onConnectorDataLoaded={handleConnectorDataLoaded}
                  onRegisterMergedDataset={(nextTableName) => {
                    void registerDerivedDataset({
                      tableName: sanitizeTableName(nextTableName),
                      fileName: nextTableName,
                      nextTab: "profile",
                      notificationTitle: "Merged dataset ready",
                      notificationMessage: `${nextTableName} was materialized from the merge workspace and is ready to explore.`,
                    });
                  }}
                  onSqlJoinComplete={handleSqlJoinComplete}
                  onRefreshDataset={refreshActiveDataset}
                  onFormulaSave={handleFormulaSave}
                  onSavedChartRemove={handleSavedChartRemove}
                  onSavedChartEdit={handleSavedChartEdit}
                  onOpenExportWizard={() => setShowExportWizard(true)}
                />
              )}
            </main>
          </div>

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

          <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />
          <CommandPalette
            open={showCommandPalette}
            onClose={() => setShowCommandPalette(false)}
            onAction={handleCommandAction}
          />
          <KeyboardShortcutsDialog
            open={showKeyboardShortcuts}
            onClose={() => setShowKeyboardShortcuts(false)}
          />

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
