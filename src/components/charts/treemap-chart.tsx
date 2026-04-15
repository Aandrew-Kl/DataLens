"use client";

import { quoteIdentifier } from "@/lib/utils/sql";
import { startTransition, useMemo, useRef, useState, useSyncExternalStore } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { TreemapChart as EChartsTreemapChart } from "echarts/charts";
import { TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  Boxes,
  Download,
  Loader2,
  Network,
  Palette,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([EChartsTreemapChart, TooltipComponent, VisualMapComponent, CanvasRenderer]);

interface TreemapChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface TreemapNode {
  name: string;
  value?: number;
  children?: TreemapNode[];
  itemStyle?: {
    color?: string;
  };
}

interface FlatTreemapRow {
  category: string;
  nestedCategory: string | null;
  value: number;
}

type ColorMode = "value" | "category";

const EASE = [0.22, 1, 0.36, 1] as const;
const PANEL_CLASS =
  "rounded-[1.75rem] border border-white/20 bg-white/75 shadow-xl shadow-slate-950/10 backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45";
const FIELD_CLASS =
  "rounded-2xl border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-cyan-400 dark:bg-slate-950/45 dark:text-slate-100";
const CATEGORY_PALETTE = ["#06b6d4", "#34d399", "#2563eb", "#f97316", "#8b5cf6", "#f43f5e", "#f59e0b"] as const;

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
function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildTreemapQuery(
  tableName: string,
  categoryColumn: string,
  valueColumn: string,
  nestedColumn: string | null,
) {
  const safeTable = quoteIdentifier(tableName);
  const safeCategory = quoteIdentifier(categoryColumn);
  const safeValue = quoteIdentifier(valueColumn);

  if (!nestedColumn) {
    return `
      SELECT
        CAST(${safeCategory} AS VARCHAR) AS category_name,
        NULL AS nested_name,
        SUM(TRY_CAST(${safeValue} AS DOUBLE)) AS metric
      FROM ${safeTable}
      WHERE ${safeCategory} IS NOT NULL
        AND ${safeValue} IS NOT NULL
        AND TRY_CAST(${safeValue} AS DOUBLE) IS NOT NULL
      GROUP BY 1
      HAVING SUM(TRY_CAST(${safeValue} AS DOUBLE)) IS NOT NULL
      ORDER BY metric DESC
      LIMIT 80
    `;
  }

  const safeNested = quoteIdentifier(nestedColumn);
  return `
    SELECT
      CAST(${safeCategory} AS VARCHAR) AS category_name,
      CAST(${safeNested} AS VARCHAR) AS nested_name,
      SUM(TRY_CAST(${safeValue} AS DOUBLE)) AS metric
    FROM ${safeTable}
    WHERE ${safeCategory} IS NOT NULL
      AND ${safeNested} IS NOT NULL
      AND ${safeValue} IS NOT NULL
      AND TRY_CAST(${safeValue} AS DOUBLE) IS NOT NULL
    GROUP BY 1, 2
    HAVING SUM(TRY_CAST(${safeValue} AS DOUBLE)) IS NOT NULL
    ORDER BY metric DESC
    LIMIT 120
  `;
}

function buildTree(rows: FlatTreemapRow[], colorMode: ColorMode) {
  const grouped = new Map<string, FlatTreemapRow[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.category) ?? [];
    bucket.push(row);
    grouped.set(row.category, bucket);
  }

  return Array.from(grouped.entries()).map(([category, entries], index) => {
    const categoryColor = CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
    if (entries.every((entry) => entry.nestedCategory == null)) {
      const total = entries.reduce((sum, entry) => sum + entry.value, 0);
      return {
        name: category,
        value: total,
        itemStyle: colorMode === "category" ? { color: categoryColor } : undefined,
      } satisfies TreemapNode;
    }

    return {
      name: category,
      itemStyle: colorMode === "category" ? { color: categoryColor } : undefined,
      children: entries.map((entry) => ({
        name: entry.nestedCategory ?? "Unspecified",
        value: entry.value,
        itemStyle: colorMode === "category" ? { color: categoryColor } : undefined,
      })),
    } satisfies TreemapNode;
  });
}

