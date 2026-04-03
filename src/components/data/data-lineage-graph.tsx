"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Clock3,
  Database,
  Download,
  FileUp,
  GitMerge,
  Play,
  Sparkles,
} from "lucide-react";
import { formatNumber, generateId } from "@/lib/utils/formatters";

type LineageEventType = "upload" | "join" | "transform" | "query";

export interface LineageEvent {
  id: string;
  tableName: string;
  type: LineageEventType;
  label: string;
  description: string;
  sql?: string;
  sourceTables?: string[];
  timestamp: number;
  rowsBefore?: number;
  rowsAfter?: number;
  metadata?: Record<string, unknown>;
}

interface DataLineageGraphProps {
  tableName: string;
}

interface LineageNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  event: LineageEvent;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "overflow-hidden rounded-[1.9rem] border border-white/15 bg-white/60 shadow-[0_24px_90px_-46px_rgba(15,23,42,0.78)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const CARD_CLASS =
  "rounded-[1.3rem] border border-white/15 bg-white/55 shadow-[0_18px_54px_-36px_rgba(15,23,42,0.9)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/38";
const STORAGE_PREFIX = "datalens:lineage-graph:";
const listeners = new Map<string, Set<() => void>>();
const snapshotCache = new Map<string, { raw: string | null; entries: LineageEvent[] }>();

const TYPE_META: Record<
  LineageEventType,
  {
    Icon: typeof FileUp;
    label: string;
    accent: string;
    badge: string;
  }
> = {
  upload: {
    Icon: FileUp,
    label: "File upload",
    accent: "from-sky-500/30 via-cyan-500/16 to-transparent",
    badge: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  },
  join: {
    Icon: GitMerge,
    label: "Join",
    accent: "from-violet-500/30 via-fuchsia-500/16 to-transparent",
    badge: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  },
  transform: {
    Icon: Sparkles,
    label: "Transform",
    accent: "from-amber-500/30 via-orange-500/16 to-transparent",
    badge: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  },
  query: {
    Icon: Play,
    label: "Query",
    accent: "from-emerald-500/30 via-teal-500/16 to-transparent",
    badge: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  },
};

function lineageKey(tableName: string) {
  return `${STORAGE_PREFIX}${tableName}`;
}

function readLineage(tableName: string): LineageEvent[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.sessionStorage.getItem(lineageKey(tableName));
  const cached = snapshotCache.get(tableName);
  if (cached && cached.raw === raw) {
    return cached.entries;
  }

  try {
    if (!raw) {
      const emptyEntries: LineageEvent[] = [];
      snapshotCache.set(tableName, { raw, entries: emptyEntries });
      return emptyEntries;
    }

    const parsed = JSON.parse(raw) as LineageEvent[];
    const entries = Array.isArray(parsed) ? parsed : [];
    snapshotCache.set(tableName, { raw, entries });
    return entries;
  } catch {
    const emptyEntries: LineageEvent[] = [];
    snapshotCache.set(tableName, { raw, entries: emptyEntries });
    return emptyEntries;
  }
}

function writeLineage(tableName: string, entries: LineageEvent[]) {
  if (typeof window === "undefined") {
    return;
  }

  const raw = JSON.stringify(entries);
  snapshotCache.set(tableName, { raw, entries });
  window.sessionStorage.setItem(lineageKey(tableName), raw);
  listeners.get(tableName)?.forEach((listener) => listener());
}

function subscribeLineage(tableName: string, listener: () => void) {
  const bucket = listeners.get(tableName) ?? new Set<() => void>();
  bucket.add(listener);
  listeners.set(tableName, bucket);

  return () => {
    const current = listeners.get(tableName);
    current?.delete(listener);
  };
}

export function appendLineageEvent(
  tableName: string,
  entry: Omit<LineageEvent, "id" | "tableName" | "timestamp"> & Partial<Pick<LineageEvent, "id" | "timestamp">>,
) {
  const normalized: LineageEvent = {
    ...entry,
    id: entry.id ?? generateId(),
    tableName,
    timestamp: entry.timestamp ?? Date.now(),
  };

  writeLineage(tableName, [...readLineage(tableName), normalized]);
  return normalized;
}

export function clearLineageEvents(tableName: string) {
  writeLineage(tableName, []);
}

