"use client";

import { startTransition, useState } from "react";
import { motion } from "framer-motion";
import { Bell, CheckCircle2, Volume2 } from "lucide-react";
import {
  ANALYTICS_EASE,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
} from "@/lib/utils/advanced-analytics";
import type { ColumnProfile } from "@/types/dataset";

interface NotificationSettingsProps {
  tableName: string;
  columns: ColumnProfile[];
}

type NotificationPosition = "top-right" | "bottom-right";

interface NotificationState {
  queryAlerts: boolean;
  exportAlerts: boolean;
  soundEnabled: boolean;
  position: NotificationPosition;
}

const DEFAULT_SETTINGS: NotificationState = {
  queryAlerts: true,
  exportAlerts: true,
  soundEnabled: false,
  position: "top-right",
};

function readSettings(tableName: string): NotificationState {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;

  try {
    const raw = window.localStorage.getItem(`datalens:notifications:${tableName}`);
    if (!raw) return DEFAULT_SETTINGS;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_SETTINGS;

    return {
      queryAlerts:
        typeof parsed.queryAlerts === "boolean"
          ? parsed.queryAlerts
          : DEFAULT_SETTINGS.queryAlerts,
      exportAlerts:
        typeof parsed.exportAlerts === "boolean"
          ? parsed.exportAlerts
          : DEFAULT_SETTINGS.exportAlerts,
      soundEnabled:
        typeof parsed.soundEnabled === "boolean"
          ? parsed.soundEnabled
          : DEFAULT_SETTINGS.soundEnabled,
      position:
        parsed.position === "bottom-right"
          ? "bottom-right"
          : DEFAULT_SETTINGS.position,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(tableName: string, settings: NotificationState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    `datalens:notifications:${tableName}`,
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

export default function NotificationSettings({
  tableName,
  columns,
}: NotificationSettingsProps) {
  const [settings, setSettings] = useState<NotificationState>(() =>
    readSettings(tableName),
  );
  const [status, setStatus] = useState("Notification preferences are stored locally.");

  function patchSettings(patch: Partial<NotificationState>) {
    startTransition(() => {
      const next = { ...settings, ...patch };
      setSettings(next);
      persistSettings(tableName, next);
      setStatus("Saved notification settings to localStorage.");
    });
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Bell className="h-3.5 w-3.5" />
            Notification settings
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Control local alerts for queries and exports
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Configure completion alerts, sound, and toast placement for the
            current dataset workspace.
          </p>
        </div>

        <div className={`${GLASS_CARD_CLASS} max-w-sm p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Dataset scope
          </p>
          <p className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">
            {tableName}
          </p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {columns.length} profiled columns available in this workspace.
          </p>
        </div>
      </div>

      <p className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-700 dark:text-cyan-300">
        {status}
      </p>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: ANALYTICS_EASE }}
        className="mt-6 grid gap-4 lg:grid-cols-2"
      >
        <ToggleCard
          label="Query completion alerts"
          description="Show a local notification when a SQL query finishes."
          checked={settings.queryAlerts}
          onToggle={() => patchSettings({ queryAlerts: !settings.queryAlerts })}
        />
        <ToggleCard
          label="Export completion alerts"
          description="Notify when files are ready to download."
          checked={settings.exportAlerts}
          onToggle={() => patchSettings({ exportAlerts: !settings.exportAlerts })}
        />
        <ToggleCard
          label="Sound"
          description="Play a short sound when a notification appears."
          checked={settings.soundEnabled}
          onToggle={() => patchSettings({ soundEnabled: !settings.soundEnabled })}
        />

        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-white">
            <Volume2 className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
            Notification position
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(["top-right", "bottom-right"] as const).map((position) => (
              <button
                key={position}
                type="button"
                aria-pressed={settings.position === position}
                onClick={() => patchSettings({ position })}
                className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                  settings.position === position
                    ? "border-cyan-400/70 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                    : "border-white/20 bg-white/70 text-slate-700 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-200"
                }`}
              >
                {position}
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-white/20 bg-white/70 p-4 dark:border-white/10 dark:bg-slate-950/40">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-950 dark:text-white">
              <CheckCircle2 className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
              Current preview
            </div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Notifications appear in the <strong>{settings.position}</strong> corner.
            </p>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
