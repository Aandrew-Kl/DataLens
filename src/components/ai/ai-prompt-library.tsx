"use client";

import { startTransition, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Copy,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  ANALYTICS_EASE,
  BUTTON_CLASS,
  FIELD_CLASS,
  GLASS_CARD_CLASS,
  GLASS_PANEL_CLASS,
} from "@/lib/utils/advanced-analytics";
import { formatRelativeTime } from "@/lib/utils/formatters";
import type { ColumnProfile } from "@/types/dataset";

interface AIPromptLibraryProps {
  tableName: string;
  columns: ColumnProfile[];
}

type PromptCategory =
  | "exploration"
  | "cleaning"
  | "visualization"
  | "reporting";

interface PromptRecord {
  id: string;
  title: string;
  category: PromptCategory;
  prompt: string;
  createdAt: number;
  updatedAt: number;
}

interface PromptDraft {
  title: string;
  category: PromptCategory;
  prompt: string;
}

const PROMPT_STORAGE_KEY = "datalens:ai-prompt-library";
const PROMPT_CATEGORIES = [
  "exploration",
  "cleaning",
  "visualization",
  "reporting",
] as const;

function createPromptId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `prompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isPromptCategory(value: unknown): value is PromptCategory {
  return (
    typeof value === "string" &&
    PROMPT_CATEGORIES.includes(value as PromptCategory)
  );
}

function isPromptRecord(value: unknown): value is PromptRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    isPromptCategory(record.category) &&
    typeof record.prompt === "string" &&
    typeof record.createdAt === "number" &&
    typeof record.updatedAt === "number"
  );
}

function createStarterPrompts(tableName: string, columns: ColumnProfile[]) {
  const numericColumn =
    columns.find((column) => column.type === "number")?.name ?? "metric";
  const categoryColumn =
    columns.find(
      (column) => column.type === "string" || column.type === "date",
    )?.name ?? "dimension";
  const now = Date.now();

  return [
    {
      id: "starter-exploration",
      title: "Initial exploration scan",
      category: "exploration" as const,
      prompt: `Profile the ${tableName} dataset, summarize data quality risks, and highlight surprising distributions for ${numericColumn} and ${categoryColumn}.`,
      createdAt: now - 1000 * 60 * 60 * 8,
      updatedAt: now - 1000 * 60 * 60 * 3,
    },
    {
      id: "starter-cleaning",
      title: "Cleaning checklist",
      category: "cleaning" as const,
      prompt: `Suggest a step-by-step cleaning plan for ${tableName}, focusing on null handling, type normalization, and duplicate detection.`,
      createdAt: now - 1000 * 60 * 60 * 16,
      updatedAt: now - 1000 * 60 * 60 * 12,
    },
  ] satisfies PromptRecord[];
}

function readStoredPrompts(
  tableName: string,
  columns: ColumnProfile[],
): PromptRecord[] {
  if (typeof window === "undefined") {
    return createStarterPrompts(tableName, columns);
  }

  const storedValue = window.localStorage.getItem(PROMPT_STORAGE_KEY);

  if (!storedValue) {
    return createStarterPrompts(tableName, columns);
  }

  try {
    const parsed = JSON.parse(storedValue);
    if (!Array.isArray(parsed)) {
      return createStarterPrompts(tableName, columns);
    }

    const prompts = parsed.filter(isPromptRecord);
    return prompts.length > 0
      ? prompts.sort((left, right) => right.updatedAt - left.updatedAt)
      : createStarterPrompts(tableName, columns);
  } catch {
    return createStarterPrompts(tableName, columns);
  }
}

function persistPrompts(prompts: PromptRecord[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PROMPT_STORAGE_KEY, JSON.stringify(prompts));
}

function buildBlankDraft(): PromptDraft {
  return {
    title: "",
    category: "exploration",
    prompt: "",
  };
}

function matchesFilters(
  prompt: PromptRecord,
  searchTerm: string,
  category: PromptCategory | "all",
) {
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const matchesCategory = category === "all" || prompt.category === category;

  if (!matchesCategory) {
    return false;
  }

  if (!normalizedSearch) {
    return true;
  }

  return (
    prompt.title.toLowerCase().includes(normalizedSearch) ||
    prompt.prompt.toLowerCase().includes(normalizedSearch)
  );
}

async function copyPromptToClipboard(prompt: string) {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof navigator.clipboard.writeText !== "function"
  ) {
    return false;
  }

  await navigator.clipboard.writeText(prompt);
  return true;
}

export default function AIPromptLibrary({
  tableName,
  columns,
}: AIPromptLibraryProps) {
  const [prompts, setPrompts] = useState(() =>
    readStoredPrompts(tableName, columns),
  );
  const [draft, setDraft] = useState<PromptDraft>(buildBlankDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<PromptCategory | "all">(
    "all",
  );
  const [status, setStatus] = useState(
    "Save reusable prompts for recurring analysis workflows.",
  );

  const filteredPrompts = useMemo(
    () =>
      prompts.filter((prompt) =>
        matchesFilters(prompt, searchTerm, categoryFilter),
      ),
    [categoryFilter, prompts, searchTerm],
  );

  function commitPrompts(nextPrompts: PromptRecord[], nextStatus: string) {
    const sortedPrompts = [...nextPrompts].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );

    persistPrompts(sortedPrompts);
    startTransition(() => {
      setPrompts(sortedPrompts);
      setStatus(nextStatus);
    });
  }

  function handleSavePrompt() {
    if (!draft.title.trim() || !draft.prompt.trim()) {
      setStatus("Title and prompt content are required.");
      return;
    }

    const now = Date.now();
    const nextRecord: PromptRecord = {
      id: editingId ?? createPromptId(),
      title: draft.title.trim(),
      category: draft.category,
      prompt: draft.prompt.trim(),
      createdAt:
        prompts.find((prompt) => prompt.id === editingId)?.createdAt ?? now,
      updatedAt: now,
    };
    const remainingPrompts = prompts.filter((prompt) => prompt.id !== editingId);

    commitPrompts(
      [nextRecord, ...remainingPrompts],
      editingId ? "Prompt updated." : "Prompt saved.",
    );
    setEditingId(null);
    setDraft(buildBlankDraft());
  }

  function handleEditPrompt(prompt: PromptRecord) {
    setEditingId(prompt.id);
    setDraft({
      title: prompt.title,
      category: prompt.category,
      prompt: prompt.prompt,
    });
    setStatus(`Editing "${prompt.title}".`);
  }

  function handleDeletePrompt(promptId: string) {
    const remainingPrompts = prompts.filter((prompt) => prompt.id !== promptId);
    commitPrompts(remainingPrompts, "Prompt deleted.");

    if (editingId === promptId) {
      setEditingId(null);
      setDraft(buildBlankDraft());
    }
  }

  async function handleCopyPrompt(prompt: PromptRecord) {
    const copied = await copyPromptToClipboard(prompt.prompt);
    setStatus(copied ? `Copied "${prompt.title}" to the clipboard.` : "Clipboard access is unavailable.");
  }

  function handleResetForm() {
    setEditingId(null);
    setDraft(buildBlankDraft());
    setStatus("Prompt editor reset.");
  }

  return (
    <motion.section
      className={`${GLASS_PANEL_CLASS} space-y-6 p-6`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, ease: ANALYTICS_EASE }}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-fuchsia-500/10 p-3 text-fuchsia-600 dark:text-fuchsia-300">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-950 dark:text-white">
                AI prompt library
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Keep reusable prompts close to {tableName} and its {columns.length} profiled columns.
              </p>
            </div>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">{status}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className={`${FIELD_CLASS} pl-11`}
              placeholder="Search prompts"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.currentTarget.value)}
            />
          </label>
          <select
            className={FIELD_CLASS}
            value={categoryFilter}
            onChange={(event) =>
              setCategoryFilter(event.currentTarget.value as PromptCategory | "all")
            }
          >
            <option value="all">All categories</option>
            {PROMPT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,22rem)_1fr]">
        <div className={`${GLASS_CARD_CLASS} space-y-4 p-5`}>
          <div>
            <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
              {editingId ? "Edit prompt" : "Save prompt"}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Build reusable instructions for exploration, cleanup, visualization, and reporting.
            </p>
          </div>

          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Title
            </span>
            <input
              className={FIELD_CLASS}
              value={draft.title}
              onChange={(event) => {
                const nextTitle = event.currentTarget.value;
                setDraft((current) => ({
                  ...current,
                  title: nextTitle,
                }));
              }}
              placeholder="Prompt name"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Category
            </span>
            <select
              className={FIELD_CLASS}
              value={draft.category}
              onChange={(event) => {
                const nextCategory = event.currentTarget.value as PromptCategory;
                setDraft((current) => ({
                  ...current,
                  category: nextCategory,
                }));
              }}
            >
              {PROMPT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Prompt
            </span>
            <textarea
              className={`${FIELD_CLASS} min-h-[13rem] resize-none`}
              value={draft.prompt}
              onChange={(event) => {
                const nextPrompt = event.currentTarget.value;
                setDraft((current) => ({
                  ...current,
                  prompt: nextPrompt,
                }));
              }}
              placeholder="Describe the exact analysis task you want the assistant to perform."
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={BUTTON_CLASS}
              onClick={handleSavePrompt}
            >
              <Plus className="h-4 w-4" />
              {editingId ? "Update prompt" : "Save prompt"}
            </button>
            <button
              type="button"
              className={BUTTON_CLASS}
              onClick={handleResetForm}
            >
              Reset
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {filteredPrompts.length > 0 ? (
            filteredPrompts.map((prompt) => (
              <article
                key={prompt.id}
                className={`${GLASS_CARD_CLASS} flex h-full flex-col gap-4 p-5`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <span className="rounded-full border border-white/15 bg-white/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:bg-slate-950/25 dark:text-slate-300">
                      {prompt.category}
                    </span>
                    <h3 className="text-lg font-semibold text-slate-950 dark:text-white">
                      {prompt.title}
                    </h3>
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {formatRelativeTime(prompt.updatedAt)}
                  </span>
                </div>

                <p className="line-clamp-6 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {prompt.prompt}
                </p>

                <div className="mt-auto flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={BUTTON_CLASS}
                    onClick={() => void handleCopyPrompt(prompt)}
                  >
                    <Copy className="h-4 w-4" />
                    Copy
                  </button>
                  <button
                    type="button"
                    className={BUTTON_CLASS}
                    onClick={() => handleEditPrompt(prompt)}
                  >
                    <Pencil className="h-4 w-4" />
                    Edit
                  </button>
                  <button
                    type="button"
                    className={BUTTON_CLASS}
                    onClick={() => handleDeletePrompt(prompt.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className={`${GLASS_CARD_CLASS} col-span-full p-8 text-center`}>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No prompts match the current search and category filters.
              </p>
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}
