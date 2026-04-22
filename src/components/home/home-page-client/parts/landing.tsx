"use client";

import { motion } from "framer-motion";
import {
  Database,
  ExternalLink as GithubIcon,
  Moon,
  Sun,
} from "lucide-react";

import DataUploadSection from "@/components/home/DataUploadSection";
import FeatureShowcase from "@/components/home/FeatureShowcase";
import HeroSection from "@/components/home/HeroSection";
import QuickStartGuide from "@/components/home/QuickStartGuide";
import type { FileDropResult } from "@/components/home/types";

import { FEATURES, LANDING_FEATURES } from "../constants";

interface LandingViewProps {
  theme: "light" | "dark";
  isLoading: boolean;
  loadError: string | null;
  onToggleTheme: () => void;
  onFileLoaded: (result: FileDropResult) => void | Promise<void>;
  onSampleLoad: (fileName: string, csvContent: string) => void;
  onDataGenerated: (csvContent: string, fileName: string) => void;
}

export function LandingView({
  theme,
  isLoading,
  loadError,
  onToggleTheme,
  onFileLoaded,
  onSampleLoad,
  onDataGenerated,
}: LandingViewProps) {
  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 shadow-md shadow-indigo-500/20">
            <Database className="h-4 w-4 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
            DataLens
          </span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="https://github.com/Aandrew-Kl/DataLens"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="View on GitHub"
          >
            <GithubIcon className="h-5 w-5" />
          </a>
          <button
            onClick={onToggleTheme}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Toggle dark mode"
          >
            {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-2xl space-y-8 text-center"
        >
          <HeroSection
            title="DataLens"
            tagline="Drop a file. Ask anything. See everything."
            description="Open source AI-powered data explorer. No SQL needed. Runs 100% locally."
          />

          <DataUploadSection
            isLoading={isLoading}
            loadError={loadError}
            onFileLoaded={onFileLoaded}
          />

          <QuickStartGuide features={FEATURES} onSampleLoad={onSampleLoad} />
        </motion.div>

        <FeatureShowcase features={LANDING_FEATURES} onDataGenerated={onDataGenerated} />
      </main>

      <footer className="py-4 text-center text-xs text-slate-400 dark:text-slate-600">
        <a
          href="https://github.com/Aandrew-Kl/DataLens"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-slate-600 dark:hover:text-slate-400"
        >
          MIT License &middot; Star on GitHub
        </a>
      </footer>
    </div>
  );
}
