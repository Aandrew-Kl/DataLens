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
import {
  HeatmapChart as EChartsHeatmapChart,
  LineChart as EChartsLineChart,
  ScatterChart as EChartsScatterChart,
} from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  Download,
  GitCompareArrows,
  Sigma,
  TableProperties,
} from "lucide-react";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
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
  toNumber,
} from "@/lib/utils/advanced-analytics";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  EChartsHeatmapChart,
  EChartsScatterChart,
  EChartsLineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

interface CorrelationExplorerProps {
  tableName: string;
  columns: ColumnProfile[];
}

type CorrelationMethod = "pearson" | "spearman";

interface CorrelationCell {
  left: string;
  right: string;
  value: number | null;
  pairCount: number;
}

interface CorrelationPair extends CorrelationCell {
  key: string;
}

interface CorrelationMatrixSummary {
  columns: string[];
  cells: CorrelationCell[];
  pairs: CorrelationPair[];
  error: string | null;
}

interface ScatterPoint {
  x: number;
  y: number;
}

interface ScatterPreview {
  points: ScatterPoint[];
  regression: Array<[number, number]>;
  error: string | null;
}

function CorrelationExplorerLoading() {
  return (
    <div className={`${GLASS_PANEL_CLASS} flex min-h-[34rem] items-center justify-center`}>
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Building correlation explorer…
      </div>
    </div>
  );
}

function CorrelationExplorerEmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <GitCompareArrows className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Correlation Explorer
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {message}
          </p>
        </div>
      </div>
    </section>
  );
}

function escapeCsvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n") ||
    stringValue.includes("\r")
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function pairKey(left: string, right: string) {
  return [left, right].sort((first, second) => first.localeCompare(second)).join("::");
}

function buildRegression(points: ScatterPoint[]) {
  if (points.length < 2) {
    return [] as Array<[number, number]>;
  }

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
    sumXY += point.x * point.y;
    sumXX += point.x * point.x;
  }

  const count = points.length;
  const denominator = count * sumXX - sumX * sumX;
  if (!Number.isFinite(denominator) || denominator === 0) {
    return [] as Array<[number, number]>;
  }

  const slope = (count * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / count;
  const xValues = points.map((point) => point.x);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);

  return [
    [minX, slope * minX + intercept],
    [maxX, slope * maxX + intercept],
  ] as Array<[number, number]>;
}

function buildCorrelationExpression(
  method: CorrelationMethod,
  leftColumn: string,
  rightColumn: string,
) {
  const safeLeft = quoteIdentifier(leftColumn);
  const safeRight = quoteIdentifier(rightColumn);

  if (method === "pearson") {
    return `
      SELECT
        '${leftColumn.replaceAll("'", "''")}' AS left_name,
        '${rightColumn.replaceAll("'", "''")}' AS right_name,
        corr(TRY_CAST(${safeLeft} AS DOUBLE), TRY_CAST(${safeRight} AS DOUBLE)) AS correlation_value,
        COUNT(*) FILTER (
          WHERE TRY_CAST(${safeLeft} AS DOUBLE) IS NOT NULL
            AND TRY_CAST(${safeRight} AS DOUBLE) IS NOT NULL
        ) AS pair_count
      FROM __base__
    `;
  }

  return `
    WITH paired AS (
      SELECT
        TRY_CAST(${safeLeft} AS DOUBLE) AS left_value,
        TRY_CAST(${safeRight} AS DOUBLE) AS right_value
      FROM __base__
      WHERE TRY_CAST(${safeLeft} AS DOUBLE) IS NOT NULL
        AND TRY_CAST(${safeRight} AS DOUBLE) IS NOT NULL
    ),
    ranked AS (
      SELECT
        left_value,
        right_value,
        RANK() OVER (ORDER BY left_value) AS left_rank,
        RANK() OVER (ORDER BY right_value) AS right_rank
      FROM paired
    )
    SELECT
      '${leftColumn.replaceAll("'", "''")}' AS left_name,
      '${rightColumn.replaceAll("'", "''")}' AS right_name,
      corr(left_rank, right_rank) AS correlation_value,
      COUNT(*) AS pair_count
    FROM ranked
  `;
}

