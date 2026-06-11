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
  const [theme, setTheme] = useState<"dark" | "light">("light");
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
      <div className="min-h-screen bg-white text-zinc-900 transition-colors dark:bg-zinc-950 dark:text-zinc-50">
        <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3 sm:px-8 lg:px-12">
            <Link href="/" className="inline-flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-900 text-xs font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900">
                DL
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  DataLens
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Browser-native analytics
                </p>
              </div>
            </Link>

            <nav className="hidden items-center gap-6 text-sm text-zinc-500 lg:flex dark:text-zinc-400">
              <a href="#features" className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">
                Features
              </a>
              <a href="#how-it-works" className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">
                How it works
              </a>
              <a href="#stats" className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">
                Stats
              </a>
              <a href="#comparison" className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">
                Compare
              </a>
              <Link
                href={DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
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
                className="hidden rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-500 md:inline-flex"
              >
                GitHub
              </Link>
              <Link
                href="/login"
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
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

        <main>
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
