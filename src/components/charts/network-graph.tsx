"use client";

import {
  Suspense,
  startTransition,
  use,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { GraphChart as EChartsGraphChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  CircleDot,
  Download,
  GitBranchPlus,
  Network,
  Share2,
} from "lucide-react";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  dataUrlToBytes,
  isRecord,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([EChartsGraphChart, TooltipComponent, CanvasRenderer]);

interface NetworkGraphProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface NetworkLink {
  source: string;
  target: string;
  value: number;
}

interface NetworkNode {
  id: string;
  name: string;
  degree: number;
  neighborCount: number;
  symbolSize: number;
}

interface NetworkSummary {
  nodes: NetworkNode[];
  links: NetworkLink[];
  strongestNode: NetworkNode | null;
  edgeMetricLabel: string;
  error: string | null;
}

const NETWORK_COLORS = [
  "#22d3ee",
  "#0ea5e9",
  "#34d399",
  "#f59e0b",
  "#f97316",
  "#a78bfa",
] as const;

function NetworkGraphLoading() {
  return (
    <div className={`${GLASS_PANEL_CLASS} flex min-h-[32rem] items-center justify-center`}>
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Building network graph…
      </div>
    </div>
  );
}

function NetworkGraphEmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <Network className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Network Graph
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {message}
          </p>
        </div>
      </div>
    </section>
  );
}

function isCategoricalColumn(column: ColumnProfile) {
  return column.type === "string" || column.type === "boolean" || column.type === "date";
}

