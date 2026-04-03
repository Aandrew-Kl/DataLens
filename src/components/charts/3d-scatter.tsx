"use client";

import { Suspense, use, useMemo, useRef, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { motion } from "framer-motion";
import { Cuboid, Download, Loader2, Orbit } from "lucide-react";
import { runQuery } from "@/lib/duckdb/client";
import { useDarkMode } from "@/lib/hooks/use-dark-mode";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
  dataUrlToBytes,
  quoteIdentifier,
  toNumber,
} from "@/lib/utils/advanced-analytics";
import { downloadFile } from "@/lib/utils/export";
import { formatNumber } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

echarts.use([ScatterChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface Scatter3DProps {
  tableName: string;
  columns: ColumnProfile[];
}

interface Scatter3DPoint {
  x: number;
  y: number;
  z: number;
  category: string | null;
}

interface Scatter3DResult {
  points: Scatter3DPoint[];
  totalRows: number;
  glAvailable: boolean;
  error: string | null;
}

interface Scatter3DReadyProps {
  tableName: string;
  xColumn: string;
  yColumn: string;
  zColumn: string;
  pitch: number;
  yaw: number;
  zoom: number;
  promise: Promise<Scatter3DResult>;
}

async function detectEChartsGl() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const importer = new Function(
      "specifier",
      "return import(specifier);",
    ) as (specifier: string) => Promise<unknown>;
    await importer("echarts-gl");
    return true;
  } catch {
    return false;
  }
}

async function loadScatter3DData(
  tableName: string,
  xColumn: string,
  yColumn: string,
  zColumn: string,
  categoryColumn: string,
): Promise<Scatter3DResult> {
  if (!xColumn || !yColumn || !zColumn) {
    return {
      points: [],
      totalRows: 0,
      glAvailable: false,
      error: "Choose X, Y, and Z numeric columns.",
    };
  }

  try {
    const [glAvailable, rows] = await Promise.all([
      detectEChartsGl(),
      runQuery(`
        SELECT
          TRY_CAST(${quoteIdentifier(xColumn)} AS DOUBLE) AS x_value,
          TRY_CAST(${quoteIdentifier(yColumn)} AS DOUBLE) AS y_value,
          TRY_CAST(${quoteIdentifier(zColumn)} AS DOUBLE) AS z_value
          ${categoryColumn ? `, CAST(${quoteIdentifier(categoryColumn)} AS VARCHAR) AS category_value` : ""}
        FROM ${quoteIdentifier(tableName)}
        WHERE TRY_CAST(${quoteIdentifier(xColumn)} AS DOUBLE) IS NOT NULL
          AND TRY_CAST(${quoteIdentifier(yColumn)} AS DOUBLE) IS NOT NULL
          AND TRY_CAST(${quoteIdentifier(zColumn)} AS DOUBLE) IS NOT NULL
        LIMIT 400
      `),
    ]);

    const points = rows.flatMap<Scatter3DPoint>((row) => {
      const x = toNumber(row.x_value);
      const y = toNumber(row.y_value);
      const z = toNumber(row.z_value);
      if (x === null || y === null || z === null) {
        return [];
      }
      return [
        {
          x,
          y,
          z,
          category: categoryColumn ? String(row.category_value ?? "Unspecified") : null,
        },
      ];
    });

    return {
      points,
      totalRows: points.length,
      glAvailable,
      error: points.length === 0 ? "DuckDB returned no points for the selected axes." : null,
    };
  } catch (error) {
    return {
      points: [],
      totalRows: 0,
      glAvailable: false,
      error: error instanceof Error ? error.message : "Unable to render the 3D scatter plot.",
    };
  }
}

