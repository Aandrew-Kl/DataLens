"use client";

import {
  Columns3,
  Database,
  Moon,
  Rows3,
  Settings,
  Share2,
  Sun,
  Upload,
} from "lucide-react";

import type { AppTab } from "@/components/home/types";
import { formatBytes, formatNumber } from "@/lib/utils/formatters";
import type { DatasetMeta } from "@/types/dataset";

import { TABS } from "../constants";

interface WorkspaceHeaderProps {
  theme: "light" | "dark";
  activeDataset: DatasetMeta | undefined;
  datasetCount: number;
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onOpenCommandPalette: () => void;
  onNewDataset: () => void;
  onOpenShare: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
}

export function WorkspaceHeader({
  theme,
  activeDataset,
  datasetCount,
  activeTab,
  onTabChange,
  onOpenCommandPalette,
  onNewDataset,
  onOpenShare,
  onOpenSettings,
  onToggleTheme,
}: WorkspaceHeaderProps) {
  return (
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
            onClick={onOpenCommandPalette}
            className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-400 transition-colors hover:text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500 dark:hover:text-slate-400 sm:flex"
          >
            <span>Search...</span>
            <kbd className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono dark:bg-slate-700">
              {typeof navigator !== "undefined" && navigator.platform?.includes("Mac")
                ? "⌘"
                : "Ctrl+"}
              K
            </kbd>
          </button>
          <button
            onClick={onNewDataset}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New Dataset</span>
          </button>
          <button
            onClick={onOpenShare}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Share</span>
          </button>
          <button
            onClick={onOpenSettings}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            onClick={onToggleTheme}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Toggle dark mode"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto px-4 sm:px-6">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
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
  );
}
