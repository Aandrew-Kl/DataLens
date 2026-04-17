"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  BarChart3,
  ClipboardCopy,
  Database,
  FileDown,
  Layers,
  MessageCircleMore,
  Plus,
  Search,
  XSquare,
} from "lucide-react";
import QueryHistory from "@/components/query/query-history";
import { useChartStore } from "@/stores/chart-store";
import { useDatasetStore } from "@/stores/dataset-store";
import { useQueryStore } from "@/stores/query-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { exportToCSV } from "@/lib/utils/export";
import {
  formatBytes,
  formatNumber,
  formatRelativeTime,
  sanitizeTableName,
} from "@/lib/utils/formatters";
import { runQuery } from "@/lib/duckdb/client";

import type { SavedChartConfig } from "@/stores/chart-store";

const NO_DATASET_TITLE = "No active dataset";
function getChartBadgeClass(type: SavedChartConfig["type"]) {
  if (type === "line") {
    return "bg-emerald-400/20 text-emerald-200 border-emerald-300/40";
  }

  if (type === "pie") {
    return "bg-rose-400/20 text-rose-200 border-rose-300/40";
  }

  if (type === "scatter") {
    return "bg-violet-400/20 text-violet-200 border-violet-300/40";
  }

  return "bg-cyan-400/20 text-cyan-200 border-cyan-300/40";
}

function formatNullRate(count: number, rowCount: number, columnCount: number): string {
  if (!rowCount || !columnCount) {
    return "—";
  }

  const percent = (count / (rowCount * columnCount)) * 100;
  return `${Math.max(0, Math.min(100, percent)).toFixed(1)}%`;
}

