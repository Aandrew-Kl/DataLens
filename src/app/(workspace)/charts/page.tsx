"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ChartRenderer from "@/components/charts/chart-renderer";
import DashboardBuilder from "@/components/charts/dashboard-builder";
import RouteErrorBoundary from "@/components/workspace/route-error-boundary";
import { runQuery } from "@/lib/duckdb/client";
import { sanitizeTableName } from "@/lib/utils/formatters";
import { buildMetricExpression } from "@/lib/utils/sql";
import { useChartStore } from "@/stores/chart-store";
import { useDatasetStore } from "@/stores/dataset-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

import type { SavedChartConfig } from "@/stores/chart-store";
import type { DatasetMeta } from "@/types/dataset";

type QueryRow = Record<string, unknown>;
type DraftChartConfig = Omit<SavedChartConfig, "createdAt" | "updatedAt">;

const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;

const buildColumnNames = (columns: DatasetMeta["columns"] = []) =>
  columns.map((column) => column.name).filter((name) => name.length > 0);

const readChartOption = (chart: SavedChartConfig, key: string) => {
  const value = chart.options[key];
  return typeof value === "string" ? value : "";
};

const buildDefaultChart = (dataset: DatasetMeta, index: number): DraftChartConfig => {
  const columns = buildColumnNames(dataset.columns);
  const xAxis = columns[0] ?? "";
  const yAxis = dataset.columns.find((column) => column.type === "number")?.name ?? "";
  const tableName = sanitizeTableName(dataset.name || dataset.fileName);
  const query =
    xAxis && yAxis
      ? `SELECT ${quote(xAxis)} AS ${quote(xAxis)}, SUM(${quote(yAxis)}) AS ${quote(
          yAxis
        )} FROM ${quote(tableName)} WHERE ${quote(xAxis)} IS NOT NULL AND ${quote(
          yAxis
        )} IS NOT NULL GROUP BY 1 ORDER BY 1 ASC LIMIT 200`
      : `SELECT * FROM ${quote(tableName)} LIMIT 200`;

  return {
    id: crypto.randomUUID(),
    title: `Chart ${index + 1}`,
    type: "bar",
    xAxis: xAxis || undefined,
    yAxis: yAxis || undefined,
    aggregation: "sum",
    columns,
    options: {
      datasetId: dataset.id,
      query,
      tableName,
    },
  };
};

const buildChartQuery = (chart: SavedChartConfig, dataset?: DatasetMeta | null) => {
  const fallbackTableName = readChartOption(chart, "tableName");
  const tableName = sanitizeTableName(dataset?.name || dataset?.fileName || fallbackTableName);

  if (!tableName) {
    return "";
  }

  const savedQuery = readChartOption(chart, "query").trim();
  if (savedQuery) {
    return savedQuery;
  }

  const chartType = chart.type;
  const xAxis = chart.xAxis ?? "";
  const yAxis = chart.yAxis ?? "";
  const groupBy = chart.groupBy ?? "";
  const aggregation =
    chart.aggregation ?? (chartType === "line" || chartType === "area" ? "avg" : "sum");

  if (chartType === "histogram") {
    const metricColumn = yAxis || xAxis;
    if (!metricColumn) {
      return `SELECT * FROM ${quote(tableName)} LIMIT 200`;
    }

    return `SELECT ${quote(metricColumn)} FROM ${quote(tableName)} WHERE ${quote(
      metricColumn
    )} IS NOT NULL LIMIT 5000`;
  }

  if (!xAxis || !yAxis) {
    return `SELECT * FROM ${quote(tableName)} LIMIT 200`;
  }

  if (chartType === "scatter") {
    return `SELECT ${quote(xAxis)}, ${quote(yAxis)} FROM ${quote(
      tableName
    )} WHERE ${quote(xAxis)} IS NOT NULL AND ${quote(yAxis)} IS NOT NULL LIMIT 500`;
  }

  const metric = buildMetricExpression(aggregation, yAxis, quote, { cast: false, preserveCase: true });

  if (groupBy) {
    return `SELECT ${quote(xAxis)} AS ${quote(xAxis)}, ${quote(groupBy)} AS ${quote(
      groupBy
    )}, ${metric} AS ${quote(yAxis)} FROM ${quote(tableName)} WHERE ${quote(
      xAxis
    )} IS NOT NULL AND ${quote(yAxis)} IS NOT NULL AND ${quote(
      groupBy
    )} IS NOT NULL GROUP BY 1, 2 ORDER BY 1 ASC, 2 ASC LIMIT 200`;
  }

  return `SELECT ${quote(xAxis)} AS ${quote(xAxis)}, ${metric} AS ${quote(
    yAxis
  )} FROM ${quote(tableName)} WHERE ${quote(xAxis)} IS NOT NULL AND ${quote(
    yAxis
  )} IS NOT NULL GROUP BY 1 ORDER BY ${
    chartType === "line" || chartType === "area" ? "1 ASC" : "2 DESC"
  } LIMIT 200`;
};

