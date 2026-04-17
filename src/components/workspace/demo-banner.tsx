"use client";

import { useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { isDemoMode } from "@/lib/auth/demo-mode";

const DISMISS_KEY = "datalens.demo.banner.dismissed";

export default function DemoBanner() {
  const [hidden, setHidden] = useState(false);
  const dismissed = useSyncExternalStore(
    () => () => undefined,
    () => window.localStorage.getItem(DISMISS_KEY) === "true",
    () => false,
  );

  if (!isDemoMode() || hidden || dismissed) {
    return null;
  }

  return (
    <>
      <div className="h-16" />
      <div className="fixed inset-x-4 top-20 z-40 mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-amber-200 bg-amber-100/90 px-4 py-3 text-sm text-amber-950 shadow-lg backdrop-blur-xl dark:border-amber-500/20 dark:bg-amber-950/40 dark:text-amber-100">
        <p className="flex-1">
          You&apos;re in demo mode — data resets on refresh.
        </p>
        <a
          href="https://github.com/Aandrew-Kl/DataLens"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-amber-900 underline underline-offset-4 dark:text-amber-200"
        >
          Get your own →
        </a>
        <button
          type="button"
          aria-label="Dismiss demo banner"
          onClick={() => {
            window.localStorage.setItem(DISMISS_KEY, "true");
            setHidden(true);
          }}
          className="rounded-lg p-1 transition-colors hover:bg-amber-200/70 dark:hover:bg-amber-900/40"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </>
  );
}