function exportChartImage(chartRef: ReactEChartsCore | null, dark: boolean, fileName: string) {
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

function buildOption(
  dark: boolean,
  tree: TreemapNode[],
  total: number,
  colorMode: ColorMode,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.9)";

  return {
    animationDuration: 520,
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params;
        const rawValue = Array.isArray((item as { value?: unknown }).value)
          ? Number(((item as { value?: unknown[] }).value?.[0]) ?? 0)
          : Number((item as { value?: unknown }).value ?? 0);
        const pathInfo = Array.isArray((item as { treePathInfo?: Array<{ name: string }> }).treePathInfo)
          ? ((item as unknown as { treePathInfo: Array<{ name: string }> }).treePathInfo)
          : [];
        const share = total === 0 ? 0 : (rawValue / total) * 100;
        return [
          `<strong>${pathInfo.map((entry) => entry.name).filter(Boolean).join(" / ") || String(("name" in item ? item.name : "") ?? "")}</strong>`,
          `Value: ${formatNumber(rawValue)}`,
          `Share of total: ${share.toFixed(1)}%`,
        ].join("<br/>");
      },
    },
    series: [
      {
        type: "treemap",
        data: tree,
        roam: false,
        nodeClick: "zoomToNode",
        visibleMin: 1,
        breadcrumb: {
          show: true,
          height: 26,
          itemStyle: {
            color: dark ? "#0f172a" : "#e2e8f0",
            borderColor: dark ? "#334155" : "#cbd5e1",
          },
        },
        label: {
          show: true,
          color: dark ? "#f8fafc" : "#0f172a",
          formatter: "{b}",
        },
        upperLabel: {
          show: true,
          color: dark ? "#f8fafc" : "#0f172a",
          height: 26,
        },
        itemStyle: {
          borderColor,
          borderWidth: 1,
          gapWidth: 2,
        },
        colorMappingBy: colorMode === "value" ? "value" : "index",
        levels: [
          {
            itemStyle: {
              borderColor,
              borderWidth: 3,
              gapWidth: 4,
            },
            upperLabel: { show: true, color: textColor },
          },
          {
            colorSaturation: colorMode === "value" ? [0.25, 0.9] : undefined,
            itemStyle: {
              borderColor,
              borderWidth: 2,
              gapWidth: 2,
            },
          },
        ],
      },
    ],
    visualMap: colorMode === "value"
      ? {
          show: false,
          min: 0,
          max: Math.max(...tree.flatMap((entry) => {
            if (entry.children) {
              return entry.children.map((child) => Number(child.value ?? 0));
            }
            return [Number(entry.value ?? 0)];
          }), 0),
          inRange: {
            color: ["#bfdbfe", "#60a5fa", "#2563eb"],
          },
        }
      : undefined,
  };
}

function TreemapMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 dark:bg-slate-950/45">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

