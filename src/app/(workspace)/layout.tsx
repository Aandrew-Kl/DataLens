"use client";

import { type ReactNode, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useUIStore } from "@/stores/ui-store";
import { useDatasetStore } from "@/stores/dataset-store";
import { Sun, Moon, Menu, Upload, Settings, Search } from "lucide-react";
import CommandPalette from "@/components/layout/command-palette";
import SettingsPanel from "@/components/settings/settings-panel";

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

export default function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
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

        <main className="flex-1 overflow-y-auto p-4">{children}</main>
      </div>

      <CommandPalette
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onAction={handleCommandAction}
      />
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
          <div className="relative max-w-sm w-full rounded-2xl border border-white/30 bg-white/80 dark:bg-slate-900/90 dark:border-white/10 backdrop-blur-xl p-4 shadow-xl">
            <h3 className="text-sm font-semibold">Uploader</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              Dataset uploader will be wired here.
            </p>
            <button
              type="button"
              onClick={() => setShowUploader(false)}
              className="mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-purple-600 text-white hover:bg-purple-500"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
