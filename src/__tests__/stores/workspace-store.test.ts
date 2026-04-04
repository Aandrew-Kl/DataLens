import { useWorkspaceStore } from "@/stores/workspace-store";
import type { ColumnProfile } from "@/types/dataset";

describe("workspace-store", () => {
  beforeEach(() => {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState());
  });

  it("has correct initial state", () => {
    const state = useWorkspaceStore.getState();

    expect(state.profileData).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.loadError).toBeNull();
    expect(state.showUploader).toBe(false);
    expect(state.showSettings).toBe(false);
    expect(state.showCommandPalette).toBe(false);
    expect(state.showKeyboardShortcuts).toBe(false);
    expect(state.showExportWizard).toBe(false);
    expect(state.showSharePanel).toBe(false);
    expect(state.previewRows).toEqual([]);
    expect(state.selectedPreviewRow).toBeNull();
    expect(state.selectedPreviewRowIndex).toBeNull();
    expect(state.selectedAdvancedColumn).toBeNull();
    expect(state.showColumnDetail).toBe(false);
    expect(state.analyticsColumnName).toBe("");
    expect(state.savedCharts).toEqual([]);
  });

  it("setProfileData updates profile data", () => {
    const profileData: ColumnProfile[] = [
      {
        name: "id",
        type: "string",
        nullCount: 0,
        uniqueCount: 3,
        sampleValues: ["a", "b", "c"],
      },
      {
        name: "amount",
        type: "number",
        nullCount: 1,
        uniqueCount: 2,
        sampleValues: [1, 2, null],
      },
    ];

    useWorkspaceStore.getState().setProfileData(profileData);

    expect(useWorkspaceStore.getState().profileData).toEqual(profileData);
  });

  it("setIsLoading toggles loading state", () => {
    useWorkspaceStore.getState().setIsLoading(true);
    expect(useWorkspaceStore.getState().isLoading).toBe(true);

    useWorkspaceStore.getState().setIsLoading(false);
    expect(useWorkspaceStore.getState().isLoading).toBe(false);
  });

  it("toggles workspace boolean panels", () => {
    useWorkspaceStore.getState().toggleUploader();
    expect(useWorkspaceStore.getState().showUploader).toBe(true);
    useWorkspaceStore.getState().toggleUploader();
    expect(useWorkspaceStore.getState().showUploader).toBe(false);

    useWorkspaceStore.getState().toggleSettings();
    expect(useWorkspaceStore.getState().showSettings).toBe(true);
    useWorkspaceStore.getState().toggleSettings();
    expect(useWorkspaceStore.getState().showSettings).toBe(false);

    useWorkspaceStore.getState().toggleCommandPalette();
    expect(useWorkspaceStore.getState().showCommandPalette).toBe(true);
    useWorkspaceStore.getState().toggleCommandPalette();
    expect(useWorkspaceStore.getState().showCommandPalette).toBe(false);

    useWorkspaceStore.getState().toggleKeyboardShortcuts();
    expect(useWorkspaceStore.getState().showKeyboardShortcuts).toBe(true);
    useWorkspaceStore.getState().toggleKeyboardShortcuts();
    expect(useWorkspaceStore.getState().showKeyboardShortcuts).toBe(false);

    useWorkspaceStore.getState().toggleExportWizard();
    expect(useWorkspaceStore.getState().showExportWizard).toBe(true);
    useWorkspaceStore.getState().toggleExportWizard();
    expect(useWorkspaceStore.getState().showExportWizard).toBe(false);

    useWorkspaceStore.getState().toggleSharePanel();
    expect(useWorkspaceStore.getState().showSharePanel).toBe(true);
    useWorkspaceStore.getState().toggleSharePanel();
    expect(useWorkspaceStore.getState().showSharePanel).toBe(false);
  });

  it("setSelectedPreviewRow updates both row and index", () => {
    const row = { id: 1, name: "Alice" };

    useWorkspaceStore.getState().setSelectedPreviewRow(row, 3);

    const state = useWorkspaceStore.getState();
    expect(state.selectedPreviewRow).toEqual(row);
    expect(state.selectedPreviewRowIndex).toBe(3);
  });

  it("clearPreviewSelection resets preview selection", () => {
    useWorkspaceStore.getState().setSelectedPreviewRow({ id: 1, name: "Alice" }, 2);
    useWorkspaceStore.getState().clearPreviewSelection();

    const state = useWorkspaceStore.getState();
    expect(state.selectedPreviewRow).toBeNull();
    expect(state.selectedPreviewRowIndex).toBeNull();
  });

  it("addSavedChart appends a saved chart", () => {
    const savedChart = {
      id: "chart-1",
      label: "Sales trend",
      type: "line",
      config: { xAxis: "month" },
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    useWorkspaceStore.getState().addSavedChart(savedChart);

    expect(useWorkspaceStore.getState().savedCharts).toEqual([savedChart]);
  });

  it("removeSavedChart removes chart by id", () => {
    const chartA = {
      id: "chart-a",
      label: "A",
      type: "bar",
      config: {},
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    const chartB = {
      id: "chart-b",
      label: "B",
      type: "line",
      config: {},
      createdAt: "2026-01-02T00:00:00.000Z",
    };

    useWorkspaceStore.getState().setSavedCharts([chartA, chartB]);
    useWorkspaceStore.getState().removeSavedChart("chart-a");

    expect(useWorkspaceStore.getState().savedCharts).toEqual([chartB]);
  });

  it("sets column detail visibility", () => {
    useWorkspaceStore.getState().setShowColumnDetail(true);
    expect(useWorkspaceStore.getState().showColumnDetail).toBe(true);

    useWorkspaceStore.getState().setShowColumnDetail(false);
    expect(useWorkspaceStore.getState().showColumnDetail).toBe(false);
  });

  it("sets analytics column name", () => {
    useWorkspaceStore.getState().setAnalyticsColumnName("revenue");

    expect(useWorkspaceStore.getState().analyticsColumnName).toBe("revenue");
  });
});
