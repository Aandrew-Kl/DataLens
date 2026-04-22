import type { Variants } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  CheckCircle2,
  Clock3,
  Layers3,
  Shield,
  Sigma,
} from "lucide-react";

import type { ColumnProfile } from "@/types/dataset";

export type DimensionKey =
  | "completeness"
  | "uniqueness"
  | "validity"
  | "consistency"
  | "timeliness";

export interface ColumnQualityRow {
  name: string;
  type: ColumnProfile["type"];
  nonNullCount: number;
  distinctCount: number;
  invalidCount: number;
  whitespaceCount: number;
  blankLikeCount: number;
  normalizedDistinctCount: number;
  latestTimestamp: string | null;
  earliestTimestamp: string | null;
  completeness: number;
  uniqueness: number;
  validity: number;
  consistency: number;
  timeliness: number | null;
  overall: number;
  flag: string;
}

export interface ChartDatum {
  label: string;
  value: number;
}

export interface DimensionSummary {
  key: DimensionKey;
  label: string;
  score: number;
  detailLabel: string;
  detailValue: string;
  helper: string;
  details: string[];
  chartData: ChartDatum[];
}

export interface DashboardMetrics {
  rowCount: number;
  overallScore: number;
  dimensions: Record<DimensionKey, DimensionSummary>;
  columnRows: ColumnQualityRow[];
  evaluatedAt: number;
}

export const HIGH_CARDINALITY_THRESHOLD = 0.8;

export const DIMENSION_META: Record<
  DimensionKey,
  {
    icon: LucideIcon;
    tone: string;
    color: string;
    accent: string;
  }
> = {
  completeness: {
    icon: CheckCircle2,
    tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    color: "#10b981",
    accent:
      "from-emerald-500/22 via-emerald-400/12 to-transparent dark:from-emerald-500/18 dark:via-emerald-400/8 dark:to-transparent",
  },
  uniqueness: {
    icon: Sigma,
    tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    color: "#06b6d4",
    accent:
      "from-cyan-500/22 via-cyan-400/12 to-transparent dark:from-cyan-500/18 dark:via-cyan-400/8 dark:to-transparent",
  },
  validity: {
    icon: Shield,
    tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    color: "#8b5cf6",
    accent:
      "from-violet-500/22 via-violet-400/12 to-transparent dark:from-violet-500/18 dark:via-violet-400/8 dark:to-transparent",
  },
  consistency: {
    icon: Layers3,
    tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    color: "#f59e0b",
    accent:
      "from-amber-500/22 via-amber-400/12 to-transparent dark:from-amber-500/18 dark:via-amber-400/8 dark:to-transparent",
  },
  timeliness: {
    icon: Clock3,
    tone: "border-sky-400/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    color: "#0ea5e9",
    accent:
      "from-sky-500/22 via-sky-400/12 to-transparent dark:from-sky-500/18 dark:via-sky-400/8 dark:to-transparent",
  },
};

export const EXECUTIVE_ACCENT_ICON = Activity;

export const TYPE_BADGE: Record<
  ColumnProfile["type"],
  {
    label: string;
    className: string;
  }
> = {
  string: {
    label: "String",
    className: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  },
  number: {
    label: "Number",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  date: {
    label: "Date",
    className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300",
  },
  boolean: {
    label: "Boolean",
    className:
      "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/50 dark:text-fuchsia-300",
  },
  unknown: {
    label: "Unknown",
    className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
};

export const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.35, ease: "easeOut" as const },
  },
};
