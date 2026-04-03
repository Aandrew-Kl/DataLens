"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  ChartColumn,
  Database,
  FileText,
  Pencil,
  Search,
  Upload,
} from "lucide-react";

export type CommandCategory = "File" | "Edit" | "View" | "Data" | "Chart" | "Export";

export interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  description?: string;
  keywords?: string[];
  shortcut?: string;
  icon?: ComponentType<{ className?: string }>;
}

interface CommandBarProps {
  commands: Command[];
  onExecute: (command: Command) => void;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const RECENT_KEY = "datalens:command-bar:recent";
const MAX_RECENT = 6;
const CATEGORY_ORDER: CommandCategory[] = ["File", "Edit", "View", "Data", "Chart", "Export"];

const DEFAULT_ICONS: Record<CommandCategory, typeof FileText> = {
  File: FileText,
  Edit: Pencil,
  View: Search,
  Data: Database,
  Chart: ChartColumn,
  Export: Upload,
};

function readRecentIds() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function saveRecentId(id: string) {
  if (typeof window === "undefined") {
    return;
  }

  const next = [id, ...readRecentIds().filter((entry) => entry !== id)].slice(0, MAX_RECENT);
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

function fuzzyScore(query: string, command: Command) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return 0;
  }

  const tokens = [
    command.label,
    command.category,
    command.description ?? "",
    ...(command.keywords ?? []),
  ].join(" ").toLowerCase();

  if (tokens.includes(normalizedQuery)) {
    return Math.max(1, 260 - normalizedQuery.length * 3);
  }

  let score = 0;
  let queryIndex = 0;
  for (let index = 0; index < tokens.length && queryIndex < normalizedQuery.length; index += 1) {
    if (tokens[index] === normalizedQuery[queryIndex]) {
      score += 8;
      queryIndex += 1;
    }
  }

  return queryIndex === normalizedQuery.length ? score : -1;
}

