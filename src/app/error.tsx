"use client";

import Link from "next/link";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-transparent p-4">
      <div className="bg-white/75 dark:bg-slate-950/45 border border-white/20 rounded-3xl p-8 backdrop-blur-2xl text-center max-w-lg w-full space-y-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Something went wrong</h1>
        <p className="text-sm text-slate-700 dark:text-slate-200">{error.message}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            onClick={reset}
            className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-full border border-slate-300/70 px-5 py-2.5 text-sm font-medium text-slate-800 dark:border-slate-600 dark:text-slate-100 hover:bg-slate-100/50 dark:hover:bg-slate-800/40"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
