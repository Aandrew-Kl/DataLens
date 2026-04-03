import { create } from "zustand";
import type { ChartConfig } from "@/types/chart";

const MAX_CHART_HISTORY = 10;

export interface SavedChartConfig extends ChartConfig {
  columns: string[];
  options: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

interface ChartStore {
  savedCharts: SavedChartConfig[];
  activeChartId: string | null;
  chartHistory: SavedChartConfig[];
  addChart: (chart: Omit<SavedChartConfig, "createdAt" | "updatedAt">) => void;
  removeChart: (id: string) => void;
  updateChart: (id: string, patch: Partial<Omit<SavedChartConfig, "id" | "createdAt">>) => void;
  duplicateChart: (id: string) => void;
  reorderCharts: (fromIndex: number, toIndex: number) => void;
  clearAll: () => void;
}

function createChartId(): string {
  return `chart_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneChart(chart: SavedChartConfig): SavedChartConfig {
  return cloneValue(chart);
}

function appendHistory(history: SavedChartConfig[], chart: SavedChartConfig): SavedChartConfig[] {
  return [cloneChart(chart), ...history].slice(0, MAX_CHART_HISTORY);
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  if (typeof moved === "undefined") {
    return items;
  }

  next.splice(toIndex, 0, moved);
  return next;
}

export const useChartStore = create<ChartStore>((set) => ({
  savedCharts: [],
  activeChartId: null,
  chartHistory: [],

  addChart: (chart) =>
    set((state) => {
      const timestamp = Date.now();
      const nextChart: SavedChartConfig = {
        ...cloneValue(chart),
        id: chart.id || createChartId(),
        columns: [...chart.columns],
        options: cloneValue(chart.options),
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      return {
        savedCharts: [nextChart, ...state.savedCharts],
        activeChartId: nextChart.id,
        chartHistory: appendHistory(state.chartHistory, nextChart),
      };
    }),

  removeChart: (id) =>
    set((state) => {
      const removedChart = state.savedCharts.find((chart) => chart.id === id);
      const nextCharts = state.savedCharts.filter((chart) => chart.id !== id);
      const nextActiveChartId =
        state.activeChartId === id ? nextCharts[0]?.id ?? null : state.activeChartId;

      return {
        savedCharts: nextCharts,
        activeChartId: nextActiveChartId,
        chartHistory: removedChart
          ? appendHistory(state.chartHistory, removedChart)
          : state.chartHistory,
      };
    }),

  updateChart: (id, patch) =>
    set((state) => {
      const existingChart = state.savedCharts.find((chart) => chart.id === id);
      if (!existingChart) {
        return state;
      }

      const nextCharts = state.savedCharts.map((chart) =>
        chart.id === id
          ? {
              ...chart,
              ...cloneValue(patch),
              columns: patch.columns ? [...patch.columns] : [...chart.columns],
              options: patch.options ? cloneValue(patch.options) : cloneValue(chart.options),
              updatedAt: Date.now(),
            }
          : chart,
      );

      return {
        savedCharts: nextCharts,
        activeChartId: id,
        chartHistory: appendHistory(state.chartHistory, existingChart),
      };
    }),

  duplicateChart: (id) =>
    set((state) => {
      const sourceChart = state.savedCharts.find((chart) => chart.id === id);
      if (!sourceChart) {
        return state;
      }

      const timestamp = Date.now();
      const duplicatedChart: SavedChartConfig = {
        ...cloneChart(sourceChart),
        id: createChartId(),
        title: `${sourceChart.title} Copy`,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      return {
        savedCharts: [duplicatedChart, ...state.savedCharts],
        activeChartId: duplicatedChart.id,
        chartHistory: appendHistory(state.chartHistory, duplicatedChart),
      };
    }),

  reorderCharts: (fromIndex, toIndex) =>
    set((state) => ({
      savedCharts: moveItem(state.savedCharts, fromIndex, toIndex),
    })),

  clearAll: () =>
    set({
      savedCharts: [],
      activeChartId: null,
      chartHistory: [],
    }),
}));