export default function ChartsPage() {
  const savedCharts = useChartStore((state) => state.savedCharts);
  const activeChartId = useChartStore((state) => state.activeChartId);
  const addChart = useChartStore((state) => state.addChart);
  const removeChart = useChartStore((state) => state.removeChart);
  const setActiveChartId = useCallback((id: string | null) => {
    useChartStore.setState({ activeChartId: id });
  }, []);

  const datasets = useDatasetStore((state) => state.datasets);
  const activeDatasetId = useDatasetStore((state) => state.activeDatasetId);

  const isWorkspaceLoading = useWorkspaceStore((state) => state.isLoading);

  const [rows, setRows] = useState<QueryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === activeDatasetId) ?? null,
    [datasets, activeDatasetId]
  );

  const activeChart = useMemo(
    () => savedCharts.find((chart) => chart.id === activeChartId) ?? null,
    [savedCharts, activeChartId]
  );

  const datasetColumns = activeDataset?.columns ?? [];
  const rowCount = activeDataset?.rowCount ?? 0;

  const chartQuery = useMemo(
    () => (activeChart ? buildChartQuery(activeChart, activeDataset) : ""),
    [activeChart, activeDataset]
  );

  const refreshActiveChart = useCallback(async () => {
    if (!activeChart || !activeDataset || !chartQuery) {
      setRows([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const nextRows = await runQuery(chartQuery);
      if (Array.isArray(nextRows)) {
        setRows(nextRows as QueryRow[]);
      } else {
        setRows([]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load chart data";
      setError(message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeChart, activeDataset, chartQuery]);

  useEffect(() => {
    if (!activeDataset || !activeChart || isWorkspaceLoading) {
      setRows([]);
      return;
    }

    void refreshActiveChart();
  }, [activeChart, activeDataset, isWorkspaceLoading, refreshActiveChart]);

  useEffect(() => {
    if (!activeChartId && savedCharts.length > 0) {
      setActiveChartId(savedCharts[0].id);
    }
  }, [activeChartId, savedCharts, setActiveChartId]);

  const handleCreateChart = useCallback(() => {
    if (!activeDataset) {
      return;
    }

    const next = buildDefaultChart(activeDataset, savedCharts.length);
    addChart(next);
  }, [activeDataset, addChart, savedCharts.length]);

  const handleSelectChart = useCallback(
    (chartId: string) => {
      setActiveChartId(chartId);
    },
    [setActiveChartId]
  );

  const handleDeleteChart = useCallback(
    (chartId: string) => {
      removeChart(chartId);
    },
    [removeChart]
  );

  return (
    <RouteErrorBoundary scope="charts-route">
      <main className="min-h-screen bg-slate-950/30 p-4 md:p-6">
        <div className="mx-auto max-w-7xl space-y-4">
          <section className="rounded-3xl border border-white/20 bg-white/10 px-4 py-5 shadow-2xl backdrop-blur-xl md:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold text-white">Charts</h1>
              <button
                type="button"
                onClick={handleCreateChart}
                disabled={!activeDataset || isWorkspaceLoading}
                className="rounded-xl border border-cyan-300/40 bg-cyan-300/20 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                + New chart
              </button>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-[340px_1fr]">
            <section className="rounded-3xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl">
              <div className="mb-3 text-sm font-medium text-slate-100">Saved charts</div>

              <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
                {savedCharts.length === 0 ? (
                  <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
                    No charts yet. Create one to get started.
                  </p>
                ) : (
                  savedCharts.map((chart) => {
                    const isActive = chart.id === activeChartId;

                    return (
                      <div
                        key={chart.id}
                        className={`flex items-center justify-between rounded-xl border px-3 py-2 transition ${
                          isActive
                            ? "border-cyan-200/60 bg-cyan-500/20"
                            : "border-white/20 bg-white/5 hover:bg-white/10"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectChart(chart.id)}
                          className="truncate text-left text-sm font-medium text-slate-100"
                        >
                          {chart.title || chart.id}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteChart(chart.id)}
                          className="text-xs font-semibold text-red-100/90"
                          title="Delete chart"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            <div className="space-y-4">
              <section className="rounded-3xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">Chart preview</h2>
                  <button
                    type="button"
                    onClick={() => void refreshActiveChart()}
                    disabled={loading || !activeChart || !activeDataset}
                    className="rounded-lg border border-cyan-200/40 bg-cyan-300/20 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Refresh
                  </button>
                </div>

                {(!activeDataset || !activeChart) && (
                  <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
                    Pick a chart from the left or create a new one.
                  </p>
                )}

                {activeChart && activeDataset && loading && (
                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-10 text-center text-sm text-slate-200">
                    Loading chart data…
                  </div>
                )}

                {error && !loading && (
                  <p className="mb-3 rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                    {error}
                  </p>
                )}

                {activeChart && activeDataset && !loading && !error ? (
                  <ChartRenderer
                    key={activeChart.id}
                    config={activeChart}
                    data={rows}
                  />
                ) : null}
              </section>

              <section className="rounded-3xl border border-white/20 bg-white/10 p-4 backdrop-blur-xl">
                <h2 className="mb-3 text-lg font-semibold text-white">Dashboard builder</h2>

                {activeDataset ? (
                  <DashboardBuilder
                    tableName={activeDataset.name ?? ""}
                    columns={datasetColumns}
                    rowCount={rowCount}
                  />
                ) : (
                  <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
                    Select an active dataset to access the dashboard builder.
                  </p>
                )}
              </section>
            </div>
          </section>
        </div>
      </main>
    </RouteErrorBoundary>
  );
}
