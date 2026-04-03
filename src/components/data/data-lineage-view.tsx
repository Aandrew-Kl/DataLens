"use client";

import {
  Suspense,
  startTransition,
  use,
  useMemo,
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
  ArrowRight,
  Database,
  Download,
  GitBranchPlus,
  History,
  Network,
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
  toCount,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([EChartsGraphChart, TooltipComponent, CanvasRenderer]);

interface DataLineageViewProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface CatalogTable {
  tableName: string;
  columns: string[];
  rowCount: number;
}

interface LineageNode {
  id: string;
  role: "focus" | "upstream" | "downstream";
  rowCount: number;
  columnCount: number;
}

interface LineageLink {
  source: string;
  target: string;
  sharedColumns: string[];
  relationship: string;
  strength: number;
}

interface HistoryEntry {
  id: string;
  label: string;
  description: string;
  stage: "source" | "transform" | "publish";
}

interface LineageResult {
  nodes: LineageNode[];
  links: LineageLink[];
  history: HistoryEntry[];
  warning: string | null;
}

interface MetricCardProps {
  label: string;
  value: string;
  icon: typeof Network;
}

interface LineageReadyProps extends DataLineageViewProps {
  promise: Promise<LineageResult>;
}

const GRAPH_COLORS = {
  focus: "#06b6d4",
  upstream: "#8b5cf6",
  downstream: "#f59e0b",
} as const;

function readCatalogName(row: Record<string, unknown>) {
  const candidates = [
    row.name,
    row.table_name,
    row.tableName,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate;
    }
  }

  return null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim() !== "")));
}

function inferRole(focus: CatalogTable, related: CatalogTable, sharedColumns: string[]) {
  const normalizedFocus = focus.tableName.toLowerCase();
  const normalizedRelated = related.tableName.toLowerCase();

  if (normalizedFocus.includes(normalizedRelated) || related.rowCount <= focus.rowCount) {
    return "upstream" as const;
  }

  if (normalizedRelated.includes(normalizedFocus) || sharedColumns.length <= 1) {
    return "downstream" as const;
  }

  return "upstream" as const;
}

function buildHistory(
  tableName: string,
  focus: CatalogTable,
  links: LineageLink[],
) {
  const entries: HistoryEntry[] = [];

  links
    .filter((link) => link.target === tableName)
    .forEach((link, index) => {
      entries.push({
        id: `source-${index}`,
        label: `Source inferred from ${link.source}`,
        description: `${link.sharedColumns.length} shared columns suggest upstream reuse.`,
        stage: "source",
      });
    });

  const loweredName = tableName.toLowerCase();
  if (/(agg|rollup|summary)/.test(loweredName)) {
    entries.push({
      id: "transform-aggregate",
      label: "Aggregation detected",
      description: "Name pattern suggests grouped or rolled-up output.",
      stage: "transform",
    });
  }

  if (/(join|merge|union|append)/.test(loweredName)) {
    entries.push({
      id: "transform-merge",
      label: "Merge operation detected",
      description: "Name pattern suggests this table was built from more than one source.",
      stage: "transform",
    });
  }

  entries.push({
    id: "focus-snapshot",
    label: `Current table snapshot`,
    description: `${formatNumber(focus.rowCount)} rows across ${focus.columns.length} columns.`,
    stage: "transform",
  });

  links
    .filter((link) => link.source === tableName)
    .forEach((link, index) => {
      entries.push({
        id: `publish-${index}`,
        label: `Downstream propagation to ${link.target}`,
        description: `${link.sharedColumns.length} shared fields remain available downstream.`,
        stage: "publish",
      });
    });

  if (entries.length === 1) {
    entries.unshift({
      id: "catalog-only",
      label: "Catalog-only lineage",
      description: "No related tables were inferred, so this view is based on the current schema only.",
      stage: "source",
    });
  }

  return entries;
}

