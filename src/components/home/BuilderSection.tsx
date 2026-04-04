"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Code2,
  Database,
  LayoutGrid,
  Menu,
  PieChart,
  Sparkles,
  Table,
} from "lucide-react";
import dynamic from "next/dynamic";

import type { ColumnProfile } from "@/types/dataset";
import DashboardBuilder from "@/components/charts/dashboard-builder";
import WorkspaceTabs from "@/components/layout/workspace-tabs";
import CommandBar, {
  type Command as CommandBarCommand,
} from "@/components/ui/command-bar";
import Dropdown from "@/components/ui/dropdown";
import EmptyState from "@/components/ui/empty-state";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import {
  SkeletonCard,
  SkeletonChart,
  SkeletonTable,
} from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

import type { AppTab } from "@/components/home/types";
import {
  AnimatedWorkspaceSection,
  ToolSection,
} from "@/components/home/workspace-shared";

const GroupByBuilder = dynamic(
  () => import("@/components/data/group-by-builder"),
  { ssr: false },
);
const PivotChartCombo = dynamic(
  () => import("@/components/data/pivot-chart-combo"),
  { ssr: false },
);
const PivotTableBuilder = dynamic(
  () => import("@/components/data/pivot-table-builder"),
  { ssr: false },
);
const SmartFilterBuilder = dynamic(
  () => import("@/components/data/smart-filter-builder"),
  { ssr: false },
);
const WindowFunctionBuilder = dynamic(
  () => import("@/components/data/window-function-builder"),
  { ssr: false },
);
const NotFoundPage = dynamic(() => import("@/components/layout/not-found"), {
  ssr: false,
});

function WorkspacePolishLab({
  activeTab,
  onTabChange,
  tabs,
  commands,
  onExecuteCommand,
}: {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  tabs: Array<{
    id: AppTab;
    label: string;
    icon: LucideIcon;
    badge?: number | string;
  }>;
  commands: CommandBarCommand[];
  onExecuteCommand: (command: CommandBarCommand) => void;
}) {
  const { toast } = useToast();
  const [showCommandBar, setShowCommandBar] = useState(false);

  const dropdownItems = useMemo(
    () => [
      {
        label: "Jump to Profile",
        icon: Table,
        onClick: () => onTabChange("profile"),
      },
      {
        label: "Jump to Charts",
        icon: PieChart,
        onClick: () => onTabChange("charts"),
      },
      {
        label: showCommandBar ? "Hide Command Bar" : "Show Command Bar",
        icon: Code2,
        onClick: () => setShowCommandBar((current) => !current),
      },
      { type: "separator" as const },
      {
        label: "Preview Success Toast",
        icon: Sparkles,
        onClick: () =>
          toast("Workspace polish preview is ready.", "success", 3200),
      },
      {
        label: "Preview Warning Toast",
        icon: Sparkles,
        onClick: () =>
          toast(
            "Review the route and empty states before shipping the shell.",
            "warning",
            3600,
          ),
      },
    ],
    [onTabChange, showCommandBar, toast],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <ErrorBoundary>
          <Dropdown
            trigger={
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Menu className="h-4 w-4" />
                Quick Menu
              </button>
            }
            items={dropdownItems}
          />
        </ErrorBoundary>
        <button
          type="button"
          onClick={() => toast("Builder tab controls are connected.", "info", 2600)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Sparkles className="h-4 w-4" />
          Fire Toast
        </button>
        <button
          type="button"
          onClick={() => setShowCommandBar((current) => !current)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Code2 className="h-4 w-4" />
          {showCommandBar ? "Hide Command Bar" : "Show Command Bar"}
        </button>
      </div>

      <ErrorBoundary>
        <WorkspaceTabs
          tabs={tabs}
          activeTab={activeTab}
          onChange={(id) => onTabChange(id as AppTab)}
        />
      </ErrorBoundary>

      {showCommandBar ? (
        <ErrorBoundary>
          <CommandBar commands={commands} onExecute={onExecuteCommand} />
        </ErrorBoundary>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
          Enable the advanced command bar to preview the richer search-driven
          command surface without replacing the existing command palette.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ErrorBoundary>
          <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-2 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
            <EmptyState
              icon={LayoutGrid}
              title="No preview selected"
              description="Use the workspace tabs or quick menu to jump to a feature area from this builder-side lab."
              action={{
                label: "Go to Profile",
                onClick: () => onTabChange("profile"),
              }}
            />
          </div>
        </ErrorBoundary>
        <ErrorBoundary>
          <SkeletonCard className="h-full" />
        </ErrorBoundary>
        <ErrorBoundary>
          <SkeletonChart className="h-full" />
        </ErrorBoundary>
      </div>

      <ErrorBoundary>
        <SkeletonTable rows={4} columns={5} />
      </ErrorBoundary>

      <details className="group rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Route Fallback Preview
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Preview the shared not-found experience inside the builder lab
                without changing the active route.
              </p>
            </div>
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
              Expand
            </span>
          </div>
        </summary>
        <div className="mt-4 max-h-[36rem] overflow-auto rounded-[1.75rem] border border-slate-200/70 bg-slate-50 dark:border-slate-700/60 dark:bg-slate-950/70">
          <ErrorBoundary>
            <NotFoundPage />
          </ErrorBoundary>
        </div>
      </details>
    </div>
  );
}

interface BuilderSectionProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  tabs: Array<{
    id: AppTab;
    label: string;
    icon: LucideIcon;
    badge?: number | string;
  }>;
  commands: CommandBarCommand[];
  onExecuteCommand: (command: CommandBarCommand) => void;
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

export default function BuilderSection({
  activeTab,
  onTabChange,
  tabs,
  commands,
  onExecuteCommand,
  tableName,
  columns,
  rowCount,
}: BuilderSectionProps) {
  const [showMoreBuilder, setShowMoreBuilder] = useState(false);

  return (
    <AnimatedWorkspaceSection>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
          Dashboard Builder
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Compose a custom dashboard layout with charts, tables, KPI cards, and
          notes.
        </p>
      </div>
      <ErrorBoundary>
        <DashboardBuilder
          tableName={tableName}
          columns={columns}
          rowCount={rowCount}
        />
      </ErrorBoundary>
      <div className="mt-6">
        <ToolSection
          title="Workspace Polish Lab"
          description="Exercise shared navigation, command, state, and fallback primitives from a contained builder-side integration surface."
        >
          <WorkspacePolishLab
            activeTab={activeTab}
            onTabChange={onTabChange}
            tabs={tabs}
            commands={commands}
            onExecuteCommand={onExecuteCommand}
          />
        </ToolSection>
      </div>
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowMoreBuilder((current) => !current)}
          className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-sky-600 dark:text-slate-200"
        >
          {showMoreBuilder ? "▾" : "▸"} More Builder Tools (5 available)
        </button>
        {showMoreBuilder && (
          <div className="mt-4 grid gap-6">
            <ErrorBoundary>
              <GroupByBuilder tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <WindowFunctionBuilder tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <PivotTableBuilder tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <PivotChartCombo tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <SmartFilterBuilder tableName={tableName} columns={columns} />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </AnimatedWorkspaceSection>
  );
}
