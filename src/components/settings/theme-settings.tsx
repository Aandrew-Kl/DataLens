"use client";

import { motion } from "framer-motion";
import { startTransition, useMemo, useState } from "react";
import {
  Laptop,
  Moon,
  Palette,
  Sparkles,
  Sun,
  TextCursorInput,
  Workflow,
} from "lucide-react";
import {
  ANALYTICS_EASE,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
} from "@/lib/utils/advanced-analytics";

type ThemeMode = "light" | "dark" | "system";
type AccentPreset =
  | "cyan"
  | "emerald"
  | "amber"
  | "rose"
  | "violet"
  | "slate";

interface ThemeSettingsState {
  theme: ThemeMode;
  accent: AccentPreset;
  fontSize: number;
  compactMode: boolean;
}

const STORAGE_KEY = "datalens:theme-settings";
const DEFAULT_SETTINGS: ThemeSettingsState = {
  theme: "system",
  accent: "cyan",
  fontSize: 16,
  compactMode: false,
};

const ACCENT_PRESETS = [
  { value: "cyan", label: "Cyan", color: "#06b6d4" },
  { value: "emerald", label: "Emerald", color: "#10b981" },
  { value: "amber", label: "Amber", color: "#f59e0b" },
  { value: "rose", label: "Rose", color: "#f43f5e" },
  { value: "violet", label: "Violet", color: "#8b5cf6" },
  { value: "slate", label: "Slate", color: "#64748b" },
] as const;