async function loadCorrelationMatrix(
  tableName: string,
  selectedColumns: string[],
  method: CorrelationMethod,
): Promise<CorrelationMatrixSummary> {
  if (selectedColumns.length < 2) {
    return {
      columns: selectedColumns,
      cells: [],
      pairs: [],
      error: "Select at least two numeric columns to compute correlations.",
    };
  }

  const pairQueries = selectedColumns.flatMap((left, leftIndex) =>
    selectedColumns.slice(leftIndex).map((right) =>
      buildCorrelationExpression(method, left, right),
    ),
  );

  const query = `
    WITH __base__ AS (
      SELECT *
      FROM ${quoteIdentifier(tableName)}
    )
    ${pairQueries.join(" UNION ALL ")}
  `;
  const rows = await runQuery(query);
  const pairMap = new Map<string, CorrelationPair>();

  for (const row of rows) {
    const left = typeof row.left_name === "string" ? row.left_name : null;
    const right = typeof row.right_name === "string" ? row.right_name : null;
    const value = left === right ? 1 : toNumber(row.correlation_value);
    const pairCount = Math.max(0, Math.round(toNumber(row.pair_count) ?? 0));

    if (left === null || right === null) {
      continue;
    }

    pairMap.set(pairKey(left, right), {
      key: pairKey(left, right),
      left,
      right,
      value,
      pairCount,
    });
  }

  const cells = selectedColumns.flatMap<CorrelationCell>((left) =>
    selectedColumns.map((right) => {
      const pair = pairMap.get(pairKey(left, right));
      return {
        left,
        right,
        value: left === right ? 1 : pair?.value ?? null,
        pairCount: left === right ? 0 : pair?.pairCount ?? 0,
      };
    }),
  );

  return {
    columns: selectedColumns,
    cells,
    pairs: Array.from(pairMap.values()).filter((pair) => pair.left !== pair.right),
    error: null,
  };
}

async function loadScatterPreview(
  tableName: string,
  pair: CorrelationPair | null,
): Promise<ScatterPreview> {
  if (pair === null) {
    return {
      points: [],
      regression: [],
      error: "Select a correlation cell to inspect the scatter plot.",
    };
  }

  const rows = await runQuery(`
    SELECT
      TRY_CAST(${quoteIdentifier(pair.left)} AS DOUBLE) AS left_value,
      TRY_CAST(${quoteIdentifier(pair.right)} AS DOUBLE) AS right_value
    FROM ${quoteIdentifier(tableName)}
    WHERE TRY_CAST(${quoteIdentifier(pair.left)} AS DOUBLE) IS NOT NULL
      AND TRY_CAST(${quoteIdentifier(pair.right)} AS DOUBLE) IS NOT NULL
    USING SAMPLE 320 ROWS
  `);
  const points = rows.flatMap<ScatterPoint>((row) => {
    const x = toNumber(row.left_value);
    const y = toNumber(row.right_value);
    if (x === null || y === null) {
      return [];
    }
    return [{ x, y }];
  });

  if (points.length === 0) {
    return {
      points: [],
      regression: [],
      error: "The selected pair does not have overlapping numeric rows.",
    };
  }

  return {
    points,
    regression: buildRegression(points),
    error: null,
  };
}

function buildMatrixOption(
  summary: CorrelationMatrixSummary,
  dark: boolean,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";

  return {
    animationDuration: 380,
    tooltip: {
      position: "top",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const item = Array.isArray(params) ? params[0] : params;
        if (!isRecord(item) || !Array.isArray(item.value)) {
          return "Correlation cell";
        }

        const xIndex = Number(item.value[0] ?? 0);
        const yIndex = Number(item.value[1] ?? 0);
        const correlation = item.value[2];
        const pairCount = item.value[3];
        const left = summary.columns[yIndex] ?? "";
        const right = summary.columns[xIndex] ?? "";

        return [
          `<strong>${left}</strong> ↔ <strong>${right}</strong>`,
          `Correlation: ${typeof correlation === "number" ? correlation.toFixed(3) : "—"}`,
          `Paired rows: ${formatNumber(Number(pairCount ?? 0))}`,
        ].join("<br/>");
      },
    },
    grid: {
      left: 110,
      right: 24,
      top: 22,
      bottom: 70,
    },
    xAxis: {
      type: "category",
      data: summary.columns,
      axisLabel: {
        color: textColor,
        rotate: summary.columns.length > 6 ? 30 : 0,
      },
    },
    yAxis: {
      type: "category",
      data: summary.columns,
      axisLabel: { color: textColor },
    },
    visualMap: {
      min: -1,
      max: 1,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 12,
      textStyle: { color: textColor },
      inRange: {
        color: ["#dc2626", "#f8fafc", "#0284c7"],
      },
    },
    series: [
      {
        type: "heatmap",
        data: summary.cells.map((cell) => [
          summary.columns.indexOf(cell.right),
          summary.columns.indexOf(cell.left),
          cell.value,
          cell.pairCount,
        ]),
        label: {
          show: true,
          color: dark ? "#e2e8f0" : "#0f172a",
          fontSize: 10,
          formatter: (params: unknown) => {
            const item = params as { value?: [number, number, number | null] };
            const value = item.value?.[2];
            return typeof value === "number" ? value.toFixed(2) : "";
          },
        },
        itemStyle: {
          borderWidth: 1,
          borderColor: dark ? "#020617" : "#ffffff",
        },
      },
    ],
  };
}

