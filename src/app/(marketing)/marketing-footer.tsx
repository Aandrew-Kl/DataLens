"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { footerLinks } from "./marketing-content";

export default function MarketingFooter() {
  return (
    <footer className="px-6 pb-10 pt-4 sm:px-8 lg:px-12">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 rounded-[1.75rem] border border-white/40 bg-white/65 px-6 py-6 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/65 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-lg font-semibold text-slate-950 dark:text-white">
            DataLens
          </p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            MIT licensed. Privacy-first AI analytics that keeps your data local.
          </p>
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            Built with <Heart className="h-4 w-4 text-rose-500" /> in Greece
          </p>
        </div>

        <div className="flex flex-wrap gap-4 text-sm">
          {footerLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              target={link.placeholder ? undefined : "_blank"}
              rel={link.placeholder ? undefined : "noreferrer"}
              className="rounded-full border border-white/40 bg-white/75 px-4 py-2 text-slate-600 transition hover:-translate-y-0.5 hover:text-slate-950 dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:text-white"
            >
              {link.placeholder ? `${link.label} (soon)` : link.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
