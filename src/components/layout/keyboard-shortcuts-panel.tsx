"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Command,
  Database,
  FileText,
  Keyboard,
  Search,
  X,
} from "lucide-react";
import {
  ANALYTICS_EASE,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
} from "@/lib/utils/advanced-analytics";
import type { ColumnProfile } from "@/types/dataset";

interface KeyboardShortcutsPanelProps {
  tableName: string;
  columns: ColumnProfile[];
}

type ShortcutCategory = "Navigation" | "Queries" | "Reports" | "Datasets";

interface ShortcutDefinition {
  category: ShortcutCategory;
  keys: readonly string[];
  description: string;
}

const SHORTCUTS: readonly ShortcutDefinition[] = [
  { category: "Navigation", keys: ["Cmd/Ctrl", "K"] as const, description: "Open the command palette." },
  { category: "Navigation", keys: ["Esc"] as const, description: "Close the active panel or dialog." },
  { category: "Queries", keys: ["Cmd/Ctrl", "Enter"] as const, description: "Run the current SQL query." },
  { category: "Queries", keys: ["Shift", "Enter"] as const, description: "Insert a new line in the editor." },
  { category: "Reports", keys: ["Cmd/Ctrl", "E"] as const, description: "Open export actions for the active report or dataset." },
  { category: "Reports", keys: ["Cmd/Ctrl", "Shift", "P"] as const, description: "Add the active chart into a report workflow." },
  { category: "Datasets", keys: ["Cmd/Ctrl", "N"] as const, description: "Start a new dataset import flow." },
  { category: "Datasets", keys: ["Cmd/Ctrl", "F"] as const, description: "Focus the dataset search or schema filter." },
] as const;

const CATEGORY_META: Record<
  ShortcutCategory,
  { icon: typeof Keyboard; description: string }
> = {
  Navigation: {
    icon: Command,
    description: "Global movement and panel-level actions.",
  },
  Queries: {
    icon: Keyboard,
    description: "Keyboard-first query authoring and execution.",
  },
  Reports: {
    icon: FileText,
    description: "Shortcuts for sharing, exporting, and report composition.",
  },
  Datasets: {
    icon: Database,
    description: "Schema navigation and dataset-level actions.",
  },
};

function KeyCaps({ keys }: { keys: readonly string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {keys.map((key) => (
        <kbd
          key={`${keys.join("-")}-${key}`}
          className="rounded-xl border border-white/20 bg-white/70 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-200"
        >
          {key}
        </kbd>
      ))}
    </div>
  );
}

export default function KeyboardShortcutsPanel({
  tableName,
  columns,
}: KeyboardShortcutsPanelProps) {
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  const groupedShortcuts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = SHORTCUTS.filter((shortcut) => {
      if (!query) return true;
      return `${shortcut.category} ${shortcut.description} ${shortcut.keys.join(" ")}`
        .toLowerCase()
        .includes(query);
    });

    return (Object.keys(CATEGORY_META) as ShortcutCategory[])
      .map((category) => ({
        category,
        shortcuts: filtered.filter((shortcut) => shortcut.category === category),
      }))
      .filter((section) => section.shortcuts.length > 0);
  }, [search]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${GLASS_CARD_CLASS} inline-flex items-center gap-2 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200`}
      >
        <Keyboard className="h-4 w-4" />
        Open shortcuts
      </button>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.button
          type="button"
          aria-label="Close keyboard shortcuts panel"
          onClick={() => setOpen(false)}
          className="absolute inset-0 bg-slate-950/55 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />

        <motion.section
          role="dialog"
          aria-modal="true"
          aria-labelledby="keyboard-shortcuts-panel-title"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.96 }}
          transition={{ duration: 0.24, ease: ANALYTICS_EASE }}
          className="relative w-full max-w-5xl rounded-[2rem] bg-white/75 p-6 shadow-[0_30px_120px_-48px_rgba(15,23,42,0.9)] backdrop-blur-2xl dark:bg-slate-950/45 border border-white/20"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
                <Keyboard className="h-3.5 w-3.5" />
                Keyboard shortcuts
              </div>
              <h2
                id="keyboard-shortcuts-panel-title"
                className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white"
              >
                Work faster inside the {tableName} workspace
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                Search the shortcut catalog for this dataset context. {columns.length} columns
                are currently available in the active table.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-2xl border border-white/20 bg-white/70 p-2.5 text-slate-500 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-300"
              aria-label="Close panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <label className="mt-5 block">
            <span className="sr-only">Search shortcuts</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                aria-label="Search shortcuts"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className={`${FIELD_CLASS} pl-11`}
                placeholder="Filter by category, key, or action"
              />
            </div>
          </label>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {groupedShortcuts.map((section) => {
              const meta = CATEGORY_META[section.category];
              const Icon = meta.icon;

              return (
                <div key={section.category} className={`${GLASS_CARD_CLASS} p-5`}>
                  <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-cyan-500/10 p-2.5 text-cyan-700 dark:text-cyan-300">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-slate-950 dark:text-white">
                        {section.category}
                      </h3>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {meta.description}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {section.shortcuts.map((shortcut) => (
                      <div
                        key={`${shortcut.category}-${shortcut.description}`}
                        className="rounded-2xl border border-white/20 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-slate-950/40"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">
                            {shortcut.description}
                          </p>
                          <KeyCaps keys={shortcut.keys} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.section>
      </motion.div>
    </AnimatePresence>
  );
}
