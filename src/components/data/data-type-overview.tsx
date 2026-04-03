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
import { PieChart } from "echarts/charts";
import { LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Database, Eye } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import type { ColumnProfile, ColumnType } from "@/types/dataset";

echarts.use([PieChart, LegendComponent, TooltipComponent, CanvasRenderer]);

interface DataTypeOverviewProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface TypeDistributionItem {
  type: ColumnType;
  count: number;
  color: string;
}

const TYPE_COLORS: Record<ColumnType, string> = {
  string: "#06b6d4",
  number: "#22c55e",
  date: "#8b5cf6",
  boolean: "#f97316",
  unknown: "#94a3b8",
};

const rowCountCache = new Map<string, Promise<number>>();

function formatSampleValue(value: string | number | boolean | null) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

function buildDistribution(columns: ColumnProfile[]): TypeDistributionItem[] {
  const counts = columns.reduce<Record<ColumnType, number>>(
    (accumulator, column) => {
      accumulator[column.type] += 1;
      return accumulator;
    },
    {
      string: 0,
      number: 0,
      date: 0,
      boolean: 0,
      unknown: 0,
    },
  );

  return (Object.keys(counts) as ColumnType[])
    .filter((type) => counts[type] > 0)
    .map((type) => ({
      type,
      count: counts[type],
      color: TYPE_COLORS[type],
    }));
}

function buildDonutOption(
  dark: boolean,
  distribution: TypeDistributionItem[],
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";

  return {
    animationDuration: 420,
    legend: {
      bottom: 0,
      textStyle: { color: textColor },
    },
    tooltip: {
      trigger: "item",
      formatter: (params: unknown) => {
        const item = params as {
          name?: string;
          value?: number;
          percent?: number;
        };

        return [
          `<strong>${item.name ?? "Unknown"}</strong>`,
          `${formatNumber(item.value ?? 0)} columns`,
          `${(item.percent ?? 0).toFixed(1)}% of schema`,
        ].join("<br/>");
      },
    },
    series: [
      {
        type: "pie",
        radius: ["58%", "78%"],
        center: ["50%", "44%"],
        itemStyle: {
          borderColor: dark ? "#020617" : "#ffffff",
          borderWidth: 2,
        },
        label: {
          color: textColor,
          formatter: "{b|{b}}\n{c} cols",
          rich: { b: { fontWeight: 600, lineHeight: 18 } },
        },
        data: distribution.map((item) => ({
          name: item.type,
          value: item.count,
          itemStyle: { color: item.color },
        })),
      },
    ],
  };
}

function readRowCount(tableName: string) {
  const cached = rowCountCache.get(tableName);

  if (cached) {
    return cached;
  }

  const promise = runQuery(
    `SELECT COUNT(*) AS total_rows FROM ${quoteIdentifier(tableName)}`,
  )
    .then((rows) => {
      const totalRows = toNumber(rows[0]?.total_rows);
      return Math.max(1, Math.round(totalRows ?? 1));
    })
    .catch(() => 1);

  rowCountCache.set(tableName, promise);
  return promise;
}

function buildSampleQuery(tableName: string, columnName: string) {
  return `
    SELECT DISTINCT CAST(${quoteIdentifier(columnName)} AS VARCHAR) AS sample_value
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(columnName)} IS NOT NULL
    LIMIT 8
  `;
}

