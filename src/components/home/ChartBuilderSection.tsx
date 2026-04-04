"use client";

import { useRef, useState } from "react";
import type ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import dynamic from "next/dynamic";

import type { ColumnProfile } from "@/types/dataset";
import ChartAnnotator from "@/components/charts/chart-annotator";
import ChartBuilder, {
  type SavedChartSnapshot,
} from "@/components/charts/chart-builder";
import ChartExport from "@/components/charts/chart-export";
import ChartGallery from "@/components/charts/chart-gallery";
import ChartRecommendations from "@/components/charts/chart-recommendations";
import ChartRenderer from "@/components/charts/chart-renderer";
import ChartTemplates from "@/components/charts/chart-templates";
import FunnelChart from "@/components/charts/funnel-chart";
import GeoChart from "@/components/charts/geo-chart";
import AreaChart from "@/components/charts/area-chart";
import BoxplotChart from "@/components/charts/boxplot-chart";
import DonutChart from "@/components/charts/donut-chart";
import GaugeChart from "@/components/charts/gauge-chart";
import HeatmapChart from "@/components/charts/heatmap-chart";
import ParallelCoordinates from "@/components/charts/parallel-coordinates";
import RadarChart from "@/components/charts/radar-chart";
import SankeyChart from "@/components/charts/sankey-chart";
import ScatterMatrix from "@/components/charts/scatter-matrix";
import SparklineGrid from "@/components/charts/sparkline-grid";
import TreemapChart from "@/components/charts/treemap-chart";
import WaterfallChart from "@/components/charts/waterfall-chart";
import { ErrorBoundary } from "@/components/ui/error-boundary";

import {
  AnimatedWorkspaceSection,
  ToolSection,
} from "@/components/home/workspace-shared";

const BoxPlot = dynamic(() => import("@/components/charts/box-plot"), {
  ssr: false,
});
const BubbleChartDyn = dynamic(() => import("@/components/charts/bubble-chart"), {
  ssr: false,
});
const CandlestickChart = dynamic(
  () => import("@/components/charts/candlestick-chart"),
  { ssr: false },
);
const ComboChart = dynamic(() => import("@/components/charts/combo-chart"), {
  ssr: false,
});
const DivergingBarChart = dynamic(
  () => import("@/components/charts/diverging-bar-chart"),
  { ssr: false },
);
const DotPlot = dynamic(() => import("@/components/charts/dot-plot"), {
  ssr: false,
});
const DumbbellChart = dynamic(
  () => import("@/components/charts/dumbbell-chart"),
  { ssr: false },
);
const HeatCalendar = dynamic(() => import("@/components/charts/heat-calendar"), {
  ssr: false,
});
const HistogramChart = dynamic(
  () => import("@/components/charts/histogram-chart"),
  { ssr: false },
);
const LollipopChart = dynamic(
  () => import("@/components/charts/lollipop-chart"),
  { ssr: false },
);
const NetworkGraph = dynamic(
  () => import("@/components/charts/network-graph"),
  { ssr: false },
);
const PictorialBar = dynamic(
  () => import("@/components/charts/pictorial-bar"),
  { ssr: false },
);
const PolarChart = dynamic(() => import("@/components/charts/polar-chart"), {
  ssr: false,
});
const SankeyDiagram = dynamic(
  () => import("@/components/charts/sankey-diagram"),
  { ssr: false },
);
const Scatter3D = dynamic(() => import("@/components/charts/3d-scatter"), {
  ssr: false,
});
const SlopeChart = dynamic(() => import("@/components/charts/slope-chart"), {
  ssr: false,
});
const StackedBarChart = dynamic(
  () => import("@/components/charts/stacked-bar-chart"),
  { ssr: false },
);
const SteppedLineChart = dynamic(
  () => import("@/components/charts/stepped-line-chart"),
  { ssr: false },
);
const SunburstChart = dynamic(
  () => import("@/components/charts/sunburst-chart"),
  { ssr: false },
);
const ViolinPlot = dynamic(() => import("@/components/charts/violin-plot"), {
  ssr: false,
});

