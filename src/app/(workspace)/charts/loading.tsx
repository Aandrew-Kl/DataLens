export default function Loading() {
  return (
    <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-2xl p-5 animate-pulse">
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Loading charts...</p>
      <div className="mt-4 grid gap-3 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="h-72 rounded-xl bg-white/70 dark:bg-slate-800/70" />
        <div className="h-72 rounded-xl bg-white/70 dark:bg-slate-800/70" />
      </div>
    </div>
  );
}