function DataTypeOverviewBody({
  tableName,
  columns,
}: DataTypeOverviewProps) {
  const dark = useDarkMode();
  const totalRows = use(readRowCount(tableName));
  const distribution = useMemo(() => buildDistribution(columns), [columns]);
  const chartOption = useMemo(
    () => buildDonutOption(dark, distribution),
    [dark, distribution],
  );
  const [selectedColumnName, setSelectedColumnName] = useState(
    columns[0]?.name ?? "",
  );
  const [sampleMap, setSampleMap] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState(
    "Review column types and inspect representative sample values.",
  );
  const [loadingColumn, setLoadingColumn] = useState<string | null>(null);

  const selectedColumn =
    columns.find((column) => column.name === selectedColumnName) ?? columns[0];
  const sampleValues =
    (selectedColumn ? sampleMap[selectedColumn.name] : undefined) ??
    (selectedColumn?.sampleValues.map(formatSampleValue) ?? []);

  async function handleSelectColumn(column: ColumnProfile) {
    setSelectedColumnName(column.name);

    if (sampleMap[column.name]) {
      setStatus(`Showing cached sample values for ${column.name}.`);
      return;
    }

    setLoadingColumn(column.name);
    setStatus(`Loading sample values for ${column.name}…`);

    try {
      const rows = await runQuery(buildSampleQuery(tableName, column.name));
      const nextSamples = rows.flatMap((row) => {
        const value = row.sample_value;
        if (value === null || value === undefined) {
          return [];
        }
        return [String(value)];
      });

      startTransition(() => {
        setSampleMap((current) => ({
          ...current,
          [column.name]:
            nextSamples.length > 0
              ? nextSamples
              : column.sampleValues.map(formatSampleValue),
        }));
        setStatus(`Loaded sample values for ${column.name}.`);
      });
    } catch (caughtError) {
      setStatus(
        caughtError instanceof Error
          ? caughtError.message
          : "Sample lookup failed.",
      );
    } finally {
      setLoadingColumn(null);
    }
  }

  return (
    <motion.section
      className={`${GLASS_PANEL_CLASS} space-y-6 p-6`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, ease: ANALYTICS_EASE }}
    >
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-emerald-500/10 p-3 text-emerald-600 dark:text-emerald-300">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
              Data type overview
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Type distribution, null density, and column-level samples for {tableName}.
            </p>
          </div>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">{status}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,24rem)_1fr]">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
              Type distribution
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Based on {columns.length} columns across {formatNumber(totalRows)} rows.
            </p>
          </div>
          <ReactEChartsCore
            echarts={echarts}
            option={chartOption}
            notMerge
            lazyUpdate
            style={{ height: 320 }}
          />
        </div>

        <div className="grid gap-4">
          <div className={`${GLASS_CARD_CLASS} overflow-hidden p-5`}>
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                Column inventory
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Click a column to inspect sample values and cardinality clues.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="pb-3 pr-4">Column</th>
                    <th className="pb-3 pr-4">Type</th>
                    <th className="pb-3 pr-4">Null %</th>
                    <th className="pb-3">Unique %</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((column) => {
                    const selected = column.name === selectedColumn?.name;
                    const nullPercent = (column.nullCount / totalRows) * 100;
                    const uniquePercent = (column.uniqueCount / totalRows) * 100;

                    return (
                      <tr
                        key={column.name}
                        className={`border-t border-white/10 ${selected ? "bg-cyan-500/5" : ""}`}
                      >
                        <th className="py-3 pr-4 font-medium text-slate-900 dark:text-white">
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 text-left"
                            onClick={() => void handleSelectColumn(column)}
                          >
                            <Eye className="h-4 w-4 text-cyan-500" />
                            {column.name}
                          </button>
                        </th>
                        <td className="py-3 pr-4 text-slate-600 dark:text-slate-300">
                          {column.type}
                        </td>
                        <td className="py-3 pr-4 text-slate-600 dark:text-slate-300">
                          {formatPercent(nullPercent, 1)}
                        </td>
                        <td className="py-3 text-slate-600 dark:text-slate-300">
                          {formatPercent(uniquePercent, 1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className={`${GLASS_CARD_CLASS} p-5`}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                  {selectedColumn?.name ?? "Column"} samples
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {selectedColumn
                    ? `${selectedColumn.type} column with ${formatNumber(selectedColumn.uniqueCount)} unique values`
                    : "Select a column to inspect values."}
                </p>
              </div>
              <button
                type="button"
                className={BUTTON_CLASS}
                onClick={() => selectedColumn && void handleSelectColumn(selectedColumn)}
                disabled={!selectedColumn || loadingColumn === selectedColumn.name}
              >
                {loadingColumn === selectedColumn?.name ? "Loading…" : "Refresh samples"}
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {sampleValues.length > 0 ? (
                sampleValues.map((sample) => (
                  <span
                    key={`${selectedColumn?.name ?? "sample"}-${sample}`}
                    className="rounded-full border border-white/15 bg-white/55 px-3 py-1.5 text-sm text-slate-700 dark:bg-slate-950/25 dark:text-slate-200"
                  >
                    {sample}
                  </span>
                ))
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No sample values available.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

export default function DataTypeOverview({
  tableName,
  columns,
}: DataTypeOverviewProps) {
  if (columns.length === 0) {
    return (
      <section className={`${GLASS_PANEL_CLASS} p-6`}>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Add profiled columns to inspect type distribution.
        </p>
      </section>
    );
  }

  return (
    <Suspense
      fallback={
        <section className={`${GLASS_PANEL_CLASS} p-6`}>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Loading schema overview…
          </p>
        </section>
      }
    >
      <DataTypeOverviewBody tableName={tableName} columns={columns} />
    </Suspense>
  );
}
