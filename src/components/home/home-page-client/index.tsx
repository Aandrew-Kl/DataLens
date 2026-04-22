"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Database, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import AiAssistant from "@/components/ai/ai-assistant";
import DataBookmarks from "@/components/data/data-bookmarks";
import ExportWizard from "@/components/data/export-wizard";
import SharePanel from "@/components/data/share-panel";
import HomeTabPanels from "@/components/home/HomeTabPanels";
import type { AppTab, FileDropResult } from "@/components/home/types";
import Breadcrumb from "@/components/layout/breadcrumb";
import CommandPalette from "@/components/layout/command-palette";
import ThemeCustomizer from "@/components/layout/theme-customizer";
import SettingsPanel from "@/components/settings/settings-panel";
import AccessibilityPanel from "@/components/ui/accessibility-panel";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import KeyboardShortcutsDialog from "@/components/ui/keyboard-shortcuts-dialog";
import LoadingOverlay from "@/components/ui/loading-overlay";
import NotificationCenter, {
  useNotifications,
} from "@/components/ui/notification-center";
import OnboardingTour from "@/components/ui/onboarding-tour";
import ShortcutOverlay from "@/components/ui/shortcut-overlay";
import { ToastProvider } from "@/components/ui/toast";
import { sanitizeTableName } from "@/lib/utils/formatters";
import { useDatasetStore } from "@/stores/dataset-store";
import { useQueryStore } from "@/stores/query-store";
import { useUIStore } from "@/stores/ui-store";
import type { ColumnProfile } from "@/types/dataset";

import { TABS } from "./constants";
import { useCommandBar } from "./hooks/use-command-bar";
import { useDatasetActions } from "./hooks/use-dataset-actions";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useSavedCharts } from "./hooks/use-saved-charts";
import { useThemeBootstrap } from "./hooks/use-theme-bootstrap";
import { DatasetSidebar } from "./parts/dataset-sidebar";
import { LandingView } from "./parts/landing";
import { UploadModal } from "./parts/upload-modal";
import { WorkspaceHeader } from "./parts/workspace-header";

