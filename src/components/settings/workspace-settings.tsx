"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Gauge,
  Paintbrush,
  RefreshCw,
  Save,
  Settings2,
  TimerReset,
} from "lucide-react";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
} from "@/lib/utils/advanced-analytics";

interface WorkspaceSettingsState {
  workspaceName: string;
  description: string;
  chartTheme: "ocean" | "neutral" | "sunset" | "forest";
  dateFormat: "YYYY-MM-DD" | "DD/MM/YYYY" | "MMM D, YYYY";
  numberFormat: "standard" | "compact" | "currency" | "percent";
  queryTimeoutSeconds: number;
  maxRows: number;
  cacheTtlMinutes: number;
}

const STORAGE_KEY = "datalens-workspace-settings";

const DEFAULT_SETTINGS: WorkspaceSettingsState = {
  workspaceName: "DataLens workspace",
  description: "Shared analysis space for local DuckDB exploration and reporting.",
  chartTheme: "ocean",
  dateFormat: "YYYY-MM-DD",
  numberFormat: "standard",
  queryTimeoutSeconds: 30,
  maxRows: 5000,
  cacheTtlMinutes: 10,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readWorkspaceSettings(): WorkspaceSettingsState {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_SETTINGS;

    return {
      workspaceName:
        typeof parsed.workspaceName === "string" && parsed.workspaceName.trim().length > 0
          ? parsed.workspaceName
          : DEFAULT_SETTINGS.workspaceName,
      description:
        typeof parsed.description === "string"
          ? parsed.description
          : DEFAULT_SETTINGS.description,
      chartTheme:
        parsed.chartTheme === "neutral" ||
        parsed.chartTheme === "sunset" ||
        parsed.chartTheme === "forest"
          ? parsed.chartTheme
          : DEFAULT_SETTINGS.chartTheme,
      dateFormat:
        parsed.dateFormat === "DD/MM/YYYY" || parsed.dateFormat === "MMM D, YYYY"
          ? parsed.dateFormat
          : DEFAULT_SETTINGS.dateFormat,
      numberFormat:
        parsed.numberFormat === "compact" ||
        parsed.numberFormat === "currency" ||
        parsed.numberFormat === "percent"
          ? parsed.numberFormat
          : DEFAULT_SETTINGS.numberFormat,
      queryTimeoutSeconds: Number.isFinite(Number(parsed.queryTimeoutSeconds))
        ? Math.max(5, Math.min(300, Math.round(Number(parsed.queryTimeoutSeconds))))
        : DEFAULT_SETTINGS.queryTimeoutSeconds,
      maxRows: Number.isFinite(Number(parsed.maxRows))
        ? Math.max(100, Math.min(100_000, Math.round(Number(parsed.maxRows))))
        : DEFAULT_SETTINGS.maxRows,
      cacheTtlMinutes: Number.isFinite(Number(parsed.cacheTtlMinutes))
        ? Math.max(1, Math.min(1440, Math.round(Number(parsed.cacheTtlMinutes))))
        : DEFAULT_SETTINGS.cacheTtlMinutes,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistWorkspaceSettings(settings: WorkspaceSettingsState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Settings2;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-5`}>
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-2xl bg-cyan-500/10 p-2.5 text-cyan-700 dark:text-cyan-300">
          <Icon className="h-4 w-4" />
        </div>
        <h3 className="text-base font-semibold text-slate-950 dark:text-white">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function WorkspaceSettings() {
  const [settings, setSettings] = useState<WorkspaceSettingsState>(() => readWorkspaceSettings());
  const [status, setStatus] = useState("Local workspace defaults are ready.");

  const summary = useMemo(
    () =>
      `${settings.workspaceName} · ${settings.chartTheme} charts · ${settings.maxRows.toLocaleString()} max rows`,
    [settings.chartTheme, settings.maxRows, settings.workspaceName],
  );

  function updateSetting<K extends keyof WorkspaceSettingsState>(
    key: K,
    value: WorkspaceSettingsState[K],
  ) {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function saveSettings() {
    persistWorkspaceSettings(settings);
    setStatus("Workspace settings saved to localStorage.");
  }

  function resetSettings() {
    setSettings(DEFAULT_SETTINGS);
    persistWorkspaceSettings(DEFAULT_SETTINGS);
    setStatus("Workspace settings reset to defaults.");
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Settings2 className="h-3.5 w-3.5" />
            Workspace settings
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Tune workspace defaults for display and performance
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Save a local workspace profile for presentation defaults, query limits, and caching
            behavior. These values are persisted only in the current browser.
          </p>
        </div>

        <div className={`${GLASS_CARD_CLASS} max-w-md p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Current profile
          </p>
          <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
            {summary}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {status}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <Section icon={Settings2} title="General">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Workspace name
              </span>
              <input
                value={settings.workspaceName}
                onChange={(event) => updateSetting("workspaceName", event.target.value)}
                className={FIELD_CLASS}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Description
              </span>
              <textarea
                value={settings.description}
                onChange={(event) => updateSetting("description", event.target.value)}
                className={`${FIELD_CLASS} min-h-32 resize-none`}
              />
            </label>
          </div>
        </Section>

        <Section icon={Paintbrush} title="Display">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Default chart theme
              </span>
              <select
                value={settings.chartTheme}
                onChange={(event) =>
                  updateSetting("chartTheme", event.target.value as WorkspaceSettingsState["chartTheme"])
                }
                className={FIELD_CLASS}
              >
                <option value="ocean">Ocean</option>
                <option value="neutral">Neutral</option>
                <option value="sunset">Sunset</option>
                <option value="forest">Forest</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Date format
              </span>
              <select
                value={settings.dateFormat}
                onChange={(event) =>
                  updateSetting("dateFormat", event.target.value as WorkspaceSettingsState["dateFormat"])
                }
                className={FIELD_CLASS}
              >
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="MMM D, YYYY">MMM D, YYYY</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Number format
              </span>
              <select
                value={settings.numberFormat}
                onChange={(event) =>
                  updateSetting("numberFormat", event.target.value as WorkspaceSettingsState["numberFormat"])
                }
                className={FIELD_CLASS}
              >
                <option value="standard">Standard</option>
                <option value="compact">Compact</option>
                <option value="currency">Currency</option>
                <option value="percent">Percent</option>
              </select>
            </label>
          </div>
        </Section>

        <Section icon={Gauge} title="Performance">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Query timeout (seconds)
              </span>
              <input
                type="number"
                min={5}
                max={300}
                value={settings.queryTimeoutSeconds}
                onChange={(event) =>
                  updateSetting("queryTimeoutSeconds", Math.max(5, Number(event.target.value) || 5))
                }
                className={FIELD_CLASS}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Max rows per result
              </span>
              <input
                type="number"
                min={100}
                max={100000}
                value={settings.maxRows}
                onChange={(event) =>
                  updateSetting("maxRows", Math.max(100, Number(event.target.value) || 100))
                }
                className={FIELD_CLASS}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Cache TTL (minutes)
              </span>
              <input
                type="number"
                min={1}
                max={1440}
                value={settings.cacheTtlMinutes}
                onChange={(event) =>
                  updateSetting("cacheTtlMinutes", Math.max(1, Number(event.target.value) || 1))
                }
                className={FIELD_CLASS}
              />
            </label>
          </div>
        </Section>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
        className="mt-6 flex flex-wrap gap-3"
      >
        <button type="button" onClick={saveSettings} className={BUTTON_CLASS}>
          <Save className="h-4 w-4" />
          Save settings
        </button>
        <button type="button" onClick={resetSettings} className={BUTTON_CLASS}>
          <TimerReset className="h-4 w-4" />
          Reset defaults
        </button>
        <div className={`${GLASS_CARD_CLASS} inline-flex items-center gap-2 px-4 py-3 text-sm text-slate-600 dark:text-slate-300`}>
          <RefreshCw className="h-4 w-4 text-cyan-500" />
          Settings are browser-local and update only when you save.
        </div>
      </motion.div>
    </section>
  );
}