function getStringValue(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function buildAdjacencyMap(links: NetworkLink[]) {
  const adjacency = new Map<string, Set<string>>();

  for (const link of links) {
    if (!adjacency.has(link.source)) {
      adjacency.set(link.source, new Set<string>());
    }
    if (!adjacency.has(link.target)) {
      adjacency.set(link.target, new Set<string>());
    }

    adjacency.get(link.source)?.add(link.target);
    adjacency.get(link.target)?.add(link.source);
  }

  return adjacency;
}

async function loadNetworkGraph(
  tableName: string,
  sourceColumn: string,
  targetColumn: string,
  weightColumn: string,
): Promise<NetworkSummary> {
  if (!sourceColumn || !targetColumn) {
    return {
      nodes: [],
      links: [],
      strongestNode: null,
      edgeMetricLabel: "Row count",
      error: "Choose two categorical columns to build the network.",
    };
  }

  const useRowCount = weightColumn === "__count__";
  const safeSource = quoteIdentifier(sourceColumn);
  const safeTarget = quoteIdentifier(targetColumn);
  const safeTable = quoteIdentifier(tableName);
  const metricLabel = useRowCount ? "Row count" : `SUM(${weightColumn})`;
  const metricProjection = useRowCount
    ? "COUNT(*)"
    : `SUM(TRY_CAST(${quoteIdentifier(weightColumn)} AS DOUBLE))`;
  const metricFilter = useRowCount
    ? ""
    : `AND TRY_CAST(${quoteIdentifier(weightColumn)} AS DOUBLE) IS NOT NULL`;

  const rows = await runQuery(`
    SELECT
      CAST(${safeSource} AS VARCHAR) AS source_name,
      CAST(${safeTarget} AS VARCHAR) AS target_name,
      ${metricProjection} AS edge_value
    FROM ${safeTable}
    WHERE ${safeSource} IS NOT NULL
      AND ${safeTarget} IS NOT NULL
      ${metricFilter}
    GROUP BY 1, 2
    HAVING ${metricProjection} IS NOT NULL
    ORDER BY edge_value DESC, source_name, target_name
    LIMIT 180
  `);

  const links = rows.flatMap<NetworkLink>((row) => {
    const source = getStringValue(row.source_name);
    const target = getStringValue(row.target_name);
    const value = toNumber(row.edge_value);

    if (source === null || target === null || value === null || value <= 0) {
      return [];
    }

    return [{ source, target, value }];
  });

  if (links.length === 0) {
    return {
      nodes: [],
      links: [],
      strongestNode: null,
      edgeMetricLabel: metricLabel,
      error: "No relationships were found for the selected columns.",
    };
  }

  const degreeByNode = new Map<string, number>();
  const neighborSetByNode = new Map<string, Set<string>>();

  for (const link of links) {
    degreeByNode.set(link.source, (degreeByNode.get(link.source) ?? 0) + link.value);
    degreeByNode.set(link.target, (degreeByNode.get(link.target) ?? 0) + link.value);

    if (!neighborSetByNode.has(link.source)) {
      neighborSetByNode.set(link.source, new Set<string>());
    }
    if (!neighborSetByNode.has(link.target)) {
      neighborSetByNode.set(link.target, new Set<string>());
    }

    neighborSetByNode.get(link.source)?.add(link.target);
    neighborSetByNode.get(link.target)?.add(link.source);
  }

  const maxDegree = Math.max(...degreeByNode.values(), 1);
  const nodes = Array.from(degreeByNode.entries())
    .map<NetworkNode>((entry) => {
      const [name, degree] = entry;
      const neighborCount = neighborSetByNode.get(name)?.size ?? 0;
      const scale = Math.sqrt(degree / maxDegree);

      return {
        id: name,
        name,
        degree,
        neighborCount,
        symbolSize: 18 + scale * 34,
      };
    })
    .sort((left, right) => right.degree - left.degree || left.name.localeCompare(right.name));

  return {
    nodes,
    links,
    strongestNode: nodes[0] ?? null,
    edgeMetricLabel: metricLabel,
    error: null,
  };
}

function buildNetworkOption(
  result: NetworkSummary,
  dark: boolean,
  selectedNode: string | null,
): EChartsOption {
  const adjacency = buildAdjacencyMap(result.links);
  const activeSet = selectedNode
    ? new Set([selectedNode, ...(adjacency.get(selectedNode) ?? new Set<string>())])
    : null;
  const maxDegree = Math.max(...result.nodes.map((node) => node.degree), 1);
  const textColor = dark ? "#e2e8f0" : "#0f172a";
  const borderColor = dark ? "#334155" : "#cbd5e1";

  return {
    animationDuration: 600,
    tooltip: {
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: textColor },
      formatter: (params: unknown) => {
        const item = Array.isArray(params) ? params[0] : params;
        if (!isRecord(item)) {
          return "Network point";
        }

        if (item.dataType === "edge" && isRecord(item.data)) {
          const source = getStringValue(item.data.source) ?? "";
          const target = getStringValue(item.data.target) ?? "";
          const value = toNumber(item.data.value) ?? 0;

          return [
            `<strong>${source}</strong> → <strong>${target}</strong>`,
            `Weight: ${formatNumber(value)}`,
          ].join("<br/>");
        }

        if (isRecord(item.data)) {
          const degree = toNumber(item.data.degree) ?? 0;
          const neighborCount = toNumber(item.data.neighborCount) ?? 0;

          return [
            `<strong>${getStringValue(item.data.name) ?? "Node"}</strong>`,
            `Weighted degree: ${formatNumber(degree)}`,
            `Neighbors: ${formatNumber(neighborCount)}`,
          ].join("<br/>");
        }

        return "Network point";
      },
    },
    series: [
      {
        type: "graph",
        layout: "force",
        roam: true,
        draggable: false,
        force: {
          repulsion: 180,
          gravity: 0.12,
          edgeLength: [56, 150] as const,
        },
        emphasis: {
          focus: "adjacency",
        },
        label: {
          show: true,
          position: "right",
          color: textColor,
          fontSize: 12,
        },
        lineStyle: {
          curveness: 0.18,
          opacity: 0.42,
        },
        data: result.nodes.map((node, index) => {
          const isActive = selectedNode === node.id;
          const isRelated = activeSet?.has(node.id) ?? true;
          const intensity = maxDegree === 0 ? 0 : node.degree / maxDegree;

          return {
            id: node.id,
            name: node.name,
            degree: node.degree,
            neighborCount: node.neighborCount,
            symbolSize: node.symbolSize,
            itemStyle: {
              color: NETWORK_COLORS[index % NETWORK_COLORS.length],
              opacity: isRelated ? 0.94 : 0.24,
              borderColor: isActive ? "#f8fafc" : dark ? "#0f172a" : "#ffffff",
              borderWidth: isActive ? 3 : 1 + intensity,
              shadowBlur: isActive ? 24 : 10,
              shadowColor: isActive
                ? dark
                  ? "rgba(34,211,238,0.55)"
                  : "rgba(14,165,233,0.35)"
                : "rgba(15,23,42,0.18)",
            },
          };
        }),
        links: result.links.map((link) => {
          const isRelated =
            activeSet === null ||
            activeSet.has(link.source) ||
            activeSet.has(link.target);
          const opacity = isRelated ? 0.46 : 0.12;
          const width = 1.5 + Math.min(Math.sqrt(link.value), 8);

          return {
            ...link,
            lineStyle: {
              opacity,
              width,
            },
          };
        }),
      },
    ],
  };
}

