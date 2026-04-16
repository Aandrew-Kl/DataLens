"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Check, CircleOff, Minus } from "lucide-react";
import {
  comparisonRows,
  DOCS_URL,
  featureCards,
  GITHUB_REPO_URL,
  stats,
  workflowSteps,
} from "./marketing-content";
import { cn, Reveal, SectionHeading } from "./marketing-primitives";

export function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-24 px-6 py-20 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <SectionHeading
            eyebrow="Why DataLens"
            title="The privacy-first analytics stack, packaged for speed"
            description="DataLens combines browser-native SQL, local AI, charts, transforms, and ML into one surface so you can move from raw file to insight without shipping your data to someone else’s server."
          />
        </Reveal>

        <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {featureCards.map((feature, index) => {
            const Icon = feature.icon;

            return (
              <Reveal key={feature.title} delay={index * 0.06}>
                <motion.div
                  whileHover={{ y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="group h-full rounded-[1.75rem] border border-white/40 bg-white/65 p-6 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/65"
                >
                  <div className="inline-flex rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-700 dark:text-cyan-200">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-xl font-semibold text-slate-950 dark:text-white">
                    {feature.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
                    {feature.description}
                  </p>
                  <div className="mt-6 h-px bg-gradient-to-r from-cyan-500/20 via-blue-500/10 to-transparent" />
                  <p className="mt-4 text-xs uppercase tracking-[0.26em] text-slate-400 transition group-hover:text-cyan-600 dark:text-slate-500 dark:group-hover:text-cyan-300">
                    Private by default
                  </p>
                </motion.div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="scroll-mt-24 px-6 py-20 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <SectionHeading
            eyebrow="How It Works"
            title="A local-first workflow that stays fast from first upload to final export"
            description="Everything important happens on your machine: parsing, SQL execution, AI-assisted query building, transforms, charting, and exports."
          />
        </Reveal>

        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {workflowSteps.map((step, index) => {
            const Icon = step.icon;

            return (
              <Reveal key={step.title} delay={index * 0.08}>
                <div className="h-full rounded-[1.75rem] border border-white/40 bg-white/70 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
                  <div className="flex items-center justify-between gap-4">
                    <div className="inline-flex rounded-2xl border border-white/50 bg-white/85 p-3 text-slate-700 dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-100">
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="text-4xl font-semibold tracking-tight text-slate-300 dark:text-slate-700">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="mt-6 text-xl font-semibold text-slate-950 dark:text-white">
                    {step.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
                    {step.description}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function StatsSection({
  stars,
  starsLabel,
}: {
  stars: number | null;
  starsLabel: string;
}) {
  return (
    <section id="stats" className="scroll-mt-24 px-6 py-20 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <SectionHeading
            eyebrow="Built In Public"
            title="Substance over screenshotware"
            description="DataLens is already a deep product surface with charts, data pipelines, profiling, ML, and AI-assisted analysis. The stats below are product signals, not placeholder vanity metrics."
          />
        </Reveal>

        <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
          {stats.map((stat, index) => (
            <Reveal key={stat.label} delay={index * 0.05}>
              <div className="h-full rounded-[1.75rem] border border-white/40 bg-white/70 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
                <p className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
                  {stat.value}
                </p>
                <p className="mt-2 text-sm font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  {stat.label}
                </p>
                <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  {stat.detail}
                </p>
              </div>
            </Reveal>
          ))}

          <Reveal delay={0.25}>
            <div className="h-full rounded-[1.75rem] border border-cyan-400/20 bg-gradient-to-br from-cyan-500/12 to-blue-500/12 p-6 backdrop-blur-xl dark:border-cyan-400/15 dark:from-cyan-400/12 dark:to-blue-500/10">
              <p className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
                {stars === null ? "Live" : stars.toLocaleString()}
              </p>
              <p className="mt-2 text-sm font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                GitHub stars
              </p>
              <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
                Community signal from the public repo. Currently showing {starsLabel}.
              </p>
              <Link
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-cyan-700 transition hover:text-cyan-800 dark:text-cyan-200 dark:hover:text-cyan-100"
              >
                View repository
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function ComparisonSection() {
  return (
    <section id="comparison" className="scroll-mt-24 px-6 py-20 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <SectionHeading
            eyebrow="Comparison"
            title="Designed around local execution, not hosted dependency"
            description="DataLens is different because the analytics engine and AI workflow can both stay close to the data. That changes the privacy model, deployment story, and cost profile from the start."
          />
        </Reveal>

        <Reveal className="mt-12">
          <div className="overflow-hidden rounded-[2rem] border border-white/40 bg-white/70 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead>
                  <tr className="border-b border-white/40 dark:border-white/10">
                    <th className="px-6 py-5 text-xs font-semibold uppercase tracking-[0.26em] text-slate-500 dark:text-slate-400">
                      Capability
                    </th>
                    <th className="px-6 py-5 text-sm font-semibold text-slate-950 dark:text-white">
                      DataLens
                    </th>
                    <th className="px-6 py-5 text-sm font-semibold text-slate-950 dark:text-white">
                      Metabase
                    </th>
                    <th className="px-6 py-5 text-sm font-semibold text-slate-950 dark:text-white">
                      Tableau
                    </th>
                    <th className="px-6 py-5 text-sm font-semibold text-slate-950 dark:text-white">
                      Observable
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((row, index) => (
                    <tr
                      key={row.label}
                      className={cn(
                        "align-top",
                        index !== comparisonRows.length - 1 &&
                          "border-b border-white/30 dark:border-white/10",
                      )}
                    >
                      <td className="px-6 py-5">
                        <p className="font-medium text-slate-950 dark:text-white">
                          {row.label}
                        </p>
                        <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500 dark:text-slate-400">
                          {row.description}
                        </p>
                      </td>
                      <td className="px-6 py-5">
                        <ComparisonValue value={row.values.datalens} emphasis />
                      </td>
                      <td className="px-6 py-5">
                        <ComparisonValue value={row.values.metabase} />
                      </td>
                      <td className="px-6 py-5">
                        <ComparisonValue value={row.values.tableau} />
                      </td>
                      <td className="px-6 py-5">
                        <ComparisonValue value={row.values.observable} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-white/40 px-6 py-4 text-xs leading-6 text-slate-500 dark:border-white/10 dark:text-slate-400">
              Comparison reflects default deployment model, AI posture, licensing,
              and public pricing pages as of April 16, 2026.
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function FinalCtaSection({
  starsLabel,
}: {
  starsLabel: string;
}) {
  return (
    <section className="px-6 py-20 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <div className="overflow-hidden rounded-[2.2rem] border border-cyan-400/20 bg-gradient-to-br from-cyan-500/14 via-white/85 to-blue-500/12 p-8 shadow-[0_24px_70px_-45px_rgba(8,145,178,0.45)] backdrop-blur-xl sm:p-10 dark:from-cyan-400/14 dark:via-slate-900/82 dark:to-blue-500/12">
            <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-700 dark:text-cyan-300">
                  Ready when you are
                </p>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl dark:text-white">
                  Ready to explore your data privately?
                </h2>
                <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 dark:text-slate-300">
                  Start with a file, ask a question, inspect the SQL, and keep the
                  analytics runtime where it belongs: on your machine.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-6 py-3.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 dark:bg-white dark:text-slate-950"
                >
                  Try the demo
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href={GITHUB_REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/40 bg-white/75 px-6 py-3.5 text-sm font-semibold text-slate-700 backdrop-blur transition hover:-translate-y-0.5 dark:border-white/10 dark:bg-slate-950/65 dark:text-slate-100"
                >
                  Star on GitHub
                  <span className="rounded-full bg-slate-950/6 px-2.5 py-0.5 text-xs text-slate-600 dark:bg-white/10 dark:text-slate-300">
                    {starsLabel}
                  </span>
                </Link>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-white/40 pt-6 text-sm text-slate-600 dark:border-white/10 dark:text-slate-300">
              <Link
                href={DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-cyan-700 transition hover:text-cyan-800 dark:text-cyan-300 dark:hover:text-cyan-200"
              >
                Read the docs
              </Link>
              <span className="hidden text-slate-300 sm:inline dark:text-slate-700">/</span>
              <span>Self-hostable. MIT licensed. No telemetry.</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function ComparisonValue({
  value,
  emphasis = false,
}: {
  value: boolean | string;
  emphasis?: boolean;
}) {
  if (value === true) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium",
          emphasis
            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "bg-emerald-500/8 text-emerald-700 dark:text-emerald-300",
        )}
      >
        <Check className="h-4 w-4" />
        Yes
      </span>
    );
  }

  if (value === false) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium text-slate-500 dark:text-slate-400">
        <CircleOff className="h-4 w-4" />
        No
      </span>
    );
  }

  if (value === "Limited") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium text-amber-700 dark:text-amber-300">
        <Minus className="h-4 w-4" />
        Limited
      </span>
    );
  }

  return (
    <span
      className={cn(
        "text-sm leading-6",
        emphasis
          ? "font-semibold text-slate-950 dark:text-white"
          : "text-slate-600 dark:text-slate-300",
      )}
    >
      {value}
    </span>
  );
}
