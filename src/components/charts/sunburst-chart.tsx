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
import { SunburstChart as EChartsSunburstChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Download, Sun } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
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
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([EChartsSunburstChart, TooltipComponent, CanvasRenderer]);

interface SunburstChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface SunburstNode {
  name: string;
  value: number;
  children?: SunburstNode[];
}

interface SunburstResult {
  nodes: SunburstNode[];
  total: number;
  error: string | null;
}

interface SunburstReadyProps extends SunburstChartProps {
  promise: Promise<SunburstResult>;
}

function buildHierarchy(
  rows: Record<string, unknown>[],
  hierarchyColumns: string[],
  valueColumn: string,
) {
  const rootNodes: SunburstNode[] = [];

  rows.forEach((row) => {
    const amount = toNumber(row[valueColumn]);
    if (amount === null || amount <= 0) {
      return;
    }

    let branch = rootNodes;

    hierarchyColumns.forEach((columnName) => {
      const key = String(row[columnName] ?? "Unknown");
      const existing = branch.find((node) => node.name === key) ?? {
        name: key,
        value: 0,
        children: [],
      };
      existing.value += amount;
      if (!branch.includes(existing)) {
        branch.push(existing);
      }
      branch = existing.children ?? [];
      existing.children = branch;
    });
  });

  function prune(nodes: SunburstNode[]): SunburstNode[] {
    return nodes.map((node) => {
      const children = prune(node.children ?? []);
      return children.length > 0
        ? { ...node, children }
        : { name: node.name, value: node.value };
    });
  }

  return prune(rootNodes);
}

async function loadSunburstData(
  tableName: string,
  hierarchyColumns: string[],
  valueColumn: string,
): Promise<SunburstResult> {
  if (hierarchyColumns.length < 2 || !valueColumn) {
    return {
      nodes: [],
      total: 0,
      error: "Choose at least two hierarchy columns and one numeric value column.",
    };
  }

  const selectList = hierarchyColumns
    .map((columnName) => `${quoteIdentifier(columnName)} AS ${quoteIdentifier(columnName)}`)
    .concat(`TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE) AS ${quoteIdentifier(valueColumn)}`)
    .join(", ");
  const whereClause = hierarchyColumns
    .map((columnName) => `${quoteIdentifier(columnName)} IS NOT NULL`)
    .concat(`TRY_CAST(${quoteIdentifier(valueColumn)} AS DOUBLE) IS NOT NULL`)
    .join("\n  AND ");

  try {
    const rows = await runQuery(`
      SELECT ${selectList}
      FROM ${quoteIdentifier(tableName)}
      WHERE ${whereClause}
      ORDER BY ${quoteIdentifier(valueColumn)} DESC
      LIMIT 300
    `);
    const nodes = buildHierarchy(rows, hierarchyColumns, valueColumn);
    const total = nodes.reduce((sum, node) => sum + node.value, 0);

    return {
      nodes,
      total,
      error: nodes.length === 0 ? "No hierarchical rows were available for the selected fields." : null,
    };
  } catch (error) {
    return {
      nodes: [],
      total: 0,
      error: error instanceof Error ? error.message : "Sunburst analysis failed.",
    };
  }
}

function buildSunburstOption(
  result: SunburstResult,
  dark: boolean,
): EChartsOption {
  const textColor = dark ? "#e2e8f0" : "#0f172a";

  return {
    animationDuration: 520,
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: textColor },
      formatter: (params: unknown) => {
        if (!isRecord(params) || !isRecord(params.data)) {
          return "Hierarchy node";
        }
        return [
          `<strong>${String(params.name ?? "Segment")}</strong>`,
          `Value: ${formatNumber(toNumber(params.data.value) ?? 0)}`,
        ].join("<br/>");
      },
    },
    series: [
      {
        type: "sunburst",
        radius: [0, "92%"],
        sort: undefined,
        nodeClick: "rootToNode",
        label: {
          rotate: "radial",
          color: textColor,
          formatter: (params: { name?: string }) => String(params.name ?? ""),
        },
        data: result.nodes,
      },
    ],
  };
}

function exportChartPng(chartRef: ReactEChartsCore | null, fileName: string, dark: boolean) {
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

function SunburstLoadingState() {
  return (
    <div className={`${GLASS_CARD_CLASS} flex min-h-[24rem] items-center justify-center p-6 text-sm text-slate-600 dark:text-slate-300`}>
      Building sunburst chart…
    </div>
  );
}

function readPath(params: unknown) {
  if (!isRecord(params)) return [];
  const pathInfo = params.treePathInfo;
  if (!Array.isArray(pathInfo)) return [];
  return pathInfo
    .map((entry) => (isRecord(entry) && typeof entry.name === "string" ? entry.name : ""))
    .filter((value) => value !== "");
}

function SunburstReady({
  tableName,
  columns,
  promise,
}: SunburstReadyProps) {
  const dark = useDarkMode();
  const result = use(promise);
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const dimensionColumns = useMemo(
    () => columns.filter((column) => column.type !== "number"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [activePath, setActivePath] = useState<string[]>([]);
  const option = useMemo(() => buildSunburstOption(result, dark), [dark, result]);

  function handleClick(params: unknown) {
    startTransition(() => {
      setActivePath(readPath(params));
    });
  }

  if (result.error) {
    return (
      <div className={`${GLASS_CARD_CLASS} p-6 text-sm text-slate-600 dark:text-slate-300`}>
        {result.error}
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
      <div className="space-y-4">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Hierarchy columns
          </div>
          <div className="mt-3 grid gap-3">
            {dimensionColumns.slice(0, 3).map((column) => (
              <input
                key={column.name}
                className={FIELD_CLASS}
                readOnly
                value={column.name}
              />
            ))}
          </div>
          <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">
            Value column: {numericColumns[0]?.name ?? "None"}
          </div>
          <button
            type="button"
            className={`${BUTTON_CLASS} mt-4`}
            onClick={() => exportChartPng(chartRef.current, `${tableName}-sunburst.png`, dark)}
          >
            <Download className="h-4 w-4" />
            Export PNG
          </button>
        </div>
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Breadcrumb
          </div>
          <div className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">
            {activePath.length > 0 ? activePath.join(" / ") : "Root"}
          </div>
          <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            Total value: {formatNumber(result.total)}
          </div>
        </div>
      </div>

      <div className={`${GLASS_CARD_CLASS} p-4`}>
        <ReactEChartsCore
          ref={chartRef}
          option={option}
          style={{ height: 440 }}
          onEvents={{ click: handleClick }}
        />
      </div>
    </div>
  );
}

export default function SunburstChart({
  tableName,
  columns,
}: SunburstChartProps) {
  const dimensionColumns = useMemo(
    () => columns.filter((column) => column.type !== "number").slice(0, 3).map((column) => column.name),
    [columns],
  );
  const valueColumn = columns.find((column) => column.type === "number")?.name ?? "";
  const promise = useMemo(
    () => loadSunburstData(tableName, dimensionColumns, valueColumn),
    [dimensionColumns, tableName, valueColumn],
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} p-6`}
    >
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
          <Sun className="h-4 w-4" />
          Sunburst Chart
        </div>
        <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
          Visualize hierarchical contribution across nested segments
        </h2>
      </div>

      <Suspense fallback={<SunburstLoadingState />}>
        <SunburstReady tableName={tableName} columns={columns} promise={promise} />
      </Suspense>
    </motion.section>
  );
}
