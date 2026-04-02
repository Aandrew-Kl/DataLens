"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Bot,
  Palette,
  Database,
  Keyboard,
  Info,
  Loader2,
  Sun,
  Moon,
  Monitor,
  ExternalLink,
  Command,
} from "lucide-react";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

type Theme = "light" | "dark" | "system";

interface Settings {
  ollamaUrl: string;
  ollamaModel: string;
  theme: Theme;
  compact: boolean;
  pageSize: number;
  autoDashboard: boolean;
  maxChartRows: number;
}

const DEFAULT_SETTINGS: Settings = {
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
  theme: "system",
  compact: false,
  pageSize: 25,
  autoDashboard: true,
  maxChartRows: 15,
};

const STORAGE_KEYS = {
  ollamaUrl: "datalens-ollama-url",
  ollamaModel: "datalens-ollama-model",
  theme: "datalens-theme",
  compact: "datalens-compact",
  pageSize: "datalens-page-size",
  autoDashboard: "datalens-auto-dashboard",
  maxChartRows: "datalens-max-chart-rows",
} as const;

const PAGE_SIZES = [10, 25, 50, 100];
const MAX_CHART_ROWS_OPTIONS = [10, 15, 20, 50];

const SHORTCUTS = [
  { keys: ["Ctrl/Cmd", "Enter"], description: "Execute query" },
  { keys: ["Ctrl/Cmd", "K"], description: "Open search" },
  { keys: ["Ctrl/Cmd", "N"], description: "New dataset" },
  { keys: ["Ctrl/Cmd", "E"], description: "Export data" },
  { keys: ["Ctrl/Cmd", "D"], description: "Toggle dark mode" },
  { keys: ["Ctrl/Cmd", ","], description: "Open settings" },
  { keys: ["Escape"], description: "Close modal/panel" },
];

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;

  return {
    ollamaUrl:
      localStorage.getItem(STORAGE_KEYS.ollamaUrl) ?? DEFAULT_SETTINGS.ollamaUrl,
    ollamaModel:
      localStorage.getItem(STORAGE_KEYS.ollamaModel) ?? DEFAULT_SETTINGS.ollamaModel,
    theme:
      (localStorage.getItem(STORAGE_KEYS.theme) as Theme) ?? DEFAULT_SETTINGS.theme,
    compact:
      localStorage.getItem(STORAGE_KEYS.compact) === "true",
    pageSize:
      Number(localStorage.getItem(STORAGE_KEYS.pageSize)) || DEFAULT_SETTINGS.pageSize,
    autoDashboard:
      localStorage.getItem(STORAGE_KEYS.autoDashboard) !== "false",
    maxChartRows:
      Number(localStorage.getItem(STORAGE_KEYS.maxChartRows)) || DEFAULT_SETTINGS.maxChartRows,
  };
}

