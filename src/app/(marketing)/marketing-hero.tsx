"use client";

import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import { GITHUB_REPO_URL, heroBadges } from "./marketing-content";
import { Reveal } from "./marketing-primitives";

const queryLines = [
  "SELECT region,",
  "       SUM(revenue) AS revenue,",
  "       AVG(retention_30d) AS retention_30d",
  "FROM uploads.pipeline_q1",
  "WHERE segment = 'enterprise'",
  "GROUP BY 1",
  "ORDER BY revenue DESC;",
] as const;

const resultRows = [
  { region: "EMEA", revenue: "$4.2M", retention: "91.4%" },
  { region: "North America", revenue: "$3.6M", retention: "89.7%" },
  { region: "APAC", revenue: "$2.9M", retention: "88.1%" },
] as const;

export default function MarketingHero({
  starsLabel,
}: {
  starsLabel: string;
}) {
  return (
    <section className="px-6 pb-20 pt-12 sm:px-8 lg:px-12 lg:pb-28 lg:pt-16">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <Reveal>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Privacy-first analytics — your data never leaves the browser.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {heroBadges.map((badge) => (
              <span
                key={badge}
                className="border border-zinc-200 px-2.5 py-1 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
              >
                {badge}
              </span>
            ))}
          </div>

          <h1 className="mt-7 max-w-2xl text-4xl font-medium tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
            Analyze data at the speed of thought. Privately.
          </h1>

          <p className="mt-5 max-w-xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
            Open-source AI data analytics that runs entirely in your browser.
            DuckDB + local LLMs. No cloud. No tracking.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Try it free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-500"
            >
              <Star className="h-4 w-4" />
              Star on GitHub
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{starsLabel}</span>
            </Link>
          </div>

          <div className="mt-10 grid gap-px overflow-hidden rounded-md border border-zinc-200 bg-zinc-200 text-sm sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-800">
            <div className="bg-white p-4 dark:bg-zinc-950">
              <p className="font-medium text-zinc-900 dark:text-zinc-100">Query locally</p>
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                DuckDB-WASM executes analytical SQL on-device, so the fast path is
                also the private path.
              </p>
            </div>
            <div className="bg-white p-4 dark:bg-zinc-950">
              <p className="font-medium text-zinc-900 dark:text-zinc-100">Think in language or SQL</p>
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                Ask questions with a local model, inspect the SQL, then ship the
                chart or pipeline you need.
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.05}>
          <SqlTerminalVisual />
        </Reveal>
      </div>
    </section>
  );
}

function SqlTerminalVisual() {
  return (
    <div className="overflow-hidden rounded-md border border-zinc-200 bg-zinc-950 text-zinc-100 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-4 border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-600" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-600" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-600" />
          <span className="ml-3 font-mono text-xs text-zinc-500">query.sql</span>
        </div>
        <span className="font-mono text-xs text-zinc-500">Ollama · local</span>
      </div>

      <div className="grid gap-px bg-zinc-800 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="bg-zinc-950 p-4">
          <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-wider text-zinc-600">
            <span>Editor</span>
            <span>DuckDB-WASM</span>
          </div>

          <div className="mt-4 space-y-1.5 font-mono text-sm leading-6">
            {queryLines.map((line, index) => (
              <div key={line} className="flex gap-4">
                <span className="select-none text-zinc-700">{String(index + 1).padStart(2, "0")}</span>
                <span className="text-zinc-300">{line}</span>
              </div>
            ))}
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between font-mono text-xs text-zinc-500">
              <span>Running on your device</span>
              <span>42 ms</span>
            </div>
            <div className="mt-2 h-px w-full bg-zinc-800">
              <div className="h-px w-2/5 bg-zinc-500" />
            </div>
          </div>
        </div>

        <div className="bg-zinc-950 p-4">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-4">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-600">Result</p>
              <p className="mt-1.5 text-lg font-medium text-zinc-100">3 regions returned</p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-600">Revenue</p>
              <p className="mt-1.5 text-lg font-medium text-zinc-100">$10.7M</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-[1.4fr_1fr_1fr] gap-3 font-mono text-[11px] uppercase tracking-wider text-zinc-600">
            <span>Region</span>
            <span>Revenue</span>
            <span>Retention</span>
          </div>
          <div className="mt-3 space-y-3 text-sm">
            {resultRows.map((row) => (
              <div
                key={row.region}
                className="grid grid-cols-[1.4fr_1fr_1fr] items-center gap-3"
              >
                <span className="text-zinc-200">{row.region}</span>
                <span className="text-zinc-400">{row.revenue}</span>
                <span className="text-zinc-400">{row.retention}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
