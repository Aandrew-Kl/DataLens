"use client";

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ElementType,
} from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowRightLeft,
  GitBranch,
  Link2,
  Network,
  ScanSearch,
  Sigma,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile, ColumnType } from "@/types/dataset";

interface RelationshipExplorerProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
}

interface CandidateEdge {
  id: string;
  source: string;
  target: string;
  reasons: string[];
  correlation: number | null;
  pairCount: number;
}

interface RelationshipEdge extends CandidateEdge {
  strength: number;
  sharedValueCount: number;
  joinCardinality: string;
  dependencies: string[];
}

interface GraphNode {
  id: string;
  name: string;
  type: ColumnType;
  completeness: number;
  degree: number;
}

interface LoadState {
  key: string;
  nodes: GraphNode[];
  edges: RelationshipEdge[];
  error: string | null;
}

const EASE = [0.22, 1, 0.36, 1] as const;

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function toNumber(value: unknown) {
  const parsed = value == null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function darkModeSubscribe(onStoreChange: () => void) {
  if (typeof document === "undefined") return () => undefined;
  const root = document.documentElement;
  const observer = new MutationObserver(onStoreChange);
  observer.observe(root, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function getDarkModeSnapshot() {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

function useDarkMode() {
  return useSyncExternalStore(darkModeSubscribe, getDarkModeSnapshot, () => false);
}

function edgeId(source: string, target: string) {
  return [source, target].sort((left, right) => left.localeCompare(right)).join("::");
}

function normalizeName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function stripIdSuffix(name: string) {
  return normalizeName(name).replace(/ids?$/, "");
}

function detectNameMatches(columns: ColumnProfile[]) {
  const matches = new Map<string, CandidateEdge>();

  columns.forEach((left, leftIndex) => {
    columns.slice(leftIndex + 1).forEach((right) => {
      const leftNormalized = normalizeName(left.name);
      const rightNormalized = normalizeName(right.name);
      const leftBase = stripIdSuffix(left.name);
      const rightBase = stripIdSuffix(right.name);
      const leftIsIdLike = /(^id$|_id$|id$)/i.test(left.name);
      const rightIsIdLike = /(^id$|_id$|id$)/i.test(right.name);

      const shouldLink =
        (leftIsIdLike && rightIsIdLike && leftBase === rightBase && leftBase.length > 0) ||
        (leftNormalized === "id" && rightIsIdLike) ||
        (rightNormalized === "id" && leftIsIdLike) ||
        (leftBase.length > 0 && leftBase === rightBase && left.name !== right.name);

      if (!shouldLink) return;

      const id = edgeId(left.name, right.name);
      matches.set(id, {
        id,
        source: left.name,
        target: right.name,
        reasons: ["ID-style naming match"],
        correlation: null,
        pairCount: 0,
      });
    });
  });

  return matches;
}

function getJoinCardinality(leftMax: number, rightMax: number) {
  if (leftMax <= 1 && rightMax <= 1) return "one-to-one";
  if (leftMax <= 1 && rightMax > 1) return "one-to-many";
  if (leftMax > 1 && rightMax <= 1) return "many-to-one";
  return "many-to-many";
}

async function loadCandidateEdges(
  tableName: string,
  columns: ColumnProfile[],
): Promise<Map<string, CandidateEdge>> {
  const candidateMap = detectNameMatches(columns);
  const numericColumns = columns.filter((column) => column.type === "number");

  if (numericColumns.length > 1) {
    const table = quoteIdentifier(tableName);
    const correlationSql = numericColumns
      .flatMap((left, leftIndex) =>
        numericColumns.slice(leftIndex + 1).map((right) => `
          SELECT
            '${left.name.replace(/'/g, "''")}' AS source_name,
            '${right.name.replace(/'/g, "''")}' AS target_name,
            CORR(${quoteIdentifier(left.name)}, ${quoteIdentifier(right.name)}) AS correlation_value,
            COUNT(*) FILTER (
              WHERE ${quoteIdentifier(left.name)} IS NOT NULL
                AND ${quoteIdentifier(right.name)} IS NOT NULL
            ) AS pair_count
          FROM ${table}
        `),
      )
      .join(" UNION ALL ");

    const rows = await runQuery(correlationSql);
    rows.forEach((row) => {
      const source = String(row.source_name ?? "");
      const target = String(row.target_name ?? "");
      const correlation = toNumber(row.correlation_value);
      if (correlation == null || Math.abs(correlation) <= 0.5) return;

      const id = edgeId(source, target);
      const existing = candidateMap.get(id);
      candidateMap.set(id, {
        id,
        source,
        target,
        reasons: [
          ...(existing?.reasons ?? []),
          `Correlation ${correlation > 0 ? ">" : "<"} ${correlation > 0 ? "0.5" : "-0.5"}`,
        ],
        correlation,
        pairCount: toNumber(row.pair_count) ?? 0,
      });
    });
  }

  return candidateMap;
}

async function loadEdgeDetails(
  tableName: string,
  candidates: CandidateEdge[],
): Promise<RelationshipEdge[]> {
  if (candidates.length === 0) return [];
  const table = quoteIdentifier(tableName);

  const detailSql = candidates
    .map((candidate) => {
      const left = quoteIdentifier(candidate.source);
      const right = quoteIdentifier(candidate.target);
      return `
        WITH left_values AS (
          SELECT DISTINCT CAST(${left} AS VARCHAR) AS value
          FROM ${table}
          WHERE ${left} IS NOT NULL
        ),
        right_values AS (
          SELECT DISTINCT CAST(${right} AS VARCHAR) AS value
          FROM ${table}
          WHERE ${right} IS NOT NULL
        ),
        left_freq AS (
          SELECT COUNT(*) AS freq FROM ${table} WHERE ${left} IS NOT NULL GROUP BY ${left}
        ),
        right_freq AS (
          SELECT COUNT(*) AS freq FROM ${table} WHERE ${right} IS NOT NULL GROUP BY ${right}
        )
        SELECT
          '${candidate.id}' AS edge_id,
          (SELECT COUNT(*) FROM left_values JOIN right_values USING (value)) AS shared_value_count,
          COALESCE((SELECT MAX(freq) FROM left_freq), 0) AS left_max_frequency,
          COALESCE((SELECT MAX(freq) FROM right_freq), 0) AS right_max_frequency
      `;
    })
    .join(" UNION ALL ");

  const dependencySql = candidates
    .flatMap((candidate) => {
      const sourceField = quoteIdentifier(candidate.source);
      const targetField = quoteIdentifier(candidate.target);
      return [
        `
          SELECT
            '${candidate.id}' AS edge_id,
            '${candidate.source.replace(/'/g, "''")}' AS determinant_name,
            '${candidate.target.replace(/'/g, "''")}' AS dependent_name,
            COUNT(*) FILTER (WHERE dependent_variants > 1) AS violating_groups,
            COUNT(*) AS determinant_groups
          FROM (
            SELECT ${sourceField} AS determinant_value, COUNT(DISTINCT ${targetField}) AS dependent_variants
            FROM ${table}
            WHERE ${sourceField} IS NOT NULL AND ${targetField} IS NOT NULL
            GROUP BY 1
          )
        `,
        `
          SELECT
            '${candidate.id}' AS edge_id,
            '${candidate.target.replace(/'/g, "''")}' AS determinant_name,
            '${candidate.source.replace(/'/g, "''")}' AS dependent_name,
            COUNT(*) FILTER (WHERE dependent_variants > 1) AS violating_groups,
            COUNT(*) AS determinant_groups
          FROM (
            SELECT ${targetField} AS determinant_value, COUNT(DISTINCT ${sourceField}) AS dependent_variants
            FROM ${table}
            WHERE ${targetField} IS NOT NULL AND ${sourceField} IS NOT NULL
            GROUP BY 1
          )
        `,
      ];
    })
    .join(" UNION ALL ");

  const [detailRows, dependencyRows] = await Promise.all([
    runQuery(detailSql),
    runQuery(dependencySql),
  ]);

  const detailMap = new Map(
    detailRows.map((row) => [
      String(row.edge_id ?? ""),
      {
        sharedValueCount: toNumber(row.shared_value_count) ?? 0,
        leftMaxFrequency: toNumber(row.left_max_frequency) ?? 0,
        rightMaxFrequency: toNumber(row.right_max_frequency) ?? 0,
      },
    ]),
  );

  const dependencyMap = dependencyRows.reduce<Map<string, string[]>>((map, row) => {
    const id = String(row.edge_id ?? "");
    const violations = toNumber(row.violating_groups) ?? 0;
    const determinantGroups = toNumber(row.determinant_groups) ?? 0;
    if (violations !== 0 || determinantGroups <= 1) return map;
    const label = `${String(row.determinant_name ?? "")} \u2192 ${String(row.dependent_name ?? "")}`;
    const current = map.get(id) ?? [];
    current.push(label);
    map.set(id, current);
    return map;
  }, new Map<string, string[]>());

  return candidates.map((candidate) => {
    const detail = detailMap.get(candidate.id);
    const dependencies = dependencyMap.get(candidate.id) ?? [];
    const sharedValueCount = detail?.sharedValueCount ?? 0;
    const joinCardinality = getJoinCardinality(detail?.leftMaxFrequency ?? 0, detail?.rightMaxFrequency ?? 0);
    const strength = Math.max(
      Math.abs(candidate.correlation ?? 0),
      candidate.reasons.some((reason) => reason.includes("ID-style")) ? 0.7 : 0,
      dependencies.length > 0 ? 0.8 : 0.55,
    );

    return {
      ...candidate,
      strength,
      sharedValueCount,
      joinCardinality,
      dependencies,
    };
  });
}

function buildGraphOption(
  nodes: GraphNode[],
  edges: RelationshipEdge[],
  dark: boolean,
  activeNodeId: string | null,
  activeEdgeId: string | null,
): EChartsOption {
  const activeNeighbors = new Set<string>();
  edges.forEach((edge) => {
    if (edge.id === activeEdgeId || edge.source === activeNodeId || edge.target === activeNodeId) {
      activeNeighbors.add(edge.source);
      activeNeighbors.add(edge.target);
    }
  });

  return {
    animationDuration: 420,
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#1e293b" : "#dbe4f0",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
    },
    series: [
      {
        type: "graph",
        layout: "force",
        roam: true,
        draggable: true,
        focusNodeAdjacency: true,
        force: { repulsion: 260, edgeLength: 160, gravity: 0.08 },
        label: {
          show: true,
          position: "right",
          color: dark ? "#e2e8f0" : "#0f172a",
        },
        categories: [
          { name: "number" },
          { name: "string" },
          { name: "date" },
          { name: "boolean" },
          { name: "unknown" },
        ],
        data: nodes.map((node) => ({
          id: node.id,
          name: node.name,
          value: node.degree,
          category: node.type,
          symbolSize: 18 + node.completeness * 18 + node.degree * 2,
          itemStyle: {
            color:
              node.type === "number"
                ? "#38bdf8"
                : node.type === "string"
                  ? "#a855f7"
                  : node.type === "date"
                    ? "#34d399"
                    : node.type === "boolean"
                      ? "#f59e0b"
                      : "#94a3b8",
            opacity:
              activeNodeId && node.id !== activeNodeId && !activeNeighbors.has(node.id) ? 0.26 : 0.95,
          },
        })),
        links: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          value: edge.strength,
          lineStyle: {
            width: 1 + edge.strength * 5,
            color:
              edge.reasons.some((reason) => reason.includes("ID-style"))
                ? "rgba(251,191,36,0.82)"
                : (edge.correlation ?? 0) >= 0
                  ? "rgba(56,189,248,0.78)"
                  : "rgba(244,114,182,0.78)",
            opacity:
              activeEdgeId && edge.id !== activeEdgeId
                ? 0.16
                : activeNodeId && edge.source !== activeNodeId && edge.target !== activeNodeId
                  ? 0.16
                  : 0.92,
          },
        })),
      },
    ],
  };
}