function SectionHeader({
  icon: Icon,
  label,
}: {
  icon: React.ElementType;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon className="w-4 h-4 text-purple-500 dark:text-purple-400" />
      <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </h3>
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`
          relative w-10 h-[22px] rounded-full transition-colors duration-200
          ${checked ? "bg-purple-500" : "bg-gray-300 dark:bg-gray-600"}
        `}
      >
        <motion.div
          className="absolute top-[3px] left-[3px] w-4 h-4 bg-white rounded-full shadow-sm"
          animate={{ x: checked ? 18 : 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      </button>
    </div>
  );
}

function KeyBadge({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="
      inline-flex items-center justify-center min-w-[24px] h-6 px-1.5
      text-[11px] font-mono font-medium
      bg-gray-100 dark:bg-gray-800
      text-gray-600 dark:text-gray-400
      border border-gray-200 dark:border-gray-700
      rounded-md shadow-sm
    ">
      {children}
    </kbd>
  );
}

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "testing" | "connected" | "disconnected"
  >("idle");

  useEffect(() => {
    if (open) {
      setSettings(loadSettings());
    }
  }, [open]);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, handleEscape]);

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    const storageKey = STORAGE_KEYS[key];
    localStorage.setItem(storageKey, String(value));

    if (key === "theme") {
      applyTheme(value as Theme);
    }
  }

  function applyTheme(theme: Theme) {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "light") {
      root.classList.remove("dark");
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.classList.toggle("dark", prefersDark);
    }
  }

  async function testConnection() {
    setConnectionStatus("testing");
    try {
      const url = settings.ollamaUrl.replace(/\/+$/, "");
      const response = await fetch(url, { method: "GET" });
      setConnectionStatus(response.ok ? "connected" : "disconnected");
    } catch {
      setConnectionStatus("disconnected");
    }
  }

  const connectionDot = {
    idle: "bg-gray-400 dark:bg-gray-500",
    testing: "bg-amber-400 dark:bg-amber-500",
    connected: "bg-emerald-500 dark:bg-emerald-400",
    disconnected: "bg-red-500 dark:bg-red-400",
  };

  const connectionLabel = {
    idle: "Not tested",
    testing: "Testing...",
    connected: "Connected",
    disconnected: "Disconnected",
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Content */}
          <motion.div
            className="
              relative w-full max-w-lg max-h-[85vh]
              rounded-2xl
              bg-white/90 dark:bg-gray-900/90
              backdrop-blur-xl
              border border-gray-200/50 dark:border-gray-700/50
              shadow-xl
              flex flex-col
            "
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200/60 dark:border-gray-700/50 shrink-0">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Settings
              </h2>
              <button
                onClick={onClose}
                className="
                  p-1.5 rounded-lg
                  text-gray-400 hover:text-gray-600
                  dark:text-gray-500 dark:hover:text-gray-300
                  hover:bg-gray-100 dark:hover:bg-gray-800
                  transition-colors duration-150
                "
                aria-label="Close settings"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">
              {/* AI Settings */}
              <section>
                <SectionHeader icon={Bot} label="AI Settings" />
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Ollama URL
                    </label>
                    <input
                      type="text"
                      value={settings.ollamaUrl}
                      onChange={(e) => updateSetting("ollamaUrl", e.target.value)}
                      className="
                        w-full px-3 py-2 text-sm rounded-lg
                        bg-gray-50 dark:bg-gray-800
                        border border-gray-200 dark:border-gray-700
                        text-gray-800 dark:text-gray-200
                        placeholder-gray-400 dark:placeholder-gray-500
                        focus:outline-none focus:ring-2 focus:ring-purple-500/40
                        transition-shadow duration-150
                        font-mono
                      "
                      placeholder="http://localhost:11434"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Model Name
                    </label>
                    <input
                      type="text"
                      value={settings.ollamaModel}
                      onChange={(e) => updateSetting("ollamaModel", e.target.value)}
                      className="
                        w-full px-3 py-2 text-sm rounded-lg
                        bg-gray-50 dark:bg-gray-800
                        border border-gray-200 dark:border-gray-700
                        text-gray-800 dark:text-gray-200
                        placeholder-gray-400 dark:placeholder-gray-500
                        focus:outline-none focus:ring-2 focus:ring-purple-500/40
                        transition-shadow duration-150
                        font-mono
                      "
                      placeholder="llama3.2"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={testConnection}
                      disabled={connectionStatus === "testing"}
                      className="
                        flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg
                        bg-purple-500 hover:bg-purple-600
                        text-white
                        disabled:opacity-50 disabled:cursor-not-allowed
                        transition-colors duration-150
                      "
                    >
                      {connectionStatus === "testing" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : null}
                      Test Connection
                    </button>
                    <div className="flex items-center gap-1.5">
                      <div
                        className={`w-2 h-2 rounded-full ${connectionDot[connectionStatus]}`}
                      />
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {connectionLabel[connectionStatus]}
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Appearance */}
              <section>
                <SectionHeader icon={Palette} label="Appearance" />
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                      Theme
                    </label>
                    <div className="flex gap-2">
                      {(
                        [
                          { value: "light" as Theme, icon: Sun, label: "Light" },
                          { value: "dark" as Theme, icon: Moon, label: "Dark" },
                          { value: "system" as Theme, icon: Monitor, label: "System" },
                        ] as const
                      ).map(({ value, icon: ThemeIcon, label }) => (
                        <button
                          key={value}
                          onClick={() => updateSetting("theme", value)}
                          className={`
                            flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg flex-1
                            transition-colors duration-150
                            ${
                              settings.theme === value
                                ? "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700"
                                : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
                            }
                          `}
                        >
                          <ThemeIcon className="w-3.5 h-3.5" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={settings.compact}
                    onChange={(val) => updateSetting("compact", val)}
                    label="Compact mode"
                  />
                </div>
              </section>

              {/* Data Settings */}
              <section>
                <SectionHeader icon={Database} label="Data Settings" />
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                      Default Page Size
                    </label>
                    <div className="flex gap-2">
                      {PAGE_SIZES.map((size) => (
                        <button
                          key={size}
                          onClick={() => updateSetting("pageSize", size)}
                          className={`
                            px-3 py-1.5 text-xs font-mono font-medium rounded-lg flex-1
                            transition-colors duration-150
                            ${
                              settings.pageSize === size
                                ? "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700"
                                : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
                            }
                          `}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={settings.autoDashboard}
                    onChange={(val) => updateSetting("autoDashboard", val)}
                    label="Auto-generate dashboard"
                  />
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                      Max Chart Rows
                    </label>
                    <div className="flex gap-2">
                      {MAX_CHART_ROWS_OPTIONS.map((count) => (
                        <button
                          key={count}
                          onClick={() => updateSetting("maxChartRows", count)}
                          className={`
                            px-3 py-1.5 text-xs font-mono font-medium rounded-lg flex-1
                            transition-colors duration-150
                            ${
                              settings.maxChartRows === count
                                ? "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700"
                                : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
                            }
                          `}
                        >
                          {count}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {/* Keyboard Shortcuts */}
              <section>
                <SectionHeader icon={Keyboard} label="Keyboard Shortcuts" />
                <div className="rounded-lg border border-gray-200/60 dark:border-gray-700/50 overflow-hidden">
                  {SHORTCUTS.map((shortcut, i) => (
                    <div
                      key={shortcut.description}
                      className={`
                        flex items-center justify-between px-3 py-2.5
                        ${i !== SHORTCUTS.length - 1 ? "border-b border-gray-100 dark:border-gray-800" : ""}
                        ${i % 2 === 0 ? "bg-gray-50/50 dark:bg-gray-800/30" : ""}
                      `}
                    >
                      <span className="text-xs text-gray-600 dark:text-gray-400">
                        {shortcut.description}
                      </span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, ki) => (
                          <span key={ki} className="flex items-center gap-1">
                            {ki > 0 && (
                              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                                +
                              </span>
                            )}
                            <KeyBadge>
                              {key === "Ctrl/Cmd" ? (
                                <span className="flex items-center gap-0.5">
                                  <Command className="w-3 h-3" />
                                </span>
                              ) : (
                                key
                              )}
                            </KeyBadge>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* About */}
              <section>
                <SectionHeader icon={Info} label="About" />
                <div className="space-y-3">
                  <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 px-4 py-3 space-y-2">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                      DataLens
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Open Source AI Data Explorer
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                        v0.1.0
                      </span>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400">
                        MIT License
                      </span>
                    </div>
                  </div>
                  <a
                    href="https://github.com/datalens/datalens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="
                      flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg
                      text-gray-600 dark:text-gray-400
                      hover:bg-gray-100 dark:hover:bg-gray-800
                      transition-colors duration-150
                    "
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    View on GitHub
                  </a>
                </div>
              </section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