export default function TreemapChart({ tableName, columns }: TreemapChartProps) {
  const dark = useSyncExternalStore(subscribeDarkMode, getDarkModeSnapshot, () => false);
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const categoryColumns = useMemo(
    () => columns.filter((column) => column.type !== "unknown"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );

  const [categoryColumn, setCategoryColumn] = useState(categoryColumns[0]?.name ?? "");
  const [valueColumn, setValueColumn] = useState(numericColumns[0]?.name ?? "");
  const [nestedColumn, setNestedColumn] = useState<string>("");
  const [colorMode, setColorMode] = useState<ColorMode>("value");
  const [rows, setRows] = useState<FlatTreemapRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableNestedColumns = useMemo(
    () => categoryColumns.filter((column) => column.name !== categoryColumn),
    [categoryColumn, categoryColumns],
  );
  const tree = useMemo(
    () => buildTree(rows, colorMode),
    [colorMode, rows],
  );
  const total = useMemo(
    () => rows.reduce((sum, row) => sum + row.value, 0),
    [rows],
  );
  const option = useMemo(
    () => buildOption(dark, tree, total, colorMode),
    [colorMode, dark, total, tree],
  );

  async function loadTreemap() {
    if (!categoryColumn || !valueColumn) {
      setError("Select a category column and a numeric value column.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const queryRows = await runQuery(
        buildTreemapQuery(tableName, categoryColumn, valueColumn, nestedColumn || null),
      );
      const nextRows = queryRows.map((row) => ({
        category: String(row.category_name ?? "Untitled"),
        nestedCategory: row.nested_name == null ? null : String(row.nested_name),
        value: toNumber(row.metric),
      }));
      startTransition(() => {
        setRows(nextRows);
      });
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to build the treemap.");
    } finally {
      setLoading(false);
    }
  }

  const topLevelCount = tree.length;
  const leafCount = rows.length;

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: EASE }}
      className={`${PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-violet-700 dark:text-violet-300">
            <Boxes className="h-4 w-4" />
            Treemap
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">Explore categorical volume with nested drill-down</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
            Group a numeric measure by one or two dimensions, color by value or category, and zoom into segments directly from the chart.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <TreemapMetric label="Top groups" value={formatNumber(topLevelCount)} />
          <TreemapMetric label="Leaf nodes" value={formatNumber(leafCount)} />
          <TreemapMetric label="Total value" value={formatNumber(total)} />
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_1fr_1fr_0.9fr_auto]">
        <select value={categoryColumn} onChange={(event) => setCategoryColumn(event.target.value)} className={FIELD_CLASS}>
          <option value="">Category column</option>
          {categoryColumns.map((column) => (
            <option key={column.name} value={column.name}>
              {column.name}
            </option>
          ))}
        </select>
        <select value={valueColumn} onChange={(event) => setValueColumn(event.target.value)} className={FIELD_CLASS}>
          <option value="">Value column</option>
          {numericColumns.map((column) => (
            <option key={column.name} value={column.name}>
              {column.name}
            </option>
          ))}
        </select>
        <select value={nestedColumn} onChange={(event) => setNestedColumn(event.target.value)} className={FIELD_CLASS}>
          <option value="">No second level</option>
          {availableNestedColumns.map((column) => (
            <option key={column.name} value={column.name}>
              {column.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/75 px-4 py-3 text-sm text-slate-700 dark:bg-slate-950/45 dark:text-slate-200">
          <Palette className="h-4 w-4 text-cyan-500" />
          <select value={colorMode} onChange={(event) => setColorMode(event.target.value as ColorMode)} className="w-full bg-transparent outline-none">
            <option value="value">Color by value</option>
            <option value="category">Color by category</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void loadTreemap()}
          disabled={loading || !categoryColumn || !valueColumn}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Network className="h-4 w-4" />}
          Build chart
        </button>
      </div>

      {error ? (
        <div className="mt-5 rounded-2xl border border-rose-300/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.45fr_0.8fr]">
        <div className="rounded-[1.5rem] border border-white/15 bg-white/65 p-4 dark:bg-slate-950/35">
          {rows.length === 0 ? (
            <div className="flex min-h-[400px] items-center justify-center rounded-[1.25rem] border border-dashed border-white/20 text-center text-sm text-slate-500 dark:text-slate-400">
              Build the treemap to start drilling into categories and nested segments.
            </div>
          ) : (
            <ReactEChartsCore
              ref={chartRef}
              echarts={echarts}
              option={option}
              notMerge
              lazyUpdate
              style={{ height: 440 }}
            />
          )}
        </div>

        <div className="space-y-4 rounded-[1.5rem] border border-white/15 bg-white/65 p-4 dark:bg-slate-950/35">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Nested navigation</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Click any rectangle to zoom into that node. Use the breadcrumb inside the chart to step back out.</p>
            </div>
            <button
              type="button"
              onClick={() => exportChartImage(chartRef.current, dark, `${tableName}-treemap.png`)}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-950/45 dark:text-slate-200 dark:hover:bg-slate-950/65"
            >
              <Download className="h-4 w-4" />
              Export PNG
            </button>
          </div>

          <div className="space-y-3">
            {tree.slice(0, 8).map((node) => {
              const nodeValue = Number(node.value ?? node.children?.reduce((sum, child) => sum + Number(child.value ?? 0), 0) ?? 0);
              const share = total === 0 ? 0 : (nodeValue / total) * 100;
              return (
                <div key={node.name} className="rounded-2xl border border-white/15 bg-white/70 p-4 dark:bg-slate-950/45">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{node.name}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {node.children ? `${node.children.length} nested segments` : "Leaf segment"}
                      </p>
                    </div>
                    <span className="rounded-full bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300">
                      {share.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-800/70">
                    <div
                      className="h-full rounded-full bg-violet-500"
                      style={{ width: `${share}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Value {formatNumber(nodeValue)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