function readThemeSettings(): ThemeSettingsState {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_SETTINGS;

    return {
      theme:
        parsed.theme === "light" || parsed.theme === "dark"
          ? parsed.theme
          : DEFAULT_SETTINGS.theme,
      accent:
        parsed.accent === "emerald" ||
        parsed.accent === "amber" ||
        parsed.accent === "rose" ||
        parsed.accent === "violet" ||
        parsed.accent === "slate"
          ? parsed.accent
          : DEFAULT_SETTINGS.accent,
      fontSize: Number.isFinite(Number(parsed.fontSize))
        ? Math.min(20, Math.max(14, Math.round(Number(parsed.fontSize))))
        : DEFAULT_SETTINGS.fontSize,
      compactMode:
        typeof parsed.compactMode === "boolean"
          ? parsed.compactMode
          : DEFAULT_SETTINGS.compactMode,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveThemeSettings(settings: ThemeSettingsState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function previewSurface(theme: ThemeMode) {
  if (theme === "dark") {
    return {
      background: "linear-gradient(135deg, rgba(15,23,42,0.96), rgba(2,6,23,0.92))",
      color: "#f8fafc",
      muted: "#cbd5e1",
    };
  }

  return {
    background:
      theme === "light"
        ? "linear-gradient(135deg, rgba(255,255,255,0.92), rgba(241,245,249,0.96))"
        : "linear-gradient(135deg, rgba(248,250,252,0.92), rgba(226,232,240,0.96))",
    color: "#0f172a",
    muted: "#475569",
  };
}

export default function ThemeSettings() {
  const [settings, setSettings] = useState<ThemeSettingsState>(() =>
    readThemeSettings(),
  );
  const [notice, setNotice] = useState("Theme preferences are stored locally.");

  const accentColor = useMemo(
    () =>
      ACCENT_PRESETS.find((preset) => preset.value === settings.accent)?.color ??
      ACCENT_PRESETS[0].color,
    [settings.accent],
  );
  const preview = useMemo(() => previewSurface(settings.theme), [settings.theme]);

  function updateSettings(patch: Partial<ThemeSettingsState>) {
    startTransition(() => {
      const next = {
        ...settings,
        ...patch,
      };

      setSettings(next);
      saveThemeSettings(next);
      setNotice("Theme settings saved to localStorage.");
    });
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Palette className="h-3.5 w-3.5" />
            Theme settings
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Configure appearance defaults and preview them live
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Switch between light, dark, and system modes, set a preferred
            accent, adjust base font size, and toggle compact spacing.
          </p>
        </div>

        <div className={`${GLASS_CARD_CLASS} max-w-md p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Current profile
          </p>
          <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
            {settings.theme} · {settings.accent} · {settings.fontSize}px
          </p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {notice}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.05fr,0.95fr]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
          className="space-y-5"
        >
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Mode
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                { value: "light" as const, label: "Light", icon: Sun },
                { value: "dark" as const, label: "Dark", icon: Moon },
                { value: "system" as const, label: "System", icon: Laptop },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={settings.theme === value}
                  onClick={() => updateSettings({ theme: value })}
                  className={
                    settings.theme === value
                      ? "rounded-3xl border border-cyan-400/40 bg-cyan-500/15 p-4 text-left text-cyan-800 dark:text-cyan-200"
                      : `${GLASS_CARD_CLASS} p-4 text-left`
                  }
                >
                  <Icon className="h-5 w-5" />
                  <p className="mt-3 font-medium">{label}</p>
                </button>
              ))}
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Accent color
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  aria-pressed={settings.accent === preset.value}
                  onClick={() => updateSettings({ accent: preset.value })}
                  className={
                    settings.accent === preset.value
                      ? "rounded-3xl border border-white/30 bg-white/70 p-4 text-left dark:bg-slate-950/50"
                      : `${GLASS_CARD_CLASS} p-4 text-left`
                  }
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="h-5 w-5 rounded-full"
                      style={{ backgroundColor: preset.color }}
                    />
                    <span className="font-medium text-slate-950 dark:text-white">
                      {preset.label}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} grid gap-4 p-5 md:grid-cols-2`}>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Font size
              </span>
              <input
                type="range"
                min={14}
                max={20}
                step={1}
                value={settings.fontSize}
                onChange={(event) =>
                  updateSettings({ fontSize: Number(event.target.value) })
                }
                className="w-full accent-cyan-500"
              />
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {settings.fontSize}px base text
              </p>
            </label>

            <button
              type="button"
              aria-pressed={settings.compactMode}
              onClick={() =>
                updateSettings({ compactMode: !settings.compactMode })
              }
              className={`${GLASS_CARD_CLASS} flex items-center justify-between gap-4 p-4 text-left`}
            >
              <div>
                <p className="font-medium text-slate-950 dark:text-white">
                  Compact mode
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Reduce spacing density in cards and lists.
                </p>
              </div>
              <span
                className={
                  settings.compactMode
                    ? "rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300"
                    : "rounded-full bg-slate-300/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                }
              >
                {settings.compactMode ? "On" : "Off"}
              </span>
            </button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: ANALYTICS_EASE, delay: 0.04 }}
          className={`${GLASS_CARD_CLASS} p-5`}
        >
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <Sparkles className="h-4 w-4 text-cyan-500" />
            Live preview
          </div>

          <div
            className="mt-4 rounded-[2rem] border border-white/20 p-5 shadow-lg"
            style={{
              background: preview.background,
              color: preview.color,
              fontSize: `${settings.fontSize}px`,
              boxShadow: `0 18px 50px ${accentColor}22`,
            }}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70">
                  Theme sample
                </p>
                <h3 className="mt-2 text-2xl font-semibold">
                  DataLens workspace preview
                </h3>
              </div>
              <span
                className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]"
                style={{
                  backgroundColor: `${accentColor}22`,
                  color: accentColor,
                }}
              >
                {settings.accent}
              </span>
            </div>

            <div
              className="mt-5 grid gap-4 sm:grid-cols-2"
              style={{ gap: settings.compactMode ? "0.75rem" : "1rem" }}
            >
              <div
                className="rounded-3xl border border-white/20 p-4"
                style={{
                  backgroundColor:
                    settings.theme === "dark"
                      ? "rgba(15, 23, 42, 0.48)"
                      : "rgba(255, 255, 255, 0.6)",
                }}
              >
                <div className="flex items-center gap-2">
                  <TextCursorInput className="h-4 w-4" style={{ color: accentColor }} />
                  <p className="font-medium">Typography</p>
                </div>
                <p className="mt-2" style={{ color: preview.muted }}>
                  Base copy uses the chosen font size and spacing density.
                </p>
              </div>

              <div
                className="rounded-3xl border border-white/20 p-4"
                style={{
                  backgroundColor:
                    settings.theme === "dark"
                      ? "rgba(15, 23, 42, 0.48)"
                      : "rgba(255, 255, 255, 0.6)",
                }}
              >
                <div className="flex items-center gap-2">
                  <Workflow className="h-4 w-4" style={{ color: accentColor }} />
                  <p className="font-medium">Density</p>
                </div>
                <p className="mt-2" style={{ color: preview.muted }}>
                  {settings.compactMode
                    ? "Compact spacing keeps more information visible."
                    : "Standard spacing gives breathing room to controls."}
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
