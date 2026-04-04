export default function Loading() {
  return (
    <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-2xl p-5 animate-pulse">
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Loading profiler...</p>
      <div className="mt-4 space-y-3">
        <div className="h-16 rounded-xl bg-white/70 dark:bg-slate-800/70" />
        <div className="h-40 rounded-xl bg-white/70 dark:bg-slate-800/70" />
        <div className="h-24 rounded-xl bg-white/70 dark:bg-slate-800/70" />
      </div>
    </div>
  );
}
