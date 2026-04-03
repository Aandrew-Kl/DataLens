"use client";

import {
  Suspense,
  use,
  useMemo,
} from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { HeatmapChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Download,
  Network,
  Rows4,
  ShieldCheck,
} from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  isRecord,
  quoteIdentifier,
  toCount,
} from "@/lib/utils/advanced-analytics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

interface NullPatternAnalyzerProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface PairStatistic {
  leftName: string;
  rightName: string;
  leftNullCount: number;
  rightNullCount: number;
  coNullCount: number;
  coNullRate: number;
  expectedCoNullCount: number;
  lift: number;
  correlation: number;
  classification: string;
}

interface NullPatternResult {
  rowCount: number;
  columnNames: string[];
  pairStats: PairStatistic[];
  totalNullCells: number;
  nearRandomPairs: number;
  structuredPairs: number;
  marAssessment: string;
  strongestPair: PairStatistic | null;
  error: string | null;
}

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

function buildNullPairQuery(tableName: string, columnNames: string[]) {
  const safeTable = quoteIdentifier(tableName);
  const pairQueries: string[] = [];

  for (let leftIndex = 0; leftIndex < columnNames.length; leftIndex += 1) {
    for (let rightIndex = leftIndex; rightIndex < columnNames.length; rightIndex += 1) {
      const leftName = columnNames[leftIndex] ?? "";
      const rightName = columnNames[rightIndex] ?? "";
      const leftField = quoteIdentifier(leftName);
      const rightField = quoteIdentifier(rightName);
      const escapedLeftName = leftName.replace(/'/g, "''");
      const escapedRightName = rightName.replace(/'/g, "''");

      pairQueries.push(`
        SELECT
          '${escapedLeftName}' AS left_name,
          '${escapedRightName}' AS right_name,
          COUNT(*) FILTER (WHERE ${leftField} IS NULL) AS left_null_count,
          COUNT(*) FILTER (WHERE ${rightField} IS NULL) AS right_null_count,
          COUNT(*) FILTER (WHERE ${leftField} IS NULL AND ${rightField} IS NULL) AS co_null_count
        FROM ${safeTable}
      `);
    }
  }

  return pairQueries.join(" UNION ALL ");
}

function computePhiCoefficient(
  rowCount: number,
  leftNullCount: number,
  rightNullCount: number,
  coNullCount: number,
) {
  if (rowCount <= 0) {
    return 0;
  }

  const a = coNullCount;
  const b = leftNullCount - coNullCount;
  const c = rightNullCount - coNullCount;
  const d = rowCount - a - b - c;
  const denominator = Math.sqrt(
    (a + b) * (c + d) * (a + c) * (b + d),
  );

  if (!Number.isFinite(denominator) || denominator === 0) {
    return 0;
  }

  return (a * d - b * c) / denominator;
}

function classifyPair(lift: number, expectedCoNullCount: number) {
  if (expectedCoNullCount <= 0) {
    return "Insufficient signal";
  }
  if (lift >= 1.5) {
    return "Structured";
  }
  if (lift <= 0.75) {
    return "Avoidant";
  }
  return "Near-random";
}

function loadNullPatternResult(
  tableName: string,
  columns: ColumnProfile[],
): Promise<NullPatternResult> {
  const analysisColumns = columns
    .filter((column) => column.nullCount > 0)
    .slice(0, 8);
  const columnNames = analysisColumns.map((column) => column.name);

  if (columnNames.length < 2) {
    return Promise.resolve({
      rowCount: 0,
      columnNames,
      pairStats: [],
      totalNullCells: analysisColumns.reduce(
        (sum, column) => sum + column.nullCount,
        0,
      ),
      nearRandomPairs: 0,
      structuredPairs: 0,
      marAssessment: "Insufficient signal",
      strongestPair: null,
      error: null,
    });
  }

  return Promise.all([
    runQuery(
      `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tableName)}`,
    ),
    runQuery(buildNullPairQuery(tableName, columnNames)),
  ])
    .then(([rowCountRows, pairRows]) => {
      const firstRow = rowCountRows[0];
      const rowCount = isRecord(firstRow) ? toCount(firstRow.row_count) : 0;
      const pairStats = pairRows
        .filter(isRecord)
        .map<PairStatistic>((row) => {
          const leftNullCount = toCount(row.left_null_count);
          const rightNullCount = toCount(row.right_null_count);
          const coNullCount = toCount(row.co_null_count);
          const expectedCoNullCount =
            rowCount > 0
              ? (leftNullCount * rightNullCount) / rowCount
              : 0;
          const lift =
            expectedCoNullCount > 0 ? coNullCount / expectedCoNullCount : 0;
          const correlation = computePhiCoefficient(
            rowCount,
            leftNullCount,
            rightNullCount,
            coNullCount,
          );

          return {
            leftName: String(row.left_name ?? ""),
            rightName: String(row.right_name ?? ""),
            leftNullCount,
            rightNullCount,
            coNullCount,
            coNullRate: rowCount > 0 ? (coNullCount / rowCount) * 100 : 0,
            expectedCoNullCount,
            lift,
            correlation,
            classification: classifyPair(lift, expectedCoNullCount),
          };
        });

      const comparablePairs = pairStats.filter(
        (pair) =>
          pair.leftName !== pair.rightName && pair.expectedCoNullCount > 0,
      );
      const nearRandomPairs = comparablePairs.filter(
        (pair) => pair.classification === "Near-random",
      ).length;
      const structuredPairs = comparablePairs.filter(
        (pair) => pair.classification === "Structured",
      ).length;
      const strongestPair =
        comparablePairs
          .slice()
          .sort(
            (left, right) =>
              Math.abs(right.correlation) - Math.abs(left.correlation) ||
              right.coNullCount - left.coNullCount,
          )[0] ?? null;

      let marAssessment = "Mixed pattern";
      if (comparablePairs.length === 0) {
        marAssessment = "Insufficient signal";
      } else if (nearRandomPairs / comparablePairs.length >= 0.6) {
        marAssessment = "Mostly random";
      } else if (structuredPairs / comparablePairs.length >= 0.4) {
        marAssessment = "Likely not random";
      }

      return {
        rowCount,
        columnNames,
        pairStats,
        totalNullCells: analysisColumns.reduce(
          (sum, column) => sum + column.nullCount,
          0,
        ),
        nearRandomPairs,
        structuredPairs,
        marAssessment,
        strongestPair,
        error: null,
      };
    })
    .catch((error: unknown) => ({
      rowCount: 0,
      columnNames,
      pairStats: [],
      totalNullCells: analysisColumns.reduce(
        (sum, column) => sum + column.nullCount,
        0,
      ),
      nearRandomPairs: 0,
      structuredPairs: 0,
      marAssessment: "Insufficient signal",
      strongestPair: null,
      error:
        error instanceof Error
          ? error.message
          : "Unable to analyze null patterns.",
    }));
}

function buildHeatmapOption(result: NullPatternResult): EChartsOption {
  const matrixPoints: Array<[number, number, number]> = [];
  const lookup = new Map<string, PairStatistic>();

  result.pairStats.forEach((pair) => {
    lookup.set(`${pair.leftName}::${pair.rightName}`, pair);
    lookup.set(`${pair.rightName}::${pair.leftName}`, pair);
  });

  result.columnNames.forEach((leftName, leftIndex) => {
    result.columnNames.forEach((rightName, rightIndex) => {
      const pair = lookup.get(`${leftName}::${rightName}`);
      matrixPoints.push([
        leftIndex,
        rightIndex,
        Number((pair?.coNullRate ?? 0).toFixed(2)),
      ]);
    });
  });

  return {
    animationDuration: 400,
    tooltip: {
      position: "top",
      formatter: (params: unknown) => {
        const safeParams = params as unknown;
        if (!isRecord(safeParams)) {
          return "";
        }

        const value = safeParams.value;
        if (!Array.isArray(value) || value.length < 3) {
          return "";
        }

        const xIndex = Number(value[0]);
        const yIndex = Number(value[1]);
        const coNullRate = Number(value[2]);
        const leftName = result.columnNames[xIndex] ?? "";
        const rightName = result.columnNames[yIndex] ?? "";
        const pair =
          result.pairStats.find(
            (entry) =>
              (entry.leftName === leftName && entry.rightName === rightName) ||
              (entry.leftName === rightName && entry.rightName === leftName),
          ) ?? null;

        return `${leftName} × ${rightName}<br/>Co-null rate: ${coNullRate.toFixed(
          2,
        )}%<br/>Lift: ${pair ? pair.lift.toFixed(2) : "0.00"}<br/>Phi: ${
          pair ? pair.correlation.toFixed(2) : "0.00"
        }`;
      },
    },
    grid: {
      left: 82,
      right: 18,
      top: 16,
      bottom: 80,
    },
    xAxis: {
      type: "category",
      data: result.columnNames,
      splitArea: {
        show: true,
      },
      axisLabel: {
        color: "#64748b",
        interval: 0,
        rotate: result.columnNames.length > 4 ? 24 : 0,
      },
    },
    yAxis: {
      type: "category",
      data: result.columnNames,
      splitArea: {
        show: true,
      },
      axisLabel: {
        color: "#64748b",
      },
    },
    visualMap: {
      min: 0,
      max: Math.max(
        1,
        ...matrixPoints.map((point) => Number(point[2] ?? 0)),
      ),
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 18,
      textStyle: {
        color: "#475569",
      },
      inRange: {
        color: ["#ecfeff", "#67e8f9", "#0891b2", "#155e75"],
      },
    },
    series: [
      {
        name: "Co-null %",
        type: "heatmap",
        data: matrixPoints,
        label: {
          show: true,
          formatter: (params: unknown) => {
            const safeParams = params as unknown;
            if (!isRecord(safeParams)) {
              return "";
            }
            const value = safeParams.value;
            if (!Array.isArray(value) || value.length < 3) {
              return "";
            }
            return `${Number(value[2]).toFixed(1)}%`;
          },
          color: "#082f49",
          fontSize: 11,
        },
        emphasis: {
          itemStyle: {
            borderColor: "#082f49",
            borderWidth: 1,
          },
        },
      },
    ],
  };
}

function LoadingState() {
  return (
    <div className={`${GLASS_PANEL_CLASS} p-6`}>
      <p className="text-sm text-slate-500 dark:text-slate-300">
        Mapping null co-occurrence…
      </p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
        Null Pattern Analyzer
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
        {message}
      </p>
    </section>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Rows4;
  label: string;
  value: string;
}) {
  return (
    <div className={`${GLASS_CARD_CLASS} p-4`}>
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function CorrelationMatrix({
  result,
}: {
  result: NullPatternResult;
}) {
  const lookup = useMemo(() => {
    const nextLookup = new Map<string, PairStatistic>();
    result.pairStats.forEach((pair) => {
      nextLookup.set(`${pair.leftName}::${pair.rightName}`, pair);
      nextLookup.set(`${pair.rightName}::${pair.leftName}`, pair);
    });
    return nextLookup;
  }, [result.pairStats]);

  return (
    <div className="overflow-auto rounded-3xl border border-white/20 bg-white/55 dark:bg-slate-900/35">
      <table className="min-w-full border-collapse">
        <thead className="bg-white/65 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:bg-slate-900/45 dark:text-slate-400">
          <tr>
            <th className="px-4 py-3">Column</th>
            {result.columnNames.map((name) => (
              <th key={name} className="px-4 py-3">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.columnNames.map((rowName) => (
            <tr
              key={rowName}
              className="border-t border-white/20 text-sm text-slate-700 dark:text-slate-200"
            >
              <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                {rowName}
              </td>
              {result.columnNames.map((columnName) => {
                const pair = lookup.get(`${rowName}::${columnName}`) ?? null;
                const value =
                  rowName === columnName
                    ? 1
                    : Number(pair?.correlation ?? 0);

                return (
                  <td key={`${rowName}-${columnName}`} className="px-4 py-3">
                    {value.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NullPatternPanel({
  resource,
  tableName,
}: {
  resource: Promise<NullPatternResult>;
  tableName: string;
}) {
  const result = use(resource);
  const heatmapOption = buildHeatmapOption(result);

  function handleExport() {
    const csv = rowsToCsv(
      result.pairStats.map((pair) => ({
        left_column: pair.leftName,
        right_column: pair.rightName,
        left_null_count: pair.leftNullCount,
        right_null_count: pair.rightNullCount,
        co_null_count: pair.coNullCount,
        co_null_rate: Number(pair.coNullRate.toFixed(2)),
        expected_co_null_count: Number(pair.expectedCoNullCount.toFixed(2)),
        lift: Number(pair.lift.toFixed(3)),
        null_correlation: Number(pair.correlation.toFixed(3)),
        classification: pair.classification,
      })),
    );

    downloadFile(
      csv,
      `${tableName}-null-patterns.csv`,
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
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={Rows4}
          label="Analyzed Rows"
          value={formatNumber(result.rowCount)}
        />
        <SummaryCard
          icon={Network}
          label="Null Cells"
          value={formatNumber(result.totalNullCells)}
        />
        <SummaryCard
          icon={ShieldCheck}
          label="Near-Random Pairs"
          value={formatNumber(result.nearRandomPairs)}
        />
        <SummaryCard
          icon={AlertTriangle}
          label="Structured Pairs"
          value={formatNumber(result.structuredPairs)}
        />
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
              Null Co-occurrence Heatmap
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              The heatmap shows the percentage of rows where each column pair is
              missing together.
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
            option={heatmapOption}
            notMerge
            lazyUpdate
            style={{ height: 380 }}
          />
        </div>
      </motion.section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className={`${GLASS_PANEL_CLASS} p-5`}>
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            Null Correlation Matrix
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Each cell is the phi correlation between the binary null indicators for
            two columns.
          </p>
          <div className="mt-4">
            <CorrelationMatrix result={result} />
          </div>
        </section>

        <section className={`${GLASS_PANEL_CLASS} p-5`}>
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
            Missing-at-Random Detection
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Assessment:{" "}
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {result.marAssessment}
            </span>
          </p>
          {result.strongestPair ? (
            <div className="mt-4 rounded-3xl border border-white/20 bg-white/55 p-4 dark:bg-slate-900/35">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Strongest Pair
              </p>
              <p className="mt-2 text-base font-semibold text-slate-950 dark:text-white">
                {result.strongestPair.leftName} × {result.strongestPair.rightName}
              </p>
              <dl className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <div className="flex items-center justify-between gap-4">
                  <dt>Co-null rows</dt>
                  <dd>{formatNumber(result.strongestPair.coNullCount)}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt>Lift</dt>
                  <dd>{result.strongestPair.lift.toFixed(2)}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt>Phi correlation</dt>
                  <dd>{result.strongestPair.correlation.toFixed(2)}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt>Classification</dt>
                  <dd>{result.strongestPair.classification}</dd>
                </div>
              </dl>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export default function NullPatternAnalyzer({
  tableName,
  columns,
}: NullPatternAnalyzerProps) {
  const analysisColumns = useMemo(
    () => columns.filter((column) => column.nullCount > 0).slice(0, 8),
    [columns],
  );
  const resource = useMemo(
    () => loadNullPatternResult(tableName, columns),
    [columns, tableName],
  );

  if (analysisColumns.length < 2) {
    return (
      <EmptyState message="Add at least two columns with missing values before comparing null patterns." />
    );
  }

  return (
    <section className="space-y-5">
      <div className={`${GLASS_PANEL_CLASS} p-5`}>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
          Null Structure
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
          Null Pattern Analyzer
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          Compare missing-value co-occurrence, surface structured gaps, and check
          whether missingness behaves more like random noise or a systematic pattern.
        </p>
      </div>

      <Suspense fallback={<LoadingState />}>
        <NullPatternPanel resource={resource} tableName={tableName} />
      </Suspense>
    </section>
  );
}
