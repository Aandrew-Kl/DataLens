"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  FileDown,
  Moon,
  Settings,
  Trash2,
  Keyboard,
  ExternalLink,
  Search,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onAction: (action: string) => void;
}

interface Command {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  group: "Data" | "View" | "Help";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMMANDS: Command[] = [
  {
    id: "new-dataset",
    label: "New Dataset",
    icon: Plus,
    shortcut: "Ctrl+N",
    group: "Data",
  },
  {
    id: "export-csv",
    label: "Export as CSV",
    icon: FileDown,
    shortcut: "Ctrl+Shift+E",
    group: "Data",
  },
  {
    id: "export-json",
    label: "Export as JSON",
    icon: FileDown,
    group: "Data",
  },
  {
    id: "toggle-dark-mode",
    label: "Toggle Dark Mode",
    icon: Moon,
    shortcut: "Ctrl+D",
    group: "View",
  },
  {
    id: "open-settings",
    label: "Open Settings",
    icon: Settings,
    shortcut: "Ctrl+,",
    group: "View",
  },
  {
    id: "clear-query-history",
    label: "Clear Query History",
    icon: Trash2,
    group: "Data",
  },
  {
    id: "show-keyboard-shortcuts",
    label: "Show Keyboard Shortcuts",
    icon: Keyboard,
    shortcut: "Ctrl+/",
    group: "Help",
  },
  {
    id: "view-github",
    label: "View on GitHub",
    icon: ExternalLink,
    group: "Help",
  },
];

const GROUP_ORDER: Command["group"][] = ["Data", "View", "Help"];

const RECENT_KEY = "datalens-recent-commands";
const MAX_RECENT = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readRecentCommands(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as string[]).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function saveRecentCommand(id: string) {
  if (typeof window === "undefined") return;
  try {
    const current = readRecentCommands().filter((c) => c !== id);
    const next = [id, ...current].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage blocked or full
  }
}

/** Simple case-insensitive substring match. */
function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Direct substring
  if (t.includes(q)) return true;

  // Character-by-character fuzzy match
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CommandPalette({
  open,
  onClose,
  onAction,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state when dialog opens (React-recommended derived state pattern)
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setRecentIds(readRecentCommands());
    }
  }

  // Focus the input when opened
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  // Build the flat, filtered list of items to render
  const { flatItems, groupedSections } = useMemo(() => {
    const filtered = query
      ? COMMANDS.filter((cmd) => fuzzyMatch(query, cmd.label))
      : COMMANDS;

    // Group by section
    const sections: { group: string; items: Command[] }[] = [];
    for (const g of GROUP_ORDER) {
      const items = filtered.filter((c) => c.group === g);
      if (items.length > 0) sections.push({ group: g, items });
    }

    // Build a flat array for keyboard indexing (headers are not selectable)
    const flat: Command[] = [];
    for (const s of sections) {
      flat.push(...s.items);
    }

    return { flatItems: flat, groupedSections: sections };
  }, [query]);

  // Recent items that are not already in filtered results
  const recentItems = useMemo(() => {
    if (query) return []; // hide recent section when searching
    return recentIds
      .map((id) => COMMANDS.find((c) => c.id === id))
      .filter((c): c is Command => c !== undefined);
  }, [query, recentIds]);

  // All selectable items (recent + grouped)
  const allSelectableItems = useMemo(() => {
    return [...recentItems, ...flatItems];
  }, [recentItems, flatItems]);

  // Clamp selected index when list changes
  const clampedIndex = selectedIndex >= allSelectableItems.length
    ? Math.max(0, allSelectableItems.length - 1)
    : selectedIndex;
  if (clampedIndex !== selectedIndex) {
    setSelectedIndex(clampedIndex);
  }

