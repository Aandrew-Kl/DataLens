import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import {
  CHART_SAVED_EVENT,
  SAVED_CHARTS_STORAGE_KEY,
  type SavedChartSnapshot,
} from "@/components/charts/chart-builder";
import type { DatasetMeta } from "@/types/dataset";

import type { AddNotificationFn } from "./use-notifications-adapter";

// Internal event dispatched when this tab mutates localStorage's saved-charts
// entry. The browser's native "storage" event only fires in *other* tabs, so
// we dispatch this manually to keep the current tab's useSyncExternalStore in
// sync.
const SAVED_CHARTS_LOCAL_MUTATION_EVENT = "datalens:saved-charts-mutated";

// useSyncExternalStore helpers for saved charts backed by localStorage.
// getSnapshot returns the raw string (stable reference when unchanged) to
// keep re-render churn low; the component parses+filters inside a useMemo.
function getSavedChartsSnapshot(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return window.localStorage.getItem(SAVED_CHARTS_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function getSavedChartsServerSnapshot(): string {
  return "";
}

function subscribeToSavedCharts(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const chartHandler = () => onStoreChange();
  const storageHandler = (event: StorageEvent) => {
    if (event.key === null || event.key === SAVED_CHARTS_STORAGE_KEY) {
      onStoreChange();
    }
  };
  const mutationHandler = () => onStoreChange();
  window.addEventListener(CHART_SAVED_EVENT, chartHandler as EventListener);
  window.addEventListener("storage", storageHandler);
  window.addEventListener(
    SAVED_CHARTS_LOCAL_MUTATION_EVENT,
    mutationHandler as EventListener,
  );
  return () => {
    window.removeEventListener(
      CHART_SAVED_EVENT,
      chartHandler as EventListener,
    );
    window.removeEventListener("storage", storageHandler);
    window.removeEventListener(
      SAVED_CHARTS_LOCAL_MUTATION_EVENT,
      mutationHandler as EventListener,
    );
  };
}

function parseSavedCharts(raw: string): SavedChartSnapshot[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SavedChartSnapshot[]) : [];
  } catch {
    return [];
  }
}

export function useSavedCharts(
  activeDataset: DatasetMeta | undefined,
  tableName: string,
  addNotification: AddNotificationFn,
) {
  // Subscribe to saved-charts in localStorage via useSyncExternalStore,
  // then derive the filtered list per-tableName during render. This avoids
  // the old useEffect -> setSavedCharts pattern that tripped
  // react-you-might-not-need-an-effect/no-chained-state.
  const savedChartsSnapshot = useSyncExternalStore(
    subscribeToSavedCharts,
    getSavedChartsSnapshot,
    getSavedChartsServerSnapshot,
  );
  const savedCharts = useMemo<SavedChartSnapshot[]>(() => {
    if (!activeDataset) {
      return [];
    }
    return parseSavedCharts(savedChartsSnapshot).filter(
      (chart) => chart.tableName === tableName,
    );
  }, [activeDataset, savedChartsSnapshot, tableName]);

  // Separately: fire the "Chart saved" toast when the CHART_SAVED_EVENT
  // custom event targets the current table. Pure side-effect (no state).
  useEffect(() => {
    if (!activeDataset) {
      return;
    }

    const handleChartSaved = (event: Event) => {
      const detail = (event as CustomEvent<SavedChartSnapshot>).detail;
      if (detail?.tableName === tableName) {
        addNotification({
          type: "success",
          title: "Chart saved",
          message: `${
            detail.config.title || "Untitled chart"
          } was added to the gallery.`,
        });
      }
    };
    window.addEventListener(CHART_SAVED_EVENT, handleChartSaved as EventListener);
    return () => {
      window.removeEventListener(
        CHART_SAVED_EVENT,
        handleChartSaved as EventListener,
      );
    };
  }, [activeDataset, addNotification, tableName]);

  const handleSavedChartRemove = useCallback(
    (chartId: string) => {
      const nextCharts = parseSavedCharts(getSavedChartsSnapshot()).filter(
        (entry) => entry.config.id !== chartId,
      );

      try {
        window.localStorage.setItem(
          SAVED_CHARTS_STORAGE_KEY,
          JSON.stringify(nextCharts),
        );
        // Notify the useSyncExternalStore subscriber in the same tab
        // (native "storage" events don't fire for the writing tab).
        window.dispatchEvent(new Event(SAVED_CHARTS_LOCAL_MUTATION_EVENT));
      } catch {
        // localStorage failures are non-critical
      }

      addNotification({
        type: "info",
        title: "Chart removed",
        message: "The saved chart was removed from the gallery.",
      });
    },
    [addNotification],
  );

  const handleSavedChartEdit = useCallback(
    async (chart: {
      title: string;
      xAxis?: string;
      yAxis?: string;
      groupBy?: string;
      aggregation?: string;
    }) => {
      const summary = JSON.stringify(chart, null, 2);

      try {
        await navigator.clipboard.writeText(summary);
        addNotification({
          type: "info",
          title: "Chart config copied",
          message:
            "ChartBuilder does not expose external edit props, so the saved config was copied to the clipboard.",
        });
      } catch {
        addNotification({
          type: "warning",
          title: "Clipboard unavailable",
          message: "The saved chart config could not be copied.",
        });
      }
    },
    [addNotification],
  );

  return {
    savedCharts,
    handleSavedChartRemove,
    handleSavedChartEdit,
  };
}
