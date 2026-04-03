"use client";

import { startTransition, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { GraphChart } from "echarts/charts";
import {
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  Database,
  Download,
  KeyRound,
  Link2,
  Network,
  Sigma,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
  quoteIdentifier,
  quoteLiteral,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import { correlation } from "@/lib/utils/statistics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([GraphChart, LegendComponent, TooltipComponent, CanvasRenderer]);

interface ColumnDependencyGraphProps {
  tableName: string;
  columns: ColumnProfile[];
}

type DependencySignal = "correlation" | "dependency" | "hybrid";

interface DependencyNode {
  id: string;
  type: ColumnProfile["type"];
  uniqueCount: number;
  nullCount: number;
  uniquenessRatio: number;
  sampleValues: string[];
}

interface DependencyEdge {
  id: string;
  source: string;
  target: string;
  strength: number;
  signal: DependencySignal;
  label: string;
  detail: string;
}

interface DependencyGraphResult {
  rowCount: number;
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  trimmedColumns: number;
  strongestStrength: number;
}

interface SummaryCardProps {
  icon: typeof Network;
  label: string;
  value: string;
}

const MAX_ANALYSIS_COLUMNS = 10;
const MAX_NUMERIC_COLUMNS = 8;
const CORRELATION_SAMPLE_LIMIT = 600;

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildFunctionalDependencyQuery(tableName: string, columns: string[]): string {
  return columns
    .flatMap((source) =>
      columns
        .filter((target) => target !== source)
        .map((target) => {
          const safeSource = quoteIdentifier(source);
          const safeTarget = quoteIdentifier(target);
          return `
            SELECT
              ${quoteLiteral(source)} AS source_name,
              ${quoteLiteral(target)} AS target_name,
              COUNT(*) AS pair_rows,
              COUNT(DISTINCT source_value) AS source_count,
              COUNT(DISTINCT target_value) AS target_count,
              COUNT(DISTINCT source_value || '¦' || target_value) AS pair_count
            FROM (
              SELECT
                CAST(${safeSource} AS VARCHAR) AS source_value,
                CAST(${safeTarget} AS VARCHAR) AS target_value
              FROM ${quoteIdentifier(tableName)}
              WHERE ${safeSource} IS NOT NULL
                AND ${safeTarget} IS NOT NULL
            )
          `;
        }),
    )
    .join(" UNION ALL ");
}

function buildNumericSampleQuery(tableName: string, numericColumns: string[]): string {
  return `
    SELECT
      ${numericColumns
        .map(
          (column) =>
            `TRY_CAST(${quoteIdentifier(column)} AS DOUBLE) AS ${quoteIdentifier(column)}`,
        )
        .join(",\n      ")}
    FROM ${quoteIdentifier(tableName)}
    LIMIT ${CORRELATION_SAMPLE_LIMIT}
  `;
}

function buildCorrelationKey(left: string, right: string): string {
  return [left, right].sort((a, b) => a.localeCompare(b)).join("::");
}

function buildEdgeId(source: string, target: string): string {
  return `${source}->${target}`;
}

function readCount(rows: Record<string, unknown>[], key: string): number {
  const value = toNumber(rows[0]?.[key]);
  return value === null ? 0 : Math.max(0, Math.round(value));
}

function describeSampleValues(values: ColumnProfile["sampleValues"]): string[] {
  return values.slice(0, 4).map((value) => String(value ?? ""));
}

function buildDependencyNodes(
  columns: ColumnProfile[],
  rowCount: number,
): DependencyNode[] {
  return columns.map((column) => {
    const nonNullCount = Math.max(1, rowCount - column.nullCount);
    return {
      id: column.name,
      type: column.type,
      uniqueCount: column.uniqueCount,
      nullCount: column.nullCount,
      uniquenessRatio: Math.min(1, column.uniqueCount / nonNullCount),
      sampleValues: describeSampleValues(column.sampleValues),
    };
  });
}

function buildCorrelationEdges(
  numericRows: Record<string, unknown>[],
  numericColumns: string[],
): Map<string, number> {
  const scores = new Map<string, number>();

  for (let leftIndex = 0; leftIndex < numericColumns.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < numericColumns.length; rightIndex += 1) {
      const leftName = numericColumns[leftIndex] ?? "";
      const rightName = numericColumns[rightIndex] ?? "";
      const leftValues: number[] = [];
      const rightValues: number[] = [];

      for (const row of numericRows) {
        const leftValue = toNumber(row[leftName]);
        const rightValue = toNumber(row[rightName]);

        if (leftValue === null || rightValue === null) {
          continue;
        }

        leftValues.push(leftValue);
        rightValues.push(rightValue);
      }

      if (leftValues.length < 8) {
        continue;
      }

      const score = Math.abs(correlation(leftValues, rightValues));
      if (Number.isFinite(score) && score >= 0.45) {
        scores.set(buildCorrelationKey(leftName, rightName), score);
      }
    }
  }

  return scores;
}

function buildDependencyEdges(
  dependencyRows: Record<string, unknown>[],
  nodes: DependencyNode[],
  correlationScores: Map<string, number>,
): DependencyEdge[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges = new Map<string, DependencyEdge>();

  for (const row of dependencyRows) {
    const source = String(row.source_name ?? "");
    const target = String(row.target_name ?? "");
    const sourceCount = toNumber(row.source_count);
    const pairCount = toNumber(row.pair_count);
    const pairRows = toNumber(row.pair_rows);

    if (
      source.length === 0 ||
      target.length === 0 ||
      sourceCount === null ||
      pairCount === null ||
      pairRows === null ||
      pairRows <= 0 ||
      pairCount <= 0
    ) {
      continue;
    }

    const dependencyStrength = sourceCount / pairCount;
    const sourceNode = nodeMap.get(source);
    const correlationKey = buildCorrelationKey(source, target);
    const correlationStrength = correlationScores.get(correlationKey) ?? 0;

    if (
      dependencyStrength < 0.58 &&
      correlationStrength < 0.65 &&
      (sourceNode?.uniquenessRatio ?? 0) < 0.85
    ) {
      continue;
    }

    const signal: DependencySignal =
      dependencyStrength >= 0.58 && correlationStrength >= 0.45
        ? "hybrid"
        : dependencyStrength >= 0.58
          ? "dependency"
          : "correlation";
    const strength = Math.max(dependencyStrength, correlationStrength);
    const detail =
      signal === "correlation"
        ? `${source} and ${target} share a numeric signal with |r| ${formatPercent(correlationStrength * 100, 0)}.`
        : signal === "hybrid"
          ? `${source} behaves like a determinant for ${target} and also carries a correlated numeric signal.`
          : `${source} functionally predicts ${target} across ${formatPercent(dependencyStrength * 100, 0)} of distinct combinations.`;

    edges.set(buildEdgeId(source, target), {
      id: buildEdgeId(source, target),
      source,
      target,
      strength,
      signal,
      label:
        signal === "correlation"
          ? `|r| ${correlationStrength.toFixed(2)}`
          : `${(dependencyStrength * 100).toFixed(0)}% determinant`,
      detail,
    });
  }

  for (const [key, strength] of correlationScores.entries()) {
    const [source, target] = key.split("::");
    if (!source || !target) {
      continue;
    }

    const directKey = buildEdgeId(source, target);
    const reverseKey = buildEdgeId(target, source);

    if (edges.has(directKey) || edges.has(reverseKey)) {
      continue;
    }

    edges.set(directKey, {
      id: directKey,
      source,
      target,
      strength,
      signal: "correlation",
      label: `|r| ${strength.toFixed(2)}`,
      detail: `${source} and ${target} move together with ${formatPercent(strength * 100, 0)} absolute correlation.`,
    });
  }

  return [...edges.values()].sort((left, right) => right.strength - left.strength);
}

async function loadDependencyGraph(
  tableName: string,
  columns: ColumnProfile[],
): Promise<DependencyGraphResult> {
  const analysisColumns = columns.slice(0, MAX_ANALYSIS_COLUMNS);
  const numericColumns = analysisColumns
    .filter((column) => column.type === "number")
    .slice(0, MAX_NUMERIC_COLUMNS)
    .map((column) => column.name);

  const [rowCountRows, dependencyRows, numericRows] = await Promise.all([
    runQuery(`
      SELECT COUNT(*) AS row_count
      FROM ${quoteIdentifier(tableName)}
    `),
    analysisColumns.length > 1
      ? runQuery(
          buildFunctionalDependencyQuery(
            tableName,
            analysisColumns.map((column) => column.name),
          ),
        )
      : Promise.resolve<Record<string, unknown>[]>([]),
    numericColumns.length > 1
      ? runQuery(buildNumericSampleQuery(tableName, numericColumns))
      : Promise.resolve<Record<string, unknown>[]>([]),
  ]);

  const rowCount = readCount(rowCountRows, "row_count");
  const nodes = buildDependencyNodes(analysisColumns, rowCount);
  const correlationScores = buildCorrelationEdges(numericRows, numericColumns);
  const edges = buildDependencyEdges(dependencyRows, nodes, correlationScores);
  const strongestStrength =
    edges.length > 0 ? edges.reduce((max, edge) => Math.max(max, edge.strength), 0) : 0;

  return {
    rowCount,
    nodes,
    edges,
    trimmedColumns: Math.max(0, columns.length - analysisColumns.length),
    strongestStrength,
  };
}

function buildGraphOption(
  nodes: DependencyNode[],
  edges: DependencyEdge[],
  dark: boolean,
  selectedNodeId: string | null,
): EChartsOption {
  const neighborIds = new Set<string>();
  edges.forEach((edge) => {
    if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
      neighborIds.add(edge.source);
      neighborIds.add(edge.target);
    }
  });

  return {
    animationDuration: 420,
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#1e293b" : "#dbe4f0",
      textStyle: {
        color: dark ? "#e2e8f0" : "#0f172a",
      },
    },
    legend: {
      bottom: 0,
      textStyle: { color: dark ? "#cbd5e1" : "#475569" },
      data: ["dependency", "correlation", "hybrid"],
    },
    series: [
      {
        type: "graph",
        layout: "force",
        roam: true,
        draggable: true,
        focusNodeAdjacency: true,
        force: { repulsion: 280, edgeLength: 180, gravity: 0.06 },
        label: {
          show: true,
          position: "right",
          color: dark ? "#e2e8f0" : "#0f172a",
        },
        edgeSymbol: ["circle", "arrow"],
        categories: [
          { name: "dependency" },
          { name: "correlation" },
          { name: "hybrid" },
        ],
        data: nodes.map((node) => ({
          id: node.id,
          name: node.id,
          value: node.uniquenessRatio,
          symbolSize: 22 + node.uniquenessRatio * 20,
          itemStyle: {
            color:
              node.type === "number"
                ? "#06b6d4"
                : node.type === "string"
                  ? "#8b5cf6"
                  : node.type === "date"
                    ? "#10b981"
                    : node.type === "boolean"
                      ? "#f59e0b"
                      : "#94a3b8",
            opacity:
              selectedNodeId &&
              selectedNodeId !== node.id &&
              !neighborIds.has(node.id)
                ? 0.25
                : 0.96,
          },
        })),
        links: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          value: edge.strength,
          category: edge.signal,
          lineStyle: {
            width: 1 + edge.strength * 6,
            color:
              edge.signal === "dependency"
                ? "rgba(14,165,233,0.82)"
                : edge.signal === "hybrid"
                  ? "rgba(168,85,247,0.82)"
                  : "rgba(16,185,129,0.82)",
            opacity:
              selectedNodeId &&
              edge.source !== selectedNodeId &&
              edge.target !== selectedNodeId
                ? 0.18
                : 0.92,
          },
        })),
      },
    ],
  };
}

