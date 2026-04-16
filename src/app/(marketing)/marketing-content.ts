import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BrainCircuit,
  Code2,
  Database,
  GitBranch,
  Shield,
  Sparkles,
  Upload,
} from "lucide-react";

export interface MarketingFeature {
  icon: LucideIcon;
  title: string;
  description: string;
}

export interface WorkflowStep {
  icon: LucideIcon;
  title: string;
  description: string;
}

export interface ComparisonRow {
  label: string;
  description: string;
  values: {
    datalens: boolean | string;
    metabase: boolean | string;
    tableau: boolean | string;
    observable: boolean | string;
  };
}

export interface FooterLink {
  label: string;
  href: string;
  placeholder?: boolean;
}

export const GITHUB_REPO_URL = "https://github.com/Aandrew-Kl/DataLens";
export const DOCS_URL = "https://github.com/Aandrew-Kl/DataLens/tree/main/docs";

export const heroBadges = [
  "DuckDB-WASM on-device",
  "Local Ollama workflows",
  "MIT licensed",
] as const;

export const featureCards: MarketingFeature[] = [
  {
    icon: Database,
    title: "DuckDB in your browser",
    description:
      "Analytical SQL on millions of rows with zero setup. Load files, query instantly, and keep the whole runtime on-device.",
  },
  {
    icon: Sparkles,
    title: "Local AI assistant",
    description:
      "Natural language to SQL via Ollama, with prompts and data staying local instead of flowing through a cloud API.",
  },
  {
    icon: BarChart3,
    title: "Beautiful charts",
    description:
      "40+ interactive chart types with exports, drill-downs, and polished visuals for dashboards, reports, and one-off analysis.",
  },
  {
    icon: GitBranch,
    title: "Data pipelines",
    description:
      "Compose transforms visually, save reusable recipes, and turn repetitive cleanup into a repeatable browser-side workflow.",
  },
  {
    icon: BrainCircuit,
    title: "ML workflows",
    description:
      "Regression, clustering, forecasting, anomaly detection, and more without leaving the same privacy-first analytics surface.",
  },
  {
    icon: Shield,
    title: "Privacy first",
    description:
      "No telemetry, no tracking, and no vendor lock-in. Run it locally, inspect the code, or self-host it on your own terms.",
  },
];

export const workflowSteps: WorkflowStep[] = [
  {
    icon: Upload,
    title: "Upload CSV, JSON, or Excel",
    description:
      "Data is parsed client-side, loaded into DuckDB-WASM, and ready to explore without a backend ingestion pipeline.",
  },
  {
    icon: Code2,
    title: "Ask in plain English or write SQL",
    description:
      "Use Ollama-backed local AI for query generation, or drop into raw SQL when you want full control over the analysis.",
  },
  {
    icon: BarChart3,
    title: "Visualize, transform, and export",
    description:
      "Move from query to charts, pipelines, and ML outputs in one flow, then export the artifacts you want to keep.",
  },
];

export const stats = [
  { value: "328", label: "components", detail: "Reusable React building blocks across the platform." },
  { value: "1679", label: "tests passing", detail: "Regression coverage across app, hooks, stores, and utilities." },
  { value: "~240K", label: "lines of code", detail: "A serious codebase, not a thin demo wrapped in marketing copy." },
  { value: "100%", label: "open source (MIT)", detail: "Audit it, fork it, self-host it, and extend it freely." },
] as const;

export const comparisonRows: ComparisonRow[] = [
  {
    label: "Runs in browser",
    description: "Core analytics runtime executes on-device instead of requiring a hosted query tier.",
    values: {
      datalens: true,
      metabase: false,
      tableau: false,
      observable: "Limited",
    },
  },
  {
    label: "Local AI",
    description: "AI assistance can run against a local model instead of a vendor-managed cloud model.",
    values: {
      datalens: true,
      metabase: false,
      tableau: false,
      observable: false,
    },
  },
  {
    label: "Open source",
    description: "Source is available to inspect, fork, and extend.",
    values: {
      datalens: true,
      metabase: true,
      tableau: false,
      observable: false,
    },
  },
  {
    label: "Free self-host",
    description: "You can run the product on your own infrastructure without entering a paid contract.",
    values: {
      datalens: true,
      metabase: true,
      tableau: false,
      observable: false,
    },
  },
  {
    label: "No vendor lock-in",
    description: "You can keep your stack portable without tying core analytics to a single proprietary platform.",
    values: {
      datalens: true,
      metabase: true,
      tableau: false,
      observable: "Limited",
    },
  },
  {
    label: "Price",
    description: "Representative entry point from public pricing pages.",
    values: {
      datalens: "Free",
      metabase: "Free OSS / paid add-ons",
      tableau: "$15-$115 per user/mo",
      observable: "Free / $22 editor/mo",
    },
  },
  {
    label: "Enterprise SSO",
    description: "Centralized identity support for larger deployments.",
    values: {
      datalens: "Planned",
      metabase: true,
      tableau: true,
      observable: true,
    },
  },
];

export const footerLinks: FooterLink[] = [
  { label: "GitHub", href: GITHUB_REPO_URL },
  { label: "Docs", href: DOCS_URL },
  { label: "Blog", href: "#blog", placeholder: true },
  { label: "Twitter", href: "#twitter", placeholder: true },
];
