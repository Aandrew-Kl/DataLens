"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Database,
  Plus,
  Settings,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  MoreHorizontal,
  Trash2,
  Copy,
  Clock,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useDatasetStore } from "@/stores/dataset-store";
import { useUIStore } from "@/stores/ui-store";
import { formatNumber, formatBytes } from "@/lib/utils/formatters";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  onNewDataset: () => void;
  onSettingsOpen: () => void;
}

interface RecentFile {
  name: string;
  openedAt: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RECENT_KEY = "datalens-recent";
const MAX_RECENT = 5;
const SIDEBAR_EXPANDED = 240;
const SIDEBAR_COLLAPSED = 56;

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function readRecent(): RecentFile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as RecentFile[]).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Sidebar({
  isOpen,
  onToggle,
  onNewDataset,
  onSettingsOpen,
}: SidebarProps) {
  const { datasets, activeDatasetId, setActiveDataset, removeDataset } =
    useDatasetStore();
  const { theme, toggleTheme } = useUIStore();

  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [aiStatus, setAiStatus] = useState<"checking" | "online" | "offline">(
    "checking",
  );
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Load recent files from localStorage
  useEffect(() => {
    setRecentFiles(readRecent());
  }, []);

  // Check AI health on mount
  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/health");
        if (!res.ok) throw new Error("unhealthy");
        const data = await res.json();
        if (!cancelled) setAiStatus(data.ollama ? "online" : "offline");
      } catch {
        if (!cancelled) setAiStatus("offline");
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenuId(null);
      }
    }

    if (contextMenuId) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [contextMenuId]);

  const handleRemoveDataset = useCallback(
    (id: string) => {
      removeDataset(id);
      setContextMenuId(null);
    },
    [removeDataset],
  );

  const handleCopyTableName = useCallback(
    (name: string) => {
      navigator.clipboard.writeText(name);
      setContextMenuId(null);
    },
    [],
  );

  const width = isOpen ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED;

  return (
    <motion.aside
      className="relative flex flex-col h-full border-r border-gray-200/60 dark:border-gray-700/60 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl select-none overflow-hidden"
      animate={{ width }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      {/* ----------------------------------------------------------------- */}
      {/* Logo + collapse toggle                                            */}
      {/* ----------------------------------------------------------------- */}
      <div className="flex items-center justify-between px-3 h-14 shrink-0 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white">
            <Database className="w-4 h-4" />
          </div>
          <AnimatePresence>
            {isOpen && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15 }}
                className="text-sm font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap overflow-hidden"
              >
                DataLens
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <button
          onClick={onToggle}
          className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          {isOpen ? (
            <ChevronLeft className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Datasets list                                                     */}
      {/* ----------------------------------------------------------------- */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
        {isOpen && (
          <p className="px-2 mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Datasets
          </p>
        )}

        {datasets.length === 0 ? (
          isOpen ? (
            <div className="px-2 py-6 text-center">
              <FileSpreadsheet className="w-8 h-8 mx-auto text-gray-300 dark:text-gray-600 mb-2" />
              <p className="text-xs text-gray-400 dark:text-gray-500">
                No datasets yet
              </p>
              <button
                onClick={onNewDataset}
                className="mt-2 text-xs text-purple-500 hover:text-purple-600 dark:text-purple-400 dark:hover:text-purple-300 transition-colors"
              >
                Upload your first file
              </button>
            </div>
          ) : (
            <div className="flex justify-center py-4">
              <FileSpreadsheet className="w-5 h-5 text-gray-300 dark:text-gray-600" />
            </div>
          )
        ) : (
          datasets.map((ds) => {
            const isActive = ds.id === activeDatasetId;
            return (
              <div key={ds.id} className="relative group">
                <button
                  onClick={() => setActiveDataset(ds.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenuId(ds.id);
                  }}
                  className={`
                    w-full flex items-center gap-2 rounded-lg transition-colors duration-150
                    ${isOpen ? "px-2 py-2" : "px-0 py-2 justify-center"}
                    ${
                      isActive
                        ? "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                        : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                    }
                  `}
                  title={ds.fileName}
                >
                  <FileSpreadsheet
                    className={`w-4 h-4 shrink-0 ${
                      isActive
                        ? "text-purple-500 dark:text-purple-400"
                        : "text-gray-400 dark:text-gray-500"
                    }`}
                  />
                  {isOpen && (
                    <>
                      <span className="flex-1 text-left text-sm truncate">
                        {ds.fileName}
                      </span>
                      <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                        {formatNumber(ds.rowCount)}
                      </span>
                    </>
                  )}
                </button>

                {/* "..." menu button (expanded state only) */}
                {isOpen && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setContextMenuId(
                        contextMenuId === ds.id ? null : ds.id,
                      );
                    }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500 transition-all"
                    aria-label="Dataset options"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </button>
                )}

                {/* Context menu */}
                <AnimatePresence>
                  {contextMenuId === ds.id && (
                    <motion.div
                      ref={contextMenuRef}
                      initial={{ opacity: 0, scale: 0.95, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -4 }}
                      transition={{ duration: 0.12 }}
                      className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1"
                    >
                      <button
                        onClick={() => handleCopyTableName(ds.name)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy table name
                      </button>
                      <button
                        onClick={() => handleRemoveDataset(ds.id)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remove dataset
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        )}

        {/* --------------------------------------------------------------- */}
        {/* Recent files                                                     */}
        {/* --------------------------------------------------------------- */}
        {isOpen && recentFiles.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
            <p className="px-2 mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Recent
            </p>
            {recentFiles.map((rf, i) => (
              <div
                key={`${rf.name}-${i}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors cursor-default"
              >
                <Clock className="w-3.5 h-3.5 shrink-0 text-gray-300 dark:text-gray-600" />
                <span className="flex-1 text-xs truncate">{rf.name}</span>
                <span className="shrink-0 text-[10px] text-gray-300 dark:text-gray-600">
                  {formatTimeAgo(rf.openedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Bottom actions                                                     */}
      {/* ----------------------------------------------------------------- */}
      <div className="shrink-0 border-t border-gray-100 dark:border-gray-800 p-2 space-y-1">
        {/* New Dataset */}
        <button
          onClick={onNewDataset}
          className={`
            w-full flex items-center gap-2 rounded-lg transition-colors duration-150
            text-gray-600 dark:text-gray-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:text-purple-600 dark:hover:text-purple-400
            ${isOpen ? "px-2 py-2" : "px-0 py-2 justify-center"}
          `}
          title="New Dataset"
        >
          <Plus className="w-4 h-4 shrink-0" />
          {isOpen && <span className="text-sm">New Dataset</span>}
        </button>

        {/* Settings */}
        <button
          onClick={onSettingsOpen}
          className={`
            w-full flex items-center gap-2 rounded-lg transition-colors duration-150
            text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800
            ${isOpen ? "px-2 py-2" : "px-0 py-2 justify-center"}
          `}
          title="Settings"
        >
          <Settings className="w-4 h-4 shrink-0" />
          {isOpen && <span className="text-sm">Settings</span>}
        </button>

        {/* Theme toggle + AI status */}
        <div
          className={`flex items-center ${
            isOpen ? "justify-between px-2" : "justify-center"
          } py-1`}
        >
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>

          {isOpen && (
            <div
              className="flex items-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-500"
              title={
                aiStatus === "online"
                  ? "Ollama connected"
                  : aiStatus === "offline"
                    ? "Ollama unavailable"
                    : "Checking..."
              }
            >
              {aiStatus === "online" ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <Wifi className="w-3 h-3 text-emerald-500" />
                  <span>AI</span>
                </>
              ) : aiStatus === "offline" ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  <WifiOff className="w-3 h-3 text-red-400" />
                  <span>AI</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                  <span>checking...</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.aside>
  );
}
