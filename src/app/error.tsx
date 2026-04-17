"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw, Bug } from "lucide-react";
import { reportError } from "@/lib/errors/report";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError(error, { scope: "app-error-boundary" });
  }, [error]);

  const isDev = process.env.NODE_ENV === "development";
  const issueUrl = `https://github.com/Aandrew-Kl/DataLens/issues/new?title=${encodeURIComponent(
    `Error: ${error.message}`,
  )}&body=${encodeURIComponent(
    `**Error:** ${error.message}\n\n**Digest:** ${error.digest ?? "n/a"}\n\nPlease describe what you were doing...`,
  )}`;

  return (
    <main className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4 md:p-8">
      <section className="w-full max-w-2xl rounded-[1.75rem] border border-white/15 bg-white/50 p-6 shadow-[0_20px_60px_-35px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:bg-slate-900/35 md:p-8">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-200/60 bg-amber-50/80 text-amber-600 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300">
          <AlertTriangle className="h-7 w-7" />
        </div>

        <h1 className="mt-5 text-3xl font-semibold text-slate-900 dark:text-white">
          Something went wrong
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          DataLens hit an unexpected error. The page may still work after a reload.
        </p>
        <p className="mt-4 rounded-xl border border-white/20 bg-white/65 px-4 py-3 text-sm text-slate-700 dark:border-white/10 dark:bg-slate-950/45 dark:text-slate-200">
          {error.message}
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            aria-label="Try again"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200/70 bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:border-white/10 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          >
            <RotateCcw className="h-4 w-4" />
            Reload
          </button>
          <Link
            href={issueUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/70 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-white/90 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-200 dark:hover:bg-slate-900/80"
          >
            <Bug className="h-4 w-4" />
            Report issue
          </Link>
        </div>

        {isDev ? (
          <details className="mt-6 rounded-[1.3rem] border border-white/20 bg-white/65 p-4 dark:border-white/10 dark:bg-slate-950/45">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-200">
              Developer details
            </summary>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl border border-white/20 bg-slate-950/90 p-4 text-xs leading-6 text-slate-100 dark:border-white/10">
              {error.stack ?? error.message}
            </pre>
          </details>
        ) : null}
      </section>
    </main>
  );
}
