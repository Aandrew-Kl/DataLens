"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Lock, Sparkles, Star } from "lucide-react";
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
    <section className="relative overflow-hidden px-6 pb-24 pt-10 sm:px-8 lg:px-12 lg:pb-32 lg:pt-16">
      <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[1.02fr_0.98fr] lg:items-center">
        <Reveal className="relative z-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-700 backdrop-blur-xl dark:border-cyan-400/20 dark:bg-cyan-400/10 dark:text-cyan-200">
            <Lock className="h-4 w-4" />
            Privacy-first AI data analytics. Your data never leaves your browser.
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {heroBadges.map((badge) => (
              <span
                key={badge}
                className="rounded-full border border-white/40 bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-900/70 dark:text-slate-300"
              >
                {badge}
              </span>
            ))}
          </div>

          <h1 className="mt-8 max-w-3xl text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl lg:text-7xl dark:text-white">
            Analyze data at the speed of thought. Privately.
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">
            Open-source AI data analytics that runs entirely in your browser.
            DuckDB + local LLMs. No cloud. No tracking.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3.5 text-sm font-semibold text-white shadow-[0_30px_80px_-35px_rgba(14,165,233,0.7)] transition hover:-translate-y-0.5"
            >
              Try it free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/40 bg-white/75 px-6 py-3.5 text-sm font-semibold text-slate-700 shadow-[0_20px_50px_-35px_rgba(15,23,42,0.4)] backdrop-blur transition hover:-translate-y-0.5 hover:bg-white dark:border-white/10 dark:bg-slate-900/70 dark:text-slate-100 dark:hover:bg-slate-900"
            >
              <Star className="h-4 w-4" />
              Star on GitHub
              <span className="rounded-full bg-slate-950/6 px-2.5 py-0.5 text-xs text-slate-600 dark:bg-white/10 dark:text-slate-300">
                {starsLabel}
              </span>
            </Link>
          </div>

          <div className="mt-10 grid gap-4 text-sm text-slate-600 sm:grid-cols-2 dark:text-slate-300">
            <div className="rounded-2xl border border-white/40 bg-white/60 p-4 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60">
              <p className="font-semibold text-slate-900 dark:text-white">Query locally</p>
              <p className="mt-1">
                DuckDB-WASM executes analytical SQL on-device, so the fast path is
                also the private path.
              </p>
            </div>
            <div className="rounded-2xl border border-white/40 bg-white/60 p-4 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60">
              <p className="font-semibold text-slate-900 dark:text-white">Think in language or SQL</p>
              <p className="mt-1">
                Ask questions with a local model, inspect the SQL, then ship the
                chart or pipeline you need.
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <SqlTerminalVisual />
        </Reveal>
      </div>
    </section>
  );
}

function SqlTerminalVisual() {
  return (
    <div className="relative">
      <div className="absolute -left-10 top-10 h-48 w-48 rounded-full bg-cyan-400/20 blur-3xl dark:bg-cyan-400/15" />
      <div className="absolute -bottom-8 right-0 h-56 w-56 rounded-full bg-blue-500/20 blur-3xl dark:bg-blue-500/15" />

      <div className="relative overflow-hidden rounded-[2rem] border border-white/40 bg-slate-950/95 p-5 text-slate-100 shadow-[0_30px_120px_-45px_rgba(8,145,178,0.6)] ring-1 ring-cyan-400/10">
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-rose-400" />
            <span className="h-3 w-3 rounded-full bg-amber-300" />
            <span className="h-3 w-3 rounded-full bg-emerald-400" />
            <span className="ml-3 text-xs uppercase tracking-[0.3em] text-slate-400">
              query.sql
            </span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">
            <Sparkles className="h-3.5 w-3.5" />
            Ollama assisting locally
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.26em] text-slate-500">
              <span>Editor</span>
              <span>DuckDB-WASM</span>
            </div>

            <div className="mt-4 space-y-2 font-mono text-sm leading-7">
              {queryLines.map((line, index) => (
                <motion.div
                  key={line}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + index * 0.06, duration: 0.35 }}
                  className="flex gap-4"
                >
                  <span className="select-none text-slate-500">{String(index + 1).padStart(2, "0")}</span>
                  <span className="text-cyan-100">{line}</span>
                </motion.div>
              ))}
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Running on your device</span>
                <span>42 ms</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500"
                  animate={{ x: ["-60%", "110%"] }}
                  transition={{ duration: 1.8, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
                  style={{ width: "38%" }}
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.26em] text-slate-500">Result</p>
                  <p className="mt-2 text-2xl font-semibold text-white">3 regions returned</p>
                </div>
                <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-right">
                  <p className="text-xs uppercase tracking-[0.24em] text-cyan-200">Revenue</p>
                  <p className="mt-1 text-xl font-semibold text-cyan-50">$10.7M</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/85 p-4">
              <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3 border-b border-white/10 pb-3 text-xs uppercase tracking-[0.24em] text-slate-500">
                <span>Region</span>
                <span>Revenue</span>
                <span>Retention</span>
              </div>
              <div className="mt-3 space-y-3">
                {resultRows.map((row, index) => (
                  <motion.div
                    key={row.region}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.55 + index * 0.12, duration: 0.4 }}
                    className="grid grid-cols-[1.4fr_1fr_1fr] items-center gap-3 rounded-2xl border border-white/5 bg-white/5 px-3 py-3 text-sm"
                  >
                    <span className="font-medium text-white">{row.region}</span>
                    <span className="text-slate-200">{row.revenue}</span>
                    <div className="flex items-center gap-3">
                      <span className="min-w-14 text-slate-200">{row.retention}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                        <motion.div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400"
                          initial={{ width: 0 }}
                          animate={{ width: `${68 + index * 10}%` }}
                          transition={{ delay: 0.65 + index * 0.12, duration: 0.6 }}
                        />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
