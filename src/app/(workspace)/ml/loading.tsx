export default function Loading() {
  return (
    <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-2xl p-5 animate-pulse">
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Loading ML workspace...</p>
      <div className="mt-4 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="h-52 rounded-xl bg-white/70 dark:bg-slate-800/70" />
        <div className="space-y-3">
          <div className="h-20 rounded-xl bg-white/70 dark:bg-slate-800/70" />
          <div className="h-28 rounded-xl bg-white/70 dark:bg-slate-800/70" />
        </div>
      </div>
    </div>
  );
}
