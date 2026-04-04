"use client";

import { memo, useCallback, useMemo, useState, useSyncExternalStore } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  Download,
  Loader2,
  Monitor,
  Orbit,
  Play,
  Server,
  Sigma,
  Sparkles,
} from "lucide-react";
import { exportToCSV } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import { runQuery } from "@/lib/duckdb/client";
import { cluster as apiCluster } from "@/lib/api/ml";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([ScatterChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface ClusteringViewProps {
  tableName: string;
  columns: ColumnProfile[];
}

type ClusteringAlgorithm = "kmeans" | "dbscan";

interface ClusterPoint {
  pointId: number;
  clusterId: number;
  values: number[];
}

interface ClusterSummary {
  clusterId: number;
  size: number;
  withinClusterVariance: number;
  centroid: number[];
}

interface UnionFindState {
  parent: Map<number, number>;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const CARD_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const PALETTE = [
  "#06b6d4",
  "#22c55e",
  "#f97316",
  "#8b5cf6",
  "#e11d48",
  "#0ea5e9",
  "#84cc16",
] as const;

function subscribeDarkMode(listener: () => void) {
  if (typeof document === "undefined") return () => undefined;
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getDarkModeSnapshot() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function createTempName(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function distanceExpression(dimensions: number): string {
  return Array.from({ length: dimensions }, (_, index) => `POWER(s.f${index + 1} - c.f${index + 1}, 2)`).join(" + ");
}

function sourceDistanceExpression(aliasA: string, aliasB: string, dimensions: number): string {
  return Array.from({ length: dimensions }, (_, index) => `POWER(${aliasA}.f${index + 1} - ${aliasB}.f${index + 1}, 2)`).join(" + ");
}

function createUnionFind(points: number[]): UnionFindState {
  return {
    parent: new Map(points.map((point) => [point, point])),
  };
}

function unionFindRoot(state: UnionFindState, point: number): number {
  const currentParent = state.parent.get(point) ?? point;
  if (currentParent === point) return point;
  const root = unionFindRoot(state, currentParent);
  state.parent.set(point, root);
  return root;
}

function unionPoints(state: UnionFindState, left: number, right: number) {
  const leftRoot = unionFindRoot(state, left);
  const rightRoot = unionFindRoot(state, right);
  if (leftRoot !== rightRoot) {
    state.parent.set(rightRoot, leftRoot);
  }
}

function buildChartOption(
  dark: boolean,
  selectedColumns: string[],
  points: ClusterPoint[],
): EChartsOption {
  const clusters = Array.from(new Set(points.map((point) => point.clusterId))).sort((left, right) => left - right);
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";

  return {
    animationDuration: 420,
    color: PALETTE.slice(),
    legend: {
      bottom: 0,
      textStyle: { color: textColor },
    },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params) => {
        const primary = Array.isArray(params) ? params[0] : params;
        const value = Array.isArray(primary?.value) ? primary.value : [];
        return [
          `<strong>${primary?.seriesName ?? "Cluster"}</strong>`,
          `${selectedColumns[0]}: ${formatNumber(Number(value[0] ?? 0))}`,
          `${selectedColumns[1]}: ${formatNumber(Number(value[1] ?? 0))}`,
          selectedColumns[2] ? `${selectedColumns[2]}: ${formatNumber(Number(value[2] ?? 0))}` : "",
        ]
          .filter(Boolean)
          .join("<br/>");
      },
    },
    grid: { left: 56, right: 24, top: 24, bottom: 56 },
    xAxis: {
      type: "value",
      name: selectedColumns[0],
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    yAxis: {
      type: "value",
      name: selectedColumns[1],
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: borderColor, type: "dashed" } },
    },
    series: clusters.map((clusterId, index) => ({
      name: clusterId === -1 ? "Noise" : `Cluster ${clusterId}`,
      type: "scatter",
      symbolSize: (point: number[]) => {
        if (selectedColumns.length < 3) return 10;
        return Math.max(8, Math.min(18, Math.abs(point[2] ?? 10)));
      },
      itemStyle: {
        color: clusterId === -1 ? "#94a3b8" : PALETTE[index % PALETTE.length],
        opacity: clusterId === -1 ? 0.45 : 0.82,
      },
      data: points
        .filter((point) => point.clusterId === clusterId)
        .map((point) => point.values),
    })),
  };
}

function SummaryTable({
  columns,
  summaries,
}: {
  columns: string[];
  summaries: ClusterSummary[];
}) {
  if (summaries.length === 0) {
    return (
      <div className="rounded-[1rem] border border-dashed border-white/20 px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
        Run clustering to inspect centroids, cluster sizes, and variance.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[1rem] border border-white/15 bg-white/55 dark:bg-slate-950/25">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-white/60 dark:bg-slate-900/60">
            <tr>
              <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Cluster</th>
              <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Size</th>
              {columns.map((column) => (
                <th key={column} className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">
                  {column} centroid
                </th>
              ))}
              <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">Variance</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((summary) => (
              <tr key={summary.clusterId} className="border-t border-white/10">
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                  {summary.clusterId === -1 ? "Noise" : summary.clusterId}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{summary.size}</td>
                {summary.centroid.map((value, index) => (
                  <td key={`${summary.clusterId}-${index}`} className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {formatNumber(value)}
                  </td>
                ))}
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                  {formatNumber(summary.withinClusterVariance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClusteringView({ tableName, columns }: ClusteringViewProps) {
  const dark = useSyncExternalStore(subscribeDarkMode, getDarkModeSnapshot, () => false);
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [selectedColumns, setSelectedColumns] = useState<string[]>(() =>
    numericColumns.slice(0, 2).map((column) => column.name),
  );
  const [algorithm, setAlgorithm] = useState<ClusteringAlgorithm>("kmeans");
  const [kValue, setKValue] = useState(3);
  const [epsilon, setEpsilon] = useState(1.5);
  const [minPts, setMinPts] = useState(5);
  const [points, setPoints] = useState<ClusterPoint[]>([]);
  const [summaries, setSummaries] = useState<ClusterSummary[]>([]);
  const [useBackend, setUseBackend] = useState(true);
  const [backendFailed, setBackendFailed] = useState(false);
  const [status, setStatus] = useState("Pick 2-3 numeric columns and run clustering.");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const chartOption = useMemo(
    () => buildChartOption(dark, selectedColumns, points),
    [dark, points, selectedColumns],
  );

  function toggleColumn(columnName: string) {
    setSelectedColumns((current) => {
      if (current.includes(columnName)) {
        return current.filter((column) => column !== columnName);
      }
      if (current.length >= 3) {
        return [...current.slice(1), columnName];
      }
      return [...current, columnName];
    });
  }

  async function runKMeans(tempSource: string, dimensions: number) {
    const tempCentroids = createTempName("cluster_centroids");
    const tempAssignments = createTempName("cluster_assignments");

    await runQuery(
      `CREATE OR REPLACE TEMP TABLE ${quoteIdentifier(tempCentroids)} AS
       SELECT ROW_NUMBER() OVER (ORDER BY point_id) - 1 AS cluster_id, ${Array.from({ length: dimensions }, (_, index) => `f${index + 1}`).join(", ")}
       FROM ${quoteIdentifier(tempSource)}
       LIMIT ${Math.max(kValue, 2)}`,
    );

    for (let iteration = 0; iteration < 8; iteration += 1) {
      await runQuery(
        `CREATE OR REPLACE TEMP TABLE ${quoteIdentifier(tempAssignments)} AS
         WITH ranked AS (
           SELECT
             s.point_id,
             c.cluster_id,
             ${distanceExpression(dimensions)} AS distance_sq,
             ROW_NUMBER() OVER (
               PARTITION BY s.point_id
               ORDER BY ${distanceExpression(dimensions)} ASC
             ) AS rank_index
           FROM ${quoteIdentifier(tempSource)} s
           CROSS JOIN ${quoteIdentifier(tempCentroids)} c
         )
         SELECT point_id, cluster_id, distance_sq
         FROM ranked
         WHERE rank_index = 1`,
      );

      await runQuery(
        `CREATE OR REPLACE TEMP TABLE ${quoteIdentifier(tempCentroids)} AS
         SELECT
           a.cluster_id,
           ${Array.from({ length: dimensions }, (_, index) => `AVG(s.f${index + 1}) AS f${index + 1}`).join(", ")}
         FROM ${quoteIdentifier(tempAssignments)} a
         JOIN ${quoteIdentifier(tempSource)} s USING (point_id)
         GROUP BY a.cluster_id
         ORDER BY a.cluster_id`,
      );
    }

    const pointRows = await runQuery(
      `SELECT
         s.point_id,
         a.cluster_id,
         ${Array.from({ length: dimensions }, (_, index) => `s.f${index + 1}`).join(", ")}
       FROM ${quoteIdentifier(tempSource)} s
       JOIN ${quoteIdentifier(tempAssignments)} a USING (point_id)
       ORDER BY a.cluster_id, s.point_id`,
    );
    const summaryRows = await runQuery(
      `SELECT
         a.cluster_id,
         COUNT(*) AS cluster_size,
         AVG(a.distance_sq) AS variance,
         ${Array.from({ length: dimensions }, (_, index) => `AVG(s.f${index + 1}) AS c${index + 1}`).join(", ")}
       FROM ${quoteIdentifier(tempAssignments)} a
       JOIN ${quoteIdentifier(tempSource)} s USING (point_id)
       GROUP BY a.cluster_id
       ORDER BY a.cluster_id`,
    );

    return {
      points: pointRows.map((row) => ({
        pointId: Number(row.point_id ?? 0),
        clusterId: Number(row.cluster_id ?? 0),
        values: Array.from({ length: dimensions }, (_, index) => toNumber(row[`f${index + 1}`])),
      })),
      summaries: summaryRows.map((row) => ({
        clusterId: Number(row.cluster_id ?? 0),
        size: Number(row.cluster_size ?? 0),
        withinClusterVariance: toNumber(row.variance),
        centroid: Array.from({ length: dimensions }, (_, index) => toNumber(row[`c${index + 1}`])),
      })),
    };
  }

  async function runDbscan(tempSource: string, dimensions: number) {
    const epsilonSquared = epsilon * epsilon;
    const edgeRows = await runQuery(
      `WITH edges AS (
         SELECT
           a.point_id AS left_id,
           b.point_id AS right_id
         FROM ${quoteIdentifier(tempSource)} a
         JOIN ${quoteIdentifier(tempSource)} b
           ON a.point_id < b.point_id
          AND ${sourceDistanceExpression("a", "b", dimensions)} <= ${epsilonSquared}
       )
       SELECT * FROM edges`,
    );

    const neighborRows = await runQuery(
      `WITH edges AS (
         SELECT
           a.point_id AS left_id,
           b.point_id AS right_id
         FROM ${quoteIdentifier(tempSource)} a
         JOIN ${quoteIdentifier(tempSource)} b
           ON a.point_id < b.point_id
          AND ${sourceDistanceExpression("a", "b", dimensions)} <= ${epsilonSquared}
       ),
       counts AS (
         SELECT left_id AS point_id FROM edges
         UNION ALL
         SELECT right_id AS point_id FROM edges
         UNION ALL
         SELECT point_id FROM ${quoteIdentifier(tempSource)}
       )
       SELECT point_id, COUNT(*) AS neighbor_count
       FROM counts
       GROUP BY point_id`,
    );
    const pointRows = await runQuery(
      `SELECT point_id, ${Array.from({ length: dimensions }, (_, index) => `f${index + 1}`).join(", ")}
       FROM ${quoteIdentifier(tempSource)}
       ORDER BY point_id`,
    );

    const corePoints = new Set(
      neighborRows
        .filter((row) => Number(row.neighbor_count ?? 0) >= minPts)
        .map((row) => Number(row.point_id ?? 0)),
    );
    const state = createUnionFind(pointRows.map((row) => Number(row.point_id ?? 0)));

    edgeRows.forEach((row) => {
      const leftId = Number(row.left_id ?? 0);
      const rightId = Number(row.right_id ?? 0);
      if (corePoints.has(leftId) && corePoints.has(rightId)) {
        unionPoints(state, leftId, rightId);
      }
    });

    const clusterIdByRoot = new Map<number, number>();
    let clusterCounter = 0;
    const assignments = new Map<number, number>();

    pointRows.forEach((row) => {
      const pointId = Number(row.point_id ?? 0);
      if (!corePoints.has(pointId)) return;
      const root = unionFindRoot(state, pointId);
      if (!clusterIdByRoot.has(root)) {
        clusterIdByRoot.set(root, clusterCounter);
        clusterCounter += 1;
      }
      assignments.set(pointId, clusterIdByRoot.get(root) ?? -1);
    });

    edgeRows.forEach((row) => {
      const leftId = Number(row.left_id ?? 0);
      const rightId = Number(row.right_id ?? 0);

      if (!assignments.has(leftId) && assignments.has(rightId)) {
        assignments.set(leftId, assignments.get(rightId) ?? -1);
      }
      if (!assignments.has(rightId) && assignments.has(leftId)) {
        assignments.set(rightId, assignments.get(leftId) ?? -1);
      }
    });

    pointRows.forEach((row) => {
      const pointId = Number(row.point_id ?? 0);
      if (!assignments.has(pointId)) assignments.set(pointId, -1);
    });

    const clusteredPoints: ClusterPoint[] = pointRows.map((row) => ({
      pointId: Number(row.point_id ?? 0),
      clusterId: assignments.get(Number(row.point_id ?? 0)) ?? -1,
      values: Array.from({ length: dimensions }, (_, index) => toNumber(row[`f${index + 1}`])),
    }));

    const grouped = new Map<number, ClusterPoint[]>();
    clusteredPoints.forEach((point) => {
      const bucket = grouped.get(point.clusterId) ?? [];
      bucket.push(point);
      grouped.set(point.clusterId, bucket);
    });

    const summaryData: ClusterSummary[] = Array.from(grouped.entries())
      .map(([clusterId, clusterPoints]) => {
        const centroid = Array.from({ length: dimensions }, (_, dimensionIndex) => {
          const sum = clusterPoints.reduce((acc, point) => acc + (point.values[dimensionIndex] ?? 0), 0);
          return sum / Math.max(clusterPoints.length, 1);
        });
        const variance =
          clusterPoints.reduce((acc, point) => {
            const distanceSq = centroid.reduce((distance, value, dimensionIndex) => {
              const delta = (point.values[dimensionIndex] ?? 0) - value;
              return distance + delta * delta;
            }, 0);
            return acc + distanceSq;
          }, 0) / Math.max(clusterPoints.length, 1);

        return {
          clusterId,
          size: clusterPoints.length,
          withinClusterVariance: variance,
          centroid,
        };
      })
      .sort((left, right) => left.clusterId - right.clusterId);

    return {
      points: clusteredPoints,
      summaries: summaryData,
    };
  }

  const fetchSamplesForBackend = useCallback(async () => {
    const whereClause = selectedColumns
      .map((column) => `${quoteIdentifier(column)} IS NOT NULL`)
      .join(" AND ");

    const sampleRows = await runQuery(
      `SELECT ${selectedColumns.map((column) => `CAST(${quoteIdentifier(column)} AS DOUBLE) AS ${quoteIdentifier(column)}`).join(", ")}
       FROM ${quoteIdentifier(tableName)}
       WHERE ${whereClause}
       LIMIT 1500`,
    );
    return sampleRows.map((row) =>
      Object.fromEntries(selectedColumns.map((column) => [column, toNumber(row[column])])),
    );
  }, [tableName, selectedColumns]);

  async function runClusteringClientSide() {
    const tempSource = createTempName("cluster_source");
    const dimensions = selectedColumns.length;
    const selectColumns = selectedColumns
      .map((column, index) => `CAST(${quoteIdentifier(column)} AS DOUBLE) AS f${index + 1}`)
      .join(", ");
    const whereClause = selectedColumns
      .map((column) => `${quoteIdentifier(column)} IS NOT NULL`)
      .join(" AND ");

    await runQuery(
      `CREATE OR REPLACE TEMP TABLE ${quoteIdentifier(tempSource)} AS
       SELECT
         ROW_NUMBER() OVER () AS point_id,
         ${selectColumns}
       FROM ${quoteIdentifier(tableName)}
       WHERE ${whereClause}
       LIMIT 1500`,
    );

    const result =
      algorithm === "kmeans"
        ? await runKMeans(tempSource, dimensions)
        : await runDbscan(tempSource, dimensions);

    setPoints(result.points);
    setSummaries(result.summaries);
    setStatus(
      algorithm === "kmeans"
        ? `K-means completed with ${result.summaries.length} clusters (client-side).`
        : `DBSCAN completed with ${result.summaries.filter((summary) => summary.clusterId !== -1).length} dense regions (client-side).`,
    );
  }

  async function runClustering() {
    if (selectedColumns.length < 2 || selectedColumns.length > 3) {
      setError("Select exactly 2 or 3 numeric columns for clustering.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (useBackend && !backendFailed) {
        try {
          const rawSamples = await fetchSamplesForBackend();
          const apiResult = await apiCluster(rawSamples, selectedColumns, algorithm, kValue);
          const dimensions = selectedColumns.length;

          const nextPoints: ClusterPoint[] = rawSamples.map((row, index) => ({
            pointId: index,
            clusterId: apiResult.labels[index] ?? -1,
            values: selectedColumns.map((column) => toNumber(row[column])),
          }));

          const grouped = new Map<number, ClusterPoint[]>();
          nextPoints.forEach((point) => {
            const bucket = grouped.get(point.clusterId) ?? [];
            bucket.push(point);
            grouped.set(point.clusterId, bucket);
          });

          const nextSummaries: ClusterSummary[] = Array.from(grouped.entries())
            .map(([clusterId, clusterPoints]) => {
              const centroid = Array.from({ length: dimensions }, (_, dimIdx) => {
                const sum = clusterPoints.reduce((acc, p) => acc + (p.values[dimIdx] ?? 0), 0);
                return sum / Math.max(clusterPoints.length, 1);
              });
              const variance =
                clusterPoints.reduce((acc, point) => {
                  const distSq = centroid.reduce((dist, val, dimIdx) => {
                    const delta = (point.values[dimIdx] ?? 0) - val;
                    return dist + delta * delta;
                  }, 0);
                  return acc + distSq;
                }, 0) / Math.max(clusterPoints.length, 1);

              return { clusterId, size: clusterPoints.length, withinClusterVariance: variance, centroid };
            })
            .sort((l, r) => l.clusterId - r.clusterId);

          setPoints(nextPoints);
          setSummaries(nextSummaries);
          setStatus(
            algorithm === "kmeans"
              ? `K-means completed with ${nextSummaries.length} clusters (server-side).`
              : `DBSCAN completed with ${nextSummaries.filter((s) => s.clusterId !== -1).length} dense regions (server-side).`,
          );
          return;
        } catch {
          setBackendFailed(true);
          setUseBackend(false);
        }
      }

      await runClusteringClientSide();
    } catch (clusterError) {
      setError(clusterError instanceof Error ? clusterError.message : "Clustering failed.");
    } finally {
      setLoading(false);
    }
  }

  function exportAssignments() {
    if (points.length === 0) return;
    exportToCSV(
      points.map((point) => ({
        point_id: point.pointId,
        cluster_id: point.clusterId,
        ...Object.fromEntries(selectedColumns.map((column, index) => [column, point.values[index] ?? null])),
      })),
      `${tableName}-${algorithm}-clusters.csv`,
    );
  }

  return (
    <section className={`${CARD_CLASS} overflow-hidden p-5`}>
      <div className="flex flex-col gap-5 border-b border-white/15 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-[1.25rem] bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
            <Orbit className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
              Clustering
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">
              K-means and DBSCAN in DuckDB SQL
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900/30 dark:text-slate-300">
            <input
              type="checkbox"
              checked={useBackend}
              onChange={(event) => {
                setUseBackend(event.target.checked);
                if (event.target.checked) setBackendFailed(false);
              }}
              className="h-4 w-4 rounded accent-cyan-500"
            />
            Use server-side ML
          </label>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
              useBackend && !backendFailed
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
            }`}
          >
            {useBackend && !backendFailed ? (
              <><Server className="h-3 w-3" /> Backend</>
            ) : (
              <><Monitor className="h-3 w-3" /> Client-side</>
            )}
          </span>
        </div>
      </div>

      <div className="rounded-[1rem] border border-white/15 bg-white/45 px-4 py-3 mt-4 text-sm text-slate-600 dark:bg-slate-900/30 dark:text-slate-300">
        {status}
      </div>

      {error ? (
        <div className="mt-4 rounded-[1.2rem] border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30"
          >
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Numeric feature selection
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {numericColumns.map((column) => {
                const active = selectedColumns.includes(column.name);
                return (
                  <button
                    key={column.name}
                    type="button"
                    onClick={() => toggleColumn(column.name)}
                    className={`rounded-full px-3 py-2 text-sm transition ${
                      active
                        ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                        : "bg-slate-200/70 text-slate-700 dark:bg-slate-800/70 dark:text-slate-300"
                    }`}
                  >
                    {column.name}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <select
                value={algorithm}
                onChange={(event) => setAlgorithm(event.target.value as ClusteringAlgorithm)}
                className="rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
              >
                <option value="kmeans">K-means</option>
                <option value="dbscan">DBSCAN</option>
              </select>
              {algorithm === "kmeans" ? (
                <input
                  type="number"
                  min={2}
                  max={12}
                  value={kValue}
                  onChange={(event) => setKValue(Math.max(Number(event.target.value), 2))}
                  className="rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
                />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={epsilon}
                    onChange={(event) => setEpsilon(Math.max(Number(event.target.value), 0.1))}
                    className="rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
                  />
                  <input
                    type="number"
                    min={2}
                    step={1}
                    value={minPts}
                    onChange={(event) => setMinPts(Math.max(Number(event.target.value), 2))}
                    className="rounded-[1rem] border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-900 outline-none dark:bg-slate-950/60 dark:text-slate-50"
                  />
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runClustering()}
                className="inline-flex items-center gap-2 rounded-[1rem] bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Run clustering
              </button>
              <button
                type="button"
                onClick={exportAssignments}
                className="inline-flex items-center gap-2 rounded-[1rem] border border-white/15 bg-white/55 px-4 py-3 text-sm text-slate-700 transition hover:bg-white/70 dark:bg-slate-950/35 dark:text-slate-200"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            </div>
          </motion.div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[1.25rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Selected features
                </p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">
                {selectedColumns.length}
              </p>
            </div>
            <div className="rounded-[1.25rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
              <div className="flex items-center gap-2">
                <Sigma className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Clusters found
                </p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">
                {summaries.filter((summary) => summary.clusterId !== -1).length}
              </p>
            </div>
          </div>

          <SummaryTable columns={selectedColumns} summaries={summaries} />
        </div>

        <div className="rounded-[1.4rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/30">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            Cluster scatter plot
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            The first two selected columns drive X and Y. A third column, if selected, adjusts point size.
          </p>
          <div className="mt-4 overflow-hidden rounded-[1.2rem] border border-white/15 bg-white/55 dark:bg-slate-950/25">
            <ReactEChartsCore
              echarts={echarts}
              option={chartOption}
              notMerge
              lazyUpdate
              style={{ height: 520 }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export default memo(ClusteringView);
