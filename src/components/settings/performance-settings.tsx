"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Gauge, Layers3, Save, TimerReset, Zap } from "lucide-react";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
} from "@/lib/utils/advanced-analytics";

interface PerformanceSettingsState {
  duckDbMemoryLimitMb: number;
  workerThreads: number;
  cacheSizeMb: number;
  queryTimeoutSeconds: number;
  autoProfileOnLoad: boolean;
}

const STORAGE_KEY = "datalens:performance-settings";
const DEFAULT_SETTINGS: PerformanceSettingsState = {
  duckDbMemoryLimitMb: 2048,
  workerThreads: 4,
  cacheSizeMb: 512,
  queryTimeoutSeconds: 60,
  autoProfileOnLoad: false,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readPerformanceSettings(): PerformanceSettingsState {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_SETTINGS;

    return {
      duckDbMemoryLimitMb: clamp(Number(parsed.duckDbMemoryLimitMb) || DEFAULT_SETTINGS.duckDbMemoryLimitMb, 256, 8192),
      workerThreads: clamp(Number(parsed.workerThreads) || DEFAULT_SETTINGS.workerThreads, 1, 16),
      cacheSizeMb: clamp(Number(parsed.cacheSizeMb) || DEFAULT_SETTINGS.cacheSizeMb, 64, 4096),
      queryTimeoutSeconds: clamp(Number(parsed.queryTimeoutSeconds) || DEFAULT_SETTINGS.queryTimeoutSeconds, 5, 600),
      autoProfileOnLoad:
        typeof parsed.autoProfileOnLoad === "boolean"
          ? parsed.autoProfileOnLoad
          : DEFAULT_SETTINGS.autoProfileOnLoad,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistPerformanceSettings(settings: PerformanceSettingsState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export default function PerformanceSettings() {
  const [settings, setSettings] = useState<PerformanceSettingsState>(() => readPerformanceSettings());
  const [status, setStatus] = useState("Tune memory, parallelism, and timeouts for local DuckDB work.");

  const summary = useMemo(
    () =>
      `${settings.duckDbMemoryLimitMb} MB memory · ${settings.workerThreads} workers · ${settings.cacheSizeMb} MB cache`,
    [settings.cacheSizeMb, settings.duckDbMemoryLimitMb, settings.workerThreads],
  );

  function updateSetting<K extends keyof PerformanceSettingsState>(
    key: K,
    value: PerformanceSettingsState[K],
  ) {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function saveSettings() {
    persistPerformanceSettings(settings);
    setStatus("Performance settings saved to localStorage.");
  }

  function resetSettings() {
    setSettings(DEFAULT_SETTINGS);
    persistPerformanceSettings(DEFAULT_SETTINGS);
    setStatus("Performance settings reset to defaults.");
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Gauge className="h-3.5 w-3.5" />
            Performance
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Tune local DuckDB performance budgets
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Adjust memory, workers, caching, and timeout defaults for browser-side analytics and
            profiling workloads.
          </p>
        </div>

        <div className={`${GLASS_CARD_CLASS} max-w-md p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Current profile
          </p>
          <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">{summary}</p>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{status}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              DuckDB memory limit (MB)
            </span>
            <input
              type="range"
              min={256}
              max={8192}
              step={256}
              value={settings.duckDbMemoryLimitMb}
              onChange={(event) =>
                updateSetting("duckDbMemoryLimitMb", Number(event.target.value))
              }
              className="w-full accent-cyan-500"
              aria-label="DuckDB memory limit"
            />
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {settings.duckDbMemoryLimitMb} MB
            </p>
          </label>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Worker threads
              </span>
              <input
                type="number"
                min={1}
                max={16}
                value={settings.workerThreads}
                onChange={(event) =>
                  updateSetting("workerThreads", clamp(Number(event.target.value), 1, 16))
                }
                className={FIELD_CLASS}
                aria-label="Worker threads"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Cache size (MB)
              </span>
              <input
                type="number"
                min={64}
                max={4096}
                value={settings.cacheSizeMb}
                onChange={(event) =>
                  updateSetting("cacheSizeMb", clamp(Number(event.target.value), 64, 4096))
                }
                className={FIELD_CLASS}
                aria-label="Cache size"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Query timeout (seconds)
              </span>
              <input
                type="number"
                min={5}
                max={600}
                value={settings.queryTimeoutSeconds}
                onChange={(event) =>
                  updateSetting("queryTimeoutSeconds", clamp(Number(event.target.value), 5, 600))
                }
                className={FIELD_CLASS}
                aria-label="Query timeout"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Auto-profile on load
              </span>
              <button
                type="button"
                aria-pressed={settings.autoProfileOnLoad}
                onClick={() => updateSetting("autoProfileOnLoad", !settings.autoProfileOnLoad)}
                className={`${BUTTON_CLASS} w-full justify-between`}
              >
                <span>{settings.autoProfileOnLoad ? "Enabled" : "Disabled"}</span>
                <span className="text-xs uppercase tracking-[0.18em]">
                  {settings.autoProfileOnLoad ? "On" : "Off"}
                </span>
              </button>
            </label>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={saveSettings} className={BUTTON_CLASS}>
              <Save className="h-4 w-4" />
              Save profile
            </button>
            <button type="button" onClick={resetSettings} className={BUTTON_CLASS}>
              <TimerReset className="h-4 w-4" />
              Reset defaults
            </button>
          </div>
        </div>

        <div className="grid gap-4">
          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <div className="flex items-center gap-3">
              <Layers3 className="h-5 w-5 text-cyan-700 dark:text-cyan-300" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Parallelism
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">
                  {settings.workerThreads} worker threads
                </p>
              </div>
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <div className="flex items-center gap-3">
              <Zap className="h-5 w-5 text-cyan-700 dark:text-cyan-300" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Timeout budget
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">
                  {settings.queryTimeoutSeconds} seconds
                </p>
              </div>
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Profiling
            </p>
            <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
              {settings.autoProfileOnLoad ? "Automatic profiling enabled" : "Manual profiling"}
            </p>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
