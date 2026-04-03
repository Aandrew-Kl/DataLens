"use client";

import {
  Suspense,
  startTransition,
  use,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { SankeyChart as EChartsSankeyChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  Download,
  GitBranchPlus,
  Loader2,
  Palette,
  Rows3,
  Waypoints,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([EChartsSankeyChart, TooltipComponent, CanvasRenderer]);

interface SankeyChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface SankeyLink {
  source: string;
  target: string;
  value: number;
  share: number;
}

interface SankeyNode {
  name: string;
  itemStyle?: {
    color?: string;
  };
}

interface SankeyResult {
  links: SankeyLink[];
  nodes: SankeyNode[];
  totalFlow: number;
  error: string | null;
}

type ColorMode = "source" | "target";

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/80 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100";
const PALETTE = ["#38bdf8", "#34d399", "#f59e0b", "#a78bfa", "#fb7185", "#2dd4bf", "#f97316"] as const;

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

function useDarkMode() {
  return useSyncExternalStore(subscribeDarkMode, getDarkModeSnapshot, () => false);
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildColorMap(labels: string[]) {
  return new Map(
    labels.map((label, index) => [
      label,
      PALETTE[index % PALETTE.length],
    ]),
  );
}

async function loadSankeyData(
  tableName: string,
  sourceColumn: string,
  targetColumn: string,
  valueColumn: string,
  colorMode: ColorMode,
): Promise<SankeyResult> {
  if (!sourceColumn || !targetColumn || !valueColumn) {
    return {
      links: [],
      nodes: [],
      totalFlow: 0,
      error: "Pick source, target, and value columns.",
    };
  }

  const rows = await runQuery(`
    SELECT
      CAST(${quoteIdentifier(sourceColumn)} AS VARCHAR) AS source_name,
      CAST(${quoteIdentifier(targetColumn)} AS VARCHAR) AS target_name,
      SUM(TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE)) AS flow_value
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(sourceColumn)} IS NOT NULL
      AND ${quoteIdentifier(targetColumn)} IS NOT NULL
      AND TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE) IS NOT NULL
    GROUP BY 1, 2
    HAVING SUM(TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE)) IS NOT NULL
    ORDER BY flow_value DESC
    LIMIT 120
  `);

  const links = rows.flatMap<SankeyLink>((row) => {
    const value = toNumber(row.flow_value);
    if (value == null || value <= 0) return [];
    return [
      {
        source: String(row.source_name ?? ""),
        target: String(row.target_name ?? ""),
        value,
        share: 0,
      },
    ];
  });

  if (links.length === 0) {
    return {
      links: [],
      nodes: [],
      totalFlow: 0,
      error: "No positive flows were found for the selected fields.",
    };
  }

  const totalFlow = links.reduce((sum, link) => sum + link.value, 0);
  const sourceLabels = Array.from(new Set(links.map((link) => link.source)));
  const targetLabels = Array.from(new Set(links.map((link) => link.target)));
  const colorLabels = colorMode === "source" ? sourceLabels : targetLabels;
  const colorMap = buildColorMap(colorLabels);
  const nodeNames = Array.from(
    new Set(links.flatMap((link) => [link.source, link.target])),
  );

  return {
    links: links.map((link) => ({
      ...link,
      share: totalFlow === 0 ? 0 : link.value / totalFlow,
    })),
    nodes: nodeNames.map((name) => ({
      name,
      itemStyle: {
        color:
          colorMode === "source"
            ? colorMap.get(name) ?? colorMap.get(
                links.find((link) => link.source === name)?.source ?? "",
              )
            : colorMap.get(name) ?? colorMap.get(
                links.find((link) => link.target === name)?.target ?? "",
              ),
      },
    })),
    totalFlow,
    error: null,
  };
}

function buildSankeyOption(
  result: SankeyResult,
  dark: boolean,
  nodeWidth: number,
  nodeGap: number,
  colorMode: ColorMode,
): EChartsOption {
  const textColor = dark ? "#e2e8f0" : "#0f172a";
  const borderColor = dark ? "#334155" : "#cbd5e1";

  return {
    animationDuration: 580,
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: textColor },
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params;
        const dataType = String((item as { dataType?: string }).dataType ?? "");
        if (dataType === "edge") {
          const edge = item as {
            data?: { value?: number; share?: number; source?: string; target?: string };
          };
          return [
            `<strong>${edge.data?.source ?? ""} → ${edge.data?.target ?? ""}</strong>`,
            `Flow: ${formatNumber(edge.data?.value ?? 0)}`,
            `Share: ${((edge.data?.share ?? 0) * 100).toFixed(1)}%`,
          ].join("<br/>");
        }
        const node = item as {
          name?: string;
          value?: number;
        };
        return [
          `<strong>${node.name ?? "Node"}</strong>`,
          `Throughput: ${formatNumber(Number(node.value ?? 0))}`,
          `Color by ${colorMode}`,
        ].join("<br/>");
      },
    },
    series: [
      {
        type: "sankey",
        data: result.nodes,
        links: result.links,
        nodeAlign: "justify",
        nodeGap,
        nodeWidth,
        draggable: false,
        emphasis: {
          focus: "adjacency",
        },
        lineStyle: {
          color: "gradient",
          curveness: 0.5,
          opacity: 0.34,
        },
        label: {
          color: textColor,
          fontSize: 12,
        },
      },
    ],
  };
}

