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
