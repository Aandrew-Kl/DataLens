"use client";

import type { ReactNode } from "react";
import { Bot, Container, Database, Shield, type LucideIcon } from "lucide-react";

export const FEATURES: {
  icon: LucideIcon;
  label: string;
  description: string;
}[] = [
  { icon: Database, label: "DuckDB", description: "Fast local analytics engine." },
  { icon: Bot, label: "Ollama", description: "Optional on-device AI assistant." },
  { icon: Shield, label: "MIT", description: "Open source and permissive." },
  { icon: Container, label: "Docker", description: "Runs cleanly in a container." },
];

export const SQL_TEMPLATES = [
  {
    id: "revenue",
    title: "Top 10 countries by revenue",
    description: "Rank country-level revenue from ecommerce orders.",
    code: "SELECT country, SUM(total_amount) AS revenue FROM ecommerce_orders GROUP BY country ORDER BY revenue DESC LIMIT 10;",
  },
  {
    id: "payments",
    title: "Daily payment success rate",
    description: "Track Stripe payment success by day.",
    code: "SELECT DATE_TRUNC('day', created_at) AS day, COUNT(*) FILTER (WHERE status = 'succeeded') * 100.0 / COUNT(*) AS success_rate FROM stripe_payments GROUP BY day ORDER BY day;",
  },
  {
    id: "funnel",
    title: "Conversion funnel by referrer",
    description: "Compare sessions and conversions by referrer.",
    code: "SELECT referrer, COUNT(*) AS sessions, SUM(CASE WHEN converted THEN 1 ELSE 0 END) AS conversions, AVG(CASE WHEN converted THEN 1.0 ELSE 0.0 END) * 100 AS conv_rate FROM web_analytics GROUP BY referrer ORDER BY conv_rate DESC;",
  },
] as const;

export const OLLAMA_INSTALL = "brew install ollama\nollama pull llama3.2";
export const STEP_TITLES = [
  "Welcome to DataLens",
  "Load your first dataset",
  "Enable the AI assistant (optional)",
  "You're ready.",
] as const;

export function StepHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-white/20 bg-white/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-400">
          First-run tour
        </span>
      </div>
      <div>
        <h2 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {subtitle}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function FooterButton({
  children,
  onClick,
  variant,
}: {
  children: ReactNode;
  onClick: () => void;
  variant: "ghost" | "primary";
}) {
  const className =
    variant === "primary"
      ? "bg-slate-950 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
      : "border border-white/20 bg-white/60 text-slate-700 hover:bg-white/80 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-200 dark:hover:bg-slate-950/55";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${className}`}
    >
      {children}
    </button>
  );
}
