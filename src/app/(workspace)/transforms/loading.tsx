export default function Loading() {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 animate-pulse">
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Loading transforms...</p>
      <div className="mt-4 space-y-3">
        <div className="h-10 rounded-xl bg-white dark:bg-slate-800" />
        <div className="h-48 rounded-xl bg-white dark:bg-slate-800" />
        <div className="h-24 rounded-xl bg-white dark:bg-slate-800" />
      </div>
    </div>
  );
}
