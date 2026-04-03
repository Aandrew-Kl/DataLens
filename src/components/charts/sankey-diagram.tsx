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
import { SankeyChart as EChartsSankeyChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Download, GitBranchPlus } from "lucide-react";
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

echarts.use([EChartsSankeyChart, TooltipComponent, CanvasRenderer]);

interface SankeyDiagramProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

interface SankeyNode {
  name: string;
}

interface SankeyResult {
  links: SankeyLink[];
  nodes: SankeyNode[];
  totalFlow: number;
  error: string | null;
}

interface SankeyDiagramReadyProps extends SankeyDiagramProps {
  sourceColumn: string;
  targetColumn: string;
  valueColumn: string;
  promise: Promise<SankeyResult>;
}

function buildCsv(links: SankeyLink[]) {
  return ["source,target,value", ...links.map((link) => `${link.source},${link.target},${link.value}`)].join("\n");
}

async function loadSankeyData(
  tableName: string,
  sourceColumn: string,
  targetColumn: string,
  valueColumn: string,
): Promise<SankeyResult> {
  if (!sourceColumn || !targetColumn || !valueColumn) {
    return {
      links: [],
      nodes: [],
      totalFlow: 0,
      error: "Pick source, target, and value columns.",
    };
  }

  try {
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
      if (value === null || value <= 0) return [];
      return [
        {
          source: String(row.source_name ?? ""),
          target: String(row.target_name ?? ""),
          value,
        },
      ];
    });
    const nodes = Array.from(
      new Set(links.flatMap((link) => [link.source, link.target])),
    ).map<SankeyNode>((name) => ({ name }));

    return {
      links,
      nodes,
      totalFlow: links.reduce((sum, link) => sum + link.value, 0),
      error: links.length === 0 ? "No positive flows were found for the selected fields." : null,
    };
  } catch (error) {
    return {
      links: [],
      nodes: [],
      totalFlow: 0,
      error: error instanceof Error ? error.message : "Sankey query failed.",
    };
  }
}

function buildSankeyOption(result: SankeyResult, dark: boolean): EChartsOption {
  return {
    animationDuration: 520,
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
      formatter: (params: unknown) => {
        if (!isRecord(params)) return "Flow";
        if (params.dataType === "edge" && isRecord(params.data)) {
          return [
            `<strong>${String(params.data.source ?? "")} → ${String(params.data.target ?? "")}</strong>`,
            `Flow: ${formatNumber(toNumber(params.data.value) ?? 0)}`,
          ].join("<br/>");
        }
        return `<strong>${String(params.name ?? "Node")}</strong>`;
      },
    },
    series: [
      {
        type: "sankey",
        data: result.nodes,
        links: result.links,
        nodeGap: 18,
        nodeWidth: 18,
        emphasis: {
          focus: "adjacency",
        },
        label: {
          color: dark ? "#e2e8f0" : "#0f172a",
          formatter: (params: { name?: string }) => String(params.name ?? "").slice(0, 18),
        },
        lineStyle: {
          color: "gradient",
          opacity: 0.5,
        },
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

function SankeyLoadingState() {
  return (
    <div className={`${GLASS_CARD_CLASS} flex min-h-[24rem] items-center justify-center p-6 text-sm text-slate-600 dark:text-slate-300`}>
      Building flow diagram…
    </div>
  );
}

function SankeyDiagramReady({
  tableName,
  promise,
}: SankeyDiagramReadyProps) {
  const dark = useDarkMode();
  const result = use(promise);
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const option = useMemo(() => buildSankeyOption(result, dark), [dark, result]);

  if (result.error) {
    return (
      <div className={`${GLASS_CARD_CLASS} p-6 text-sm text-slate-600 dark:text-slate-300`}>
        {result.error}
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="space-y-4">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Flow summary
          </div>
          <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
            {formatNumber(result.totalFlow)}
          </div>
          <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {formatNumber(result.links.length)} flow links across {formatNumber(result.nodes.length)} nodes.
          </div>
        </div>
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BUTTON_CLASS}
              onClick={() =>
                downloadFile(
                  buildCsv(result.links),
                  `${tableName}-sankey.csv`,
                  "text/csv;charset=utf-8;",
                )
              }
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
            <button
              type="button"
              className={BUTTON_CLASS}
              onClick={() => exportChartPng(chartRef.current, `${tableName}-sankey.png`, dark)}
            >
              <Download className="h-4 w-4" />
              Export PNG
            </button>
          </div>
        </div>
      </div>

      <div className={`${GLASS_CARD_CLASS} p-4`}>
        <ReactEChartsCore ref={chartRef} option={option} style={{ height: 430 }} />
      </div>
    </div>
  );
}

export default function SankeyDiagram({
  tableName,
  columns,
}: SankeyDiagramProps) {
  const dimensionColumns = useMemo(
    () => columns.filter((column) => column.type !== "number"),
    [columns],
  );
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [sourceColumn, setSourceColumn] = useState(dimensionColumns[0]?.name ?? "");
  const [targetColumn, setTargetColumn] = useState(dimensionColumns[1]?.name ?? dimensionColumns[0]?.name ?? "");
  const [valueColumn, setValueColumn] = useState(numericColumns[0]?.name ?? "");

  const promise = useMemo(
    () => loadSankeyData(tableName, sourceColumn, targetColumn, valueColumn),
    [sourceColumn, tableName, targetColumn, valueColumn],
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} p-6`}
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">
            <GitBranchPlus className="h-4 w-4" />
            Sankey Diagram
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            Compare directional flow between source and target stages
          </h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <select
            className={FIELD_CLASS}
            value={sourceColumn}
            onChange={(event) => startTransition(() => setSourceColumn(event.target.value))}
          >
            {dimensionColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <select
            className={FIELD_CLASS}
            value={targetColumn}
            onChange={(event) => startTransition(() => setTargetColumn(event.target.value))}
          >
            {dimensionColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <select
            className={FIELD_CLASS}
            value={valueColumn}
            onChange={(event) => startTransition(() => setValueColumn(event.target.value))}
          >
            {numericColumns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Suspense fallback={<SankeyLoadingState />}>
        <SankeyDiagramReady
          tableName={tableName}
          columns={columns}
          sourceColumn={sourceColumn}
          targetColumn={targetColumn}
          valueColumn={valueColumn}
          promise={promise}
        />
      </Suspense>
    </motion.section>
  );
}