function buildSections(
  commands: Command[],
  recentIds: string[],
  query: string,
) {
  const ranked = commands
    .map((command) => ({ command, score: fuzzyScore(query, command) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      return left.command.label.localeCompare(right.command.label);
    });

  const rankedIds = new Set(ranked.map((entry) => entry.command.id));
  const recent = query.trim()
    ? []
    : recentIds
        .map((id) => commands.find((command) => command.id === id))
        .filter((command): command is Command => Boolean(command))
        .filter((command) => rankedIds.has(command.id));

  const recentIdSet = new Set(recent.map((command) => command.id));
  const sections = CATEGORY_ORDER.map((category) => ({
    category,
    commands: ranked
      .map((entry) => entry.command)
      .filter((command) => command.category === category && !recentIdSet.has(command.id)),
  })).filter((section) => section.commands.length > 0);

  return { recent, sections };
}

function CommandRow({
  command,
  active,
  onHover,
  onRun,
}: {
  command: Command;
  active: boolean;
  onHover: () => void;
  onRun: () => void;
}) {
  const Icon = command.icon ?? DEFAULT_ICONS[command.category];

  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onClick={onRun}
      className={`flex w-full items-center justify-between gap-4 rounded-[1.1rem] border px-4 py-3 text-left transition ${
        active
          ? "border-cyan-400/45 bg-cyan-500/14 text-slate-950 dark:text-white"
          : "border-transparent bg-white/0 text-slate-700 hover:border-white/12 hover:bg-white/10 dark:text-slate-200 dark:hover:bg-white/5"
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="rounded-2xl border border-white/12 bg-white/12 p-2.5 dark:bg-white/5">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{command.label}</div>
          <div className="truncate text-xs text-slate-500 dark:text-slate-400">
            {command.description ?? command.category}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {command.shortcut ? (
          <span className="rounded-full border border-white/12 bg-white/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">
            {command.shortcut}
          </span>
        ) : null}
        <ArrowRight className="h-4 w-4 text-slate-400" />
      </div>
    </button>
  );
}

export default function CommandBar({ commands, onExecute }: CommandBarProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);

  const { recent, sections } = useMemo(
    () => buildSections(commands, recentIds, deferredQuery),
    [commands, deferredQuery, recentIds],
  );
  const orderedCommands = useMemo(
    () => [...recent, ...sections.flatMap((section) => section.commands)],
    [recent, sections],
  );

  function openBar() {
    startTransition(() => {
      setRecentIds(readRecentIds());
      setQuery("");
      setSelectedIndex(0);
      setOpen(true);
    });
  }

  function closeBar() {
    startTransition(() => {
      setOpen(false);
      setQuery("");
      setSelectedIndex(0);
    });
  }

  function executeCommand(command: Command) {
    saveRecentId(command.id);
    startTransition(() => {
      setRecentIds(readRecentIds());
      setOpen(false);
      setQuery("");
      setSelectedIndex(0);
    });
    onExecute(command);
  }

  const handleWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const typingTarget = event.target instanceof HTMLElement
      ? event.target.closest("input, textarea, select, [contenteditable='true']")
      : null;

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (!open) {
        openBar();
      } else {
        closeBar();
      }
      return;
    }

    if (!open) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeBar();
      return;
    }

    if (typingTarget) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      startTransition(() => {
        setSelectedIndex((current) =>
          orderedCommands.length === 0 ? 0 : (current + 1) % orderedCommands.length,
        );
      });
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      startTransition(() => {
        setSelectedIndex((current) =>
          orderedCommands.length === 0
            ? 0
            : (current - 1 + orderedCommands.length) % orderedCommands.length,
        );
      });
    }

    if (event.key === "Enter" && orderedCommands[selectedIndex]) {
      event.preventDefault();
      executeCommand(orderedCommands[selectedIndex]);
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={openBar}
        className="inline-flex items-center gap-3 rounded-full border border-white/15 bg-white/55 px-4 py-2.5 text-sm text-slate-600 shadow-[0_12px_32px_-24px_rgba(15,23,42,0.85)] backdrop-blur-xl transition hover:border-cyan-300/30 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-200"
      >
        <Search className="h-4 w-4 text-cyan-500" />
        <span>Command bar</span>
        <span className="rounded-full border border-white/12 bg-white/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">
          Cmd+K
        </span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/45 px-4 py-20 backdrop-blur-md"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeBar();
              }
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.99 }}
              transition={{ duration: 0.24, ease: EASE }}
              className="w-full max-w-3xl overflow-hidden rounded-[2rem] border border-white/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(248,250,252,0.58))] shadow-[0_32px_120px_-42px_rgba(15,23,42,0.85)] backdrop-blur-2xl dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(2,6,23,0.9),rgba(15,23,42,0.78))]"
            >
              <div className="border-b border-white/10 px-5 py-4">
                <div className="flex items-center gap-3 rounded-[1.2rem] border border-white/12 bg-white/20 px-4 py-3 dark:bg-white/5">
                  <Search className="h-5 w-5 text-cyan-500" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(event) => {
                      startTransition(() => {
                        setQuery(event.target.value);
                        setSelectedIndex(0);
                      });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        startTransition(() => {
                          setSelectedIndex((current) =>
                            orderedCommands.length === 0 ? 0 : (current + 1) % orderedCommands.length,
                          );
                        });
                      }

                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        startTransition(() => {
                          setSelectedIndex((current) =>
                            orderedCommands.length === 0
                              ? 0
                              : (current - 1 + orderedCommands.length) % orderedCommands.length,
                          );
                        });
                      }

                      if (event.key === "Enter" && orderedCommands[selectedIndex]) {
                        event.preventDefault();
                        executeCommand(orderedCommands[selectedIndex]);
                      }
                    }}
                    className="min-w-0 flex-1 bg-transparent text-base text-slate-950 outline-none placeholder:text-slate-500 dark:text-white dark:placeholder:text-slate-400"
                    placeholder="Search commands, actions, datasets, charts..."
                  />
                  <span className="rounded-full border border-white/12 bg-white/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">
                    Esc
                  </span>
                </div>
              </div>

              <div className="max-h-[32rem] overflow-y-auto px-4 py-4">
                {orderedCommands.length === 0 ? (
                  <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
                    <Search className="h-8 w-8 text-slate-400" />
                    <div className="space-y-1">
                      <p className="text-base font-semibold text-slate-950 dark:text-white">
                        No commands match “{deferredQuery}”
                      </p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Try a broader term or search by category, keyword, or shortcut.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {recent.length > 0 ? (
                      <div className="space-y-2">
                        <div className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                          Recent
                        </div>
                        <div className="space-y-1">
                          {recent.map((command, index) => (
                            <CommandRow
                              key={command.id}
                              command={command}
                              active={selectedIndex === index}
                              onHover={() => setSelectedIndex(index)}
                              onRun={() => executeCommand(command)}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {sections.map((section) => {
                      const offset = recent.length + sections
                        .filter((candidate) => CATEGORY_ORDER.indexOf(candidate.category) < CATEGORY_ORDER.indexOf(section.category))
                        .reduce((sum, candidate) => sum + candidate.commands.length, 0);

                      return (
                        <div key={section.category} className="space-y-2">
                          <div className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                            {section.category}
                          </div>
                          <div className="space-y-1">
                            {section.commands.map((command, index) => (
                              <CommandRow
                                key={command.id}
                                command={command}
                                active={selectedIndex === offset + index}
                                onHover={() => setSelectedIndex(offset + index)}
                                onRun={() => executeCommand(command)}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