export default function DashboardPage() {
  const router = useRouter();
  const datasets = useDatasetStore((state) => state.datasets);
  const activeDatasetId = useDatasetStore((state) => state.activeDatasetId);
  const savedCharts = useChartStore((state) => state.savedCharts);
  const removeChart = useChartStore((state) => state.removeChart);
  const workspaceLoading = useWorkspaceStore((state) => state.isLoading);
  const queryHistory = useQueryStore((state) => state.history);

  const activeDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === activeDatasetId) ?? null,
    [datasets, activeDatasetId],
  );

  const datasetHistory = useMemo(
    () =>
      queryHistory
        .filter((entry) => entry.datasetId === activeDataset?.id)
        .sort((a, b) => b.createdAt - a.createdAt),
    [queryHistory, activeDataset?.id],
  );

  const [statusMessage, setStatusMessage] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [selectedQuery, setSelectedQuery] = useState("");

  const metricCards = useMemo(() => {
    if (!activeDataset) {
      return [
        {
          label: "Rows",
          value: "—",
          subtitle: "No active dataset",
          icon: Database,
        },
      ];
    }

    const numericColumns = activeDataset.columns.filter((column) => column.type === "number").length;
    const otherColumns = Math.max(activeDataset.columns.length - numericColumns, 0);

    return [
      {
        label: "Rows",
        value: formatNumber(activeDataset.rowCount),
        subtitle: "Total records",
        icon: Database,
      },
      {
        label: "Columns",
        value: formatNumber(activeDataset.columnCount),
        subtitle: numericColumns + " numeric, " + otherColumns + " non-numeric",
        icon: Layers,
      },
      {
        label: "Size",
        value: formatBytes(activeDataset.sizeBytes),
        subtitle: "Uploaded " + formatRelativeTime(activeDataset.uploadedAt),
        icon: Plus,
      },
      {
        label: "Null ratio",
        value: formatNullRate(
          activeDataset.columns.reduce((count, column) => count + column.nullCount, 0),
          activeDataset.rowCount,
          activeDataset.columnCount,
        ),
        subtitle: "Across all columns",
        icon: XSquare,
      },
    ];
  }, [activeDataset]);

  const datasetCharts = activeDataset
    ? savedCharts.filter((chart) => chart.options?.datasetId === activeDataset.id)
    : savedCharts;

  const handleOpenChart = useCallback(
    (chart: SavedChartConfig) => {
      useChartStore.setState({ activeChartId: chart.id });
      router.push("/charts");
    },
    [router],
  );

  const handleDeleteChart = useCallback(
    (chartId: string) => {
      removeChart(chartId);
    },
    [removeChart],
  );

  const handleExportRows = useCallback(async () => {
    if (!activeDataset || isExporting) {
      return;
    }

    if (activeDataset.rowCount === 0) {
      setStatusMessage("Dataset has no rows to export.");
      return;
    }

    setIsExporting(true);
    setStatusMessage("Preparing export from dataset table...");

    try {
      const tableName = sanitizeTableName(activeDataset.name || activeDataset.fileName);
      const rows = await runQuery(`SELECT * FROM ${quoteIdentifier(tableName)} LIMIT 1000`);

      if (!Array.isArray(rows) || rows.length === 0) {
        setStatusMessage("No rows available for export.");
        return;
      }

      const safeFileName = activeDataset.fileName.includes(".")
        ? activeDataset.fileName.split(".").slice(0, -1).join(".")
        : activeDataset.fileName;

      exportToCSV(rows, `${safeFileName}-sample-${Date.now()}.csv`);
      setStatusMessage(`Exported ${rows.length.toLocaleString()} rows to CSV.`);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? `Export failed: ${error.message}` : "Export failed.",
      );
    } finally {
      setIsExporting(false);
    }
  }, [activeDataset, isExporting]);

  const handleSelectQuery = useCallback((sql: string) => {
    setSelectedQuery(sql);
  }, []);

  const handleCopyQuery = useCallback(async () => {
    if (!selectedQuery) {
      return;
    }

    try {
      await navigator.clipboard.writeText(selectedQuery);
      setStatusMessage("Copied SQL query to clipboard.");
    } catch {
      setStatusMessage("Unable to copy query to clipboard.");
    }
  }, [selectedQuery]);

  return (
    <main className="space-y-5 pb-6">
      <section className="rounded-3xl border border-white/25 bg-white/20 px-5 py-5 backdrop-blur-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
              Workspace dashboard
            </p>
            <h1 className="mt-1 text-3xl font-semibold text-slate-900 dark:text-slate-50">
              {activeDataset?.fileName ?? NO_DATASET_TITLE}
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {activeDataset
                ? `Track saved charts, run quick actions, and jump into recent query work for ${activeDataset.name || activeDataset.fileName}.`
                : "Choose a dataset in the sidebar to unlock cards and analytics."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/charts"
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-200/50 bg-cyan-500/20 px-3.5 py-2 text-sm font-semibold text-cyan-700 transition-colors hover:bg-cyan-500/30 dark:border-cyan-300/40 dark:text-cyan-100"
            >
              <Plus className="h-4 w-4" />
              New chart
            </Link>

            <Link
              href="/query"
              className="inline-flex items-center gap-2 rounded-xl border border-violet-200/50 bg-violet-500/15 px-3.5 py-2 text-sm font-semibold text-violet-700 transition-colors hover:bg-violet-500/25 dark:border-violet-300/40 dark:text-violet-100"
            >
              <MessageCircleMore className="h-4 w-4" />
              Ask AI
            </Link>

            <Link
              href="/sql"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200/60 bg-slate-500/10 px-3.5 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-500/20 dark:border-slate-500/40 dark:text-slate-100"
            >
              <Search className="h-4 w-4" />
              SQL
            </Link>

            <button
              type="button"
              onClick={handleExportRows}
              disabled={!activeDataset || workspaceLoading || isExporting}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-200/50 bg-emerald-500/15 px-3.5 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-300/40 dark:text-emerald-100"
            >
              <FileDown className="h-4 w-4" />
              {isExporting ? "Exporting…" : "Export sample"}
            </button>
          </div>
        </div>

        {statusMessage ? (
          <p className="mt-4 rounded-xl border border-amber-300/40 bg-amber-200/15 px-3 py-2 text-sm text-amber-800 dark:bg-amber-400/10 dark:text-amber-200">
            {statusMessage}
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((metric) => (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className="rounded-2xl border border-white/25 bg-white/20 px-4 py-4 backdrop-blur-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-300">
                  {metric.label}
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">
                  {metric.value}
                </p>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {metric.subtitle}
                </p>
              </div>
              <span className="rounded-xl border border-white/40 bg-white/60 p-2 text-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                <metric.icon className="h-4 w-4" />
              </span>
            </div>
          </motion.div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <section className="rounded-3xl border border-white/25 bg-white/20 p-4 backdrop-blur-xl">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Saved charts</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {activeDataset
                  ? `${datasetCharts.length} charts for this dataset`
                  : `${savedCharts.length} charts total`}
              </p>
            </div>

            <Link
              href="/charts"
              className="rounded-lg border border-white/40 bg-white/35 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-white/55 dark:border-white/20 dark:text-slate-100"
            >
              Open chart workspace
            </Link>
          </div>

          {datasetCharts.length === 0 ? (
            <p className="rounded-2xl border border-white/40 bg-white/45 px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-300">
              No saved charts for this dataset yet. Create one from the Charts page.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {datasetCharts.map((chart) => {
                const chartTypeClass = getChartBadgeClass(chart.type);

                return (
                  <article
                    key={chart.id}
                    className="rounded-2xl border border-white/45 bg-white/45 p-3 backdrop-blur-xl"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenChart(chart)}
                        className="text-left"
                      >
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {chart.title || "Untitled chart"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                          {chart.xAxis || "No x-axis"} / {chart.yAxis || "No y-axis"}
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteChart(chart.id)}
                        className="rounded-md border border-rose-200/40 px-2 py-1 text-xs font-semibold text-rose-500 transition-colors hover:bg-rose-50 dark:border-rose-400/30 dark:hover:bg-rose-500/20"
                        aria-label={`Remove chart ${chart.title}`}
                      >
                        ×
                      </button>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2 text-[11px]">
                      <span className={`rounded-full border px-2.5 py-1 font-medium ${chartTypeClass}`}>
                        {chart.type}
                      </span>

                      <span className="text-slate-500 dark:text-slate-400">
                        {formatRelativeTime(chart.createdAt)}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleOpenChart(chart)}
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/50 bg-white/60 px-2.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-white/75 dark:bg-slate-900/40 dark:text-slate-100"
                    >
                      <BarChart3 className="h-3.5 w-3.5" />
                      Open in charts
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-white/25 bg-white/20 p-4 backdrop-blur-xl">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Query history</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {activeDataset
                  ? `${datasetHistory.length} saved runs`
                  : "Select dataset to inspect query history"}
              </p>
            </div>

            {!activeDataset ? null : (
              <button
                type="button"
                onClick={handleCopyQuery}
                disabled={!selectedQuery}
                className="inline-flex items-center gap-2 rounded-lg border border-white/40 bg-white/45 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-100"
              >
                <ClipboardCopy className="h-3.5 w-3.5" />
                Copy selected
              </button>
            )}
          </div>

          {selectedQuery ? (
            <div className="mb-3 rounded-2xl border border-cyan-200/50 bg-cyan-500/10 px-3 py-2">
              <p className="text-xs font-medium text-cyan-800 dark:text-cyan-100">Selected SQL</p>
              <pre className="mt-1 max-h-20 overflow-auto rounded-lg bg-black/10 p-2 text-[11px] leading-relaxed text-slate-900 dark:text-slate-100">
                {selectedQuery}
              </pre>
            </div>
          ) : null}

          {activeDataset ? (
            <QueryHistory datasetId={activeDataset.id} onSelectQuery={handleSelectQuery} />
          ) : (
            <p className="rounded-2xl border border-white/40 bg-white/45 px-4 py-6 text-sm text-slate-500 dark:text-slate-300">
              Pick a dataset to see its query history.
            </p>
          )}
        </section>
      </section>
    </main>
  );
}
