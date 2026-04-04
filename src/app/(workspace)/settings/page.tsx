"use client";

import { useEffect, useState } from "react";

import { useUIStore } from "@/stores/ui-store";

type FontSize = "small" | "medium" | "large";
type Density = "comfortable" | "compact" | "cozy";
type ChartType = "bar" | "line" | "area" | "pie" | "radar";
type DateFormat = "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY";
type ExportFormat = "csv" | "excel" | "pdf" | "png";

interface DisplaySettings {
  fontSize: FontSize;
  density: Density;
  compactMode: boolean;
  showGrid: boolean;
  animateCharts: boolean;
}

interface DataSettings {
  defaultChartType: ChartType;
  dateFormat: DateFormat;
  defaultTimezone: string;
  includeNullAsZero: boolean;
  precision: number;
}

interface ExportSettings {
  defaultFormat: ExportFormat;
  includeMetadata: boolean;
  filenamePrefix: string;
  rememberLastExport: boolean;
}

interface SettingsState {
  display: DisplaySettings;
  data: DataSettings;
  export: ExportSettings;
}

const storageKey = "datalens-workspace-settings-v1";

const defaultSettings: SettingsState = {
  display: {
    fontSize: "medium",
    density: "comfortable",
    compactMode: false,
    showGrid: true,
    animateCharts: true,
  },
  data: {
    defaultChartType: "bar",
    dateFormat: "YYYY-MM-DD",
    defaultTimezone: "UTC",
    includeNullAsZero: false,
    precision: 2,
  },
  export: {
    defaultFormat: "csv",
    includeMetadata: true,
    filenamePrefix: "datalens-export",
    rememberLastExport: true,
  },
};

const themeOptions = ["light", "dark"] as const;
const dateFormats: DateFormat[] = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"];
const chartTypes: ChartType[] = ["bar", "line", "area", "pie", "radar"];
const exportFormatOptions: ExportFormat[] = ["csv", "excel", "pdf", "png"];

const densityLabel: Record<Density, string> = {
  comfortable: "Comfortable",
  compact: "Compact",
  cozy: "Cozy",
};

const glass =
  "rounded-2xl border border-white/30 bg-white/60 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60";

function mergeSettings(saved: unknown): SettingsState {
  if (!saved || typeof saved !== "object") return defaultSettings;
  const candidate = saved as Partial<SettingsState>;

  return {
    display: { ...defaultSettings.display, ...candidate.display },
    data: { ...defaultSettings.data, ...candidate.data },
    export: { ...defaultSettings.export, ...candidate.export },
  };
}

