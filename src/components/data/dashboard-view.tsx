"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Maximize2,
  Minimize2,
  RefreshCw,
  Plus,
  X,
  BarChart3,
  LineChart,
  PieChart,
  ScatterChart,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Loader2,
} from "lucide-react";

import ChartRenderer from "@/components/charts/chart-renderer";
import Modal from "@/components/ui/modal";
import { runQuery } from "@/lib/duckdb/client";
import { sanitizeTableName, formatNumber } from "@/lib/utils/formatters";
import type { DatasetMeta, ColumnProfile } from "@/types/dataset";
import type {
  ChartConfig,
  DashboardConfig,
  ChartType,
} from "@/types/chart";

/* ─── Extended chart config with sql field from AI responses ─── */
interface ChartConfigWithSQL extends ChartConfig {
  sql?: string;
}

interface DashboardConfigWithSQL extends Omit<DashboardConfig, "charts"> {
  charts: ChartConfigWithSQL[];
  mode?: string;
}

/* ─── Props ─── */
interface DashboardViewProps {
  dataset: DatasetMeta;
  columns: ColumnProfile[];
}

/* ─── Constants ─── */
const CHART_TYPE_META: Record<
  ChartType,
  { label: string; icon: typeof BarChart3; color: string }
> = {
  bar: { label: "Bar", icon: BarChart3, color: "bg-blue-500/15 text-blue-500" },
  line: { label: "Line", icon: LineChart, color: "bg-emerald-500/15 text-emerald-500" },
  pie: { label: "Pie", icon: PieChart, color: "bg-violet-500/15 text-violet-500" },
  scatter: { label: "Scatter", icon: ScatterChart, color: "bg-amber-500/15 text-amber-500" },
  histogram: { label: "Histogram", icon: BarChart3, color: "bg-rose-500/15 text-rose-500" },
  heatmap: { label: "Heatmap", icon: BarChart3, color: "bg-cyan-500/15 text-cyan-500" },
  area: { label: "Area", icon: LineChart, color: "bg-teal-500/15 text-teal-500" },
};

const AGGREGATIONS = ["sum", "avg", "count", "min", "max"] as const;

/* ─── Animation variants ─── */
const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.35, ease: "easeOut" as const },
  },
};

