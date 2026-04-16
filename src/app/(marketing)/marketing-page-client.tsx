"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import MarketingHero from "./marketing-hero";
import {
  ComparisonSection,
  FeaturesSection,
  FinalCtaSection,
  HowItWorksSection,
  StatsSection,
} from "./marketing-sections";
import { DOCS_URL, GITHUB_REPO_URL } from "./marketing-content";
import MarketingFooter from "./marketing-footer";
import { ThemeToggle } from "./marketing-primitives";

const GITHUB_API_URL = "https://api.github.com/repos/Aandrew-Kl/DataLens";

function formatCompactNumber(value: number | null) {
  if (value === null) {
    return "live";
  }

  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export default function MarketingPageClient() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [githubStars, setGithubStars] = useState<number | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("datalens-theme");
    if (stored === "light" || stored === "dark") {
      startTransition(() => {
        setTheme(stored);
      });
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("datalens-theme", theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;

    async function loadStars() {
      try {
        const response = await fetch(GITHUB_API_URL, {
          headers: {
            Accept: "application/vnd.github+json",
          },
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          stargazers_count?: number;
        };

        if (!cancelled && typeof payload.stargazers_count === "number") {
          setGithubStars(payload.stargazers_count);
        }
      } catch {
        // Ignore star fetch failures and fall back to the static label.
      }
    }

    void loadStars();

    return () => {
      cancelled = true;
    };
  }, []);

  const starsLabel = formatCompactNumber(githubStars);

  return (
    <div className={theme === "dark" ? "dark" : undefined}>
      <div className="relative min-h-screen overflow-hidden bg-slate-50 text-slate-950 transition-colors dark:bg-slate-950 dark:text-slate-50">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-x-0 top-[-14rem] h-[32rem] bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.22),transparent_58%)] dark:bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_58%)]" />
          <div className="absolute right-[-10rem] top-36 h-80 w-80 rounded-full bg-blue-500/12 blur-3xl dark:bg-blue-500/14" />
          <div className="absolute left-[-8rem] top-[34rem] h-80 w-80 rounded-full bg-cyan-400/12 blur-3xl dark:bg-cyan-400/10" />
          <div className="absolute inset-0 opacity-[0.14] [background-image:linear-gradient(rgba(148,163,184,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.18)_1px,transparent_1px)] [background-size:96px_96px]" />
        </div>

        <header className="sticky top-0 z-40 px-6 pt-6 sm:px-8 lg:px-12">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 rounded-[1.75rem] border border-white/40 bg-white/70 px-4 py-3 shadow-[0_20px_50px_-35px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70">
            <Link href="/" className="inline-flex items-center gap-3">
              <div className="rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 px-3 py-2 text-sm font-semibold text-white">
                DL
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-950 dark:text-white">
                  DataLens
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Browser-native analytics
                </p>
              </div>
            </Link>

            <nav className="hidden items-center gap-6 text-sm text-slate-600 lg:flex dark:text-slate-300">
              <a href="#features" className="transition hover:text-slate-950 dark:hover:text-white">
                Features
              </a>
              <a href="#how-it-works" className="transition hover:text-slate-950 dark:hover:text-white">
                How it works
              </a>
              <a href="#stats" className="transition hover:text-slate-950 dark:hover:text-white">
                Stats
              </a>
              <a href="#comparison" className="transition hover:text-slate-950 dark:hover:text-white">
                Compare
              </a>
              <Link
                href={DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 transition hover:text-slate-950 dark:hover:text-white"
              >
                Docs
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </nav>

            <div className="flex items-center gap-2">
              <Link
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="hidden rounded-2xl border border-white/40 bg-white/75 px-4 py-2 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:bg-white dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-200 md:inline-flex"
              >
                GitHub
              </Link>
              <Link
                href="/login"
                className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 dark:bg-white dark:text-slate-950"
              >
                Try it free
              </Link>
              <ThemeToggle
                theme={theme}
                onToggle={() =>
                  setTheme((current) => (current === "dark" ? "light" : "dark"))
                }
              />
            </div>
          </div>
        </header>

        <main className="relative z-10">
          <MarketingHero starsLabel={starsLabel} />
          <FeaturesSection />
          <HowItWorksSection />
          <StatsSection stars={githubStars} starsLabel={starsLabel} />
          <ComparisonSection />
          <FinalCtaSection starsLabel={starsLabel} />
        </main>

        <MarketingFooter />
      </div>
    </div>
  );
}