export default function HomePageClient() {
  const { theme, toggleTheme } = useUIStore();
  const { addDataset, setActiveDataset } = useDatasetStore();
  const activeDataset = useDatasetStore((state) =>
    state.datasets.find((dataset) => dataset.id === state.activeDatasetId),
  );
  const datasets = useDatasetStore((state) => state.datasets);
  const datasetCount = useDatasetStore((state) => state.datasets.length);
  const lastQueryResult = useQueryStore((state) => state.lastResult);
  const tableName = activeDataset
    ? sanitizeTableName(activeDataset.fileName)
    : "";
  const { notifications, addNotification, removeNotification, clearAll } =
    useNotifications();

  const [activeTab, setActiveTab] = useState<AppTab>("profile");
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showUploader, setShowUploader] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [showExportWizard, setShowExportWizard] = useState(false);
  const [showSharePanel, setShowSharePanel] = useState(false);

  // Derive profileData directly from activeDataset.columns during render
  // (was previously synced via useEffect -> setProfileData, which triggers
  // react-you-might-not-need-an-effect/no-chained-state). Refresh flows
  // update the dataset in the store, which flows into activeDataset.columns
  // automatically — so no separate profileData state is needed. Memoised to
  // give a stable reference for downstream hook dependencies when the
  // columns value hasn't changed.
  const profileData = useMemo<ColumnProfile[]>(
    () => activeDataset?.columns ?? [],
    [activeDataset?.columns],
  );

  useThemeBootstrap(theme);

  const {
    handleFileLoaded,
    refreshActiveDataset,
    registerDerivedDataset,
    handleFormulaSave,
  } = useDatasetActions({
    addNotification,
    activeDataset,
    tableName,
    setActiveTab,
    setIsLoading,
    setLoadError,
    setShowUploader,
  });

  const { savedCharts, handleSavedChartRemove, handleSavedChartEdit } =
    useSavedCharts(activeDataset, tableName, addNotification);

  const handleGeneratedData = useCallback(
    (csvContent: string, fileName: string) => {
      void handleFileLoaded({
        fileName,
        csvContent,
        sizeBytes: new Blob([csvContent]).size,
      });
    },
    [handleFileLoaded],
  );

  useEffect(() => {
    if (!activeDataset) {
      return;
    }

    const handleComputedColumnCreated = (event: Event) => {
      const detail = (event as CustomEvent<{
        tableName?: string;
        columnName?: string;
      }>).detail;

      if (detail?.tableName !== tableName) {
        return;
      }

      void refreshActiveDataset(
        "Computed column created",
        detail.columnName
          ? `Updated ${tableName} after adding ${detail.columnName}.`
          : `Updated ${tableName} after creating a computed column.`,
      );
    };

    window.addEventListener(
      "datalens:computed-column-created",
      handleComputedColumnCreated as EventListener,
    );

    return () => {
      window.removeEventListener(
        "datalens:computed-column-created",
        handleComputedColumnCreated as EventListener,
      );
    };
  }, [activeDataset, refreshActiveDataset, tableName]);

  const handleConnectorDataLoaded = useCallback(
    (result: { tableName: string; columns: ColumnProfile[] }) => {
      const nextTableName = sanitizeTableName(result.tableName);
      void registerDerivedDataset({
        tableName: nextTableName,
        columns: result.columns,
        fileName: result.tableName,
        nextTab: "profile",
        notificationTitle: "Connector dataset ready",
        notificationMessage: `${result.tableName} was imported through the connectors workspace and is ready to explore.`,
      });
    },
    [registerDerivedDataset],
  );

  const handleSqlJoinComplete = useCallback(
    (result: { tableName: string; sql: string; columns: string[] }) => {
      void registerDerivedDataset({
        tableName: result.tableName,
        fileName: result.tableName,
        nextTab: "sql",
        notificationTitle: "Join materialized",
        notificationMessage: `${result.tableName} was created from the join wizard and is now available in the SQL workspace.`,
      });
    },
    [registerDerivedDataset],
  );

  const handleNewDataset = useCallback(() => {
    if (datasetCount > 0) {
      setShowUploader(true);
    } else {
      setActiveDataset(null);
      // profileData derives from activeDataset.columns; no separate reset needed
      setActiveTab("profile");
      setLoadError(null);
    }
  }, [datasetCount, setActiveDataset]);

  useKeyboardShortcuts({
    canUpload: !!activeDataset,
    onToggleCommandPalette: () =>
      setShowCommandPalette((current) => !current),
    onToggleTheme: toggleTheme,
    onOpenSettings: () => setShowSettings(true),
    onOpenUploader: () => setShowUploader(true),
    onToggleShortcuts: () => setShowKeyboardShortcuts((current) => !current),
    onCloseAll: () => {
      setShowCommandPalette(false);
      setShowSettings(false);
      setShowUploader(false);
      setShowKeyboardShortcuts(false);
      setShowSharePanel(false);
    },
  });

  const { commandBarCommands, handleCommandAction, handleCommandBarExecute } =
    useCommandBar({
      activeDataset,
      setShowCommandPalette,
      setShowSettings,
      onNewDataset: handleNewDataset,
      onToggleTheme: toggleTheme,
      setActiveTab,
    });

  const totalNulls = useMemo(
    () => profileData.reduce((sum, column) => sum + column.nullCount, 0),
    [profileData],
  );
  const completenessPct =
    activeDataset && activeDataset.rowCount > 0 && profileData.length > 0
      ? ((activeDataset.rowCount * profileData.length - totalNulls) /
          (activeDataset.rowCount * profileData.length)) *
        100
      : 100;
  const currentTabLabel =
    TABS.find((tab) => tab.id === activeTab)?.label ?? "Workspace";
  const workspaceTabItems = TABS.map((tab) => ({
    ...tab,
    badge:
      tab.id === "charts"
        ? savedCharts.length || undefined
        : tab.id === "catalog"
          ? datasetCount
          : tab.id === "quality"
            ? profileData.filter((column) => column.nullCount > 0).length ||
              undefined
            : undefined,
  }));

  if (!activeDataset && !showUploader) {
    return (
      <ToastProvider>
        <ErrorBoundary>
          <LoadingOverlay
            visible={isLoading}
            message="Loading and profiling dataset..."
          />
          <OnboardingTour />
          <LandingView
            theme={theme}
            isLoading={isLoading}
            loadError={loadError}
            onToggleTheme={toggleTheme}
            onFileLoaded={handleFileLoaded}
            onSampleLoad={(fileName, csvContent) => {
              void handleFileLoaded({
                fileName,
                csvContent,
                sizeBytes: new Blob([csvContent]).size,
              });
            }}
            onDataGenerated={handleGeneratedData}
          />
        </ErrorBoundary>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <ErrorBoundary>
        <LoadingOverlay
          visible={isLoading}
          message="Loading and profiling dataset..."
        />
        <OnboardingTour />
        <div className="flex min-h-screen">
          <AnimatePresence>
            {datasetCount > 0 && (
              <DatasetSidebar
                isOpen={sidebarOpen}
                onToggle={() => setSidebarOpen((current) => !current)}
                onNewDataset={handleNewDataset}
              />
            )}
          </AnimatePresence>

          <div className="flex min-w-0 flex-1 flex-col">
            <WorkspaceHeader
              theme={theme}
              activeDataset={activeDataset}
              datasetCount={datasetCount}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onOpenCommandPalette={() => setShowCommandPalette(true)}
              onNewDataset={handleNewDataset}
              onOpenShare={() => setShowSharePanel(true)}
              onOpenSettings={() => setShowSettings(true)}
              onToggleTheme={toggleTheme}
            />

            <main className="flex-1 px-4 py-6 sm:px-6">
              {activeDataset && (
                <div className="mb-4">
                  <ErrorBoundary>
                    <Breadcrumb
                      items={[
                        {
                          label: "Workspace",
                          onClick: () => setActiveTab("profile"),
                        },
                        { label: activeDataset.fileName },
                        { label: currentTabLabel },
                      ]}
                    />
                  </ErrorBoundary>
                </div>
              )}

              {activeDataset && (
                <div className="mb-6">
                  <ErrorBoundary>
                    <DataBookmarks tableName={tableName} columns={profileData} />
                  </ErrorBoundary>
                </div>
              )}

              <AnimatePresence>
                {showUploader && (
                  <UploadModal
                    isLoading={isLoading}
                    onClose={() => setShowUploader(false)}
                    onFileLoaded={handleFileLoaded}
                  />
                )}
              </AnimatePresence>

              {!activeDataset && !showUploader && (
                <div className="flex flex-col items-center justify-center gap-4 py-24">
                  <Database className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                  <p className="text-slate-500 dark:text-slate-400">
                    Select a dataset from the sidebar or upload a new one
                  </p>
                  <button
                    onClick={handleNewDataset}
                    className="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-600"
                  >
                    <Upload className="h-4 w-4" />
                    Upload Dataset
                  </button>
                </div>
              )}

              {activeDataset && (
                <HomeTabPanels
                  activeTab={activeTab}
                  activeDataset={activeDataset}
                  datasets={datasets}
                  tableName={tableName}
                  profileData={profileData}
                  completenessPct={completenessPct}
                  savedCharts={savedCharts}
                  workspaceTabItems={workspaceTabItems}
                  commandBarCommands={commandBarCommands}
                  onTabChange={setActiveTab}
                  onExecuteCommand={handleCommandBarExecute}
                  onAddNotification={addNotification}
                  onConnectorDataLoaded={handleConnectorDataLoaded}
                  onRegisterMergedDataset={(nextTableName) => {
                    void registerDerivedDataset({
                      tableName: sanitizeTableName(nextTableName),
                      fileName: nextTableName,
                      nextTab: "profile",
                      notificationTitle: "Merged dataset ready",
                      notificationMessage: `${nextTableName} was materialized from the merge workspace and is ready to explore.`,
                    });
                  }}
                  onSqlJoinComplete={handleSqlJoinComplete}
                  onRefreshDataset={refreshActiveDataset}
                  onFormulaSave={handleFormulaSave}
                  onSavedChartRemove={handleSavedChartRemove}
                  onSavedChartEdit={handleSavedChartEdit}
                  onOpenExportWizard={() => setShowExportWizard(true)}
                />
              )}
            </main>
          </div>

          <AnimatePresence>
            {showSettings && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-x-4 bottom-4 z-[80] max-h-[calc(100vh-6rem)] overflow-y-auto lg:left-20 lg:right-[26rem]"
              >
                <ErrorBoundary>
                  <ThemeCustomizer />
                </ErrorBoundary>
              </motion.div>
            )}
          </AnimatePresence>

          <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />
          <CommandPalette
            open={showCommandPalette}
            onClose={() => setShowCommandPalette(false)}
            onAction={handleCommandAction}
          />
          <KeyboardShortcutsDialog
            open={showKeyboardShortcuts}
            onClose={() => setShowKeyboardShortcuts(false)}
          />

          {activeDataset && (
            <ExportWizard
              open={showExportWizard}
              onClose={() => setShowExportWizard(false)}
              tableName={tableName}
              columns={profileData}
              rowCount={activeDataset.rowCount}
            />
          )}

          {activeDataset && (
            <SharePanel
              open={showSharePanel}
              onClose={() => setShowSharePanel(false)}
              dataset={activeDataset}
              currentTab={activeTab}
              currentSQL={lastQueryResult?.sql}
            />
          )}

          {activeDataset && (
            <AiAssistant
              tableName={tableName}
              columns={profileData}
              rowCount={activeDataset.rowCount}
            />
          )}

          <ErrorBoundary>
            <ShortcutOverlay />
          </ErrorBoundary>

          <ErrorBoundary>
            <AccessibilityPanel />
          </ErrorBoundary>

          <NotificationCenter
            notifications={notifications}
            removeNotification={removeNotification}
            clearAll={clearAll}
          />
        </div>
      </ErrorBoundary>
    </ToastProvider>
  );
}
