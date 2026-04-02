"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Compass,
  Database,
  Eye,
  Keyboard,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

type ShortcutGroup = "Navigation" | "Data" | "View";

interface ShortcutDefinition {
  keys: string[];
  description: string;
  group: ShortcutGroup;
}

interface ShortcutSection {
  title: ShortcutGroup;
  description: string;
  icon: LucideIcon;
}

const SECTIONS: ShortcutSection[] = [
  {
    title: "Navigation",
    description: "Fast access to core navigation and workspace movement.",
    icon: Compass,
  },
  {
    title: "Data",
    description: "Actions for creating, running, and exporting datasets.",
    icon: Database,
  },
  {
    title: "View",
    description: "Display and workspace controls for the current session.",
    icon: Eye,
  },
] as const;

const SHORTCUTS: ShortcutDefinition[] = [
  {
    keys: ["mod", "K"],
    description: "Command palette",
    group: "Navigation",
  },
  {
    keys: ["Escape"],
    description: "Close panel",
    group: "Navigation",
  },
  {
    keys: ["Tab"],
    description: "Switch tabs",
    group: "Navigation",
  },
  {
    keys: ["mod", "N"],
    description: "New dataset",
    group: "Data",
  },
  {
    keys: ["mod", "Enter"],
    description: "Execute SQL",
    group: "Data",
  },
  {
    keys: ["mod", "E"],
    description: "Export",
    group: "Data",
  },
  {
    keys: ["mod", "D"],
    description: "Toggle dark mode",
    group: "View",
  },
  {
    keys: ["mod", ","],
    description: "Settings",
    group: "View",
  },
] as const;

function getModifierLabel(isMac: boolean): string {
  return isMac ? "Cmd" : "Ctrl";
}

function getKeyLabel(key: string, isMac: boolean): string {
  if (key === "mod") return getModifierLabel(isMac);
  if (key === "Escape") return "Esc";
  return key;
}

function KeyCombo({ keys, isMac }: { keys: string[]; isMac: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {keys.map((key, index) => (
        <div key={`${key}-${index}`} className="flex items-center gap-1.5">
          {index > 0 && (
            <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">
              +
            </span>
          )}
          <kbd className="min-w-9 rounded-lg border border-white/60 bg-white/70 px-2.5 py-1.5 text-center text-xs font-semibold text-slate-700 shadow-sm backdrop-blur dark:border-slate-700/70 dark:bg-slate-950/70 dark:text-slate-200">
            {getKeyLabel(key, isMac)}
          </kbd>
        </div>
      ))}
    </div>
  );
}

export default function KeyboardShortcutsDialog({
  open,
  onClose,
}: KeyboardShortcutsDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [isMac] = useState(() => {
    if (typeof window === "undefined") return false;
    const nav = navigator as Navigator & {
      userAgentData?: { platform?: string };
    };
    const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
    return /mac/i.test(platform);
  });

  useEffect(() => {
    if (!open) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleEscape);

    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 40);

    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleEscape);
      window.clearTimeout(focusTimer);
    };
  }, [open, onClose]);

  const groupedShortcuts = useMemo(() => {
    return SECTIONS.map((section) => ({
      ...section,
      shortcuts: SHORTCUTS.filter((shortcut) => shortcut.group === section.title),
    }));
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.button
            type="button"
            aria-label="Close keyboard shortcuts dialog"
            className="absolute inset-0 bg-slate-950/55 backdrop-blur-md"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="keyboard-shortcuts-title"
            className="relative w-full max-w-4xl overflow-hidden rounded-[28px] border border-white/30 bg-white/75 shadow-[0_30px_120px_-48px_rgba(15,23,42,0.9)] backdrop-blur-2xl dark:border-slate-700/70 dark:bg-slate-900/80"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/80 to-transparent" />
            <div className="absolute -right-24 -top-20 h-56 w-56 rounded-full bg-cyan-400/15 blur-3xl" />
            <div className="absolute -left-20 bottom-0 h-48 w-48 rounded-full bg-indigo-500/15 blur-3xl" />

            <div className="relative border-b border-slate-200/70 px-6 py-5 dark:border-slate-800/80 sm:px-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/80 bg-cyan-50/80 px-3 py-1 text-xs font-semibold text-cyan-700 dark:border-cyan-400/20 dark:bg-cyan-400/10 dark:text-cyan-200">
                    <Keyboard className="h-3.5 w-3.5" />
                    Keyboard shortcuts
                  </div>
                  <h2
                    id="keyboard-shortcuts-title"
                    className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white"
                  >
                    Work faster without leaving the keyboard
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    Displayed for {isMac ? "macOS" : "Windows/Linux"} users with
                    the correct modifier labels.
                  </p>
                </div>

                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={onClose}
                  className="rounded-2xl border border-slate-200/80 bg-white/70 p-2.5 text-slate-500 shadow-sm transition-colors hover:text-slate-900 dark:border-slate-700/70 dark:bg-slate-950/60 dark:text-slate-400 dark:hover:text-white"
                  aria-label="Close dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="relative grid gap-4 p-6 sm:grid-cols-3 sm:p-8">
              {groupedShortcuts.map((section, index) => {
                const Icon = section.icon;

                return (
                  <motion.section
                    key={section.title}
                    className="rounded-[24px] border border-slate-200/70 bg-white/70 p-5 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.85)] backdrop-blur-xl dark:border-slate-700/70 dark:bg-slate-950/55"
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, delay: index * 0.08 }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 text-white shadow-lg shadow-indigo-500/20">
                        <Icon className="h-4.5 w-4.5" />
                      </div>

                      <div>
                        <h3 className="text-base font-semibold text-slate-950 dark:text-white">
                          {section.title}
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                          {section.description}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 space-y-3">
                      {section.shortcuts.map((shortcut) => (
                        <div
                          key={`${section.title}-${shortcut.description}`}
                          className="grid grid-cols-[auto,1fr] items-center gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/70 px-3.5 py-3 dark:border-slate-700/70 dark:bg-slate-900/70"
                        >
                          <KeyCombo keys={shortcut.keys} isMac={isMac} />
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            {shortcut.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  </motion.section>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