function buildGraphOption(
  result: LineageResult,
  dark: boolean,
  selectedNodeId: string,
): EChartsOption {
  const textColor = dark ? "#e2e8f0" : "#0f172a";
  const lineColor = dark ? "#64748b" : "#94a3b8";

  return {
    animationDuration: 520,
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: textColor },
      formatter: (params: unknown) => {
        if (!isRecord(params)) return "Lineage node";
        if (params.dataType === "edge" && isRecord(params.data)) {
          const sharedColumns = Array.isArray(params.data.sharedColumns)
            ? params.data.sharedColumns.map((value) => String(value))
            : [];
          return [
            `<strong>${String(params.data.source ?? "")} → ${String(params.data.target ?? "")}</strong>`,
            String(params.data.relationship ?? ""),
            `Shared columns: ${sharedColumns.join(", ") || "None"}`,
          ].join("<br/>");
        }

        if (isRecord(params.data)) {
          return [
            `<strong>${String(params.data.name ?? "")}</strong>`,
            `Rows: ${formatNumber(toCount(params.data.rowCount))}`,
            `Columns: ${formatNumber(toCount(params.data.columnCount))}`,
          ].join("<br/>");
        }

        return "Lineage node";
      },
    },
    series: [
      {
        type: "graph",
        layout: "force",
        roam: true,
        force: {
          repulsion: 260,
          edgeLength: 150,
        },
        label: {
          show: true,
          color: textColor,
        },
        lineStyle: {
          color: lineColor,
          opacity: 0.75,
          curveness: 0.18,
        },
        data: result.nodes.map((node) => ({
          id: node.id,
          name: node.id,
          rowCount: node.rowCount,
          columnCount: node.columnCount,
          symbolSize: node.id === selectedNodeId ? 78 : node.role === "focus" ? 70 : 58,
          itemStyle: {
            color: GRAPH_COLORS[node.role],
            borderColor: node.id === selectedNodeId ? "#ffffff" : "rgba(255,255,255,0.4)",
            borderWidth: node.id === selectedNodeId ? 3 : 1.5,
          },
        })),
        links: result.links.map((link) => ({
          source: link.source,
          target: link.target,
          relationship: link.relationship,
          sharedColumns: link.sharedColumns,
          lineStyle: {
            width: 1.5 + link.strength * 1.2,
          },
          label: {
            show: true,
            formatter: `${link.sharedColumns.length} shared`,
          },
        })),
      },
    ],
  };
}

async function loadCatalogTable(
  tableName: string,
  fallbackColumns: ColumnProfile[],
) {
  const [schemaRows, rowCountRows] = await Promise.all([
    runQuery(`DESCRIBE ${quoteIdentifier(tableName)}`),
    runQuery(`SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tableName)}`),
  ]);

  const columns = uniqueStrings(
    schemaRows
      .map((row) => {
        const value = row.column_name ?? row.name;
        return typeof value === "string" ? value : "";
      })
      .concat(
        tableName === "" ? [] : fallbackColumns.map((column) => column.name),
      ),
  );

  return {
    tableName,
    columns,
    rowCount: toCount(rowCountRows[0]?.row_count),
  } satisfies CatalogTable;
}

async function loadLineage(
  tableName: string,
  columns: ColumnProfile[],
): Promise<LineageResult> {
  try {
    const catalogRows = await runQuery("SHOW TABLES");
    const tableNames = uniqueStrings(
      catalogRows
        .filter(isRecord)
        .map(readCatalogName)
        .filter((value): value is string => value !== null)
        .concat(tableName),
    ).slice(0, 10);

    const tables = await Promise.all(
      tableNames.map((name) => loadCatalogTable(name, name === tableName ? columns : [])),
    );
    const focus = tables.find((entry) => entry.tableName === tableName) ?? {
      tableName,
      columns: columns.map((column) => column.name),
      rowCount: 0,
    };

    const focusColumnSet = new Set(focus.columns);
    const links = tables
      .filter((entry) => entry.tableName !== tableName)
      .map((entry) => {
        const sharedColumns = entry.columns.filter((column) => focusColumnSet.has(column));
        if (sharedColumns.length === 0) {
          return null;
        }

        const role = inferRole(focus, entry, sharedColumns);
        return {
          source: role === "upstream" ? entry.tableName : tableName,
          target: role === "upstream" ? tableName : entry.tableName,
          sharedColumns,
          relationship:
            role === "upstream"
              ? "Shared schema suggests an upstream dependency."
              : "Shared schema suggests a downstream derivative.",
          strength: Math.min(sharedColumns.length, 5),
        } satisfies LineageLink;
      })
      .filter((link): link is LineageLink => link !== null)
      .sort((left, right) => right.sharedColumns.length - left.sharedColumns.length)
      .slice(0, 8);

    const nodeRoleMap = new Map<string, LineageNode["role"]>([[tableName, "focus"]]);
    links.forEach((link) => {
      nodeRoleMap.set(link.source, link.source === tableName ? "focus" : "upstream");
      nodeRoleMap.set(link.target, link.target === tableName ? "focus" : "downstream");
    });

    const nodes = tables
      .filter((entry) => nodeRoleMap.has(entry.tableName))
      .map((entry) => ({
        id: entry.tableName,
        role: nodeRoleMap.get(entry.tableName) ?? "focus",
        rowCount: entry.rowCount,
        columnCount: entry.columns.length,
      }))
      .sort((left, right) => {
        if (left.role === "focus") return -1;
        if (right.role === "focus") return 1;
        return left.id.localeCompare(right.id);
      });

    return {
      nodes,
      links,
      history: buildHistory(tableName, focus, links),
      warning:
        links.length === 0
          ? "Lineage is inferred from the DuckDB catalog and shared columns."
          : null,
    };
  } catch (error) {
    return {
      nodes: [],
      links: [],
      history: [],
      warning: error instanceof Error ? error.message : "Lineage analysis failed.",
    };
  }
}

