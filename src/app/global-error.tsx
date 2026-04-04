"use client";

import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-screen bg-slate-950/5 bg-gradient-to-br from-slate-100 via-white to-sky-100 text-slate-900">
        <main className="flex min-h-screen items-center justify-center px-4">
          <div className="glass w-full max-w-md rounded-[2rem] border border-white/50 bg-white/70 p-8 text-center shadow-2xl shadow-slate-900/10 backdrop-blur-2xl">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-orange-400 text-2xl font-semibold text-white">
              !
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-600">
              {error.digest ? `Reference: ${error.digest}` : "Please try again."}
            </p>
            <button
              onClick={() => reset()}
              className="mt-6 inline-flex rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
