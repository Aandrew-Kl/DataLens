"use client";

import { Suspense, type ReactNode, useCallback, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useUIStore } from "@/stores/ui-store";
import { useDatasetStore } from "@/stores/dataset-store";
import { useAuthStore } from "@/stores/auth-store";
import { useBookmarkStore } from "@/stores/bookmark-store";
import { usePipelineStore } from "@/stores/pipeline-store";
import { useQueryStore } from "@/stores/query-store";
import FileDropzone from "@/components/data/file-dropzone";
import { getTableRowCount, loadCSVIntoDB } from "@/lib/duckdb/client";
import { profileTable } from "@/lib/duckdb/profiler";
import { generateId, sanitizeTableName } from "@/lib/utils/formatters";
import { Sun, Moon, Menu, Upload, Settings, Search, X } from "lucide-react";
import CommandPalette from "@/components/layout/command-palette";
import SettingsPanel from "@/components/settings/settings-panel";
import DemoBanner from "@/components/workspace/demo-banner";
import WelcomeWizardHost from "./welcome-wizard-host";

const TABS = [
  { href: "/profile", label: "Profile" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/query", label: "Ask AI" },
  { href: "/sql", label: "SQL" },
  { href: "/charts", label: "Charts" },
  { href: "/explore", label: "Explore" },
  { href: "/transforms", label: "Transforms" },
  { href: "/ml", label: "ML" },
  { href: "/analytics", label: "Analytics" },
  { href: "/data-ops", label: "Data Ops" },
  { href: "/pivot", label: "Pivot" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
] as const;

function WorkspaceContentFallback() {
  return (
    <div className="flex min-h-[24rem] items-center justify-center">
      <div className="w-full max-w-3xl animate-pulse rounded-2xl bg-white/60 p-6 backdrop-blur-xl dark:bg-slate-900/60">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
          Loading workspace...
        </p>
        <div className="mt-4 space-y-3">
          <div className="h-10 rounded-xl bg-white/70 dark:bg-slate-800/70" />
          <div className="grid gap-3 md:grid-cols-3">
            <div className="h-24 rounded-xl bg-white/70 dark:bg-slate-800/70" />
            <div className="h-24 rounded-xl bg-white/70 dark:bg-slate-800/70" />
            <div className="h-24 rounded-xl bg-white/70 dark:bg-slate-800/70" />
          </div>
          <div className="h-48 rounded-xl bg-white/70 dark:bg-slate-800/70" />
        </div>
      </div>
    </div>
  );
}

export default function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const authToken = useAuthStore((state) => state.token);
  const { theme, toggleTheme, sidebarOpen, toggleSidebar } = useUIStore();
  const datasets = useDatasetStore((s) => s.datasets);
  const activeDatasetId = useDatasetStore((s) => s.activeDatasetId);
  const setActiveDataset = useDatasetStore((s) => s.setActiveDataset);
  const activeDataset = datasets.find((dataset) => dataset.id === activeDatasetId);

  const {
    showUploader,
    setShowUploader,
    showSettings,
    setShowSettings,
    showCommandPalette,
    setShowCommandPalette,
    isLoading,
  } = useWorkspaceStore();

  useEffect(() => {
    void Promise.all([
      useBookmarkStore.getState().hydrate(),
      usePipelineStore.getState().hydrate(),
      useQueryStore.getState().hydrate(),
    ]);
  }, [authToken]);

  const handleCommandAction = useCallback(
    (actionId: string) => {
      setShowCommandPalette(false);

      if (actionId === "new-dataset") {
        setShowUploader(true);
        return;
      }

      if (actionId === "open-settings") {
        setShowSettings(true);
        return;
      }

      if (actionId === "toggle-dark-mode") {
        toggleTheme();
      }
    },
    [setShowCommandPalette, setShowUploader, setShowSettings, toggleTheme],
  );

  return (
    <div className="flex min-h-screen overflow-hidden bg-white/50 dark:bg-slate-950/90 text-slate-900 dark:text-slate-100 backdrop-blur-sm">
      <div
        className={`
          ${
            sidebarOpen ? "w-64" : "w-0"
          } flex-shrink-0 border-r border-white/30 dark:border-white/10 bg-white/55 dark:bg-slate-900/60 backdrop-blur-xl transition-all duration-200 overflow-hidden flex flex-col
        `}
      >
        <div className="h-full flex flex-col rounded-r-2xl">
          <div className="p-3 border-b border-white/20 dark:border-white/10">
            <h2 className="text-xs font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase">
              Datasets
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {datasets.length === 0 && (
              <p className="text-xs text-slate-400 dark:text-slate-500 p-2">
                No datasets loaded
              </p>
            )}

            {datasets.map((dataset) => (
              <button
                key={dataset.id}
                onClick={() => setActiveDataset(dataset.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  dataset.id === activeDataset?.id
                    ? "bg-purple-100/90 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800/70"
                }`}
              >
                <span className="truncate block text-left">{dataset.fileName}</span>
                <span className="text-[10px] text-slate-400">
                  {dataset.rowCount?.toLocaleString()} rows
                </span>
              </button>
            ))}
          </div>

          <div className="p-2 border-t border-white/20 dark:border-white/10">
            <button
              onClick={() => setShowUploader(true)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800/70 transition-colors"
            >
              <Upload className="w-4 h-4" />
              New Dataset
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 flex items-center justify-between px-4 border-b border-white/25 dark:border-white/10 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl flex-shrink-0 rounded-b-xl">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={toggleSidebar}
              className="p-1.5 rounded-lg hover:bg-white/70 dark:hover:bg-slate-800/70 transition-colors"
              aria-label="Toggle sidebar"
            >
              <Menu className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold">DataLens</span>
            {activeDataset ? (
              <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[28rem]">
                {activeDataset.fileName}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowCommandPalette(true)}
              className="p-1.5 rounded-lg hover:bg-white/70 dark:hover:bg-slate-800/70 transition-colors"
              title="Command Palette (⌘K)"
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="p-1.5 rounded-lg hover:bg-white/70 dark:hover:bg-slate-800/70 transition-colors"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-lg hover:bg-white/70 dark:hover:bg-slate-800/70 transition-colors"
              title="Toggle Theme"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setShowUploader(true)}
              className="p-1.5 rounded-lg hover:bg-white/70 dark:hover:bg-slate-800/70 transition-colors lg:hidden"
              title="Upload dataset"
            >
              <Upload className="w-4 h-4" />
            </button>
          </div>
        </header>

        <nav className="flex items-center gap-1 px-4 py-1.5 border-b border-white/20 dark:border-white/10 bg-white/50 dark:bg-slate-900/40 backdrop-blur-md flex-shrink-0 overflow-x-auto scrollbar-hide">
          {TABS.map((tab) => {
            const isActive = pathname === tab.href || pathname?.startsWith(`${tab.href}/`);

            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-purple-100/80 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white/70 dark:hover:bg-slate-800/70"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {isLoading ? (
          <div className="h-0.5 bg-purple-500 animate-pulse flex-shrink-0" />
        ) : null}

        <main className="flex-1 overflow-y-auto p-4">
          <DemoBanner />
          <Suspense fallback={<WorkspaceContentFallback />}>{children}</Suspense>
        </main>
      </div>

      <CommandPalette
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onAction={handleCommandAction}
      />
      <WelcomeWizardHost />
      <SettingsPanel
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {showUploader ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/25 backdrop-blur-sm"
            aria-label="Close uploader"
            onClick={() => setShowUploader(false)}
          />
          <div className="relative w-full max-w-lg rounded-2xl border border-white/30 bg-white/80 p-4 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/90">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Upload Dataset</h3>
              <button
                type="button"
                onClick={() => setShowUploader(false)}
                className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/70 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-200"
                aria-label="Close uploader"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex justify-center">
              <FileDropzone
                compact
                className="w-full"
                onFileLoaded={(result) => {
                  const { addDataset } = useDatasetStore.getState();
                  const { setIsLoading, setLoadError, setProfileData } =
                    useWorkspaceStore.getState();

                  setIsLoading(true);
                  setLoadError(null);

                  void (async () => {
                    try {
                      const nextTableName = sanitizeTableName(result.fileName);
                      await loadCSVIntoDB(nextTableName, result.csvContent);

                      const [columns, rowCount] = await Promise.all([
                        profileTable(nextTableName),
                        getTableRowCount(nextTableName),
                      ]);

                      addDataset({
                        id: generateId(),
                        name: nextTableName,
                        fileName: result.fileName,
                        rowCount,
                        columnCount: columns.length,
                        columns,
                        uploadedAt: Date.now(),
                        sizeBytes: result.sizeBytes,
                      });
                      setProfileData(columns);
                      setShowUploader(false);
                    } catch (error) {
                      console.error("Failed to load dataset:", error);
                      setLoadError(
                        error instanceof Error
                          ? error.message
                          : "Failed to load dataset",
                      );
                    } finally {
                      setIsLoading(false);
                    }
                  })();
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