function projectPoint(point: Scatter3DPoint, pitch: number, yaw: number, zoom: number) {
  const pitchRadians = (pitch * Math.PI) / 180;
  const yawRadians = (yaw * Math.PI) / 180;

  const rotatedX = point.x * Math.cos(yawRadians) - point.z * Math.sin(yawRadians);
  const rotatedZ = point.x * Math.sin(yawRadians) + point.z * Math.cos(yawRadians);
  const rotatedY = point.y * Math.cos(pitchRadians) - rotatedZ * Math.sin(pitchRadians);
  const depth = point.y * Math.sin(pitchRadians) + rotatedZ * Math.cos(pitchRadians);

  return {
    x: rotatedX * zoom,
    y: rotatedY * zoom,
    depth,
  };
}

function buildProjectedOption(
  result: Scatter3DResult,
  dark: boolean,
  xColumn: string,
  yColumn: string,
  zColumn: string,
  pitch: number,
  yaw: number,
  zoom: number,
): EChartsOption {
  const categories = Array.from(
    new Set(result.points.map((point) => point.category ?? "All rows")),
  );
  const grouped = categories.map((category) => ({
    name: category,
    points: result.points
      .filter((point) => (point.category ?? "All rows") === category)
      .map((point) => {
        const projected = projectPoint(point, pitch, yaw, zoom);
        return [
          projected.x,
          projected.y,
          point.x,
          point.y,
          point.z,
          projected.depth,
        ];
      }),
  }));

  return {
    animationDuration: 380,
    color: ["#38bdf8", "#14b8a6", "#f97316", "#a855f7"],
    legend: { top: 0, textStyle: { color: dark ? "#e2e8f0" : "#0f172a" } },
    grid: { left: 48, right: 24, top: 24, bottom: 48 },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "#020617ee" : "#ffffffee",
      borderColor: dark ? "#334155" : "#cbd5e1",
      textStyle: { color: dark ? "#e2e8f0" : "#0f172a" },
      formatter: (params: unknown) => {
        const record = params as unknown as { data?: number[]; seriesName?: string };
        if (!Array.isArray(record.data)) {
          return "Projected point";
        }
        const [, , rawX, rawY, rawZ] = record.data;
        return [
          String(record.seriesName ?? "Point"),
          `${xColumn}: ${formatNumber(Number(rawX ?? 0))}`,
          `${yColumn}: ${formatNumber(Number(rawY ?? 0))}`,
          `${zColumn}: ${formatNumber(Number(rawZ ?? 0))}`,
        ].join("<br/>");
      },
    },
    xAxis: {
      type: "value",
      name: `${xColumn} / ${zColumn}`,
      axisLabel: { color: dark ? "#cbd5e1" : "#334155" },
      splitLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" } },
    },
    yAxis: {
      type: "value",
      name: yColumn,
      axisLabel: { color: dark ? "#cbd5e1" : "#334155" },
      splitLine: { lineStyle: { color: dark ? "#1e293b" : "#e2e8f0", type: "dashed" } },
    },
    series: grouped.map((group) => ({
      name: group.name,
      type: "scatter",
      data: group.points,
      symbolSize: 10,
      itemStyle: { opacity: 0.78 },
    })),
  };
}

function buildScatter3DOption(
  result: Scatter3DResult,
  xColumn: string,
  yColumn: string,
  zColumn: string,
  pitch: number,
  yaw: number,
  zoom: number,
): EChartsOption {
  return {
    tooltip: {
      formatter: (params: unknown) => {
        const record = params as unknown as { value?: number[] };
        const values = Array.isArray(record.value) ? record.value : [];
        return [
          `${xColumn}: ${formatNumber(Number(values[0] ?? 0))}`,
          `${yColumn}: ${formatNumber(Number(values[1] ?? 0))}`,
          `${zColumn}: ${formatNumber(Number(values[2] ?? 0))}`,
        ].join("<br/>");
      },
    },
    xAxis3D: { name: xColumn, type: "value" },
    yAxis3D: { name: yColumn, type: "value" },
    zAxis3D: { name: zColumn, type: "value" },
    grid3D: {
      viewControl: {
        alpha: pitch,
        beta: yaw,
        distance: Math.round(180 / Math.max(zoom, 0.4)),
      },
    },
    series: [
      {
        type: "scatter3D",
        data: result.points.map((point) => [point.x, point.y, point.z]),
      },
    ],
  } as unknown as EChartsOption;
}