export function exportLineageEvents(tableName: string) {
  const payload = JSON.stringify(readLineage(tableName), null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${tableName}-lineage.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRowDelta(before?: number, after?: number) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) {
    return "Row delta unavailable";
  }

  const delta = Number(after) - Number(before);
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${formatNumber(delta)} rows`;
}

function buildGraph(tableName: string, events: LineageEvent[]) {
  if (events.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const root: LineageEvent = {
    id: `${tableName}::root`,
    tableName,
    type: "upload",
    label: tableName,
    description: `Session source for ${tableName}`,
    timestamp: events[0]?.timestamp ?? Date.now(),
    rowsAfter: events[0]?.rowsBefore ?? events[0]?.rowsAfter,
  };

  const fullPath = [root, ...events];
  const nodeWidth = 280;
  const nodeHeight = 156;
  const xGap = 72;
  const yGap = 70;
  const maxColumns = 3;

  const nodes = fullPath.map((event, index) => {
    const column = index % maxColumns;
    const row = Math.floor(index / maxColumns);
    return {
      id: event.id,
      x: column * (nodeWidth + xGap),
      y: row * (nodeHeight + yGap),
      width: nodeWidth,
      height: nodeHeight,
      event,
    } satisfies LineageNode;
  });

  const edges = nodes.slice(1).map((node, index) => ({
    from: nodes[index],
    to: node,
    id: `${nodes[index].id}::${node.id}`,
  }));

  const rows = Math.max(1, Math.ceil(nodes.length / maxColumns));
  return {
    nodes,
    edges,
    width: Math.min(maxColumns, nodes.length) * nodeWidth + (Math.min(maxColumns, nodes.length) - 1) * xGap,
    height: rows * nodeHeight + Math.max(0, rows - 1) * yGap,
  };
}

function GraphCanvas({
  tableName,
  graph,
  activeId,
  onSelect,
}: {
  tableName: string;
  graph: ReturnType<typeof buildGraph>;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div
        className="relative min-h-[22rem] min-w-full"
        style={{
          width: Math.max(graph.width, 960),
          height: Math.max(graph.height, 360),
        }}
      >
        <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <linearGradient id={`lineage-gradient-${tableName}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(56,189,248,0.6)" />
              <stop offset="100%" stopColor="rgba(148,163,184,0.24)" />
            </linearGradient>
          </defs>
          {graph.edges.map((edge) => {
            const startX = edge.from.x + edge.from.width;
            const startY = edge.from.y + edge.from.height / 2;
            const endX = edge.to.x;
            const endY = edge.to.y + edge.to.height / 2;
            const midX = startX + (endX - startX) / 2;
            const d = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;

            return (
              <path
                key={edge.id}
                d={d}
                fill="none"
                stroke={`url(#lineage-gradient-${tableName})`}
                strokeWidth="3"
                strokeLinecap="round"
              />
            );
          })}
        </svg>

        <AnimatePresence initial={false}>
          {graph.nodes.map((node, index) => {
            const meta = TYPE_META[node.event.type];
            const Icon = meta.Icon;
            const active = node.id === activeId;

            return (
              <motion.button
                key={node.id}
                type="button"
                initial={{ opacity: 0, y: 18, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.34, delay: index * 0.04, ease: EASE }}
                onClick={() => onSelect(node.id)}
                className={`absolute overflow-hidden rounded-[1.4rem] border px-5 py-4 text-left transition ${
                  active
                    ? "border-cyan-400/45 bg-white/78 shadow-[0_22px_70px_-34px_rgba(14,165,233,0.55)] dark:bg-slate-950/65"
                    : "border-white/15 bg-white/55 hover:border-cyan-300/30 dark:border-white/10 dark:bg-slate-950/40"
                }`}
                style={{
                  left: node.x,
                  top: node.y,
                  width: node.width,
                  height: node.height,
                }}
              >
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${meta.accent}`} />
                <div className="relative flex h-full flex-col justify-between">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${meta.badge}`}>
                        <Icon className="h-3.5 w-3.5" />
                        {meta.label}
                      </div>
                      <h3 className="mt-3 text-base font-semibold text-slate-950 dark:text-white">
                        {node.event.label}
                      </h3>
                    </div>
                    {active ? (
                      <span className="rounded-full border border-cyan-400/35 bg-cyan-500/12 px-2.5 py-1 text-[11px] font-semibold text-cyan-700 dark:text-cyan-300">
                        Active
                      </span>
                    ) : null}
                  </div>

                  <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                    <div className="flex items-center gap-2">
                      <Clock3 className="h-3.5 w-3.5 text-slate-400" />
                      {formatTimestamp(node.event.timestamp)}
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                      {formatRowDelta(node.event.rowsBefore, node.event.rowsAfter)}
                    </div>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function DataLineageGraph({ tableName }: DataLineageGraphProps) {
  const events = useSyncExternalStore(
    (listener) => subscribeLineage(tableName, listener),
    () => readLineage(tableName),
    () => [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const graph = useMemo(() => buildGraph(tableName, events), [events, tableName]);
  const latestEvent = events[events.length - 1];
  const activeNode =
    graph.nodes.find((node) => node.id === selectedId) ??
    graph.nodes.at(-1) ??
    null;
  const latestRowCount =
    latestEvent?.rowsAfter ??
    latestEvent?.rowsBefore ??
    events[0]?.rowsAfter ??
    0;

  return (
    <section className={`${PANEL_CLASS} p-6`}>
      <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
            <Database className="h-3.5 w-3.5" />
            Provenance map
          </div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Data lineage graph</h2>
          <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">
            Trace upload, join, query, and transform steps for{" "}
            <span className="font-medium text-slate-950 dark:text-white">{tableName}</span>. Events are stored in{" "}
            <span className="font-mono">sessionStorage</span> for the current tab session.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className={`${CARD_CLASS} px-4 py-3`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Events
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
              {formatNumber(events.length)}
            </div>
          </div>
          <div className={`${CARD_CLASS} px-4 py-3`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Current rows
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
              {formatNumber(latestRowCount)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => exportLineageEvents(tableName)}
            disabled={events.length === 0}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/55 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-cyan-300/35 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-100"
          >
            <Download className="h-4 w-4" />
            Export JSON
          </button>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="flex min-h-[22rem] flex-col items-center justify-center gap-4 text-center">
          <div className="rounded-full border border-white/15 bg-white/60 p-5 dark:border-white/10 dark:bg-slate-950/40">
            <Database className="h-8 w-8 text-slate-400" />
          </div>
          <div className="space-y-2">
            <p className="text-base font-semibold text-slate-950 dark:text-white">
              No lineage recorded for {tableName}
            </p>
            <p className="max-w-xl text-sm text-slate-500 dark:text-slate-400">
              Add upload, query, join, or transform events to start tracking provenance and SQL history.
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <GraphCanvas
            tableName={tableName}
            graph={graph}
            activeId={activeNode?.id ?? ""}
            onSelect={setSelectedId}
          />

          {activeNode ? (
            <motion.aside
              key={activeNode.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.32, ease: EASE }}
              className={`${CARD_CLASS} p-5`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${TYPE_META[activeNode.event.type].badge}`}>
                    {TYPE_META[activeNode.event.type].label}
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">
                    {activeNode.event.label}
                  </h3>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {formatTimestamp(activeNode.event.timestamp)}
                </span>
              </div>

              <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {activeNode.event.description}
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/40 px-4 py-3 dark:bg-slate-950/35">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Rows before
                  </div>
                  <div className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                    {activeNode.event.rowsBefore == null ? "—" : formatNumber(activeNode.event.rowsBefore)}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/40 px-4 py-3 dark:bg-slate-950/35">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Rows after
                  </div>
                  <div className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
                    {activeNode.event.rowsAfter == null ? "—" : formatNumber(activeNode.event.rowsAfter)}
                  </div>
                </div>
              </div>

              {activeNode.event.sourceTables?.length ? (
                <div className="mt-5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Sources
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeNode.event.sourceTables.map((source) => (
                      <span
                        key={source}
                        className="rounded-full border border-white/10 bg-white/45 px-3 py-1 text-xs text-slate-600 dark:bg-slate-950/35 dark:text-slate-300"
                      >
                        {source}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {activeNode.event.metadata ? (
                <div className="mt-5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Metadata
                  </div>
                  <pre className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/90 p-4 text-xs leading-6 text-slate-200">
                    {JSON.stringify(activeNode.event.metadata, null, 2)}
                  </pre>
                </div>
              ) : null}

              {activeNode.event.sql ? (
                <div className="mt-5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    SQL
                  </div>
                  <pre className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/90 p-4 text-xs leading-6 text-slate-200">
                    {activeNode.event.sql}
                  </pre>
                </div>
              ) : null}
            </motion.aside>
          ) : null}
        </div>
      )}
    </section>
  );
}