function exportChart(chartRef: ReactEChartsCore | null, dark: boolean, fileName: string) {
  const instance = chartRef?.getEchartsInstance();
  if (!instance) return;
  const url = instance.getDataURL({
    type: "png",
    pixelRatio: 2,
    backgroundColor: dark ? "#020617" : "#f8fafc",
  });
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
}

function SankeyChartLoading() {
  return (
    <div className={`${PANEL_CLASS} flex min-h-[28rem] items-center justify-center`}>
      <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Sankey diagram…
      </div>
    </div>
  );
}

function SankeyChartReady({ tableName, columns }: SankeyChartProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const dimensionColumns = useMemo(
    () =>
      columns.filter(
        (column) =>
          column.type === "string" ||
          column.type === "boolean" ||
          column.type === "date",
      ),
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
  const [valueColumn, setValueColumn] = useState(numericColumns[0]?.name ?? "");
  const [colorMode, setColorMode] = useState<ColorMode>("source");
  const [nodeWidth, setNodeWidth] = useState(22);
  const [nodeGap, setNodeGap] = useState(14);

  const safeSource = dimensionColumns.some((column) => column.name === sourceColumn)
    ? sourceColumn
    : dimensionColumns[0]?.name ?? "";
  const safeTarget = dimensionColumns.some((column) => column.name === targetColumn)
    ? targetColumn
    : dimensionColumns[1]?.name ?? dimensionColumns[0]?.name ?? "";
  const safeValue = numericColumns.some((column) => column.name === valueColumn)
    ? valueColumn
    : numericColumns[0]?.name ?? "";

  const dataPromise = useMemo(
    () =>
      loadSankeyData(tableName, safeSource, safeTarget, safeValue, colorMode).catch(
        (error) => ({
          links: [],
          nodes: [],
          totalFlow: 0,
          error:
            error instanceof Error
              ? error.message
              : "Unable to render Sankey diagram.",
        }),
      ),
    [colorMode, safeSource, safeTarget, safeValue, tableName],
  );

  const result = use(dataPromise);
  const option = useMemo(
    () => buildSankeyOption(result, dark, nodeWidth, nodeGap, colorMode),
    [colorMode, dark, nodeGap, nodeWidth, result],
  );

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: EASE }}
        className={`${PANEL_CLASS} p-5`}
      >
        <div className="grid gap-4 xl:grid-cols-[1.12fr_0.88fr]">
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
                <Waypoints className="h-3.5 w-3.5" />
                Sankey flows
              </div>
              <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                Aggregate directional movement between categories
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Duplicate source-target pairs are summed before rendering so the chart reflects total flow volume.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Source
                </label>
                <select
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
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Target
                </label>
                <select
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
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Value
                </label>
                <select
                  value={safeValue}
                  onChange={(event) =>
                    startTransition(() => setValueColumn(event.target.value))
                  }
                  className={FIELD_CLASS}
                >
                  {numericColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Color mode
                </label>
                <select
                  value={colorMode}
                  onChange={(event) =>
                    startTransition(() =>
                      setColorMode(event.target.value === "target" ? "target" : "source"),
                    )
                  }
                  className={FIELD_CLASS}
                >
                  <option value="source">Color by source</option>
                  <option value="target">Color by target</option>
                </select>
              </div>

              <label className="rounded-2xl border border-white/15 bg-white/45 px-4 py-3 dark:bg-slate-950/35">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  <span>Node width</span>
                  <span>{nodeWidth}px</span>
                </div>
                <input
                  type="range"
                  min={12}
                  max={42}
                  value={nodeWidth}
                  onChange={(event) =>
                    startTransition(() => setNodeWidth(Number(event.target.value)))
                  }
                  className="mt-3 h-2 w-full accent-cyan-500"
                />
              </label>

              <label className="rounded-2xl border border-white/15 bg-white/45 px-4 py-3 dark:bg-slate-950/35">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  <span>Node gap</span>
                  <span>{nodeGap}px</span>
                </div>
                <input
                  type="range"
                  min={6}
                  max={30}
                  value={nodeGap}
                  onChange={(event) =>
                    startTransition(() => setNodeGap(Number(event.target.value)))
                  }
                  className="mt-3 h-2 w-full accent-cyan-500"
                />
              </label>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <Rows3 className="h-3.5 w-3.5" />
                Total flow
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
                {formatNumber(result.totalFlow)}
              </div>
            </div>
            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <GitBranchPlus className="h-3.5 w-3.5" />
                Links
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
                {result.links.length}
              </div>
            </div>
            <div className="rounded-3xl border border-white/15 bg-white/45 p-4 dark:bg-slate-950/35">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <Palette className="h-3.5 w-3.5" />
                Nodes
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
                {result.nodes.length}
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className={`${PANEL_CLASS} p-5`}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Flow map
            </div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Hover an edge to inspect absolute flow and share of total volume.
            </div>
          </div>
          <button
            type="button"
            onClick={() => exportChart(chartRef.current, dark, `${tableName}-sankey.png`)}
            className="rounded-2xl border border-white/20 bg-white/55 px-3 py-2 text-sm text-slate-600 transition hover:border-cyan-300/40 dark:bg-slate-950/35 dark:text-slate-200"
          >
            <span className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Export PNG
            </span>
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
            notMerge
            lazyUpdate
            style={{ height: 560 }}
          />
        )}
      </motion.section>
    </div>
  );
}

export default function SankeyChart({ tableName, columns }: SankeyChartProps) {
  return (
    <Suspense fallback={<SankeyChartLoading />}>
      <SankeyChartReady tableName={tableName} columns={columns} />
    </Suspense>
  );
}
