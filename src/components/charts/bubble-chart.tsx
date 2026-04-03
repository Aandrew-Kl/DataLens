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
import { ScatterChart as EChartsScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import {
  CircleOff,
  Download,
  Palette,
  Scaling,
  Sparkles,
} from "lucide-react";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import { runQuery } from "@/lib/duckdb/client";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
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
import type { ColumnProfile } from "@/types/dataset";

echarts.use([
  EChartsScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface BubbleChartProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface BubblePoint {
  x: number;
  y: number;
  size: number;
  category: string;
  label: string;
  scaledSize: number;
}

interface BubbleSummary {
  points: BubblePoint[];
  categories: string[];
  minSize: number;
  maxSize: number;
  error: string | null;
}

const BUBBLE_COLORS = [
  "#22d3ee",
  "#34d399",
  "#f59e0b",
  "#f97316",
  "#a78bfa",
  "#f43f5e",
  "#2dd4bf",
  "#60a5fa",
] as const;

function BubbleChartLoading() {
  return (
    <div className={`${GLASS_PANEL_CLASS} flex min-h-[30rem] items-center justify-center`}>
      <div className="text-sm text-slate-500 dark:text-slate-300">
        Rendering bubble chart…
      </div>
    </div>
  );
}

function BubbleChartEmptyState({ message }: { message: string }) {
  return (
    <section className={`${GLASS_PANEL_CLASS} p-6`}>
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
            Bubble Chart
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

function scaleBubbleSize(value: number, min: number, max: number) {
  if (max <= min) {
    return 26;
  }

  const ratio = (value - min) / (max - min);
  return 14 + ratio * 28;
}

async function loadBubbleData(
  tableName: string,
  xColumn: string,
  yColumn: string,
  sizeColumn: string,
  colorColumn: string,
): Promise<BubbleSummary> {
  if (!xColumn || !yColumn || !sizeColumn || !colorColumn) {
    return {
      points: [],
      categories: [],
      minSize: 0,
      maxSize: 0,
      error: "Choose X, Y, bubble size, and color columns to render the chart.",
    };
  }

  const rows = await runQuery(`
    SELECT
      TRY_CAST(${quoteIdentifier(xColumn)} AS DOUBLE) AS x_value,
      TRY_CAST(${quoteIdentifier(yColumn)} AS DOUBLE) AS y_value,
      TRY_CAST(${quoteIdentifier(sizeColumn)} AS DOUBLE) AS size_value,
      CAST(${quoteIdentifier(colorColumn)} AS VARCHAR) AS color_value
    FROM ${quoteIdentifier(tableName)}
    WHERE TRY_CAST(${quoteIdentifier(xColumn)} AS DOUBLE) IS NOT NULL
      AND TRY_CAST(${quoteIdentifier(yColumn)} AS DOUBLE) IS NOT NULL
      AND TRY_CAST(${quoteIdentifier(sizeColumn)} AS DOUBLE) IS NOT NULL
      AND ${quoteIdentifier(colorColumn)} IS NOT NULL
    LIMIT 600
  `);

  const rawPoints = rows.flatMap<Omit<BubblePoint, "scaledSize">>((row) => {
    const x = toNumber(row.x_value);
    const y = toNumber(row.y_value);
    const size = toNumber(row.size_value);
    const category = typeof row.color_value === "string" ? row.color_value : null;

    if (x === null || y === null || size === null || category === null || category === "") {
      return [];
    }

    return [
      {
        x,
        y,
        size,
        category,
        label: category,
      },
    ];
  });

  if (rawPoints.length === 0) {
    return {
      points: [],
      categories: [],
      minSize: 0,
      maxSize: 0,
      error: "No complete numeric rows were available for the selected fields.",
    };
  }

  const counts = new Map<string, number>();
  for (const point of rawPoints) {
    counts.set(point.category, (counts.get(point.category) ?? 0) + 1);
  }

  const visibleCategories = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map((entry) => entry[0]);
  const categorySet = new Set(visibleCategories);
  const minSize = Math.min(...rawPoints.map((point) => point.size));
  const maxSize = Math.max(...rawPoints.map((point) => point.size));
  const points = rawPoints.map<BubblePoint>((point) => {
    const category = categorySet.has(point.category) ? point.category : "Other";
    return {
      ...point,
      category,
      label: category,
      scaledSize: scaleBubbleSize(point.size, minSize, maxSize),
    };
  });

  return {
    points,
    categories: Array.from(new Set(points.map((point) => point.category))),
    minSize,
    maxSize,
    error: null,
  };
}

function buildBubbleOption(
  result: BubbleSummary,
  dark: boolean,
  xColumn: string,
  yColumn: string,
  sizeColumn: string,
  colorColumn: string,
): EChartsOption {
  const textColor = dark ? "#cbd5e1" : "#475569";
  const borderColor = dark ? "#334155" : "#cbd5e1";

  return {
    animationDuration: 520,
    color: [...BUBBLE_COLORS],
    legend: {
      top: 0,
      data: result.categories,
      textStyle: { color: textColor },
    },
    grid: {
      left: 20,
      right: 20,
      top: 48,
      bottom: 24,
      containLabel: true,
    },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor,
      textStyle: { color: dark ? "#f8fafc" : "#0f172a" },
      formatter: (params: unknown) => {
        const item = Array.isArray(params) ? params[0] : params;
        if (!isRecord(item) || !isRecord(item.data)) {
          return "Bubble point";
        }

        const x = toNumber(item.data.xValue) ?? 0;
        const y = toNumber(item.data.yValue) ?? 0;
        const size = toNumber(item.data.sizeValue) ?? 0;
        const color = typeof item.data.colorValue === "string" ? item.data.colorValue : "";

        return [
          `<strong>${color}</strong>`,
          `${xColumn}: ${formatNumber(x)}`,
          `${yColumn}: ${formatNumber(y)}`,
          `${sizeColumn}: ${formatNumber(size)}`,
          `${colorColumn}: ${color}`,
        ].join("<br/>");
      },
    },
    xAxis: {
      type: "value",
      name: xColumn,
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
    },
    yAxis: {
      type: "value",
      name: yColumn,
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor },
    },
    series: result.categories.map((category) => ({
      type: "scatter",
      name: category,
      data: result.points
        .filter((point) => point.category === category)
        .map((point) => ({
          value: [point.x, point.y, point.size],
          xValue: point.x,
          yValue: point.y,
          sizeValue: point.size,
          colorValue: point.category,
          symbolSize: point.scaledSize,
        })),
      itemStyle: {
        opacity: 0.76,
      },
      emphasis: {
        scale: true,
      },
    })),
  };
}

function buildBubbleCsv(
  result: BubbleSummary,
  xColumn: string,
  yColumn: string,
  sizeColumn: string,
  colorColumn: string,
) {
  const rows = [
    [xColumn, yColumn, sizeColumn, colorColumn].map(escapeCsvCell).join(","),
    ...result.points.map((point) =>
      [
        escapeCsvCell(point.x),
        escapeCsvCell(point.y),
        escapeCsvCell(point.size),
        escapeCsvCell(point.category),
      ].join(","),
    ),
  ];

  return rows.join("\n");
}

function exportBubblePng(chartRef: ReactEChartsCore | null, fileName: string, dark: boolean) {
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

function BubbleMetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Scaling;
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

function BubbleChartReady({ tableName, columns }: BubbleChartProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const colorColumns = useMemo(() => columns, [columns]);
  const preferredColorColumn = useMemo(
    () =>
      columns.find((column) => column.type !== "number")?.name ??
      colorColumns[0]?.name ??
      "",
    [colorColumns, columns],
  );
  const [xColumn, setXColumn] = useState(numericColumns[0]?.name ?? "");
  const [yColumn, setYColumn] = useState(numericColumns[1]?.name ?? numericColumns[0]?.name ?? "");
  const [sizeColumn, setSizeColumn] = useState(
    numericColumns[2]?.name ?? numericColumns[0]?.name ?? "",
  );
  const [colorColumn, setColorColumn] = useState(preferredColorColumn);

  const safeX = numericColumns.some((column) => column.name === xColumn)
    ? xColumn
    : numericColumns[0]?.name ?? "";
  const safeY = numericColumns.some((column) => column.name === yColumn)
    ? yColumn
    : numericColumns[1]?.name ?? numericColumns[0]?.name ?? "";
  const safeSize = numericColumns.some((column) => column.name === sizeColumn)
    ? sizeColumn
    : numericColumns[2]?.name ?? numericColumns[0]?.name ?? "";
  const safeColor = colorColumns.some((column) => column.name === colorColumn)
    ? colorColumn
    : preferredColorColumn;

  const resource = useMemo(
    () =>
      loadBubbleData(tableName, safeX, safeY, safeSize, safeColor).catch((error) => ({
        points: [],
        categories: [],
        minSize: 0,
        maxSize: 0,
        error: error instanceof Error ? error.message : "Unable to build the bubble chart.",
      })),
    [safeColor, safeSize, safeX, safeY, tableName],
  );

  const result = use(resource);
  const option = useMemo(
    () => buildBubbleOption(result, dark, safeX, safeY, safeSize, safeColor),
    [dark, result, safeColor, safeSize, safeX, safeY],
  );

  if (numericColumns.length < 2) {
    return (
      <BubbleChartEmptyState message="At least two numeric columns are required to place bubbles on X and Y axes." />
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
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-300">
                <Sparkles className="h-3.5 w-3.5" />
                Bubble scatter
              </div>
              <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
                Compare four dimensions in a single plot
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Bubble area tracks magnitude, colors create legend groups, and every
                tooltip shows all mapped dimensions.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-sm text-slate-600 dark:text-slate-300">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  X-axis
                </span>
                <select
                  aria-label="Bubble X axis"
                  value={safeX}
                  onChange={(event) => startTransition(() => setXColumn(event.target.value))}
                  className={FIELD_CLASS}
                >
                  {numericColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-slate-600 dark:text-slate-300">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Y-axis
                </span>
                <select
                  aria-label="Bubble Y axis"
                  value={safeY}
                  onChange={(event) => startTransition(() => setYColumn(event.target.value))}
                  className={FIELD_CLASS}
                >
                  {numericColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-slate-600 dark:text-slate-300">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Bubble size
                </span>
                <select
                  aria-label="Bubble size"
                  value={safeSize}
                  onChange={(event) => startTransition(() => setSizeColumn(event.target.value))}
                  className={FIELD_CLASS}
                >
                  {numericColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-slate-600 dark:text-slate-300">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Color groups
                </span>
                <select
                  aria-label="Bubble color groups"
                  value={safeColor}
                  onChange={(event) => startTransition(() => setColorColumn(event.target.value))}
                  className={FIELD_CLASS}
                >
                  {colorColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <BubbleMetricCard
              label="Plotted rows"
              value={formatNumber(result.points.length)}
              icon={Scaling}
            />
            <BubbleMetricCard
              label="Legend groups"
              value={formatNumber(result.categories.length)}
              icon={Palette}
            />
            <BubbleMetricCard
              label="Size range"
              value={`${formatNumber(result.minSize)} to ${formatNumber(result.maxSize)}`}
              icon={CircleOff}
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
              Bubble plot
            </div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Categories outside the top eight most common groups are bucketed into “Other”.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-label="Export bubble chart PNG"
              onClick={() => exportBubblePng(chartRef.current, `${tableName}-bubble-chart.png`, dark)}
              className={BUTTON_CLASS}
            >
              <Download className="h-4 w-4" />
              Export PNG
            </button>
            <button
              type="button"
              aria-label="Export bubble chart CSV"
              onClick={() =>
                downloadFile(
                  buildBubbleCsv(result, safeX, safeY, safeSize, safeColor),
                  `${tableName}-bubble-chart.csv`,
                  "text/csv;charset=utf-8;",
                )
              }
              className={BUTTON_CLASS}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
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

export default function BubbleChart({ tableName, columns }: BubbleChartProps) {
  return (
    <Suspense fallback={<BubbleChartLoading />}>
      <BubbleChartReady tableName={tableName} columns={columns} />
    </Suspense>
  );
}
