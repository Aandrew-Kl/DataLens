import {
  BarChart3,
  BrainCircuit,
  Code2,
  Compass,
  Database,
  Eraser,
  FileText,
  FlaskConical,
  GitBranch,
  GitMerge,
  LayoutGrid,
  Lock,
  MessageSquare,
  PieChart,
  Plug,
  RefreshCw,
  Shield,
  Sparkles,
  Table,
  Wand2,
  Wrench,
  Settings,
  Zap,
} from "lucide-react";

import {
  SAVED_CHARTS_STORAGE_KEY,
  type SavedChartSnapshot,
} from "@/components/charts/chart-builder";
import type {
  AppTab,
  HomeFeatureBadge,
  HomeFeatureCard,
} from "@/components/home/types";

export const TABS: Array<{
  id: AppTab;
  label: string;
  icon: typeof Database;
}> = [
  { id: "profile", label: "Profile", icon: Table },
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "connectors", label: "Connectors", icon: Plug },
  { id: "catalog", label: "Catalog", icon: Database },
  { id: "query", label: "Ask AI", icon: MessageSquare },
  { id: "sql", label: "SQL Editor", icon: Code2 },
  { id: "charts", label: "Charts", icon: PieChart },
  { id: "forecast", label: "Forecast", icon: RefreshCw },
  { id: "ml", label: "ML", icon: BrainCircuit },
  { id: "explore", label: "Explore", icon: Compass },
  { id: "builder", label: "Builder", icon: LayoutGrid },
  { id: "transforms", label: "Transforms", icon: Wand2 },
  { id: "quality", label: "Quality", icon: Shield },
  { id: "clean", label: "Clean", icon: Eraser },
  { id: "advanced", label: "Advanced", icon: FlaskConical },
  { id: "analytics", label: "Analytics", icon: GitMerge },
  { id: "compare", label: "Compare", icon: RefreshCw },
  { id: "pivot", label: "Pivot", icon: Table },
  { id: "wrangler", label: "Wrangler", icon: Wrench },
  { id: "lineage", label: "Lineage", icon: GitBranch },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings },
];

export const FEATURES: HomeFeatureBadge[] = [
  {
    icon: Database,
    label: "DuckDB-WASM",
    description: "Analytical SQL engine runs in your browser",
  },
  {
    icon: Sparkles,
    label: "AI-Powered",
    description: "Local AI via Ollama — no API keys needed",
  },
  {
    icon: Lock,
    label: "100% Private",
    description: "Your data never leaves your machine",
  },
  {
    icon: Zap,
    label: "Zero Cost",
    description: "Free and open source forever",
  },
];

export const LANDING_FEATURES: HomeFeatureCard[] = [
  {
    icon: BarChart3,
    title: "Auto-Dashboards",
    description:
      "Drop a file and get instant charts, KPIs, and insights — no configuration needed.",
  },
  {
    icon: MessageSquare,
    title: "Natural Language Queries",
    description:
      'Ask questions like "What are total sales by region?" and get instant SQL + results.',
  },
  {
    icon: Code2,
    title: "SQL Editor",
    description:
      "Full SQL editor with syntax highlighting, auto-complete, and instant execution.",
  },
  {
    icon: Shield,
    title: "Data Profiling",
    description:
      "Automatic column analysis, type detection, distributions, and quality scoring.",
  },
];

export function readSavedChartsFromStorage(): SavedChartSnapshot[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(SAVED_CHARTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SavedChartSnapshot[]) : [];
  } catch {
    return [];
  }
}