function MetricCard({ label, value, icon: Icon }: MetricCardProps) {
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

function LineageEmptyState({ message }: { message: string }) {
  return (
    <div className={`${GLASS_CARD_CLASS} flex min-h-[18rem] items-center justify-center p-6 text-sm text-slate-600 dark:text-slate-300`}>
      {message}
    </div>
  );
}

function readSelectedNodeId(params: unknown) {
  if (!isRecord(params)) return null;
  if (params.dataType !== "node") return null;
  const candidate = params.data;
  if (!isRecord(candidate)) return null;
  return typeof candidate.id === "string" ? candidate.id : null;
}

function LineageReady({
  tableName,
  columns,
  promise,
}: LineageReadyProps) {
  const dark = useDarkMode();
  const result = use(promise);
  const [selectedNodeId, setSelectedNodeId] = useState(tableName);

  const selectedNode =
    result.nodes.find((node) => node.id === selectedNodeId) ??
    result.nodes.find((node) => node.id === tableName) ??
    result.nodes[0] ??
    null;
  const selectedLinks = selectedNode
    ? result.links.filter(
        (link) => link.source === selectedNode.id || link.target === selectedNode.id,
      )
    : [];
  const graphOption = useMemo(
    () => buildGraphOption(result, dark, selectedNode?.id ?? tableName),
    [dark, result, selectedNode?.id, tableName],
  );

  async function handleExport() {
    await promise;
    downloadFile(
      JSON.stringify(
        {
          tableName,
          columns: columns.map((column) => column.name),
          lineage: result,
        },
        null,
        2,
      ),
      `${tableName}-lineage-map.json`,
      "application/json;charset=utf-8;",
    );
  }

  function handleGraphClick(params: unknown) {
    const nextId = readSelectedNodeId(params);
    if (!nextId) return;
    startTransition(() => {
      setSelectedNodeId(nextId);
    });
  }

  if (result.nodes.length === 0) {
    return <LineageEmptyState message={result.warning ?? "No lineage information is available."} />;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          label="Tables in graph"
          value={formatNumber(result.nodes.length)}
          icon={Database}
        />
        <MetricCard
          label="Relationships"
          value={formatNumber(result.links.length)}
          icon={GitBranchPlus}
        />
        <MetricCard
          label="History entries"
          value={formatNumber(result.history.length)}
          icon={History}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.95fr]">
        <div className={`${GLASS_CARD_CLASS} p-4`}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                Inferred lineage graph
              </h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Click a node to inspect its connected sources and descendants.
              </p>
            </div>
            <button type="button" className={BUTTON_CLASS} onClick={handleExport}>
              <Download className="h-4 w-4" />
              Export lineage map
            </button>
          </div>
          <ReactEChartsCore
            option={graphOption}
            style={{ height: 430 }}
            onEvents={{ click: handleGraphClick }}
          />
        </div>

        <div className="space-y-4">
          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Selected node
            </div>
            <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              {selectedNode?.id ?? tableName}
            </h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-950/5 px-4 py-3 dark:bg-white/5">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Rows
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                  {formatNumber(selectedNode?.rowCount ?? 0)}
                </div>
              </div>
              <div className="rounded-2xl bg-slate-950/5 px-4 py-3 dark:bg-white/5">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Connected edges
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                  {formatNumber(selectedLinks.length)}
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {selectedLinks.map((link) => (
                <div
                  key={`${link.source}-${link.target}`}
                  className="rounded-2xl border border-white/20 bg-white/50 px-4 py-3 text-sm text-slate-700 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-200"
                >
                  <div className="flex items-center gap-2 font-medium">
                    <span>{link.source}</span>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                    <span>{link.target}</span>
                  </div>
                  <div className="mt-1 text-slate-600 dark:text-slate-300">
                    {link.relationship}
                  </div>
                  <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Shared: {link.sharedColumns.join(", ")}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Transformation history
            </div>
            <div className="mt-4 space-y-3">
              {result.history.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-2xl border border-white/20 bg-white/50 px-4 py-3 dark:border-white/10 dark:bg-slate-950/35"
                >
                  <div className="text-sm font-semibold text-slate-950 dark:text-white">
                    {entry.label}
                  </div>
                  <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {entry.description}
                  </div>
                </div>
              ))}
            </div>
            {result.warning ? (
              <p className="mt-4 text-sm text-amber-700 dark:text-amber-300">{result.warning}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function LineageLoadingState() {
  return (
    <div className={`${GLASS_CARD_CLASS} flex min-h-[28rem] items-center justify-center p-6 text-sm text-slate-600 dark:text-slate-300`}>
      Mapping lineage graph…
    </div>
  );
}

export default function DataLineageView({
  tableName,
  columns,
}: DataLineageViewProps) {
  const promise = useMemo(() => loadLineage(tableName, columns), [columns, tableName]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} p-6`}
    >
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
            <Network className="h-4 w-4" />
            Data Lineage
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            Trace provenance across related tables
          </h2>
        </div>
      </div>

      <Suspense fallback={<LineageLoadingState />}>
        <LineageReady tableName={tableName} columns={columns} promise={promise} />
      </Suspense>
    </motion.section>
  );
}
