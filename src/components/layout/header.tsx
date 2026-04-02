"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Menu,
  X,
  Search,
  Download,
  Sun,
  Moon,
  Settings,
  FileDown,
  Copy,
  Rows3,
  Columns3,
  HardDrive,
} from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { formatNumber, formatBytes } from "@/lib/utils/formatters";
import type { DatasetMeta } from "@/types/dataset";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HeaderProps {
  dataset: DatasetMeta;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Header({
  dataset,
  onToggleSidebar,
  sidebarOpen,
}: HeaderProps) {
  const { theme, toggleTheme } = useUIStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  // Ctrl/Cmd+K to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close export dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        exportRef.current &&
        !exportRef.current.contains(e.target as Node)
      ) {
        setExportOpen(false);
      }
    }

    if (exportOpen) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [exportOpen]);

  const handleExport = useCallback(
    async (format: "csv" | "json" | "clipboard") => {
      setExportOpen(false);

      // Dynamic import to keep bundle lean
      const { exportToCSV, exportToJSON, exportToClipboard } = await import(
        "@/lib/utils/export"
      );

      // Fetch data from DuckDB via runQuery
      const { runQuery } = await import("@/lib/duckdb/client");
      const rows = await runQuery(`SELECT * FROM "${dataset.name}" LIMIT 10000`);

      switch (format) {
        case "csv":
          exportToCSV(rows, `${dataset.name}`);
          break;
        case "json":
          exportToJSON(rows, `${dataset.name}`);
          break;
        case "clipboard":
          await exportToClipboard(rows);
          break;
      }
    },
    [dataset.name],
  );

  return (
    <header className="flex items-center gap-3 px-4 h-14 shrink-0 border-b border-gray-200/60 dark:border-gray-700/60 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl">
      {/* --------------------------------------------------------------- */}
      {/* Left: sidebar toggle + dataset info                              */}
      {/* --------------------------------------------------------------- */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={onToggleSidebar}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          {sidebarOpen ? (
            <X className="w-5 h-5" />
          ) : (
            <Menu className="w-5 h-5" />
          )}
        </button>

        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate max-w-[180px]">
            {dataset.fileName}
          </h1>

          {/* Stat badges - hidden on small screens */}
          <div className="hidden md:flex items-center gap-1.5">
            <StatBadge icon={Rows3} label={formatNumber(dataset.rowCount)} />
            <StatBadge
              icon={Columns3}
              label={formatNumber(dataset.columnCount)}
            />
            <StatBadge
              icon={HardDrive}
              label={formatBytes(dataset.sizeBytes)}
            />
          </div>
        </div>
      </div>

      {/* --------------------------------------------------------------- */}
      {/* Center: search bar                                               */}
      {/* --------------------------------------------------------------- */}
      <div className="flex-1 flex justify-center px-2">
        <div
          className={`
            relative flex items-center w-full max-w-md transition-all duration-200
            rounded-lg border bg-gray-50 dark:bg-gray-800/60
            ${
              searchFocused
                ? "border-purple-300 dark:border-purple-600 ring-2 ring-purple-200/40 dark:ring-purple-800/30"
                : "border-gray-200/60 dark:border-gray-700/60"
            }
          `}
        >
          <Search className="w-4 h-4 ml-3 shrink-0 text-gray-400 dark:text-gray-500" />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search columns, query..."
            className="flex-1 bg-transparent px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 outline-none"
          />
          {searchQuery ? (
            <button
              onClick={() => setSearchQuery("")}
              className="mr-2 p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex items-center mr-2 px-1.5 py-0.5 rounded text-[10px] font-medium text-gray-400 dark:text-gray-500 bg-gray-200/60 dark:bg-gray-700/60">
              Ctrl K
            </kbd>
          )}
        </div>
      </div>

      {/* --------------------------------------------------------------- */}
      {/* Right: export, theme, settings                                   */}
      {/* --------------------------------------------------------------- */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Export dropdown */}
        <div className="relative" ref={exportRef}>
          <button
            onClick={() => setExportOpen(!exportOpen)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Export data"
          >
            <Download className="w-4.5 h-4.5" />
          </button>

          <AnimatePresence>
            {exportOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 top-full z-50 mt-2 w-44 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1"
              >
                <ExportItem
                  icon={FileDown}
                  label="Export CSV"
                  onClick={() => handleExport("csv")}
                />
                <ExportItem
                  icon={FileDown}
                  label="Export JSON"
                  onClick={() => handleExport("json")}
                />
                <ExportItem
                  icon={Copy}
                  label="Copy to clipboard"
                  onClick={() => handleExport("clipboard")}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? (
            <Sun className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </button>

        {/* Settings */}
        <button
          onClick={() => {
            /* Forward to parent settings handler when wired up */
          }}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatBadge({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function ExportItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
