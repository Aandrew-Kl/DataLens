"use client";

import { startTransition, useState } from "react";
import { motion } from "framer-motion";
import { Accessibility, Type } from "lucide-react";
import {
  ANALYTICS_EASE,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
} from "@/lib/utils/advanced-analytics";
import type { ColumnProfile } from "@/types/dataset";

interface AccessibilitySettingsProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface AccessibilityState {
  highContrast: boolean;
  reduceMotion: boolean;
  fontScale: number;
  screenReaderHints: boolean;
}

const DEFAULT_SETTINGS: AccessibilityState = {
  highContrast: false,
  reduceMotion: false,
  fontScale: 1,
  screenReaderHints: true,
};

const FONT_SCALE_OPTIONS: readonly { label: string; value: number }[] = [
  { label: "Small (0.85x)", value: 0.85 },
  { label: "Default (1x)", value: 1 },
  { label: "Large (1.15x)", value: 1.15 },
  { label: "Extra Large (1.3x)", value: 1.3 },
] as const;

function readSettings(tableName: string): AccessibilityState {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;

  try {
    const raw = window.localStorage.getItem(`datalens:accessibility:${tableName}`);
    if (!raw) return DEFAULT_SETTINGS;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_SETTINGS;

    return {
      highContrast:
        typeof parsed.highContrast === "boolean"
          ? parsed.highContrast
          : DEFAULT_SETTINGS.highContrast,
      reduceMotion:
        typeof parsed.reduceMotion === "boolean"
          ? parsed.reduceMotion
          : DEFAULT_SETTINGS.reduceMotion,
      fontScale:
        typeof parsed.fontScale === "number" &&
        Number.isFinite(parsed.fontScale) &&
        parsed.fontScale >= 0.5 &&
        parsed.fontScale <= 2
          ? parsed.fontScale
          : DEFAULT_SETTINGS.fontScale,
      screenReaderHints:
        typeof parsed.screenReaderHints === "boolean"
          ? parsed.screenReaderHints
          : DEFAULT_SETTINGS.screenReaderHints,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(tableName: string, settings: AccessibilityState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    `datalens:accessibility:${tableName}`,
    JSON.stringify(settings),
  );
}

function ToggleCard({
  label,
  description,
  checked,
  onToggle,
}: {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className={`${GLASS_CARD_CLASS} flex items-center justify-between gap-4 p-4 text-left`}
    >
      <div>
        <p className="font-medium text-slate-950 dark:text-white">{label}</p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {description}
        </p>
      </div>
      <span
        className={
          checked
            ? "rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300"
            : "rounded-full bg-slate-900/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 dark:bg-white/10 dark:text-slate-300"
        }
      >
        {checked ? "On" : "Off"}
      </span>
    </button>
  );
}

export default function AccessibilitySettings({
  tableName,
  columns,
}: AccessibilitySettingsProps) {
  const [settings, setSettings] = useState<AccessibilityState>(() =>
    readSettings(tableName),
  );
  const [status, setStatus] = useState("Accessibility preferences are stored locally.");

  function patchSettings(patch: Partial<AccessibilityState>) {
    startTransition(() => {
      const next = { ...settings, ...patch };
      setSettings(next);
      persistSettings(tableName, next);
      setStatus("Saved accessibility settings to localStorage.");
    });
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700 dark:text-indigo-300">
            <Accessibility className="h-3.5 w-3.5" />
            Accessibility
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Configure accessibility preferences
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Adjust contrast, motion, font size, and screen reader hints for the
            current dataset workspace.
          </p>
        </div>

        <div className={`${GLASS_CARD_CLASS} max-w-sm p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Dataset
          </p>
          <p className="mt-1 text-sm font-medium text-slate-950 dark:text-white">
            {tableName}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {columns.length} column{columns.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
        className="mt-6 grid gap-4 md:grid-cols-2"
      >
        <ToggleCard
          label="High contrast mode"
          description="Increase color contrast for better visibility across charts and data tables."
          checked={settings.highContrast}
          onToggle={() => patchSettings({ highContrast: !settings.highContrast })}
        />

        <ToggleCard
          label="Reduce motion"
          description="Disable transitions and animations for chart rendering and UI elements."
          checked={settings.reduceMotion}
          onToggle={() => patchSettings({ reduceMotion: !settings.reduceMotion })}
        />

        <ToggleCard
          label="Screen reader hints"
          description="Add additional ARIA labels and descriptions for assistive technologies."
          checked={settings.screenReaderHints}
          onToggle={() => patchSettings({ screenReaderHints: !settings.screenReaderHints })}
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, delay: 0.06, ease: ANALYTICS_EASE }}
        className={`${GLASS_CARD_CLASS} mt-6 p-5`}
      >
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-indigo-500/10 p-3 text-indigo-600 dark:text-indigo-300">
            <Type className="h-5 w-5" />
          </div>
          <div>
            <p className="font-medium text-slate-950 dark:text-white">Font size scale</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Adjust the base font size for the workspace.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {FONT_SCALE_OPTIONS.map((option) => {
            const active = settings.fontScale === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => patchSettings({ fontScale: option.value })}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  active
                    ? "border-indigo-400/40 bg-indigo-500/15 text-indigo-700 dark:text-indigo-200"
                    : "border-white/20 bg-white/65 text-slate-700 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-200"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </motion.div>

      <div className="mt-6 text-sm text-slate-600 dark:text-slate-300">{status}</div>
    </section>
  );
}
