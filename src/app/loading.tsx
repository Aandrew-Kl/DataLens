export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div
        role="status"
        aria-live="polite"
        className="w-full max-w-3xl rounded-2xl border border-white/30 bg-white/60 p-5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60"
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="mx-auto flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/35 bg-cyan-500/10 sm:mx-0 dark:border-cyan-400/20 dark:bg-cyan-400/10">
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-cyan-200/70 border-t-cyan-500 dark:border-slate-700 dark:border-t-cyan-400" />
          </div>

          <div className="flex-1 space-y-3">
            <div className="space-y-2">
              <div className="h-4 w-40 animate-pulse rounded-full bg-slate-200/80 dark:bg-slate-700/70" />
              <div className="h-3 w-64 max-w-full animate-pulse rounded-full bg-slate-200/60 dark:bg-slate-800/70" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 rounded-xl border border-white/35 bg-white/55 p-4 dark:border-white/10 dark:bg-slate-950/45">
                <div className="h-3 w-20 animate-pulse rounded-full bg-slate-200/80 dark:bg-slate-700/70" />
                <div className="h-3 w-full animate-pulse rounded-full bg-slate-200/60 dark:bg-slate-800/70" />
                <div className="h-3 w-3/4 animate-pulse rounded-full bg-slate-200/60 dark:bg-slate-800/70" />
              </div>

              <div className="space-y-2 rounded-xl border border-white/35 bg-white/55 p-4 dark:border-white/10 dark:bg-slate-950/45">
                <div className="h-3 w-24 animate-pulse rounded-full bg-slate-200/80 dark:bg-slate-700/70" />
                <div className="h-3 w-full animate-pulse rounded-full bg-slate-200/60 dark:bg-slate-800/70" />
                <div className="h-3 w-2/3 animate-pulse rounded-full bg-slate-200/60 dark:bg-slate-800/70" />
              </div>
            </div>
          </div>
        </div>

        <span className="sr-only">Loading DataLens</span>
      </div>
    </div>
  );
}
