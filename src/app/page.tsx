"use client";

import { useState, useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
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
} from "lucide-react";

import { loadCSVIntoDB, runQuery, getTableRowCount } from "@/lib/duckdb/client";
import { profileTable } from "@/lib/duckdb/profiler";
import { useDatasetStore } from "@/stores/dataset-store";
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
import DataProfiler from "@/components/data/data-profiler";
import DataTable from "@/components/data/data-table";
import DashboardView from "@/components/data/dashboard-view";
import ChatInterface from "@/components/query/chat-interface";
import SQLEditor from "@/components/query/sql-editor";
import ColumnDetail from "@/components/data/column-detail";
import SettingsPanel from "@/components/settings/settings-panel";
import CommandPalette from "@/components/layout/command-palette";
import { ErrorBoundary } from "@/components/ui/error-boundary";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type AppTab = "profile" | "dashboard" | "query" | "sql";

interface FileDropResult {
  fileName: string;
  csvContent: string;
  sizeBytes: number;
}

// ─────────────────────────────────────────────
// Tab config
// ─────────────────────────────────────────────

const TABS: { id: AppTab; label: string; icon: typeof Database }[] = [
  { id: "profile", label: "Profile", icon: Table },
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "query", label: "Ask AI", icon: MessageSquare },
  { id: "sql", label: "SQL Editor", icon: Code2 },
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
}: {
  tableName: string;
  columns: ColumnProfile[];
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
        if (!cancelled) setRows(data);
      } catch (err) {
        console.error("Failed to load table preview:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tableName]);

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
    />
  );
}

// ─────────────────────────────────────────────
// SQL Editor Wrapper
// ─────────────────────────────────────────────

function SQLEditorTab({
  tableName,
  columns,
}: {
  tableName: string;
  columns: ColumnProfile[];
}) {
  const [lastResult, setLastResult] = useState<{
    data: Record<string, unknown>[];
    columns: string[];
    sql: string;
    executionTimeMs: number;
  } | null>(null);

  return (
    <div className="space-y-6">
      <SQLEditor
        tableName={tableName}
        columns={columns}
        defaultSQL={`SELECT * FROM "${tableName}" LIMIT 100`}
        onQueryResult={setLastResult}
      />

      {lastResult && lastResult.data.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex items-center justify-between mb-3">
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
  );
}

// ─────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────

export default function Home() {
  const { theme, toggleTheme } = useUIStore();
  const { addDataset, setActiveDataset } = useDatasetStore();
  const activeDataset = useDatasetStore((s) =>
    s.datasets.find((d) => d.id === s.activeDatasetId)
  );
  const datasetCount = useDatasetStore((s) => s.datasets.length);

  const [activeTab, setActiveTab] = useState<AppTab>("profile");
  const [profileData, setProfileData] = useState<ColumnProfile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showUploader, setShowUploader] = useState(false);
  const [selectedColumn, setSelectedColumn] = useState<ColumnProfile | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);

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
      } else if (e.key === "Escape") {
        setShowCommandPalette(false);
        setShowSettings(false);
        setSelectedColumn(null);
        setShowUploader(false);
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
        setLoadError(
          err instanceof Error ? err.message : "Failed to load dataset"
        );
      } finally {
        setIsLoading(false);
      }
    },
    [addDataset]
  );

  // Update profile data when active dataset changes
  useEffect(() => {
    if (activeDataset) {
      setProfileData(activeDataset.columns);
    }
  }, [activeDataset]);

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
      <ErrorBoundary>
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
    );
  }

  // ─── Workspace State ───

  const tableName = activeDataset
    ? sanitizeTableName(activeDataset.fileName)
    : "";

  return (
    <ErrorBoundary>
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
                    <ErrorBoundary>
                      <DataProfiler
                        columns={profileData}
                        rowCount={activeDataset.rowCount}
                        onColumnClick={(col) => setSelectedColumn(col)}
                      />
                    </ErrorBoundary>

                    <div className="pt-4">
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                        Data Preview
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                        First 200 rows
                      </p>
                      <ErrorBoundary>
                        <TablePreview
                          tableName={tableName}
                          columns={profileData}
                        />
                      </ErrorBoundary>
                    </div>
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

                {activeTab === "query" && (
                  <motion.div
                    key="query"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="max-w-4xl mx-auto"
                  >
                    <div className="mb-4">
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                        Ask Your Data
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Ask questions in plain English — AI generates SQL and
                        shows results instantly
                      </p>
                    </div>
                    <ErrorBoundary>
                      <ChatInterface
                        datasetId={activeDataset.id}
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                  </motion.div>
                )}

                {activeTab === "sql" && (
                  <motion.div
                    key="sql"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="mb-4">
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                        SQL Editor
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Write and execute SQL queries directly against your
                        data with DuckDB
                      </p>
                    </div>
                    <ErrorBoundary>
                      <SQLEditorTab
                        tableName={tableName}
                        columns={profileData}
                      />
                    </ErrorBoundary>
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </main>
        </div>

        {/* Column detail slide-in panel */}
        {activeDataset && (
          <ColumnDetail
            column={selectedColumn!}
            tableName={tableName}
            open={selectedColumn !== null}
            onClose={() => setSelectedColumn(null)}
          />
        )}

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
      </div>
    </ErrorBoundary>
  );
}
