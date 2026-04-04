"use client";

import dynamic from "next/dynamic";

import type { ColumnProfile } from "@/types/dataset";
import OllamaSettings from "@/components/settings/ollama-settings";
import WorkspaceSettings from "@/components/settings/workspace-settings";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import { AnimatedWorkspaceSection } from "@/components/home/workspace-shared";

const AccessibilitySettingsDyn = dynamic(
  () => import("@/components/settings/accessibility-settings"),
  { ssr: false },
);
const DataSourceSettings = dynamic(
  () => import("@/components/settings/data-source-settings"),
  { ssr: false },
);
const ExportSettingsDyn = dynamic(
  () => import("@/components/settings/export-settings"),
  { ssr: false },
);
const NotificationSettingsDyn = dynamic(
  () => import("@/components/settings/notification-settings"),
  { ssr: false },
);
const PerformanceSettingsDyn = dynamic(
  () => import("@/components/settings/performance-settings"),
  { ssr: false },
);
const ShortcutSettingsDyn = dynamic(
  () => import("@/components/settings/shortcut-settings"),
  { ssr: false },
);
const ThemeSettingsDyn = dynamic(
  () => import("@/components/settings/theme-settings"),
  { ssr: false },
);

interface SettingsPanelSectionProps {
  tableName: string;
  columns: ColumnProfile[];
}

export default function SettingsPanelSection({
  tableName,
  columns,
}: SettingsPanelSectionProps) {
  return (
    <AnimatedWorkspaceSection>
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
          Workspace Settings
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Configure local workspace defaults and the Ollama endpoint used by
          DataLens AI features.
        </p>
      </div>

      <ErrorBoundary>
        <WorkspaceSettings />
      </ErrorBoundary>
      <ErrorBoundary>
        <OllamaSettings />
      </ErrorBoundary>

      <details className="group rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Appearance
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Theme customization and accessibility preferences.
              </p>
            </div>
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
              Expand
            </span>
          </div>
        </summary>
        <div className="mt-4 space-y-6">
          <ErrorBoundary>
            <ThemeSettingsDyn />
          </ErrorBoundary>
          <ErrorBoundary>
            <AccessibilitySettingsDyn tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </div>
      </details>

      <details className="group rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Data &amp; Export
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Data source connections and export format preferences.
              </p>
            </div>
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
              Expand
            </span>
          </div>
        </summary>
        <div className="mt-4 space-y-6">
          <ErrorBoundary>
            <DataSourceSettings />
          </ErrorBoundary>
          <ErrorBoundary>
            <ExportSettingsDyn />
          </ErrorBoundary>
        </div>
      </details>

      <details className="group rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Notifications &amp; Shortcuts
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Alert preferences and keyboard shortcut bindings.
              </p>
            </div>
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
              Expand
            </span>
          </div>
        </summary>
        <div className="mt-4 space-y-6">
          <ErrorBoundary>
            <NotificationSettingsDyn tableName={tableName} columns={columns} />
          </ErrorBoundary>
          <ErrorBoundary>
            <ShortcutSettingsDyn tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </div>
      </details>

      <details className="group rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Performance
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Rendering, caching, and memory optimization settings.
              </p>
            </div>
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
              Expand
            </span>
          </div>
        </summary>
        <div className="mt-4 space-y-6">
          <ErrorBoundary>
            <PerformanceSettingsDyn />
          </ErrorBoundary>
        </div>
      </details>
    </AnimatedWorkspaceSection>
  );
}