function buildScatterOption(
  preview: ScatterPreview,
  pair: CorrelationPair | null,
  dark: boolean,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";

  return {
    animationDuration: 420,
    color: ["#22d3ee", "#f97316"],
    legend: {
      top: 0,
      data: ["Sampled points", "Trend line"],
      textStyle: { color: textColor },
    },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const item = Array.isArray(params) ? params[0] : params;
        if (!isRecord(item) || !Array.isArray(item.value)) {
          return "Scatter point";
        }

        return [
          `<strong>${pair?.left ?? "X"} vs ${pair?.right ?? "Y"}</strong>`,
          `${pair?.left ?? "X"}: ${formatNumber(Number(item.value[0] ?? 0))}`,
          `${pair?.right ?? "Y"}: ${formatNumber(Number(item.value[1] ?? 0))}`,
        ].join("<br/>");
      },
    },
    grid: {
      left: 24,
      right: 20,
      top: 48,
      bottom: 26,
      containLabel: true,
    },
    xAxis: {
      type: "value",
      name: pair?.left ?? "",
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
    },
    yAxis: {
      type: "value",
      name: pair?.right ?? "",
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
    },
    series: [
      {
        name: "Sampled points",
        type: "scatter",
        data: preview.points.map((point) => [point.x, point.y]),
        symbolSize: 8,
        itemStyle: { opacity: 0.74 },
      },
      {
        name: "Trend line",
        type: "line",
        data: preview.regression,
        symbol: "none",
        lineStyle: { width: 2, type: "dashed" },
      },
    ],
  };
}

function buildMatrixCsv(summary: CorrelationMatrixSummary, method: CorrelationMethod) {
  const rows = [
    "method,left_column,right_column,correlation,pair_count",
    ...summary.pairs.map((pair) =>
      [
        method,
        escapeCsvCell(pair.left),
        escapeCsvCell(pair.right),
        pair.value ?? "",
        pair.pairCount,
      ].join(","),
    ),
  ];

  return rows.join("\n");
}

function CorrelationMetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Sigma;
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

function ColumnChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200"
          : "border-white/20 bg-white/70 text-slate-700 dark:bg-slate-950/45 dark:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

function MethodButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-2.5 text-sm font-medium transition ${
        active
          ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200"
          : "border-white/20 bg-white/70 text-slate-700 dark:bg-slate-950/45 dark:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

function CorrelationExplorerReady({ tableName, columns }: CorrelationExplorerProps) {
  const dark = useDarkMode();
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const [selectedColumnNames, setSelectedColumnNames] = useState<string[]>(
    numericColumns.slice(0, 4).map((column) => column.name),
  );
  const [method, setMethod] = useState<CorrelationMethod>("pearson");
  const [selectedPairId, setSelectedPairId] = useState<string>("");

  const safeSelectedColumns = useMemo(() => {
    const filtered = selectedColumnNames.filter((name) =>
      numericColumns.some((column) => column.name === name),
    );

    return filtered.length > 0 ? filtered : numericColumns.slice(0, 4).map((column) => column.name);
  }, [numericColumns, selectedColumnNames]);

  const matrixResource = useMemo(
    () =>
      loadCorrelationMatrix(tableName, safeSelectedColumns, method).catch((error) => ({
        columns: safeSelectedColumns,
        cells: [],
        pairs: [],
        error: error instanceof Error ? error.message : "Unable to compute the correlation matrix.",
      })),
    [method, safeSelectedColumns, tableName],
  );

  const matrix = use(matrixResource);
  const activePair =
    matrix.pairs.find((pair) => pair.key === selectedPairId) ?? matrix.pairs[0] ?? null;
  const scatterResource = useMemo(
    () =>
      loadScatterPreview(tableName, activePair).catch((error) => ({
        points: [],
        regression: [],
        error: error instanceof Error ? error.message : "Unable to load the scatter preview.",
      })),
    [activePair, tableName],
  );
  const scatter = use(scatterResource);
  const matrixOption = useMemo(
    () => buildMatrixOption(matrix, dark),
    [dark, matrix],
  );
  const scatterOption = useMemo(
    () => buildScatterOption(scatter, activePair, dark),
    [activePair, dark, scatter],
  );

  const matrixEvents = useMemo<Record<string, (params: unknown) => void>>(
    () => ({
      click: (params: unknown) => {
        if (!isRecord(params) || !Array.isArray(params.value)) {
          return;
        }

        const xIndex = Number(params.value[0] ?? -1);
        const yIndex = Number(params.value[1] ?? -1);
        if (xIndex < 0 || yIndex < 0 || xIndex === yIndex) {
          return;
        }

        const left = matrix.columns[yIndex];
        const right = matrix.columns[xIndex];
        if (!left || !right) {
          return;
        }

        startTransition(() => setSelectedPairId(pairKey(left, right)));
      },
    }),
    [matrix.columns],
  );

  if (numericColumns.length < 2) {
    return (
      <CorrelationExplorerEmptyState message="At least two numeric columns are required to explore pairwise correlations." />
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
        <div className="grid gap-4 xl:grid-cols-[1.12fr_0.88fr]">
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
                <GitCompareArrows className="h-3.5 w-3.5" />
                Correlation explorer
              </div>
              <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                Inspect the full correlation matrix and drill into individual pairs
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Switch between Pearson and Spearman, select the numeric columns to
                include, then click a matrix cell to open a scatter preview.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {numericColumns.map((column) => {
                const active = safeSelectedColumns.includes(column.name);
                return (
                  <ColumnChip
                    key={column.name}
                    active={active}
                    label={column.name}
                    onClick={() =>
                      startTransition(() => {
                        setSelectedColumnNames((current) => {
                          if (current.includes(column.name)) {
                            return current.filter((name) => name !== column.name);
                          }
                          return [...current, column.name];
                        });
                      })
                    }
                  />
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2">
              <MethodButton
                active={method === "pearson"}
                label="Pearson"
                onClick={() => startTransition(() => setMethod("pearson"))}
              />
              <MethodButton
                active={method === "spearman"}
                label="Spearman"
                onClick={() => startTransition(() => setMethod("spearman"))}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <CorrelationMetricCard
              label="Selected columns"
              value={formatNumber(safeSelectedColumns.length)}
              icon={TableProperties}
            />
            <CorrelationMetricCard
              label="Pair count"
              value={formatNumber(matrix.pairs.length)}
              icon={GitCompareArrows}
            />
            <CorrelationMetricCard
              label="Active method"
              value={method === "pearson" ? "Pearson" : "Spearman"}
              icon={Sigma}
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
              Correlation matrix
            </div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Click any off-diagonal cell to inspect the scatter plot for that pair.
            </div>
          </div>

          <button
            type="button"
            aria-label="Export correlation CSV"
            onClick={() =>
              downloadFile(
                buildMatrixCsv(matrix, method),
                `${tableName}-${method}-correlation-matrix.csv`,
                "text/csv;charset=utf-8;",
              )
            }
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>

        {matrix.error ? (
          <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 px-4 py-5 text-sm text-rose-700 dark:text-rose-300">
            {matrix.error}
          </div>
        ) : (
          <ReactEChartsCore
            echarts={echarts}
            option={matrixOption}
            onEvents={matrixEvents}
            notMerge
            lazyUpdate
            style={{ height: 420 }}
          />
        )}
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.48, ease: ANALYTICS_EASE }}
        className={`${GLASS_PANEL_CLASS} p-5`}
      >
        <div className="mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Scatter preview
          </div>
          <h3 className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">
            {activePair
              ? `Scatter preview for ${activePair.left} vs ${activePair.right}`
              : "Scatter preview"}
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {activePair
              ? `The selected cell has ${formatNumber(activePair.pairCount)} paired rows.`
              : "Choose a correlation cell to inspect sampled points."}
          </p>
        </div>

        {scatter.error ? (
          <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 px-4 py-5 text-sm text-rose-700 dark:text-rose-300">
            {scatter.error}
          </div>
        ) : (
          <ReactEChartsCore
            echarts={echarts}
            option={scatterOption}
            notMerge
            lazyUpdate
            style={{ height: 360 }}
          />
        )}
      </motion.section>
    </div>
  );
}

export default function CorrelationExplorer(props: CorrelationExplorerProps) {
  return (
    <Suspense fallback={<CorrelationExplorerLoading />}>
      <CorrelationExplorerReady {...props} />
    </Suspense>
  );
}