export default function SettingsPage() {
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as unknown;
      setSettings(mergeSettings(parsed));
    } catch {
      // Keep defaults on malformed cache payload.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(settings));
  }, [settings]);

  const resetSettings = () => {
    setSettings(defaultSettings);
  };

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Workspace Settings</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">Fine-tune your dashboard defaults and export behavior.</p>
      </header>

      <section className={glass}>
        <h2 className="mb-3 text-base font-semibold">Theme</h2>
        <div className="flex flex-wrap items-center gap-2">
          {themeOptions.map((option) => {
            const active = theme === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setTheme(option)}
                className={`rounded-2xl border px-4 py-2 text-sm ${
                  active
                    ? "border-cyan-400 bg-cyan-600 text-white"
                    : "border-white/40 bg-white/40 text-slate-700 hover:border-cyan-300 dark:bg-slate-900/40 dark:text-slate-100"
                }`}
              >
                {option === "light" ? "Light mode" : "Dark mode"}
              </button>
            );
          })}
        </div>
      </section>

      <section className={glass}>
        <h2 className="mb-3 text-base font-semibold">Display Preferences</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-sm">Font size</span>
            <select
              value={settings.display.fontSize}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  display: { ...current.display, fontSize: event.target.value as FontSize },
                }))
              }
              className="rounded-2xl border border-white/40 bg-white/50 p-2.5 text-sm dark:bg-slate-950/50"
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm">Dashboard density</span>
            <select
              value={settings.display.density}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  display: { ...current.display, density: event.target.value as Density },
                }))
              }
              className="rounded-2xl border border-white/40 bg-white/50 p-2.5 text-sm dark:bg-slate-950/50"
            >
              {(Object.keys(densityLabel) as Density[]).map((density) => (
                <option key={density} value={density}>
                  {densityLabel[density]}
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex items-center justify-between rounded-2xl border border-white/30 bg-white/40 p-3 text-sm dark:border-white/10 dark:bg-slate-900/40">
            <span>Compact mode</span>
            <input
              type="checkbox"
              checked={settings.display.compactMode}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  display: { ...current.display, compactMode: event.target.checked },
                }))
              }
            />
          </label>

          <label className="inline-flex items-center justify-between rounded-2xl border border-white/30 bg-white/40 p-3 text-sm dark:border-white/10 dark:bg-slate-900/40">
            <span>Show chart grid</span>
            <input
              type="checkbox"
              checked={settings.display.showGrid}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  display: { ...current.display, showGrid: event.target.checked },
                }))
              }
            />
          </label>

          <label className="inline-flex items-center justify-between rounded-2xl border border-white/30 bg-white/40 p-3 text-sm dark:border-white/10 dark:bg-slate-900/40">
            <span>Animate charts</span>
            <input
              type="checkbox"
              checked={settings.display.animateCharts}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  display: { ...current.display, animateCharts: event.target.checked },
                }))
              }
            />
          </label>
        </div>
      </section>

      <section className={glass}>
        <h2 className="mb-3 text-base font-semibold">Data Preferences</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-sm">Default chart type</span>
            <select
              value={settings.data.defaultChartType}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  data: { ...current.data, defaultChartType: event.target.value as ChartType },
                }))
              }
              className="rounded-2xl border border-white/40 bg-white/50 p-2.5 text-sm dark:bg-slate-950/50"
            >
              {chartTypes.map((chart) => (
                <option key={chart} value={chart}>
                  {chart}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm">Date format</span>
            <select
              value={settings.data.dateFormat}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  data: { ...current.data, dateFormat: event.target.value as DateFormat },
                }))
              }
              className="rounded-2xl border border-white/40 bg-white/50 p-2.5 text-sm dark:bg-slate-950/50"
            >
              {dateFormats.map((format) => (
                <option key={format} value={format}>
                  {format}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm">Default timezone</span>
            <input
              value={settings.data.defaultTimezone}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  data: { ...current.data, defaultTimezone: event.target.value },
                }))
              }
              className="rounded-2xl border border-white/40 bg-white/50 p-2.5 text-sm dark:bg-slate-950/50"
            />
          </label>

          <label className="inline-flex items-center justify-between rounded-2xl border border-white/30 bg-white/40 p-3 text-sm dark:border-white/10 dark:bg-slate-900/40">
            <span>Include nulls as zero in charts</span>
            <input
              type="checkbox"
              checked={settings.data.includeNullAsZero}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  data: { ...current.data, includeNullAsZero: event.target.checked },
                }))
              }
            />
          </label>

          <label className="inline-flex flex-col gap-2">
            <span className="text-sm">Numeric precision</span>
            <input
              type="range"
              min={0}
              max={6}
              value={settings.data.precision}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  data: {
                    ...current.data,
                    precision: Number.parseInt(event.target.value, 10),
                  },
                }))
              }
            />
            <span className="text-xs text-slate-600 dark:text-slate-300">{settings.data.precision} decimal places</span>
          </label>
        </div>
      </section>

      <section className={glass}>
        <h2 className="mb-3 text-base font-semibold">Export Settings</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-sm">Default export format</span>
            <select
              value={settings.export.defaultFormat}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  export: { ...current.export, defaultFormat: event.target.value as ExportFormat },
                }))
              }
              className="rounded-2xl border border-white/40 bg-white/50 p-2.5 text-sm dark:bg-slate-950/50"
            >
              {exportFormatOptions.map((format) => (
                <option key={format} value={format}>
                  {format.toUpperCase()}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm">Filename prefix</span>
            <input
              value={settings.export.filenamePrefix}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  export: { ...current.export, filenamePrefix: event.target.value },
                }))
              }
              className="rounded-2xl border border-white/40 bg-white/50 p-2.5 text-sm dark:bg-slate-950/50"
            />
          </label>

          <label className="inline-flex items-center justify-between rounded-2xl border border-white/30 bg-white/40 p-3 text-sm dark:border-white/10 dark:bg-slate-900/40">
            <span>Include metadata in exports</span>
            <input
              type="checkbox"
              checked={settings.export.includeMetadata}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  export: { ...current.export, includeMetadata: event.target.checked },
                }))
              }
            />
          </label>

          <label className="inline-flex items-center justify-between rounded-2xl border border-white/30 bg-white/40 p-3 text-sm dark:border-white/10 dark:bg-slate-900/40">
            <span>Remember last export options</span>
            <input
              type="checkbox"
              checked={settings.export.rememberLastExport}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  export: { ...current.export, rememberLastExport: event.target.checked },
                }))
              }
            />
          </label>
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={resetSettings}
          className="rounded-2xl border border-white/40 px-4 py-2 text-sm font-semibold hover:bg-white/40 dark:border-white/15 dark:hover:bg-slate-900/35"
        >
          Reset defaults
        </button>
        <p className="rounded-2xl border border-cyan-300/40 bg-cyan-50 px-4 py-2 text-sm text-cyan-700 dark:bg-slate-950/50 dark:text-cyan-300">
          Settings saved automatically to this device.
        </p>
      </div>
    </div>
  );
}
