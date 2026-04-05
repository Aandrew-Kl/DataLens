"use client";

import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <section className="w-full max-w-xl rounded-2xl border border-white/30 bg-white/60 p-6 text-center shadow-xl shadow-slate-950/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-950/5 text-slate-700 dark:bg-white/10 dark:text-slate-200">
          <FileQuestion className="h-7 w-7" />
        </div>

        <div className="mt-4 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50 sm:text-3xl">
            Page not found
          </h1>
          <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
            The page you are looking for does not exist or has been moved.
          </p>
        </div>

        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
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
      </section>
    </div>
  );
}
