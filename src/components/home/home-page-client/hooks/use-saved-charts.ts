import { useCallback, useEffect, useState } from "react";

import {
  CHART_SAVED_EVENT,
  SAVED_CHARTS_STORAGE_KEY,
  type SavedChartSnapshot,
} from "@/components/charts/chart-builder";
import type { DatasetMeta } from "@/types/dataset";

import { readSavedChartsFromStorage } from "../constants";
import type { AddNotificationFn } from "./use-notifications-adapter";

export function useSavedCharts(
  activeDataset: DatasetMeta | undefined,
  tableName: string,
  addNotification: AddNotificationFn,
) {
  const [savedCharts, setSavedCharts] = useState<SavedChartSnapshot[]>([]);

  useEffect(() => {
    if (!activeDataset) {
      setSavedCharts([]);
      return;
    }

    const syncSavedCharts = () => {
      setSavedCharts(
        readSavedChartsFromStorage().filter(
          (chart) => chart.tableName === tableName,
        ),
      );
    };

    const handleChartSaved = (event: Event) => {
      syncSavedCharts();
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

    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === SAVED_CHARTS_STORAGE_KEY) {
        syncSavedCharts();
      }
    };

    syncSavedCharts();
    window.addEventListener(CHART_SAVED_EVENT, handleChartSaved as EventListener);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(
        CHART_SAVED_EVENT,
        handleChartSaved as EventListener,
      );
      window.removeEventListener("storage", handleStorage);
    };
  }, [activeDataset, addNotification, tableName]);

  const handleSavedChartRemove = useCallback(
    (chartId: string) => {
      const nextCharts = readSavedChartsFromStorage().filter(
        (entry) => entry.config.id !== chartId,
      );

      try {
        window.localStorage.setItem(
          SAVED_CHARTS_STORAGE_KEY,
          JSON.stringify(nextCharts),
        );
      } catch {
        // localStorage failures are non-critical
      }

      setSavedCharts(nextCharts.filter((entry) => entry.tableName === tableName));
      addNotification({
        type: "info",
        title: "Chart removed",
        message: "The saved chart was removed from the gallery.",
      });
    },
    [addNotification, tableName],
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
