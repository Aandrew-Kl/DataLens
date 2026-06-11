"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { footerLinks } from "./marketing-content";

export default function MarketingFooter() {
  return (
    <footer className="mt-10 border-t border-zinc-200 px-6 py-10 sm:px-8 lg:px-12 dark:border-zinc-800">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-base font-medium text-zinc-900 dark:text-zinc-50">
            DataLens
          </p>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            MIT licensed. Privacy-first AI analytics that keeps your data local.
          </p>
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            Built with <Heart className="h-4 w-4 text-rose-500" /> in Greece
          </p>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {footerLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              target={link.placeholder ? undefined : "_blank"}
              rel={link.placeholder ? undefined : "noreferrer"}
              className="text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {link.placeholder ? `${link.label} (soon)` : link.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
