"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Database, Search, Sparkles } from "lucide-react";

const FLOATING_ITEMS = [
  {
    icon: Search,
    className:
      "left-2 top-12 border-cyan-200/80 bg-cyan-50/90 text-cyan-600 dark:border-cyan-900/60 dark:bg-cyan-950/50 dark:text-cyan-300",
    delay: 0,
  },
  {
    icon: Sparkles,
    className:
      "right-1 top-9 border-amber-200/80 bg-amber-50/90 text-amber-600 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300",
    delay: 1.1,
  },
  {
    icon: Database,
    className:
      "bottom-6 left-8 border-indigo-200/80 bg-indigo-50/90 text-indigo-600 dark:border-indigo-900/60 dark:bg-indigo-950/50 dark:text-indigo-300",
    delay: 2.1,
  },
] as const;

export default function NotFoundPage() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="relative isolate flex min-h-[100dvh] items-center justify-center overflow-hidden px-6 py-10">
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.14),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(34,211,238,0.1),transparent_28%)] dark:bg-[radial-gradient(circle_at_top,rgba(129,140,248,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(34,211,238,0.12),transparent_30%)]" />

      <div className="absolute left-4 top-4 sm:left-6 sm:top-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/75 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm shadow-slate-200/40 backdrop-blur-sm dark:border-slate-800/80 dark:bg-slate-950/70 dark:text-slate-300 dark:shadow-black/10">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-500">
            <Database className="h-3.5 w-3.5 text-white" />
          </div>
          <span>DataLens</span>
        </div>
      </div>

      <div className="w-full max-w-5xl">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="order-2 text-center lg:order-1 lg:text-left">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/70 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
              <span>404</span>
              <span className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
              <span>Route Missing</span>
            </div>

            <h1 className="text-balance text-4xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-5xl">
              Page not found
            </h1>

            <p className="mt-4 text-base leading-7 text-slate-600 dark:text-slate-300 sm:text-lg">
              The page you asked DataLens to inspect is missing, moved, or was
              never part of this dataset.
            </p>

            <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
              Head back to the landing page and start a new path from a place
              that exists.
            </p>

            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <Link
                href="/"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white transition-all hover:-translate-y-0.5 hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
              >
                <ArrowLeft className="h-4 w-4" />
                Go back home
              </Link>

              <span className="text-xs uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                Built for local-first analytics
              </span>
            </div>
          </div>

          <div className="order-1 flex justify-center lg:order-2">
            <div className="relative h-72 w-72 sm:h-80 sm:w-80">
              <motion.div
                className="absolute inset-0 rounded-full border border-dashed border-slate-300/80 dark:border-slate-700/80"
                animate={reduceMotion ? undefined : { rotate: 360 }}
                transition={
                  reduceMotion
                    ? undefined
                    : { duration: 18, repeat: Infinity, ease: "linear" }
                }
              />

              <motion.div
                className="absolute inset-6 rounded-[2rem] border border-slate-200/80 bg-white/70 p-6 shadow-[0_30px_80px_-40px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-950/75"
                animate={reduceMotion ? undefined : { y: [0, -10, 0] }}
                transition={
                  reduceMotion
                    ? undefined
                    : { duration: 5.5, repeat: Infinity, ease: "easeInOut" }
                }
              >
                <div className="absolute inset-0 rounded-[2rem] bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.14),transparent_55%)] dark:bg-[radial-gradient(circle_at_top,rgba(129,140,248,0.18),transparent_55%)]" />

                <div className="relative flex h-full flex-col items-center justify-center">
                  <motion.div
                    className="mb-5 flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-500 shadow-lg shadow-indigo-500/25"
                    animate={reduceMotion ? undefined : { rotate: [0, -6, 6, 0] }}
                    transition={
                      reduceMotion
                        ? undefined
                        : {
                            duration: 6.5,
                            repeat: Infinity,
                            ease: "easeInOut",
                          }
                    }
                  >
                    <Database className="h-10 w-10 text-white" />
                  </motion.div>

                  <div className="w-full max-w-[12rem] space-y-2">
                    <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700" />
                    <div className="h-2 w-4/5 rounded-full bg-slate-200 dark:bg-slate-700" />
                    <div className="h-2 w-3/5 rounded-full bg-slate-200/80 dark:bg-slate-700/80" />
                  </div>

                  <p className="mt-5 text-sm font-medium text-slate-500 dark:text-slate-400">
                    Query returned zero routes.
                  </p>
                </div>
              </motion.div>

              {FLOATING_ITEMS.map((item) => {
                const Icon = item.icon;

                return (
                  <motion.div
                    key={item.className}
                    className={`absolute flex h-14 w-14 items-center justify-center rounded-2xl border shadow-sm backdrop-blur-sm ${item.className}`}
                    animate={
                      reduceMotion
                        ? undefined
                        : { y: [0, -10, 0], rotate: [0, 4, -4, 0] }
                    }
                    transition={
                      reduceMotion
                        ? undefined
                        : {
                            duration: 4.8,
                            delay: item.delay,
                            repeat: Infinity,
                            ease: "easeInOut",
                          }
                    }
                  >
                    <Icon className="h-6 w-6" />
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
