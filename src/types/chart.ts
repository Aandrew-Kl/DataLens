export type ChartType = "bar" | "line" | "pie" | "scatter" | "histogram" | "heatmap" | "area";

export interface ChartConfig {
  id: string;
  type: ChartType;
  title: string;
  xAxis?: string;
  yAxis?: string;
  groupBy?: string;
  aggregation?: "sum" | "avg" | "count" | "min" | "max";
  data?: Record<string, unknown>[];
  colorPalette?: string[];
}

export interface DashboardConfig {
  charts: ChartConfig[];
  metrics: MetricCard[];
}

export interface MetricCard {
  label: string;
  value: string | number;
  emoji: string;
  change?: string;
}