  const executeCommand = useCallback(
    (cmd: Command) => {
      saveRecentCommand(cmd.id);
      onAction(cmd.id);
      onClose();
    },
    [onAction, onClose],
  );

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < allSelectableItems.length - 1 ? prev + 1 : 0,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : allSelectableItems.length - 1,
          );
          break;
        case "Enter": {
          e.preventDefault();
          const selected = allSelectableItems[selectedIndex];
          if (selected) executeCommand(selected);
          break;
        }
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, selectedIndex, allSelectableItems, executeCommand, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selectedEl = listRef.current.querySelector(
      `[data-index="${selectedIndex}"]`,
    );
    selectedEl?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Precompute a map from command id (with prefix) to its global index
  // so we don't need a mutable counter inside JSX.
  const indexMap = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const cmd of recentItems) {
      map.set(`recent-${cmd.id}`, idx++);
    }
    for (const cmd of flatItems) {
      map.set(cmd.id, idx++);
    }
    return map;
  }, [recentItems, flatItems]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Palette */}
          <motion.div
            className="relative w-full max-w-[500px] rounded-2xl border border-gray-200/50 dark:border-gray-700/50 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl shadow-2xl overflow-hidden"
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            {/* Search input */}
            <div className="flex items-center gap-2 px-4 border-b border-gray-100 dark:border-gray-800">
              <Search className="w-4 h-4 shrink-0 text-gray-400 dark:text-gray-500" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                placeholder="Type a command..."
                className="flex-1 bg-transparent py-3.5 text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 outline-none"
              />
              <kbd className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800">
                Esc
              </kbd>
            </div>

            {/* Results list */}
            <div
              ref={listRef}
              className="max-h-[360px] overflow-y-auto py-2"
            >
              {allSelectableItems.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                  No matching commands
                </p>
              ) : (
                <>
                  {/* Recent section */}
                  {recentItems.length > 0 && (
                    <div className="mb-1">
                      <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                        Recent
                      </p>
                      {recentItems.map((cmd) => {
                        const idx = indexMap.get(`recent-${cmd.id}`) ?? 0;
                        return (
                          <CommandItem
                            key={`recent-${cmd.id}`}
                            command={cmd}
                            selected={selectedIndex === idx}
                            dataIndex={idx}
                            onSelect={() => executeCommand(cmd)}
                            onHover={() => setSelectedIndex(idx)}
                          />
                        );
                      })}
                    </div>
                  )}

                  {/* Grouped sections */}
                  {groupedSections.map((section) => (
                    <div key={section.group} className="mb-1">
                      <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                        {section.group}
                      </p>
                      {section.items.map((cmd) => {
                        const idx = indexMap.get(cmd.id) ?? 0;
                        return (
                          <CommandItem
                            key={cmd.id}
                            command={cmd}
                            selected={selectedIndex === idx}
                            dataIndex={idx}
                            onSelect={() => executeCommand(cmd)}
                            onHover={() => setSelectedIndex(idx)}
                          />
                        );
                      })}
                    </div>
                  ))}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Sub-component
// ---------------------------------------------------------------------------

function CommandItem({
  command,
  selected,
  dataIndex,
  onSelect,
  onHover,
}: {
  command: Command;
  selected: boolean;
  dataIndex: number;
  onSelect: () => void;
  onHover: () => void;
}) {
  const Icon = command.icon;

  return (
    <button
      data-index={dataIndex}
      onClick={onSelect}
      onMouseEnter={onHover}
      className={`
        w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors duration-100
        ${
          selected
            ? "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
            : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60"
        }
      `}
    >
      <Icon
        className={`w-4 h-4 shrink-0 ${
          selected
            ? "text-purple-500 dark:text-purple-400"
            : "text-gray-400 dark:text-gray-500"
        }`}
      />
      <span className="flex-1 text-left">{command.label}</span>
      {command.shortcut && (
        <kbd
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
            selected
              ? "bg-purple-100 dark:bg-purple-800/40 text-purple-500 dark:text-purple-400"
              : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500"
          }`}
        >
          {command.shortcut}
        </kbd>
      )}
    </button>
  );
}
