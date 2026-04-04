"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorStateCard } from "@/components/error/error-boundary";

export default function ErrorPage({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
  unstable_retry?: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.error("App router error boundary:", error);
    }
  }, [error]);

  const handleRetry = () => {
    if (typeof unstable_retry === "function") {
      unstable_retry();
      return;
    }

    reset?.();
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-xl space-y-4">
        <ErrorStateCard
          error={error}
          onRetry={handleRetry}
          description="DataLens ran into an unexpected problem while loading this route."
        />

        <div className="rounded-2xl border border-white/30 bg-white/60 p-5 text-center backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60">
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-xl border border-white/35 bg-white/55 px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-white/75 dark:border-white/10 dark:bg-slate-950/45 dark:text-slate-100 dark:hover:bg-slate-950/70"
            >
              Back to home
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
            >
              Open dashboard
            </Link>
          </div>

          {error.digest ? (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Reference: {error.digest}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