/* ─── Skeleton Components ─── */
function SkeletonMetricCard() {
  return (
    <div className="rounded-xl p-5 backdrop-blur-xl bg-white/60 dark:bg-gray-900/60 border border-gray-200/50 dark:border-gray-700/50">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-6 w-20 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
          <div className="h-3 w-16 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

function SkeletonChart() {
  return (
    <div className="rounded-xl p-5 backdrop-blur-xl bg-white/60 dark:bg-gray-900/60 border border-gray-200/50 dark:border-gray-700/50">
      <div className="flex items-center justify-between mb-4">
        <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
        <div className="h-5 w-14 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
      </div>
      <div className="relative h-[320px] rounded-lg bg-gray-100 dark:bg-gray-800/50 overflow-hidden">
        <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 dark:via-gray-700/30 to-transparent" />
      </div>
    </div>
  );
}

/* ─── Data Quality Score ─── */
function computeQualityScore(columns: ColumnProfile[], rowCount: number): number {
  if (columns.length === 0 || rowCount === 0) return 100;

  let totalScore = 0;
  for (const col of columns) {
    const nullRate = col.nullCount / rowCount;
    const nullScore = (1 - nullRate) * 100;
    const uniquenessRatio = col.uniqueCount / rowCount;
    const uniquenessScore =
      col.type === "string"
        ? uniquenessRatio > 0.01
          ? 100
          : 50
        : uniquenessRatio > 0.001
        ? 100
        : 60;
    totalScore += nullScore * 0.7 + uniquenessScore * 0.3;
  }

  return Math.round(totalScore / columns.length);
}

function getQualityColor(score: number): string {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-amber-500";
  return "bg-red-500";
}

function getQualityTextColor(score: number): string {
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function getQualityLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Good";
  if (score >= 60) return "Fair";
  return "Needs Attention";
}

/* ─── Build SQL for a chart config ─── */
function buildChartSQL(
  chart: ChartConfigWithSQL,
  tableName: string,
): string | null {
  if (chart.sql) return chart.sql;
  if (!chart.xAxis || !chart.yAxis) return null;

  const agg = chart.aggregation || "sum";
  const safeTable = `"${tableName}"`;
  const safeX = `"${chart.xAxis}"`;
  const safeY = `"${chart.yAxis}"`;

  if (chart.type === "scatter") {
    return `SELECT ${safeX}, ${safeY} FROM ${safeTable} LIMIT 200`;
  }

  if (chart.type === "histogram") {
    return `SELECT ${safeY} FROM ${safeTable} LIMIT 2000`;
  }

  if (chart.groupBy) {
    const safeGroup = `"${chart.groupBy}"`;
    return `SELECT ${safeX}, ${safeGroup}, ${agg}(${safeY}) AS value FROM ${safeTable} GROUP BY ${safeX}, ${safeGroup} ORDER BY value DESC LIMIT 50`;
  }

  return `SELECT ${safeX}, ${agg}(${safeY}) AS value FROM ${safeTable} GROUP BY ${safeX} ORDER BY value DESC LIMIT 20`;
}

/* ════════════════════════════════════════════════════════════════
   Main Component
   ════════════════════════════════════════════════════════════════ */

export default function DashboardView({ dataset, columns }: DashboardViewProps) {
  /* ─── State ─── */
  const [dashboardConfig, setDashboardConfig] = useState<DashboardConfigWithSQL | null>(null);
  const [chartData, setChartData] = useState<Record<string, Record<string, unknown>[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullscreenChartId, setFullscreenChartId] = useState<string | null>(null);
  const [showAddChart, setShowAddChart] = useState(false);
  const hasFetched = useRef(false);

  /* Add-chart form state */
  const [newChartType, setNewChartType] = useState<ChartType>("bar");
  const [newXAxis, setNewXAxis] = useState("");
  const [newYAxis, setNewYAxis] = useState("");
  const [newAgg, setNewAgg] = useState<(typeof AGGREGATIONS)[number]>("sum");
  const [newGroupBy, setNewGroupBy] = useState("");
  const [newChartTitle, setNewChartTitle] = useState("");
  const [previewData, setPreviewData] = useState<Record<string, unknown>[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const tableName = useMemo(() => sanitizeTableName(dataset.fileName), [dataset.fileName]);

  const numericColumns = useMemo(
    () => columns.filter((c) => c.type === "number"),
    [columns],
  );

  const qualityScore = useMemo(
    () => computeQualityScore(columns, dataset.rowCount),
    [columns, dataset.rowCount],
  );

  const columnsWithIssues = useMemo(() => {
    return columns.filter((col) => {
      const nullRate = col.nullCount / dataset.rowCount;
      if (nullRate > 0.3) return true;
      if (col.type === "string" && col.uniqueCount <= 1 && dataset.rowCount > 10)
        return true;
      return false;
    });
  }, [columns, dataset.rowCount]);

  /* ─── Fetch dashboard config and chart data ─── */
  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    setChartData({});
    setDashboardConfig(null);

    try {
      const res = await fetch("/api/ai/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "dashboard",
          tableName,
          columns,
          rowCount: dataset.rowCount,
        }),
      });

      if (!res.ok) throw new Error("Failed to generate dashboard");

      const config: DashboardConfigWithSQL = await res.json();
      setDashboardConfig(config);

      /* Execute SQL for each chart */
      const dataMap: Record<string, Record<string, unknown>[]> = {};
      const promises = config.charts.map(async (chart) => {
        try {
          const sql = buildChartSQL(chart, tableName);
          if (!sql) {
            dataMap[chart.id] = [];
            return;
          }
          const result = await runQuery(sql);
          dataMap[chart.id] = result;
        } catch {
          dataMap[chart.id] = [];
        }
      });

      await Promise.all(promises);
      setChartData(dataMap);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to generate dashboard. Is Ollama running?",
      );
    } finally {
      setLoading(false);
    }
  }, [tableName, columns, dataset.rowCount]);

  /* Initial fetch */
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    fetchDashboard();
  }, [fetchDashboard]);

  /* ─── Refresh handler ─── */
  const handleRefresh = useCallback(() => {
    hasFetched.current = true;
    fetchDashboard();
  }, [fetchDashboard]);

  /* ─── Remove chart ─── */
  const removeChart = useCallback((chartId: string) => {
    setDashboardConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        charts: prev.charts.filter((c) => c.id !== chartId),
      };
    });
    setChartData((prev) => {
      const next = { ...prev };
      delete next[chartId];
      return next;
    });
  }, []);

  /* ─── Add chart preview ─── */
  const handlePreviewChart = useCallback(async () => {
    if (!newXAxis || !newYAxis) return;
    setPreviewLoading(true);
    try {
      const chart: ChartConfigWithSQL = {
        id: "preview",
        type: newChartType,
        title: newChartTitle || `${newYAxis} by ${newXAxis}`,
        xAxis: newXAxis,
        yAxis: newYAxis,
        aggregation: newAgg,
        groupBy: newGroupBy || undefined,
      };
      const sql = buildChartSQL(chart, tableName);
      if (!sql) {
        setPreviewData([]);
        return;
      }
      const result = await runQuery(sql);
      setPreviewData(result);
    } catch {
      setPreviewData([]);
    } finally {
      setPreviewLoading(false);
    }
  }, [newChartType, newXAxis, newYAxis, newAgg, newGroupBy, newChartTitle, tableName]);

  /* ─── Add chart to dashboard ─── */
  const handleAddChart = useCallback(() => {
    if (!newXAxis || !newYAxis) return;

    const newChart: ChartConfigWithSQL = {
      id: `custom-${Date.now()}`,
      type: newChartType,
      title: newChartTitle || `${newYAxis} by ${newXAxis}`,
      xAxis: newXAxis,
      yAxis: newYAxis,
      aggregation: newAgg,
      groupBy: newGroupBy || undefined,
    };

    setDashboardConfig((prev) => {
      if (!prev) return { charts: [newChart], metrics: [] };
      return { ...prev, charts: [...prev.charts, newChart] };
    });

    if (previewData) {
      setChartData((prev) => ({ ...prev, [newChart.id]: previewData }));
    } else {
      /* Fetch data for the new chart */
      const sql = buildChartSQL(newChart, tableName);
      if (sql) {
        runQuery(sql)
          .then((result) => {
            setChartData((prev) => ({ ...prev, [newChart.id]: result }));
          })
          .catch(() => {
            setChartData((prev) => ({ ...prev, [newChart.id]: [] }));
          });
      }
    }

    /* Reset form */
    setShowAddChart(false);
    setNewChartType("bar");
    setNewXAxis("");
    setNewYAxis("");
    setNewAgg("sum");
    setNewGroupBy("");
    setNewChartTitle("");
    setPreviewData(null);
  }, [newChartType, newXAxis, newYAxis, newAgg, newGroupBy, newChartTitle, previewData, tableName]);

  /* ─── Fullscreen chart data ─── */
  const fullscreenChart = useMemo(() => {
    if (!fullscreenChartId || !dashboardConfig) return null;
    return dashboardConfig.charts.find((c) => c.id === fullscreenChartId) ?? null;
  }, [fullscreenChartId, dashboardConfig]);

  /* ════════════════════════════════════════════════
     Render: Loading
     ════════════════════════════════════════════════ */
  if (loading) {
    return (
      <div className="space-y-6">
        {/* Skeleton metrics */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonMetricCard key={i} />
          ))}
        </div>

        {/* Loading indicator */}
        <div className="flex items-center justify-center gap-3 py-4">
          <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Generating dashboard...
          </p>
        </div>

        {/* Skeleton charts */}
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonChart key={i} />
          ))}
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════════════
     Render: Error
     ════════════════════════════════════════════════ */
  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center py-16 gap-4"
      >
        <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30 px-6 py-5 max-w-md text-center">
          <AlertTriangle className="w-8 h-8 text-red-400 dark:text-red-500 mx-auto mb-3" />
          <p className="font-semibold text-red-700 dark:text-red-400 mb-1">
            Could not generate dashboard
          </p>
          <p className="text-xs text-red-600/80 dark:text-red-400/70">{error}</p>
        </div>
        <button
          onClick={handleRefresh}
          className="
            inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
            bg-violet-600 text-white hover:bg-violet-700
            transition-colors duration-150
          "
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </motion.div>
    );
  }

  if (!dashboardConfig) return null;

  const hasContent =
    dashboardConfig.metrics.length > 0 || dashboardConfig.charts.length > 0;

  /* ════════════════════════════════════════════════
     Render: Dashboard
     ════════════════════════════════════════════════ */
  return (
    <div className="space-y-8">
      {/* ─── Toolbar ─── */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Dashboard
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddChart(true)}
            className="
              inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
              bg-violet-600 text-white hover:bg-violet-700
              transition-colors duration-150
            "
          >
            <Plus className="w-3.5 h-3.5" />
            Add Chart
          </button>
          <button
            onClick={handleRefresh}
            className="
              inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
              border border-gray-200 dark:border-gray-700
              text-gray-600 dark:text-gray-400
              hover:bg-gray-50 dark:hover:bg-gray-800
              transition-colors duration-150
            "
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {!hasContent && (
        <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">
          No dashboard suggestions were generated. Try loading a dataset with
          more varied data.
        </div>
      )}

      {/* ─── Metric Cards ─── */}
      {dashboardConfig.metrics.length > 0 && (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="grid gap-3 grid-cols-2 lg:grid-cols-4"
        >
          {dashboardConfig.metrics.map((metric, i) => (
            <motion.div
              key={i}
              variants={itemVariants}
              whileHover={{ scale: 1.03, transition: { duration: 0.2 } }}
              className="
                rounded-xl p-5
                backdrop-blur-xl bg-white/60 dark:bg-gray-900/60
                border border-gray-200/50 dark:border-gray-700/50
                shadow-sm hover:shadow-md
                transition-shadow duration-300
                cursor-default
              "
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl flex-shrink-0" role="img">
                  {metric.emoji}
                </span>
                <div className="min-w-0">
                  <p className="text-2xl font-bold text-gray-800 dark:text-gray-50 tracking-tight truncate">
                    {typeof metric.value === "number"
                      ? formatNumber(metric.value)
                      : metric.value}
                  </p>
                  <p className="text-xs font-medium text-gray-400 dark:text-gray-500 mt-0.5 truncate uppercase tracking-wide">
                    {metric.label}
                  </p>
                </div>
              </div>
              {metric.change && (
                <div className="mt-2 flex items-center gap-1">
                  {metric.change.startsWith("-") ? (
                    <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                  ) : (
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                  )}
                  <span
                    className={`text-xs font-medium ${
                      metric.change.startsWith("-")
                        ? "text-red-500"
                        : "text-emerald-500"
                    }`}
                  >
                    {metric.change}
                  </span>
                </div>
              )}
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* ─── Chart Grid ─── */}
      {dashboardConfig.charts.length > 0 && (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="grid gap-4 md:grid-cols-2"
        >
          {dashboardConfig.charts.map((chart) => {
            const typeMeta = CHART_TYPE_META[chart.type] ?? CHART_TYPE_META.bar;
            const TypeIcon = typeMeta.icon;
            const data = chartData[chart.id] ?? [];

            return (
              <motion.div
                key={chart.id}
                variants={itemVariants}
                layout
                className="
                  rounded-xl p-5
                  backdrop-blur-xl bg-white/60 dark:bg-gray-900/60
                  border border-gray-200/50 dark:border-gray-700/50
                  shadow-sm hover:shadow-md
                  transition-shadow duration-300
                "
              >
                {/* Chart header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {chart.title}
                    </h3>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${typeMeta.color}`}
                    >
                      <TypeIcon className="w-3 h-3" />
                      {typeMeta.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                    <button
                      onClick={() => setFullscreenChartId(chart.id)}
                      className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                      aria-label="View fullscreen"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => removeChart(chart.id)}
                      className="p-1.5 rounded-md text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      aria-label="Remove chart"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Chart body */}
                {data.length > 0 ? (
                  <ChartRenderer
                    config={{
                      ...chart,
                      xAxis: chart.sql ? chart.xAxis : chart.xAxis,
                      yAxis: chart.sql ? chart.yAxis : "value",
                    }}
                    data={data}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-400 dark:text-gray-500">
                    <BarChart3 className="w-8 h-8" />
                    <p className="text-xs">No data available</p>
                  </div>
                )}
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* ─── Data Quality Overview ─── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3 }}
        className="
          rounded-xl p-5
          backdrop-blur-xl bg-white/60 dark:bg-gray-900/60
          border border-gray-200/50 dark:border-gray-700/50
        "
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Data Quality
          </h3>
          <div className="flex items-center gap-2">
            {qualityScore >= 80 ? (
              <CheckCircle className="w-4 h-4 text-emerald-500" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-500" />
            )}
            <span
              className={`text-sm font-bold ${getQualityTextColor(qualityScore)}`}
            >
              {qualityScore}%
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {getQualityLabel(qualityScore)}
            </span>
          </div>
        </div>

        {/* Quality bar */}
        <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden mb-4">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${qualityScore}%` }}
            transition={{ duration: 0.8, delay: 0.5, ease: "easeOut" }}
            className={`h-full rounded-full ${getQualityColor(qualityScore)}`}
          />
        </div>

        {/* Issues list */}
        {columnsWithIssues.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Columns with issues
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {columnsWithIssues.map((col) => {
                const nullRate = Math.round(
                  (col.nullCount / dataset.rowCount) * 100,
                );
                return (
                  <div
                    key={col.name}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 text-xs"
                  >
                    <span className="font-medium text-gray-700 dark:text-gray-300 truncate mr-2">
                      {col.name}
                    </span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {nullRate > 30 && (
                        <span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
                          {nullRate}% null
                        </span>
                      )}
                      {col.uniqueCount <= 1 && dataset.rowCount > 10 && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
                          low variance
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {columnsWithIssues.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            No significant quality issues detected.
          </p>
        )}
      </motion.div>

      {/* ─── Fullscreen Chart Modal ─── */}
      <AnimatePresence>
        {fullscreenChart && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
          >
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setFullscreenChartId(null)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />

            {/* Content */}
            <motion.div
              className="
                relative w-full max-w-5xl max-h-[90vh]
                rounded-2xl p-6
                bg-white/95 dark:bg-gray-900/95
                backdrop-blur-xl
                border border-gray-200/50 dark:border-gray-700/50
                shadow-2xl overflow-auto
              "
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {fullscreenChart.title}
                </h3>
                <button
                  onClick={() => setFullscreenChartId(null)}
                  className="
                    p-2 rounded-lg
                    text-gray-400 hover:text-gray-600
                    dark:text-gray-500 dark:hover:text-gray-300
                    hover:bg-gray-100 dark:hover:bg-gray-800
                    transition-colors duration-150
                  "
                  aria-label="Close fullscreen"
                >
                  <Minimize2 className="w-5 h-5" />
                </button>
              </div>

              <div className="min-h-[500px]">
                <ChartRenderer
                  config={{
                    ...fullscreenChart,
                    yAxis: fullscreenChart.sql
                      ? fullscreenChart.yAxis
                      : "value",
                  }}
                  data={chartData[fullscreenChart.id] ?? []}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Add Chart Modal ─── */}
      <Modal
        open={showAddChart}
        onClose={() => {
          setShowAddChart(false);
          setPreviewData(null);
        }}
        title="Add Custom Chart"
        size="lg"
      >
        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Chart Title (optional)
            </label>
            <input
              type="text"
              value={newChartTitle}
              onChange={(e) => setNewChartTitle(e.target.value)}
              placeholder="Auto-generated if empty"
              className="
                w-full rounded-lg border border-gray-200 dark:border-gray-700
                bg-white dark:bg-gray-800
                px-3 py-2 text-sm
                text-gray-900 dark:text-gray-100
                placeholder:text-gray-400 dark:placeholder:text-gray-500
                focus:outline-none focus:ring-2 focus:ring-violet-500/40
                transition-colors
              "
            />
          </div>

          {/* Chart type */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Chart Type
            </label>
            <div className="flex flex-wrap gap-2">
              {(
                ["bar", "line", "pie", "scatter", "area", "histogram"] as ChartType[]
              ).map((t) => {
                const meta = CHART_TYPE_META[t];
                const Icon = meta.icon;
                return (
                  <button
                    key={t}
                    onClick={() => setNewChartType(t)}
                    className={`
                      inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                      border transition-colors duration-150
                      ${
                        newChartType === t
                          ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300"
                          : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                      }
                    `}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Axis selectors */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                X-Axis Column
              </label>
              <select
                value={newXAxis}
                onChange={(e) => setNewXAxis(e.target.value)}
                className="
                  w-full rounded-lg border border-gray-200 dark:border-gray-700
                  bg-white dark:bg-gray-800
                  px-3 py-2 text-sm
                  text-gray-900 dark:text-gray-100
                  focus:outline-none focus:ring-2 focus:ring-violet-500/40
                  transition-colors
                "
              >
                <option value="">Select column...</option>
                {columns.map((col) => (
                  <option key={col.name} value={col.name}>
                    {col.name} ({col.type})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Y-Axis Column
              </label>
              <select
                value={newYAxis}
                onChange={(e) => setNewYAxis(e.target.value)}
                className="
                  w-full rounded-lg border border-gray-200 dark:border-gray-700
                  bg-white dark:bg-gray-800
                  px-3 py-2 text-sm
                  text-gray-900 dark:text-gray-100
                  focus:outline-none focus:ring-2 focus:ring-violet-500/40
                  transition-colors
                "
              >
                <option value="">Select column...</option>
                {numericColumns.map((col) => (
                  <option key={col.name} value={col.name}>
                    {col.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Aggregation & Group By */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Aggregation
              </label>
              <select
                value={newAgg}
                onChange={(e) =>
                  setNewAgg(e.target.value as (typeof AGGREGATIONS)[number])
                }
                className="
                  w-full rounded-lg border border-gray-200 dark:border-gray-700
                  bg-white dark:bg-gray-800
                  px-3 py-2 text-sm
                  text-gray-900 dark:text-gray-100
                  focus:outline-none focus:ring-2 focus:ring-violet-500/40
                  transition-colors
                "
              >
                {AGGREGATIONS.map((a) => (
                  <option key={a} value={a}>
                    {a.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Group By (optional)
              </label>
              <select
                value={newGroupBy}
                onChange={(e) => setNewGroupBy(e.target.value)}
                className="
                  w-full rounded-lg border border-gray-200 dark:border-gray-700
                  bg-white dark:bg-gray-800
                  px-3 py-2 text-sm
                  text-gray-900 dark:text-gray-100
                  focus:outline-none focus:ring-2 focus:ring-violet-500/40
                  transition-colors
                "
              >
                <option value="">None</option>
                {columns.map((col) => (
                  <option key={col.name} value={col.name}>
                    {col.name} ({col.type})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Preview area */}
          {previewData && previewData.length > 0 && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <ChartRenderer
                config={{
                  id: "preview",
                  type: newChartType,
                  title: newChartTitle || `${newYAxis} by ${newXAxis}`,
                  xAxis: newXAxis,
                  yAxis: "value",
                  aggregation: newAgg,
                  groupBy: newGroupBy || undefined,
                }}
                data={previewData}
              />
            </div>
          )}

          {previewData && previewData.length === 0 && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-6 text-center">
              <p className="text-sm text-gray-400">
                No data returned for this configuration.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={handlePreviewChart}
              disabled={!newXAxis || !newYAxis || previewLoading}
              className="
                inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium
                border border-gray-200 dark:border-gray-700
                text-gray-600 dark:text-gray-400
                hover:bg-gray-50 dark:hover:bg-gray-800
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-colors duration-150
              "
            >
              {previewLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <BarChart3 className="w-4 h-4" />
              )}
              Preview
            </button>
            <button
              onClick={handleAddChart}
              disabled={!newXAxis || !newYAxis}
              className="
                inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium
                bg-violet-600 text-white hover:bg-violet-700
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-colors duration-150
              "
            >
              <Plus className="w-4 h-4" />
              Add to Dashboard
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