interface ChartBuilderSectionProps {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
  fileName: string;
  savedCharts: SavedChartSnapshot[];
  completenessPct: number;
  onRemove: (chartId: string) => void;
  onEdit: (chart: {
    title: string;
    xAxis?: string;
    yAxis?: string;
    groupBy?: string;
    aggregation?: string;
  }) => void | Promise<void>;
}

export default function ChartBuilderSection({
  tableName,
  columns,
  rowCount,
  fileName,
  savedCharts,
  completenessPct,
  onRemove,
  onEdit,
}: ChartBuilderSectionProps) {
  const [showMoreCharts, setShowMoreCharts] = useState(false);
  const chartExportProxyRef = useRef<ReactEChartsCore | null>(
    {
      getEchartsInstance: () => {
        if (typeof document === "undefined") {
          return null;
        }

        const chartHost =
          document.querySelector<HTMLElement>(".echarts-for-react");
        return chartHost ? echarts.getInstanceByDom(chartHost) : null;
      },
    } as unknown as ReactEChartsCore,
  );

  const savedChartConfigs = savedCharts.map((chart) => chart.config);
  const savedChartData = Object.fromEntries(
    savedCharts.map((chart) => [chart.config.id, chart.data]),
  );

  return (
    <AnimatedWorkspaceSection>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
          Chart Builder
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Create custom visualizations with drag-and-drop chart configuration
        </p>
      </div>

      <ErrorBoundary>
        <ChartBuilder tableName={tableName} columns={columns} />
      </ErrorBoundary>

      <div className="mt-6">
        <ToolSection
          title="Chart Templates"
          description="Start from reusable visual patterns with auto-mapped fields and saved template presets."
        >
          <ErrorBoundary>
            <ChartTemplates tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </ToolSection>
      </div>

      <details className="group mt-6 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Chart Export Utility
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Export the current chart focus or batch-export every mounted
                chart from this workspace.
              </p>
            </div>
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
              Expand
            </span>
          </div>
        </summary>
        <div className="mt-4">
          <ErrorBoundary>
            <ChartExport chartRef={chartExportProxyRef} chartTitle={fileName} />
          </ErrorBoundary>
        </div>
      </details>

      <div className="mt-6 space-y-6">
        <ErrorBoundary>
          <ChartAnnotator tableName={tableName} columns={columns} />
        </ErrorBoundary>
        <ErrorBoundary>
          <ChartRecommendations
            tableName={tableName}
            columns={columns}
            rowCount={rowCount}
          />
        </ErrorBoundary>
        <ErrorBoundary>
          <ChartGallery
            charts={savedChartConfigs}
            chartData={savedChartData}
            onRemove={onRemove}
            onEdit={onEdit}
          />
        </ErrorBoundary>

        <ToolSection
          title="Standalone Renderer"
          description="Preview the shared chart renderer against a saved chart configuration without leaving the charts workspace."
        >
          <ErrorBoundary>
            {savedCharts[0] ? (
              <ChartRenderer
                config={savedCharts[0].config}
                data={
                  savedChartData[savedCharts[0].config.id] ?? savedCharts[0].data
                }
              />
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-white/70 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
                Save a chart from the builder to preview it in the standalone
                renderer.
              </div>
            )}
          </ErrorBoundary>
        </ToolSection>

        <ErrorBoundary>
          <SparklineGrid tableName={tableName} columns={columns} />
        </ErrorBoundary>
        <ErrorBoundary>
          <GeoChart tableName={tableName} columns={columns} />
        </ErrorBoundary>
        <ErrorBoundary>
          <ScatterMatrix tableName={tableName} columns={columns} />
        </ErrorBoundary>

        <ToolSection
          title="Area Chart"
          description="Layer aggregate trends over time or category buckets and compare grouped series with a stacked or standard area view."
        >
          <ErrorBoundary>
            <AreaChart tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </ToolSection>

        <ToolSection
          title="Donut Chart"
          description="Summarize categorical composition with configurable labels, top-slice grouping, and share-driven narrative cues."
        >
          <ErrorBoundary>
            <DonutChart tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </ToolSection>

        <ToolSection
          title="Heatmap Chart"
          description="Compare density and magnitude across paired dimensions with color-driven matrix views that work well for compact dashboards."
        >
          <ErrorBoundary>
            <HeatmapChart tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </ToolSection>

        <ToolSection
          title="Parallel Coordinates"
          description="Inspect multi-metric record shape, filter by grouped cohorts, and reveal cluster separation across many axes at once."
        >
          <ErrorBoundary>
            <ParallelCoordinates tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </ToolSection>

        <ToolSection
          title="Box Plot"
          description="Review quartiles, whiskers, and outlier points for one or more numeric columns before publishing summary statistics."
        >
          <ErrorBoundary>
            <BoxplotChart tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </ToolSection>

        <ToolSection
          title="Waterfall Chart"
          description="Track additive and subtractive contributions across ordered categories and export the result as a polished narrative chart."
        >
          <ErrorBoundary>
            <WaterfallChart tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </ToolSection>

        <ToolSection
          title="Funnel Chart"
          description="Visualize stage conversion, identify the largest drop-offs, and inspect throughput between each step."
        >
          <ErrorBoundary>
            <FunnelChart tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </ToolSection>

        <ToolSection
          title="Treemap Chart"
          description="Compare hierarchical category share with an area-based layout that works well for dense breakdowns."
        >
          <ErrorBoundary>
            <TreemapChart tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </ToolSection>

        <ToolSection
          title="Radar Chart"
          description="Overlay normalized metric performance across multiple axes to compare segments or the whole dataset at a glance."
        >
          <ErrorBoundary>
            <RadarChart tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </ToolSection>

        <ToolSection
          title="Sankey Chart"
          description="Aggregate flow between source and target dimensions to understand movement, drop-off, and throughput across categories."
        >
          <ErrorBoundary>
            <SankeyChart tableName={tableName} columns={columns} />
          </ErrorBoundary>
        </ToolSection>

        <ToolSection
          title="Chart Completeness Gauge"
          description="Keep a single KPI-style readout of dataset completeness inside the charting workspace."
        >
          <ErrorBoundary>
            <GaugeChart
              value={completenessPct}
              min={0}
              max={100}
              title="Dataset completeness"
            />
          </ErrorBoundary>
        </ToolSection>
      </div>

      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowMoreCharts((current) => !current)}
          className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-sky-600 dark:text-slate-200"
        >
          {showMoreCharts ? "▾" : "▸"} More Charts (20 available)
        </button>
        {showMoreCharts && (
          <div className="mt-4 grid gap-6">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Statistical Charts
            </h3>
            <ErrorBoundary>
              <BoxPlot tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <HistogramChart tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <ViolinPlot tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <DotPlot tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <Scatter3D tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <BubbleChartDyn tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <HeatCalendar tableName={tableName} columns={columns} />
            </ErrorBoundary>

            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Comparison Charts
            </h3>
            <ErrorBoundary>
              <StackedBarChart tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <DivergingBarChart tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <DumbbellChart tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <LollipopChart tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <SlopeChart tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <ComboChart tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <SteppedLineChart tableName={tableName} columns={columns} />
            </ErrorBoundary>

            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Specialty Charts
            </h3>
            <ErrorBoundary>
              <CandlestickChart tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <SankeyDiagram tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <SunburstChart tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <NetworkGraph tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <PolarChart tableName={tableName} columns={columns} />
            </ErrorBoundary>
            <ErrorBoundary>
              <PictorialBar tableName={tableName} columns={columns} />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </AnimatedWorkspaceSection>
  );
}
