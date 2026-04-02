import type { ChartType } from "@/types/chart";

export interface ReportConfig {
  title: string;
  description: string;
  widgets: ReportWidget[];
  createdAt: number;
}

export type ReportWidget =
  | ReportChartWidget
  | ReportTextWidget
  | ReportMetricWidget;

export interface ReportChartWidget {
  id: string;
  type: "chart";
  chartType: ChartType;
  title: string;
  sql: string;
  xAxis: string;
  yAxis: string;
  aggregation?: string;
}

export interface ReportTextWidget {
  id: string;
  type: "text";
  content: string;
}

export interface ReportMetricWidget {
  id: string;
  type: "metric";
  label: string;
  sql: string;
  format?: string;
}
