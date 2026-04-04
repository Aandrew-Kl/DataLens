import { create } from "zustand";

import type { ColumnProfile } from "@/types/dataset";

interface SavedChartSnapshot {
  id: string;
  label: string;
  type: string;
  config: Record<string, unknown>;
  createdAt: string;
}

interface WorkspaceStore {
  /* ---- Shared layout state ---- */
  profileData: ColumnProfile[];
  isLoading: boolean;
  loadError: string | null;
  showUploader: boolean;
  showSettings: boolean;
  showCommandPalette: boolean;
  showKeyboardShortcuts: boolean;
  showExportWizard: boolean;
  showSharePanel: boolean;

  /* ---- Preview / row detail ---- */
  previewRows: Record<string, unknown>[];
  selectedPreviewRow: Record<string, unknown> | null;
  selectedPreviewRowIndex: number | null;

  /* ---- Column profiler overlay ---- */
  selectedAdvancedColumn: ColumnProfile | null;
  showColumnDetail: boolean;
  analyticsColumnName: string;

  /* ---- Saved charts ---- */
  savedCharts: SavedChartSnapshot[];

  /* ---- Actions ---- */
  setProfileData: (data: ColumnProfile[]) => void;
  setIsLoading: (loading: boolean) => void;
  setLoadError: (error: string | null) => void;
  toggleUploader: () => void;
  setShowUploader: (show: boolean) => void;
  toggleSettings: () => void;
  setShowSettings: (show: boolean) => void;
  toggleCommandPalette: () => void;
  setShowCommandPalette: (show: boolean) => void;
  toggleKeyboardShortcuts: () => void;
  setShowKeyboardShortcuts: (show: boolean) => void;
  toggleExportWizard: () => void;
  setShowExportWizard: (show: boolean) => void;
  toggleSharePanel: () => void;
  setShowSharePanel: (show: boolean) => void;

  setPreviewRows: (rows: Record<string, unknown>[]) => void;
  setSelectedPreviewRow: (
    row: Record<string, unknown> | null,
    index: number | null,
  ) => void;
  clearPreviewSelection: () => void;

  setSelectedAdvancedColumn: (column: ColumnProfile | null) => void;
  setShowColumnDetail: (show: boolean) => void;
  setAnalyticsColumnName: (name: string) => void;

  setSavedCharts: (charts: SavedChartSnapshot[]) => void;
  addSavedChart: (chart: SavedChartSnapshot) => void;
  removeSavedChart: (id: string) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  /* ---- Defaults ---- */
  profileData: [],
  isLoading: false,
  loadError: null,
  showUploader: false,
  showSettings: false,
  showCommandPalette: false,
  showKeyboardShortcuts: false,
  showExportWizard: false,
  showSharePanel: false,
  previewRows: [],
  selectedPreviewRow: null,
  selectedPreviewRowIndex: null,
  selectedAdvancedColumn: null,
  showColumnDetail: false,
  analyticsColumnName: "",
  savedCharts: [],

  /* ---- Actions ---- */
  setProfileData: (data) => set({ profileData: data }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setLoadError: (error) => set({ loadError: error }),

  toggleUploader: () => set((s) => ({ showUploader: !s.showUploader })),
  setShowUploader: (show) => set({ showUploader: show }),
  toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),
  setShowSettings: (show) => set({ showSettings: show }),
  toggleCommandPalette: () =>
    set((s) => ({ showCommandPalette: !s.showCommandPalette })),
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  toggleKeyboardShortcuts: () =>
    set((s) => ({ showKeyboardShortcuts: !s.showKeyboardShortcuts })),
  setShowKeyboardShortcuts: (show) => set({ showKeyboardShortcuts: show }),
  toggleExportWizard: () =>
    set((s) => ({ showExportWizard: !s.showExportWizard })),
  setShowExportWizard: (show) => set({ showExportWizard: show }),
  toggleSharePanel: () => set((s) => ({ showSharePanel: !s.showSharePanel })),
  setShowSharePanel: (show) => set({ showSharePanel: show }),

  setPreviewRows: (rows) => set({ previewRows: rows }),
  setSelectedPreviewRow: (row, index) =>
    set({ selectedPreviewRow: row, selectedPreviewRowIndex: index }),
  clearPreviewSelection: () =>
    set({ selectedPreviewRow: null, selectedPreviewRowIndex: null }),

  setSelectedAdvancedColumn: (column) =>
    set({ selectedAdvancedColumn: column }),
  setShowColumnDetail: (show) => set({ showColumnDetail: show }),
  setAnalyticsColumnName: (name) => set({ analyticsColumnName: name }),

  setSavedCharts: (charts) => set({ savedCharts: charts }),
  addSavedChart: (chart) =>
    set((s) => ({ savedCharts: [...s.savedCharts, chart] })),
  removeSavedChart: (id) =>
    set((s) => ({
      savedCharts: s.savedCharts.filter((c) => c.id !== id),
    })),
}));
