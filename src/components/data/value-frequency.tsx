"use client";

import {
  Suspense,
  use,
  useDeferredValue,
  useMemo,
  useState,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  BarChart3,
  Download,
  ListFilter,
  Sigma,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber, formatPercent } from "@/lib/utils/formatters";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
  quoteIdentifier,
  toCount,
} from "@/lib/utils/advanced-analytics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface ValueFrequencyProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface FrequencyRow {
  label: string;
  frequency: number;
}

interface FrequencyResult {
  rows: FrequencyRow[];
  totalRows: number;
  nullBucketCount: number;
  error: string | null;
}

type RankingMode = "most" | "least";

function rowsToCsv(rows: Array<Record<string, string | number>>) {
  if (rows.length === 0) {
    return "";
  }

  const headers = Object.keys(rows[0] ?? {});
  const escapeCell = (value: string | number) => {
    const raw = String(value);
    return raw.includes(",") || raw.includes('"') || raw.includes("\n")
      ? `"${raw.replace(/"/g, '""')}"`
      : raw;
  };

  return [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((header) => escapeCell(row[header] ?? "")).join(","),
    ),
  ].join("\n");
}

function loadFrequencyRows(
  tableName: string,
  columnName: string,
): Promise<FrequencyResult> {
  const safeField = quoteIdentifier(columnName);
  const sql = `
    SELECT
      CASE
        WHEN ${safeField} IS NULL THEN '(null)'
        ELSE CAST(${safeField} AS VARCHAR)
      END AS value_label,
      COUNT(*) AS frequency
    FROM ${quoteIdentifier(tableName)}
    GROUP BY 1
    ORDER BY frequency DESC, value_label ASC
  `;

  return runQuery(sql)
    .then((rows) => {
      const mappedRows = rows
        .filter(isRecord)
        .map<FrequencyRow>((row) => ({
          label: String(row.value_label ?? ""),
          frequency: toCount(row.frequency),
        }));

      return {
        rows: mappedRows,
        totalRows: mappedRows.reduce((sum, row) => sum + row.frequency, 0),
        nullBucketCount:
          mappedRows.find((row) => row.label === "(null)")?.frequency ?? 0,
        error: null,
      };
    })
    .catch((error: unknown) => ({
      rows: [],
      totalRows: 0,
      nullBucketCount: 0,
      error:
        error instanceof Error
          ? error.message
          : "Unable to load the value frequency analysis.",
    }));
}

function buildFrequencyOption(
  rows: Array<FrequencyRow & { cumulativePercentage: number }>,
): EChartsOption {
  return {
    animationDuration: 400,
    legend: {
      top: 0,
      textStyle: {
        color: "#475569",
      },
    },
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => {
        const safeParams = Array.isArray(params) ? params : [params];
        const label = safeParams
          .find(isRecord)
          ?.name;
        const countPoint = safeParams.find(
          (entry) => isRecord(entry) && String(entry.seriesName ?? "") === "Frequency",
        );
        const cumulativePoint = safeParams.find(
          (entry) =>
            isRecord(entry) &&
            String(entry.seriesName ?? "") === "Cumulative %",
        );

        const countValue = isRecord(countPoint)
          ? formatNumber(toCount(countPoint.value))
          : "0";
        const cumulativeValue = isRecord(cumulativePoint)
          ? formatPercent(Number(cumulativePoint.value ?? 0))
          : "0.0%";

        return `${String(label ?? "")}<br/>Frequency: ${countValue}<br/>Cumulative: ${cumulativeValue}`;
      },
    },
    grid: {
      left: 18,
      right: 22,
      top: 54,
      bottom: 56,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: rows.map((row) => row.label),
      axisLabel: {
        color: "#64748b",
        interval: 0,
        rotate: rows.length > 5 ? 24 : 0,
      },
      axisLine: {
        lineStyle: {
          color: "#cbd5e1",
        },
      },
    },
    yAxis: [
      {
        type: "value",
        name: "Count",
        axisLabel: {
          color: "#64748b",
        },
        splitLine: {
          lineStyle: {
            color: "#e2e8f0",
            type: "dashed",
          },
        },
      },
      {
        type: "value",
        name: "Cumulative %",
        min: 0,
        max: 100,
        axisLabel: {
          color: "#64748b",
          formatter: (value: number) => `${value}%`,
        },
      },
    ],
    series: [
      {
        name: "Frequency",
        type: "bar",
        data: rows.map((row) => row.frequency),
        itemStyle: {
          color: "#0891b2",
          borderRadius: [10, 10, 0, 0],
        },
        barMaxWidth: 36,
      },
      {
        name: "Cumulative %",
        type: "line",
        yAxisIndex: 1,
        data: rows.map((row) => Number(row.cumulativePercentage.toFixed(2))),
        smooth: true,
        symbolSize: 8,
        lineStyle: {
          color: "#0f766e",
          width: 3,
        },
        itemStyle: {
          color: "#0f766e",
        },
      },
    ],
  };
}