function exportGraphPng(chartRef: ReactEChartsCore | null, fileName: string, dark: boolean) {
  const instance = chartRef?.getEchartsInstance();
  if (!instance) return;

  const dataUrl = instance.getDataURL({
    type: "png",
    pixelRatio: 2,
    backgroundColor: dark ? "#020617" : "#f8fafc",
  });
  const output = dataUrlToBytes(dataUrl);

  downloadFile([output.bytes], fileName, output.mimeType);
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Network;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">{value}</div>
    </div>
  );
}

function NetworkGraphReady({ tableName, columns }: NetworkGraphProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const dimensionColumns = useMemo(
    () => columns.filter(isCategoricalColumn),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [sourceColumn, setSourceColumn] = useState(dimensionColumns[0]?.name ?? "");
  const [targetColumn, setTargetColumn] = useState(
    dimensionColumns[1]?.name ?? dimensionColumns[0]?.name ?? "",
  );
  const [weightColumn, setWeightColumn] = useState<string>("__count__");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const safeSource = dimensionColumns.some((column) => column.name === sourceColumn)
    ? sourceColumn
    : dimensionColumns[0]?.name ?? "";
  const safeTarget = dimensionColumns.some((column) => column.name === targetColumn)
    ? targetColumn
    : dimensionColumns[1]?.name ?? dimensionColumns[0]?.name ?? "";
  const safeWeight =
    weightColumn === "__count__" ||
    numericColumns.some((column) => column.name === weightColumn)
      ? weightColumn
      : "__count__";

  const resource = useMemo(
    () =>
      loadNetworkGraph(tableName, safeSource, safeTarget, safeWeight).catch((error) => ({
        nodes: [],
        links: [],
        strongestNode: null,
        edgeMetricLabel: safeWeight === "__count__" ? "Row count" : `SUM(${safeWeight})`,
        error: error instanceof Error ? error.message : "Unable to build the network graph.",
      })),
    [safeSource, safeTarget, safeWeight, tableName],
  );

  const result = use(resource);
  const safeSelectedNode = result.nodes.some((node) => node.id === selectedNode)
    ? selectedNode
    : null;
  const adjacency = useMemo(() => buildAdjacencyMap(result.links), [result.links]);
  const option = useMemo(
    () => buildNetworkOption(result, dark, safeSelectedNode),
    [dark, result, safeSelectedNode],
  );
  const selectedNeighbors = safeSelectedNode
    ? Array.from(adjacency.get(safeSelectedNode) ?? []).sort((left, right) =>
        left.localeCompare(right),
      )
    : [];

  const chartEvents = useMemo<Record<string, (params: unknown) => void>>(
    () => ({
      click: (params: unknown) => {
        if (!isRecord(params) || params.dataType !== "node") {
          return;
        }

        const candidate = getStringValue(params.name);
        if (candidate === null) {
          return;
        }

        startTransition(() => {
          setSelectedNode((current) => (current === candidate ? null : candidate));
        });
      },
    }),
    [],
  );

  if (dimensionColumns.length < 2) {
    return (
      <NetworkGraphEmptyState message="At least two categorical columns are required to derive source and target nodes." />
    );
  }

  return (
    <div className="space-y-5">
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: ANALYTICS_EASE }}
        className={`${GLASS_PANEL_CLASS} p-5`}
      >
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
                <Network className="h-3.5 w-3.5" />
                Force-directed graph
              </div>
              <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                Explore connected entities across categorical fields
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                DuckDB aggregates repeated edges, node size follows weighted degree,
                and clicking a node isolates its local neighborhood.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-sm text-slate-600 dark:text-slate-300">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Source column
                </span>
                <select
                  aria-label="Source column"
                  value={safeSource}
                  onChange={(event) =>
                    startTransition(() => setSourceColumn(event.target.value))
                  }
                  className={FIELD_CLASS}
                >
                  {dimensionColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-slate-600 dark:text-slate-300">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Target column
                </span>
                <select
                  aria-label="Target column"
                  value={safeTarget}
                  onChange={(event) =>
                    startTransition(() => setTargetColumn(event.target.value))
                  }
                  className={FIELD_CLASS}
                >
                  {dimensionColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-slate-600 dark:text-slate-300">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Edge metric
                </span>
                <select
                  aria-label="Edge metric"
                  value={safeWeight}
                  onChange={(event) =>
                    startTransition(() => setWeightColumn(event.target.value))
                  }
                  className={FIELD_CLASS}
                >
                  <option value="__count__">Row count</option>
                  {numericColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      SUM({column.name})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <MetricCard
              label="Nodes"
              value={formatNumber(result.nodes.length)}
              icon={CircleDot}
            />
            <MetricCard
              label="Edges"
              value={formatNumber(result.links.length)}
              icon={GitBranchPlus}
            />
            <MetricCard
              label="Densest node"
              value={result.strongestNode?.name ?? "—"}
              icon={Share2}
            />
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: ANALYTICS_EASE }}
        className={`${GLASS_PANEL_CLASS} p-5`}
      >
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Relationship map
            </div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Edge weights currently reflect {result.edgeMetricLabel.toLowerCase()}.
            </div>
          </div>

          <button
            type="button"
            aria-label="Export network graph PNG"
            onClick={() => exportGraphPng(chartRef.current, `${tableName}-network-graph.png`, dark)}
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export PNG
          </button>
        </div>

        {result.error ? (
          <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 px-4 py-5 text-sm text-rose-700 dark:text-rose-300">
            {result.error}
          </div>
        ) : (
          <ReactEChartsCore
            ref={chartRef}
            echarts={echarts}
            option={option}
            onEvents={chartEvents}
            notMerge
            lazyUpdate
            style={{ height: 560 }}
          />
        )}
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.48, ease: ANALYTICS_EASE }}
        className={`${GLASS_PANEL_CLASS} p-5`}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
              {safeSelectedNode ? `Focus: ${safeSelectedNode}` : "Selection details"}
            </h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {safeSelectedNode
                ? "Highlighted neighbors stay fully opaque while the rest of the network dims."
                : "Click a node inside the graph to isolate its direct neighborhood."}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[0.42fr_0.58fr]">
          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Selected node
            </div>
            <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              {safeSelectedNode ?? "None"}
            </div>
            <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {safeSelectedNode
                ? `${formatNumber(selectedNeighbors.length)} direct connections`
                : "Choose a node to inspect its local graph."}
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} p-4`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Connected neighbors
            </div>
            {selectedNeighbors.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedNeighbors.map((neighbor) => (
                  <span
                    key={neighbor}
                    className="rounded-full border border-white/20 bg-white/70 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-950/45 dark:text-slate-200"
                  >
                    {neighbor}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                {safeSelectedNode ? "This node has no other visible neighbors." : "No node selected yet."}
              </div>
            )}
          </div>
        </div>
      </motion.section>
    </div>
  );
}

export default function NetworkGraph({ tableName, columns }: NetworkGraphProps) {
  return (
    <Suspense fallback={<NetworkGraphLoading />}>
      <NetworkGraphReady tableName={tableName} columns={columns} />
    </Suspense>
  );
}
