import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <section className="w-full max-w-2xl rounded-2xl border border-white/30 bg-white/60 p-5 text-center backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60">
        <div className="mx-auto inline-flex items-center rounded-full border border-white/35 bg-white/55 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:border-white/10 dark:bg-slate-950/45 dark:text-slate-400">
          404
        </div>

        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50 sm:text-4xl">
          Page not found
        </h1>
        <p className="mt-3 text-base leading-7 text-slate-600 dark:text-slate-300">
          The page you were looking for doesn&apos;t exist or is no longer available.
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
          Return to a safe route and keep exploring your datasets.
        </p>

        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-xl border border-white/35 bg-white/55 px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-white/75 dark:border-white/10 dark:bg-slate-950/45 dark:text-slate-100 dark:hover:bg-slate-950/70"
          >
            Back home
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          >
            Go to dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
