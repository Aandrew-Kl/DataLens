"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
  progress?: number;
}

function mergeClasses(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

export default function LoadingOverlay({
  visible,
  message = "Loading...",
  progress,
}: LoadingOverlayProps) {
  const safeProgress =
    typeof progress === "number" ? Math.min(100, Math.max(0, progress)) : undefined;

  useEffect(() => {
    if (!visible) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          aria-live="polite"
          aria-busy="true"
          role="status"
        >
          <motion.div
            className="absolute inset-0 bg-slate-950/25 backdrop-blur-md dark:bg-slate-950/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          <motion.div
            className={mergeClasses(
              "relative w-full max-w-sm overflow-hidden rounded-[28px] border px-8 py-7 text-center",
              "border-white/40 bg-white/78 shadow-[0_30px_120px_-48px_rgba(15,23,42,0.75)] backdrop-blur-2xl",
              "dark:border-slate-700/70 dark:bg-slate-950/82",
            )}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
          >
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-sky-500/20 bg-sky-500/10 dark:border-sky-400/20 dark:bg-sky-400/10">
              <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-sky-200 border-t-sky-500 dark:border-slate-700 dark:border-t-sky-400" />
            </div>

            <p className="mt-5 text-base font-semibold text-slate-900 dark:text-slate-50">
              {message}
            </p>

            {safeProgress !== undefined && (
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  <span>Progress</span>
                  <span>{safeProgress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800/80">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400"
                    initial={{ width: 0 }}
                    animate={{ width: `${safeProgress}%` }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                  />
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
