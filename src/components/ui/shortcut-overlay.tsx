"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  Compass,
  Database,
  Keyboard,
  PieChart,
  PencilLine,
  Search,
  X,
} from "lucide-react";

type ShortcutCategory = "Navigation" | "Editing" | "Data" | "Charts";

interface ShortcutItem {
  keys: string[];
  description: string;
  category: ShortcutCategory;
  keywords: string[];
}

interface ShortcutSection {
  title: ShortcutCategory;
  description: string;
  icon: LucideIcon;
}

const EASE = [0.16, 1, 0.3, 1] as const;
const SECTIONS: ShortcutSection[] = [
  {
    title: "Navigation",
    description: "Workspace movement, overlays, and global entry points.",
    icon: Compass,
  },
  {
    title: "Editing",
    description: "Text editing and drafting commands used across query and form surfaces.",
    icon: PencilLine,
  },
  {
    title: "Data",
    description: "Dataset, query, export, and settings shortcuts.",
    icon: Database,
  },
  {
    title: "Charts",
    description: "Chart-focused shortcuts for switching views and iterating quickly.",
    icon: PieChart,
  },
] as const;

const SHORTCUTS: ShortcutItem[] = [
  {
    keys: ["?"],
    description: "Toggle this shortcut overlay",
    category: "Navigation",
    keywords: ["help", "overlay", "shortcuts", "reference"],
  },
  {
    keys: ["mod", "K"],
    description: "Open the command palette",
    category: "Navigation",
    keywords: ["command", "palette", "search", "navigation"],
  },
  {
    keys: ["Escape"],
    description: "Close the active overlay or panel",
    category: "Navigation",
    keywords: ["close", "dismiss", "panel", "modal"],
  },
  {
    keys: ["Tab"],
    description: "Move focus to the next interactive control",
    category: "Navigation",
    keywords: ["focus", "tab", "next"],
  },
  {
    keys: ["mod", "Z"],
    description: "Undo the last editor change",
    category: "Editing",
    keywords: ["undo", "editor", "text"],
  },
  {
    keys: ["mod", "shift", "Z"],
    description: "Redo the last editor change",
    category: "Editing",
    keywords: ["redo", "editor", "text"],
  },
  {
    keys: ["shift", "Enter"],
    description: "Insert a soft line break while editing",
    category: "Editing",
    keywords: ["line break", "editor", "multiline"],
  },
  {
    keys: ["mod", "/"],
    description: "Show inline editor help or autocomplete hints",
    category: "Editing",
    keywords: ["autocomplete", "hints", "editor", "help"],
  },
  {
    keys: ["mod", "N"],
    description: "Start a new dataset workflow",
    category: "Data",
    keywords: ["dataset", "new", "import"],
  },
  {
    keys: ["mod", "Enter"],
    description: "Run the current SQL query",
    category: "Data",
    keywords: ["query", "run", "sql", "execute"],
  },
  {
    keys: ["mod", "shift", "E"],
    description: "Export the current data view",
    category: "Data",
    keywords: ["export", "csv", "json", "download"],
  },
  {
    keys: ["mod", ","],
    description: "Open workspace settings",
    category: "Data",
    keywords: ["settings", "preferences"],
  },
  {
    keys: ["shift", "1"],
    description: "Switch to a bar-oriented chart preset",
    category: "Charts",
    keywords: ["bar", "preset", "chart"],
  },
  {
    keys: ["shift", "2"],
    description: "Switch to a line or area chart preset",
    category: "Charts",
    keywords: ["line", "area", "preset", "chart"],
  },
  {
    keys: ["shift", "3"],
    description: "Switch to a scatter or correlation preset",
    category: "Charts",
    keywords: ["scatter", "correlation", "preset", "chart"],
  },
  {
    keys: ["shift", "4"],
    description: "Switch to a pie or donut preset",
    category: "Charts",
    keywords: ["pie", "donut", "preset", "chart"],
  },
] as const;

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function detectMacPlatform() {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

function getKeyLabel(key: string, isMac: boolean) {
  if (key === "mod") return isMac ? "Cmd" : "Ctrl";
  if (key === "shift") return "Shift";
  if (key === "Escape") return "Esc";
  if (key === "?") return "?";
  return key.length === 1 ? key.toUpperCase() : key;
}

function KeyCombo({
  keys,
  isMac,
}: {
  keys: string[];
  isMac: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {keys.map((key, index) => (
        <div key={`${key}-${index}`} className="flex items-center gap-1.5">
          {index > 0 ? (
            <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">+</span>
          ) : null}
          <kbd className="min-w-9 rounded-lg border border-white/60 bg-white/70 px-2.5 py-1.5 text-center text-xs font-semibold text-slate-700 shadow-sm backdrop-blur dark:border-slate-700/70 dark:bg-slate-950/70 dark:text-slate-200">
            {getKeyLabel(key, isMac)}
          </kbd>
        </div>
      ))}
    </div>
  );
}

export default function ShortcutOverlay() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isMac] = useState(() => detectMacPlatform());
  const deferredQuery = useDeferredValue(query);
  const searchInputRef = useRef<HTMLInputElement>(null);

  function closeOverlay() {
    setOpen(false);
    startTransition(() => setQuery(""));
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isQuestionMark =
        event.key === "?" ||
        (event.key === "/" && event.shiftKey && !event.metaKey && !event.ctrlKey);

      if (isQuestionMark && !event.altKey && !isEditableTarget(event.target)) {
        event.preventDefault();
        setOpen((current) => !current);
        startTransition(() => setQuery(""));
        return;
      }

      if (event.key === "Escape" && open) {
        event.preventDefault();
        closeOverlay();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    searchInputRef.current?.focus();
  }, [open]);

  const filteredShortcuts = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    if (!normalizedQuery) return SHORTCUTS;

    return SHORTCUTS.filter((shortcut) => {
      const haystack = [
        shortcut.description,
        shortcut.category,
        shortcut.keys.join(" "),
        shortcut.keywords.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [deferredQuery]);

  const groupedShortcuts = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        shortcuts: filteredShortcuts.filter((shortcut) => shortcut.category === section.title),
      })).filter((section) => section.shortcuts.length > 0),
    [filteredShortcuts],
  );

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.button
            type="button"
            aria-label="Close shortcut overlay"
            className="absolute inset-0 bg-slate-950/65 backdrop-blur-md"
            onClick={closeOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcut-overlay-title"
            className="relative w-full max-w-6xl overflow-hidden rounded-[30px] border border-white/20 bg-slate-950/72 shadow-[0_40px_140px_-56px_rgba(15,23,42,0.95)] backdrop-blur-3xl"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.24, ease: EASE }}
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/80 to-transparent" />
            <div className="absolute -left-20 top-0 h-56 w-56 rounded-full bg-cyan-400/15 blur-3xl" />
            <div className="absolute -right-24 bottom-0 h-64 w-64 rounded-full bg-indigo-500/15 blur-3xl" />

            <div className="relative border-b border-white/10 px-6 py-6 sm:px-8">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-3xl">
                  <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
                    <Keyboard className="h-3.5 w-3.5" />
                    Shortcut overlay
                  </div>
                  <h2
                    id="shortcut-overlay-title"
                    className="mt-4 text-3xl font-semibold tracking-tight text-white"
                  >
                    Keyboard reference for the DataLens workspace
                  </h2>
                  <p className="mt-2 text-sm leading-7 text-slate-300">
                    Toggle this panel with <span className="font-semibold text-white">?</span>,
                    search by command or key combo, and keep the correct modifier labels for{" "}
                    {isMac ? "macOS" : "Windows/Linux"}.
                  </p>
                </div>

                <div className="flex items-start gap-3">
                  <label className="relative block min-w-[16rem]">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      ref={searchInputRef}
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Filter shortcuts..."
                      className="w-full rounded-2xl border border-white/10 bg-white/8 py-3 pl-11 pr-4 text-sm text-white outline-none transition focus:border-cyan-400/40 focus:ring-4 focus:ring-cyan-500/10"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={closeOverlay}
                    className="rounded-2xl border border-white/10 bg-white/8 p-3 text-slate-300 transition hover:text-white"
                    aria-label="Close shortcut overlay"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.18em] text-slate-400">
                <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5">
                  {filteredShortcuts.length} shortcuts
                </span>
                <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5">
                  {groupedShortcuts.length} categories
                </span>
                <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5">
                  Press Esc to close
                </span>
              </div>
            </div>

            <div className="relative max-h-[70vh] overflow-y-auto px-6 py-6 sm:px-8">
              {groupedShortcuts.length === 0 ? (
                <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-[26px] border border-dashed border-white/10 bg-white/5 text-center text-slate-300">
                  <Search className="h-6 w-6 text-slate-500" />
                  <div className="space-y-1">
                    <p className="text-base font-semibold text-white">No shortcuts matched</p>
                    <p className="text-sm text-slate-400">
                      Try searching for &quot;export&quot;, &quot;query&quot;, &quot;chart&quot;, or &quot;settings&quot;.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid gap-5 lg:grid-cols-2">
                  {groupedShortcuts.map((section, index) => {
                    const Icon = section.icon;
                    return (
                      <motion.section
                        key={section.title}
                        className="rounded-[26px] border border-white/10 bg-white/6 p-5 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.85)] backdrop-blur-xl"
                        initial={{ opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.24, delay: index * 0.05, ease: EASE }}
                      >
                        <div className="flex items-start gap-3">
                          <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-500 text-white shadow-lg shadow-cyan-500/20">
                            <Icon className="h-4.5 w-4.5" />
                          </div>
                          <div>
                            <h3 className="text-base font-semibold text-white">{section.title}</h3>
                            <p className="mt-1 text-sm leading-6 text-slate-400">
                              {section.description}
                            </p>
                          </div>
                        </div>

                        <div className="mt-5 space-y-3">
                          {section.shortcuts.map((shortcut) => (
                            <div
                              key={`${shortcut.category}-${shortcut.description}`}
                              className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-white">
                                  {shortcut.description}
                                </p>
                                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                                  {shortcut.category}
                                </p>
                              </div>
                              <KeyCombo keys={shortcut.keys} isMac={isMac} />
                            </div>
                          ))}
                        </div>
                      </motion.section>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