function exportChartPng(chartRef: ReactEChartsCore | null, dark: boolean, fileName: string) {
  const instance = chartRef?.getEchartsInstance();
  if (!instance) {
    return;
  }
  const output = dataUrlToBytes(
    instance.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: dark ? "#020617" : "#f8fafc",
    }),
  );
  downloadFile([output.bytes], fileName, output.mimeType);
}

function Scatter3DLoading() {
  return (
    <div className={`${GLASS_CARD_CLASS} flex min-h-[24rem] items-center justify-center p-6 text-sm text-slate-600 dark:text-slate-300`}>
      Loading 3D scatter…
    </div>
  );
}

function Scatter3DReady({
  tableName,
  xColumn,
  yColumn,
  zColumn,
  pitch,
  yaw,
  zoom,
  promise,
}: Scatter3DReadyProps) {
  const dark = useDarkMode();
  const chartRef = useRef<ReactEChartsCore | null>(null);
  const result = use(promise);
  const option = useMemo(
    () => (
      result.glAvailable
        ? buildScatter3DOption(result, xColumn, yColumn, zColumn, pitch, yaw, zoom)
        : buildProjectedOption(result, dark, xColumn, yColumn, zColumn, pitch, yaw, zoom)
    ),
    [dark, pitch, result, xColumn, yColumn, yaw, zColumn, zoom],
  );

  if (result.error) {
    return (
      <div className={`${GLASS_CARD_CLASS} p-6 text-sm text-slate-600 dark:text-slate-300`}>
        {result.error}
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
      <div className={`${GLASS_CARD_CLASS} p-5`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Explore X, Y, and Z relationships with rotation controls
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {result.glAvailable
                ? "ECharts GL is available, so the chart uses scatter3D."
                : "ECharts GL is unavailable in this workspace, so this view uses a rotatable projected fallback."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => exportChartPng(chartRef.current, dark, `${tableName}-3d-scatter.png`)}
            className={BUTTON_CLASS}
          >
            <Download className="h-4 w-4" />
            Export PNG
          </button>
        </div>

        <div className="mt-5 h-[24rem]">
          <ReactEChartsCore
            ref={chartRef}
            echarts={echarts}
            option={option}
            notMerge
            lazyUpdate
            style={{ height: "100%", width: "100%" }}
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Points rendered
          </div>
          <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
            {formatNumber(result.totalRows)}
          </div>
        </div>
        <div className={`${GLASS_CARD_CLASS} p-5`}>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Rotation
          </div>
          <div className="mt-3 text-sm text-slate-700 dark:text-slate-200">
            Pitch {pitch}°, yaw {yaw}°, zoom {zoom.toFixed(1)}×
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Scatter3D({ tableName, columns }: Scatter3DProps) {
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "number"),
    [columns],
  );
  const categoryColumns = useMemo(
    () => columns.filter((column) => column.type === "string" || column.type === "boolean"),
    [columns],
  );

  const [xColumn, setXColumn] = useState("");
  const [yColumn, setYColumn] = useState("");
  const [zColumn, setZColumn] = useState("");
  const [categoryColumn, setCategoryColumn] = useState("");
  const [pitch, setPitch] = useState("30");
  const [yaw, setYaw] = useState("35");
  const [zoom, setZoom] = useState("1");

  const activeXColumn =
    numericColumns.find((column) => column.name === xColumn)?.name ??
    numericColumns[0]?.name ??
    "";
  const activeYColumn =
    numericColumns.find((column) => column.name === yColumn)?.name ??
    numericColumns[1]?.name ??
    numericColumns[0]?.name ??
    "";
  const activeZColumn =
    numericColumns.find((column) => column.name === zColumn)?.name ??
    numericColumns[2]?.name ??
    numericColumns[0]?.name ??
    "";
  const activeCategoryColumn =
    categoryColumns.find((column) => column.name === categoryColumn)?.name ?? "";
  const parsedPitch = Number.parseInt(pitch, 10);
  const parsedYaw = Number.parseInt(yaw, 10);
  const parsedZoom = Number.parseFloat(zoom);
  const activePitch = Number.isFinite(parsedPitch) ? parsedPitch : 30;
  const activeYaw = Number.isFinite(parsedYaw) ? parsedYaw : 35;
  const activeZoom = Number.isFinite(parsedZoom) ? parsedZoom : 1;

  const promise = useMemo(
    () => loadScatter3DData(tableName, activeXColumn, activeYColumn, activeZColumn, activeCategoryColumn),
    [activeCategoryColumn, activeXColumn, activeYColumn, activeZColumn, tableName],
  );

  if (numericColumns.length < 3) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.34, ease: ANALYTICS_EASE }}
        className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
      >
        <div className={`${GLASS_CARD_CLASS} flex min-h-[18rem] flex-col items-center justify-center gap-4 p-6 text-center`}>
          <Orbit className="h-8 w-8 text-slate-400 dark:text-slate-500" />
          <div className="space-y-2">
            <div className="text-lg font-semibold text-slate-950 dark:text-white">
              3D scatter needs three numeric columns
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-300">
              Choose X, Y, and Z numeric columns.
            </div>
          </div>
        </div>
      </motion.section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: ANALYTICS_EASE }}
      className={`${GLASS_PANEL_CLASS} overflow-hidden p-6`}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
              <Cuboid className="h-4 w-4" />
              3D Scatter
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">
              Plot numeric points across X, Y, and Z axes
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Select three numeric dimensions, optionally color by category, and rotate or zoom the view.
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-4">
          <label>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              X axis
            </span>
            <select
              aria-label="X axis"
              value={activeXColumn}
              onChange={(event) => setXColumn(event.target.value)}
              className={FIELD_CLASS}
            >
              {numericColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Y axis
            </span>
            <select
              aria-label="Y axis"
              value={activeYColumn}
              onChange={(event) => setYColumn(event.target.value)}
              className={FIELD_CLASS}
            >
              {numericColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Z axis
            </span>
            <select
              aria-label="Z axis"
              value={activeZColumn}
              onChange={(event) => setZColumn(event.target.value)}
              className={FIELD_CLASS}
            >
              {numericColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Color by
            </span>
            <select
              aria-label="Color by category"
              value={activeCategoryColumn}
              onChange={(event) => setCategoryColumn(event.target.value)}
              className={FIELD_CLASS}
            >
              <option value="">None</option>
              {categoryColumns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <label>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Pitch
            </span>
            <input
              aria-label="Pitch"
              value={pitch}
              onChange={(event) => setPitch(event.target.value)}
              className={FIELD_CLASS}
              inputMode="numeric"
            />
          </label>
          <label>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Yaw
            </span>
            <input
              aria-label="Yaw"
              value={yaw}
              onChange={(event) => setYaw(event.target.value)}
              className={FIELD_CLASS}
              inputMode="numeric"
            />
          </label>
          <label>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Zoom
            </span>
            <input
              aria-label="Zoom"
              value={zoom}
              onChange={(event) => setZoom(event.target.value)}
              className={FIELD_CLASS}
              inputMode="decimal"
            />
          </label>
        </div>

        <Suspense fallback={<Scatter3DLoading />}>
          <Scatter3DReady
            tableName={tableName}
            xColumn={activeXColumn}
            yColumn={activeYColumn}
            zColumn={activeZColumn}
            pitch={activePitch}
            yaw={activeYaw}
            zoom={activeZoom}
            promise={promise}
          />
        </Suspense>
      </div>
    </motion.section>
  );
}
