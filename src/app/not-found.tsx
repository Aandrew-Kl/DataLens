import Link from "next/link";
import { MapPin } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4 md:p-8">
      <section className="w-full max-w-xl rounded-[1.75rem] border border-white/15 bg-white/50 p-6 text-center shadow-[0_20px_60px_-35px_rgba(15,23,42,0.55)] backdrop-blur-2xl dark:bg-slate-900/35 md:p-8">
        <p className="text-6xl font-semibold tracking-[-0.04em] text-slate-900 dark:text-white">
          404
        </p>
        <div className="mt-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-sky-200/60 bg-sky-50/80 text-sky-600 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-300">
          <MapPin className="h-7 w-7" />
        </div>
        <h2 className="sr-only">Page not found</h2>
        <h1 className="mt-5 text-3xl font-semibold text-slate-900 dark:text-white">
          That page doesn&apos;t exist
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
          The URL might be wrong, or the page has moved.
        </p>
        <p className="sr-only">
          The page you are looking for does not exist or has been moved.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/workspace"
            className="inline-flex items-center justify-center rounded-xl border border-slate-200/70 bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:border-white/10 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          >
            Back to workspace
          </Link>
          <Link
            href="/"
            aria-label="Back to home"
            className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/70 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-white/90 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-200 dark:hover:bg-slate-900/80"
          >
            Home
          </Link>
        </div>
        <Link href="/dashboard" className="sr-only">
          Open dashboard
        </Link>
      </section>
    </main>
  );
}
