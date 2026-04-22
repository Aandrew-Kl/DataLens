"use client";

import { motion } from "framer-motion";
import type { ElementType, ReactNode } from "react";

import { EASE } from "../types";

export function Card({
  title,
  icon: Icon,
  subtitle,
  children,
}: {
  title: string;
  icon: ElementType;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: EASE }}
      className="rounded-[1.75rem] border border-white/20 bg-white/70 p-5 shadow-xl shadow-slate-950/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <Icon className="h-4 w-4" />
            {title}
          </div>
          {subtitle ? (
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {children}
    </motion.section>
  );
}

export function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/20 bg-slate-50/80 px-4 py-3 dark:border-white/10 dark:bg-slate-900/45">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">{value}</p>
    </div>
  );
}
