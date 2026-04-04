export default function WorkspaceLoading() {
  return (
    <div className="flex min-h-[calc(100vh-8.5rem)] items-center justify-center p-4">
      <div className="w-full max-w-4xl bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-2xl p-6 animate-pulse">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
          Loading workspace...
        </p>
        <div className="mt-4 space-y-3">
          <div className="h-10 rounded-xl bg-white/70 dark:bg-slate-800/70" />
          <div className="grid gap-3 md:grid-cols-3">
            <div className="h-24 rounded-xl bg-white/70 dark:bg-slate-800/70" />
            <div className="h-24 rounded-xl bg-white/70 dark:bg-slate-800/70" />
            <div className="h-24 rounded-xl bg-white/70 dark:bg-slate-800/70" />
          </div>
          <div className="grid gap-3 lg:grid-cols-[1.3fr_0.7fr]">
            <div className="h-64 rounded-xl bg-white/70 dark:bg-slate-800/70" />
            <div className="space-y-3">
              <div className="h-24 rounded-xl bg-white/70 dark:bg-slate-800/70" />
              <div className="h-36 rounded-xl bg-white/70 dark:bg-slate-800/70" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