function getNodeFromChartClick(params: unknown): string | null {
  if (!isRecord(params) || params.dataType !== "node") {
    return null;
  }

  const data = params.data;
  if (!isRecord(data) || typeof data.id !== "string") {
    return null;
  }

  return data.id;
}

function SummaryCard({ icon: Icon, label, value }: SummaryCardProps) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <Network className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Column dependency graph
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {message}
          </p>
        </div>
      </div>
    </section>
  );
}

export default function ColumnDependencyGraph({
  tableName,
  columns,
}: ColumnDependencyGraphProps) {
  const dark = useDarkMode();
  const [result, setResult] = useState<DependencyGraphResult | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [minimumStrengthPercent, setMinimumStrengthPercent] = useState(55);
  const [status, setStatus] = useState(
    "Infer relationships from uniqueness and numeric correlation signals.",
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const minimumStrength = minimumStrengthPercent / 100;

  const filteredEdges = useMemo(
    () =>
      (result?.edges ?? []).filter((edge) => edge.strength >= minimumStrength),
    [minimumStrength, result],
  );

  const visibleNodeIds = useMemo(() => {
    const ids = new Set<string>();
    filteredEdges.forEach((edge) => {
      ids.add(edge.source);
      ids.add(edge.target);
    });
    return ids;
  }, [filteredEdges]);

  const visibleNodes = useMemo(
    () =>
      (result?.nodes ?? []).filter(
        (node) => visibleNodeIds.size === 0 || visibleNodeIds.has(node.id),
      ),
    [result, visibleNodeIds],
  );

  const resolvedSelectedNode = useMemo(
    () =>
      visibleNodes.find((node) => node.id === selectedNodeId) ??
      visibleNodes[0] ??
      result?.nodes[0] ??
      null,
    [result, selectedNodeId, visibleNodes],
  );

  const selectedNodeEdges = useMemo(
    () =>
      filteredEdges.filter(
        (edge) =>
          edge.source === resolvedSelectedNode?.id || edge.target === resolvedSelectedNode?.id,
      ),
    [filteredEdges, resolvedSelectedNode],
  );

  const chartOption = useMemo(
    () =>
      buildGraphOption(
        visibleNodes,
        filteredEdges,
        dark,
        resolvedSelectedNode?.id ?? null,
      ),
    [dark, filteredEdges, resolvedSelectedNode, visibleNodes],
  );

  const chartEvents = useMemo(
    () => ({
      click: (params: unknown) => {
        const nextNodeId = getNodeFromChartClick(params);
        if (nextNodeId) {
          startTransition(() => {
            setSelectedNodeId(nextNodeId);
          });
        }
      },
    }),
    [],
  );

  async function handleAnalyze(): Promise<void> {
    setLoading(true);
    setError(null);
    setStatus("Scanning DuckDB for correlation and determinant-style signals.");

    try {
      const nextResult = await loadDependencyGraph(tableName, columns);
      startTransition(() => {
        setResult(nextResult);
        setSelectedNodeId(nextResult.nodes[0]?.id ?? null);
        setStatus(
          `Dependency graph ready with ${formatNumber(nextResult.nodes.length)} columns and ${formatNumber(nextResult.edges.length)} links.`,
        );
      });
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Unable to analyze column dependencies.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleExport(): void {
    if (!result || result.edges.length === 0) {
      return;
    }

    const lines = [
      "source,target,signal,strength,label,detail",
      ...result.edges.map(
        (edge) =>
          [
            edge.source,
            edge.target,
            edge.signal,
            edge.strength,
            edge.label,
            edge.detail,
          ]
            .map(csvEscape)
            .join(","),
      ),
    ];

    downloadFile(
      lines.join("\n"),
      `${tableName}-dependency-graph.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  if (columns.length < 2) {
    return (
      <EmptyState message="Add at least two profiled columns before building a dependency graph." />
    );
  }

  return (
    <section className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
            <Network className="h-3.5 w-3.5" />
            Dependency graph
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
            Visualize inferred column relationships
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            DataLens combines uniqueness-driven determinant checks with numeric correlation to
            suggest dependencies worth validating downstream.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <SummaryCard
            icon={Database}
            label="Columns"
            value={result ? formatNumber(result.nodes.length) : formatNumber(columns.length)}
          />
          <SummaryCard
            icon={Link2}
            label="Links"
            value={result ? formatNumber(result.edges.length) : "—"}
          />
          <SummaryCard
            icon={Sigma}
            label="Strongest"
            value={result ? formatPercent(result.strongestStrength * 100, 0) : "—"}
          />
          <SummaryCard
            icon={KeyRound}
            label="Rows scanned"
            value={result ? formatNumber(result.rowCount) : "—"}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <Sigma className="h-4 w-4 text-cyan-500" />
            Graph controls
          </div>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Minimum dependency strength
            </span>
            <input
              type="range"
              min={30}
              max={100}
              step={5}
              value={minimumStrengthPercent}
              onChange={(event) =>
                startTransition(() => {
                  setMinimumStrengthPercent(Number(event.target.value));
                })
              }
              className="w-full accent-cyan-500"
            />
            <div className="mt-2 flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
              <span>{minimumStrengthPercent}%</span>
              <span>{filteredEdges.length} visible links</span>
            </div>
          </label>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                void handleAnalyze();
              }}
              disabled={loading}
              className={BUTTON_CLASS}
            >
              <Network className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Analyze dependencies
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!result || result.edges.length === 0}
              className={BUTTON_CLASS}
            >
              <Download className="h-4 w-4" />
              Export results
            </button>
          </div>

          <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {status}
          </p>
          {result?.trimmedColumns ? (
            <p className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              Analyzed the first {MAX_ANALYSIS_COLUMNS} columns to keep the graph readable.
            </p>
          ) : null}
          {error ? (
            <p className="mt-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </p>
          ) : null}
        </div>

        <div className="grid gap-5">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
            className={`${GLASS_CARD_CLASS} p-5`}
          >
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Graph view
                </h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Click a node inside the graph or from the list below to inspect its details.
                </p>
              </div>
            </div>
            <ReactEChartsCore
              echarts={echarts}
              option={chartOption}
              onEvents={chartEvents}
              notMerge
              lazyUpdate
              style={{ height: 420 }}
            />

            <div className="mt-5 flex flex-wrap gap-2">
              {visibleNodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => {
                    startTransition(() => {
                      setSelectedNodeId(node.id);
                    });
                  }}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    resolvedSelectedNode?.id === node.id
                      ? "border-cyan-400 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                      : "border-white/20 bg-white/70 text-slate-700 dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-200"
                  }`}
                >
                  {node.id}
                </button>
              ))}
            </div>
          </motion.div>

          <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
              className={`${GLASS_CARD_CLASS} p-5`}
            >
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Node details
              </h3>
              {resolvedSelectedNode ? (
                <div className="mt-4 space-y-4 text-sm text-slate-600 dark:text-slate-300">
                  <div>
                    <p className="text-lg font-semibold text-slate-950 dark:text-white">
                      {resolvedSelectedNode.id}
                    </p>
                    <p className="mt-1">Type: {resolvedSelectedNode.type}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/20 bg-white/60 p-3 dark:border-white/10 dark:bg-slate-900/45">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Uniqueness
                      </p>
                      <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                        {formatPercent(resolvedSelectedNode.uniquenessRatio * 100, 0)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/20 bg-white/60 p-3 dark:border-white/10 dark:bg-slate-900/45">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Null count
                      </p>
                      <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                        {formatNumber(resolvedSelectedNode.nullCount)}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Sample values
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {resolvedSelectedNode.sampleValues.map((value) => (
                        <span
                          key={`${resolvedSelectedNode.id}-${value}`}
                          className="rounded-full border border-white/20 bg-white/70 px-3 py-1 text-xs dark:border-white/10 dark:bg-slate-900/45"
                        >
                          {value}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
                  Run the graph analysis to inspect node details.
                </p>
              )}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
              className={`${GLASS_CARD_CLASS} overflow-hidden`}
            >
              <div className="border-b border-white/10 px-5 py-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Edges above filter
                </h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {resolvedSelectedNode
                    ? `Showing links connected to ${resolvedSelectedNode.id}.`
                    : "Run the graph analysis to inspect inferred links."}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-white/55 dark:bg-slate-900/55">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">
                        Edge
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">
                        Signal
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">
                        Strength
                      </th>
                      <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">
                        Detail
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedNodeEdges.map((edge) => (
                      <tr key={edge.id} className="border-t border-white/10">
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                          {edge.source} → {edge.target}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                          {edge.signal}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                          {formatPercent(edge.strength * 100, 0)}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                          {edge.detail}
                        </td>
                      </tr>
                    ))}
                    {selectedNodeEdges.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-4 py-6 text-sm text-slate-600 dark:text-slate-300"
                        >
                          No edges meet the current strength filter.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
