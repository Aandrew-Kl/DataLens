"use client";

import { Database, ExternalLink, Sparkles } from "lucide-react";

const TECH_STACK = [
  "Next.js 16",
  "DuckDB-WASM",
  "Ollama",
  "TypeScript",
] as const;

export default function Footer() {
  return (
    <footer className="border-t border-slate-200/70 bg-white/50 dark:border-slate-800/80 dark:bg-slate-950/20">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-6 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-500 shadow-sm shadow-indigo-500/20">
              <Database className="h-5 w-5 text-white" />
            </div>

            <div>
              <p className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                DataLens
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                <span>MIT License</span>
                <span>Version 0.9.0-beta.0</span>
                <a
                  href="https://github.com/Aandrew-Kl/DataLens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                >
                  GitHub
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          </div>

          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/70 px-3 py-1 text-xs text-slate-600 shadow-sm shadow-slate-200/30 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300 dark:shadow-black/10">
            <Sparkles className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
            <span>Built with AI</span>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:items-end">
          <div className="flex flex-wrap gap-2">
            {TECH_STACK.map((item) => (
              <span
                key={item}
                className="rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700/80 dark:bg-slate-900 dark:text-slate-300"
              >
                {item}
              </span>
            ))}
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Private analytics, local AI workflows, zero vendor lock-in.
          </p>
        </div>
      </div>
    </footer>
  );
}
