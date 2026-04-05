import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div
        role="status"
        aria-live="polite"
        className="w-full max-w-md rounded-2xl border border-white/30 bg-white/60 p-6 text-center shadow-xl shadow-slate-950/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60"
      >
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/35 bg-white/55 dark:border-white/10 dark:bg-slate-950/45">
            <Loader2 className="h-7 w-7 animate-spin text-cyan-600 dark:text-cyan-300" />
          </div>
          <p className="text-base font-medium text-slate-950 dark:text-slate-50">
            Loading DataLens...
          </p>
        </div>
      </div>
    </div>
  );
}