function InfoCard({
  icon: Icon,
  label,
  value,
}: {
  icon: ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/20 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-slate-900/45">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">{value}</p>
    </div>
  );
}

export default function RelationshipExplorer({
  tableName,
  columns,
  rowCount,
}: RelationshipExplorerProps) {
  const dark = useDarkMode();
  const requestKey = useMemo(
    () => JSON.stringify({ tableName, rowCount, columns }),
    [columns, rowCount, tableName],
  );

  const [loadState, setLoadState] = useState<LoadState>({
    key: "",
    nodes: [],
    edges: [],
    error: null,
  });
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const candidates = await loadCandidateEdges(tableName, columns);
        const edges = await loadEdgeDetails(tableName, Array.from(candidates.values()));
        const degreeMap = edges.reduce<Map<string, number>>((map, edge) => {
          map.set(edge.source, (map.get(edge.source) ?? 0) + 1);
          map.set(edge.target, (map.get(edge.target) ?? 0) + 1);
          return map;
        }, new Map<string, number>());

        const nodes: GraphNode[] = columns.map((column) => ({
          id: column.name,
          name: column.name,
          type: column.type,
          completeness: rowCount > 0 ? 1 - column.nullCount / rowCount : 1,
          degree: degreeMap.get(column.name) ?? 0,
        }));

        if (cancelled) return;
        setLoadState({ key: requestKey, nodes, edges, error: null });
      } catch (error) {
        if (cancelled) return;
        setLoadState({
          key: requestKey,
          nodes: [],
          edges: [],
          error: error instanceof Error ? error.message : "Failed to discover relationships.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [columns, requestKey, rowCount, tableName]);

  const nodes = useMemo(
    () => (loadState.key === requestKey ? loadState.nodes : []),
    [loadState.key, loadState.nodes, requestKey],
  );
  const edges = useMemo(
    () => (loadState.key === requestKey ? loadState.edges : []),
    [loadState.edges, loadState.key, requestKey],
  );
  const loading = loadState.key !== requestKey;

  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === activeEdgeId) ?? edges[0] ?? null,
    [activeEdgeId, edges],
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === activeNodeId) ?? null,
    [activeNodeId, nodes],
  );

  const nodeConnections = useMemo(
    () => edges.filter((edge) => edge.source === activeNodeId || edge.target === activeNodeId),
    [activeNodeId, edges],
  );

  const chartEvents = useMemo(
    () => ({
      click: (params: { dataType?: string; data?: { id?: string }; name?: string }) => {
        if (params.dataType === "node") {
          const id = String(params.data?.id ?? params.name ?? "");
          setActiveNodeId(id);
          setActiveEdgeId(null);
        }
        if (params.dataType === "edge") {
          const id = String(params.data?.id ?? "");
          setActiveEdgeId(id);
          setActiveNodeId(null);
        }
      },
    }),
    [],
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="rounded-[2rem] border border-white/20 bg-white/70 p-6 shadow-xl shadow-slate-950/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45"
    >
      <div className="flex flex-col gap-4 border-b border-slate-200/70 pb-5 dark:border-slate-800/70 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-600 dark:text-cyan-400">
            Relationship Explorer
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            Structural signals across {columns.length} columns
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Edges appear when column names suggest key relationships or numeric fields show correlation stronger than 0.5.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-2.5 text-sm text-cyan-700 dark:border-cyan-400/10 dark:text-cyan-200">
          <Network className="h-4 w-4" />
          {loading ? "Scanning…" : `${formatNumber(edges.length)} relationships`}
        </div>
      </div>

      {loading ? (
        <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
          <div className="h-[520px] animate-pulse rounded-[1.75rem] border border-white/20 bg-slate-200/60 dark:border-white/10 dark:bg-slate-800/40" />
          <div className="h-[520px] animate-pulse rounded-[1.75rem] border border-white/20 bg-slate-200/60 dark:border-white/10 dark:bg-slate-800/40" />
        </div>
      ) : loadState.error ? (
        <div className="mt-6 rounded-[1.75rem] border border-rose-300/30 bg-rose-500/10 p-5 dark:border-rose-500/20 dark:bg-rose-500/10">
          <p className="text-sm text-rose-700 dark:text-rose-300">{loadState.error}</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
          <div className="rounded-[1.75rem] border border-white/20 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-slate-900/45">
            {edges.length > 0 ? (
              <ReactECharts
                option={buildGraphOption(nodes, edges, dark, activeNodeId, activeEdgeId)}
                onEvents={chartEvents}
                style={{ height: 520, width: "100%" }}
              />
            ) : (
              <div className="flex h-[520px] flex-col items-center justify-center gap-3 text-center">
                <ScanSearch className="h-6 w-6 text-slate-400" />
                <p className="text-lg font-semibold text-slate-950 dark:text-white">No strong relationships detected</p>
                <p className="max-w-md text-sm text-slate-600 dark:text-slate-300">
                  Try adding more numeric columns or key-like fields such as `id`, `customer_id`, or `order_id`.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <InfoCard icon={Link2} label="Edges" value={formatNumber(edges.length)} />
              <InfoCard icon={Sigma} label="Numeric Correlations" value={formatNumber(edges.filter((edge) => edge.correlation != null).length)} />
              <InfoCard icon={GitBranch} label="Functional Dependencies" value={formatNumber(edges.reduce((sum, edge) => sum + edge.dependencies.length, 0))} />
            </div>

            {selectedNode ? (
              <div className="rounded-[1.75rem] border border-white/20 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-slate-900/45">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-cyan-500/15 p-3 text-cyan-700 dark:text-cyan-300">
                    <Network className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      Selected Node
                    </p>
                    <h3 className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                      {selectedNode.name}
                    </h3>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <InfoCard icon={Activity} label="Completeness" value={`${Math.round(selectedNode.completeness * 100)}%`} />
                  <InfoCard icon={ArrowRightLeft} label="Connections" value={formatNumber(nodeConnections.length)} />
                </div>
                <div className="mt-4 space-y-2">
                  {nodeConnections.length > 0 ? nodeConnections.map((edge) => (
                    <button
                      key={edge.id}
                      type="button"
                      onClick={() => {
                        setActiveEdgeId(edge.id);
                        setActiveNodeId(null);
                      }}
                      className="w-full rounded-2xl border border-white/20 bg-white/70 px-4 py-3 text-left transition hover:border-cyan-300 dark:border-white/10 dark:bg-slate-950/50 dark:hover:border-cyan-500/40"
                    >
                      <p className="font-medium text-slate-950 dark:text-white">
                        {edge.source} ↔ {edge.target}
                      </p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {edge.reasons.join(" · ")}
                      </p>
                    </button>
                  )) : (
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      This column has no currently highlighted relationships.
                    </p>
                  )}
                </div>
              </div>
            ) : selectedEdge ? (
              <div className="rounded-[1.75rem] border border-white/20 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-slate-900/45">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-cyan-500/15 p-3 text-cyan-700 dark:text-cyan-300">
                    <Link2 className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      Relationship Detail
                    </p>
                    <h3 className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">
                      {selectedEdge.source} ↔ {selectedEdge.target}
                    </h3>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <InfoCard
                    icon={Sigma}
                    label="Correlation"
                    value={selectedEdge.correlation == null ? "n/a" : selectedEdge.correlation.toFixed(3)}
                  />
                  <InfoCard icon={Link2} label="Shared Values" value={formatNumber(selectedEdge.sharedValueCount)} />
                  <InfoCard icon={ArrowRightLeft} label="Join Cardinality" value={selectedEdge.joinCardinality} />
                  <InfoCard icon={Activity} label="Pair Count" value={formatNumber(selectedEdge.pairCount)} />
                </div>

                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-white/20 bg-white/70 p-4 dark:border-white/10 dark:bg-slate-950/50">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Why this edge exists
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedEdge.reasons.map((reason) => (
                        <span
                          key={reason}
                          className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-700 dark:text-cyan-200"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/20 bg-white/70 p-4 dark:border-white/10 dark:bg-slate-950/50">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Functional dependencies
                    </p>
                    <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                      {selectedEdge.dependencies.length > 0 ? (
                        selectedEdge.dependencies.map((dependency) => (
                          <div key={dependency} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-900/60">
                            {dependency}
                          </div>
                        ))
                      ) : (
                        <p>No deterministic dependency was detected for this pair.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </motion.section>
  );
}
