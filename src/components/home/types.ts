import type { LucideIcon } from "lucide-react";

export interface FileDropResult {
  fileName: string;
  csvContent: string;
  sizeBytes: number;
}

export interface HomeFeatureBadge {
  icon: LucideIcon;
  label: string;
  description: string;
}

export interface HomeFeatureCard {
  icon: LucideIcon;
  title: string;
  description: string;
}

export type AppTab =
  | "profile"
  | "dashboard"
  | "connectors"
  | "catalog"
  | "query"
  | "sql"
  | "charts"
  | "forecast"
  | "ml"
  | "explore"
  | "builder"
  | "transforms"
  | "wrangler"
  | "lineage"
  | "quality"
  | "clean"
  | "advanced"
  | "analytics"
  | "reports"
  | "pivot"
  | "compare"
  | "settings";