function FrequencyLoadingState() {
  return (
    <div className={`${GLASS_PANEL_CLASS} p-6`}>
      <p className="text-sm text-slate-500 dark:text-slate-300">
        Reading value frequencies…
      </p>
    </div>
  );
}

function EmptyFrequencyState() {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
        Value Frequency
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
        Add at least one column before analyzing value frequency.
      </p>
    </section>
  );
}

function FrequencyTableRow({
  label,
  frequency,
  percentage,
  cumulativePercentage,
}: {
  label: string;
  frequency: number;
  percentage: number;
  cumulativePercentage: number;
}) {
  return (
    <tr className="border-t border-white/20 text-sm text-slate-700 dark:text-slate-200">
      <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
        {label}
      </td>
      <td className="px-4 py-3">{formatNumber(frequency)}</td>
      <td className="px-4 py-3">{formatPercent(percentage)}</td>
      <td className="px-4 py-3">{formatPercent(cumulativePercentage)}</td>
    </tr>
  );
}

function FrequencyPanel({
  resource,
  tableName,
  columnName,
  rankingMode,
  topN,
}: {
  resource: Promise<FrequencyResult>;
  tableName: string;
  columnName: string;
  rankingMode: RankingMode;
  topN: number;
}) {
  const result = use(resource);
  const limitedRows = useMemo(() => {
    const rankedRows =
      rankingMode === "most"
        ? [...result.rows]
        : [...result.rows].reverse();

    const slicedRows = rankedRows.slice(0, topN);
    const sliceTotal = slicedRows.reduce((sum, row) => sum + row.frequency, 0);

    const cumulativeSums = slicedRows.reduce<number[]>((acc, row, i) => {
      acc.push((acc[i - 1] ?? 0) + row.frequency);
      return acc;
    }, []);

    return slicedRows.map((row, i) => ({
      ...row,
      percentage: sliceTotal > 0 ? (row.frequency / sliceTotal) * 100 : 0,
      cumulativePercentage:
        sliceTotal > 0 ? ((cumulativeSums[i] ?? 0) / sliceTotal) * 100 : 0,
    }));
  }, [rankingMode, result.rows, topN]);
  const chartOption = buildFrequencyOption(limitedRows);

  function handleExport() {
    const csv = rowsToCsv(
      limitedRows.map((row) => ({
        value: row.label,
        frequency: row.frequency,
        percentage: Number(row.percentage.toFixed(2)),
        cumulative_percentage: Number(row.cumulativePercentage.toFixed(2)),
      })),
    );
    downloadFile(
      csv,
      `${tableName}-${columnName}-frequency.csv`,
      "text/csv;charset=utf-8;",
    );
  }

  if (result.error) {
    return (
      <div className={`${GLASS_PANEL_CLASS} border-rose-200/70 p-4 dark:border-rose-400/20`}>
        <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
          {result.error}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <div className={`${GLASS_PANEL_CLASS} p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Distinct Values
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            {formatNumber(result.rows.length)}
          </p>
        </div>
        <div className={`${GLASS_PANEL_CLASS} p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Total Rows
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            {formatNumber(result.totalRows)}
          </p>
        </div>
        <div className={`${GLASS_PANEL_CLASS} p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Null Bucket
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
            {formatNumber(result.nullBucketCount)}
          </p>
        </div>
      </div>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: ANALYTICS_EASE }}
        className={`${GLASS_PANEL_CLASS} p-5`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
              {rankingMode === "most" ? "Most Frequent Values" : "Least Frequent Values"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Compare raw frequency with the cumulative share carried by the selected slice.
            </p>
          </div>
          <button type="button" onClick={handleExport} className={BUTTON_CLASS}>
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>

        <div className="mt-4">
          <ReactEChartsCore
            echarts={echarts}
            option={chartOption}
            notMerge
            lazyUpdate
            style={{ height: 320 }}
          />
        </div>
      </motion.section>

      <section className={`${GLASS_PANEL_CLASS} overflow-hidden`}>
        <table className="min-w-full border-collapse">
          <thead className="bg-white/55 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:bg-slate-900/35 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Value</th>
              <th className="px-4 py-3">Frequency</th>
              <th className="px-4 py-3">Share</th>
              <th className="px-4 py-3">Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {limitedRows.map((row) => (
              <FrequencyTableRow
                key={row.label}
                label={row.label}
                frequency={row.frequency}
                percentage={row.percentage}
                cumulativePercentage={row.cumulativePercentage}
              />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default function ValueFrequency({
  tableName,
  columns,
}: ValueFrequencyProps) {
  const [selectedName, setSelectedName] = useState(columns[0]?.name ?? "");
  const [rankingMode, setRankingMode] = useState<RankingMode>("most");
  const [topNInput, setTopNInput] = useState("8");
  const deferredTopNInput = useDeferredValue(topNInput);
  const resolvedColumn =
    columns.find((column) => column.name === selectedName) ?? columns[0] ?? null;
  const topN = Math.min(
    25,
    Math.max(1, Number.parseInt(deferredTopNInput, 10) || 8),
  );
  const resource = useMemo(
    () =>
      resolvedColumn
        ? loadFrequencyRows(tableName, resolvedColumn.name)
        : Promise.resolve<FrequencyResult>({
            rows: [],
            totalRows: 0,
            nullBucketCount: 0,
            error: null,
          }),
    [resolvedColumn, tableName],
  );

  if (columns.length === 0) {
    return <EmptyFrequencyState />;
  }

  return (
    <section className="space-y-5">
      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
              Value Frequency
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
              Frequency Profile for {resolvedColumn?.name}
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Slice the most or least common values, then compare count dominance
              against cumulative coverage.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                <Sigma className="h-3.5 w-3.5" />
                Column
              </span>
              <select
                value={resolvedColumn?.name ?? ""}
                onChange={(event) => setSelectedName(event.target.value)}
                className={FIELD_CLASS}
              >
                {columns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                <ListFilter className="h-3.5 w-3.5" />
                Ranking
              </span>
              <select
                value={rankingMode}
                onChange={(event) =>
                  setRankingMode(event.target.value as RankingMode)
                }
                className={FIELD_CLASS}
              >
                <option value="most">Most frequent</option>
                <option value="least">Least frequent</option>
              </select>
            </label>

            <label className="text-sm text-slate-600 dark:text-slate-300">
              <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                <BarChart3 className="h-3.5 w-3.5" />
                Top N
              </span>
              <input
                value={topNInput}
                onChange={(event) => setTopNInput(event.target.value)}
                inputMode="numeric"
                className={FIELD_CLASS}
              />
            </label>
          </div>
        </div>
      </div>

      <Suspense fallback={<FrequencyLoadingState />}>
        <FrequencyPanel
          resource={resource}
          tableName={tableName}
          columnName={resolvedColumn?.name ?? ""}
          rankingMode={rankingMode}
          topN={topN}
        />
      </Suspense>
    </section>
  );
}
