"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bookmark,
  Filter,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import type { ColumnProfile } from "@/types/dataset";

interface DataBookmarkManagerProps {
  tableName: string;
  columns: ColumnProfile[];
}

type BookmarkOperator =
  | "="
  | "!="
  | "contains"
  | ">"
  | "<"
  | ">="
  | "<=";

interface BookmarkCriterion {
  id: string;
  column: string;
  operator: BookmarkOperator;
  value: string;
}

interface BookmarkEntry {
  id: string;
  name: string;
  criteria: BookmarkCriterion[];
  createdAt: number;
  updatedAt: number;
}

const GLASS_PANEL =
  "bg-white/75 backdrop-blur-2xl dark:bg-slate-950/45 border border-white/20";
const CARD_EASE = [0.22, 1, 0.36, 1] as const;
const OPERATORS: BookmarkOperator[] = [
  "=",
  "!=",
  "contains",
  ">",
  "<",
  ">=",
  "<=",
];

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function storageKey(tableName: string): string {
  return `datalens:bookmark-manager:${tableName}`;
}

function readBookmarks(tableName: string): BookmarkEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(storageKey(tableName));
    return raw ? (JSON.parse(raw) as BookmarkEntry[]) : [];
  } catch {
    return [];
  }
}

function createCriterion(columns: ColumnProfile[]): BookmarkCriterion {
  return {
    id: createId(),
    column: columns[0]?.name ?? "",
    operator: "=",
    value: "",
  };
}

function formatCriteria(criteria: BookmarkCriterion[]): string {
  if (criteria.length === 0) {
    return "No filter criteria saved.";
  }

  return criteria
    .map((criterion) => `${criterion.column} ${criterion.operator} ${criterion.value || "—"}`)
    .join(" • ");
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DataBookmarkManager({
  tableName,
  columns,
}: DataBookmarkManagerProps) {
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>(() =>
    readBookmarks(tableName),
  );
  const [name, setName] = useState("");
  const [criteria, setCriteria] = useState<BookmarkCriterion[]>(() => [
    createCriterion(columns),
  ]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeBookmarkId, setActiveBookmarkId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const activeBookmark = useMemo(
    () => bookmarks.find((bookmark) => bookmark.id === activeBookmarkId) ?? null,
    [activeBookmarkId, bookmarks],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(storageKey(tableName), JSON.stringify(bookmarks));
  }, [bookmarks, tableName]);

  function addCriterion() {
    setCriteria((current) => [...current, createCriterion(columns)]);
    setStatus(null);
  }

  function updateCriterion(
    criterionId: string,
    patch: Partial<BookmarkCriterion>,
  ) {
    setCriteria((current) =>
      current.map((criterion) =>
        criterion.id === criterionId ? { ...criterion, ...patch } : criterion,
      ),
    );
    setStatus(null);
  }

  function removeCriterion(criterionId: string) {
    setCriteria((current) =>
      current.length > 1
        ? current.filter((criterion) => criterion.id !== criterionId)
        : current,
    );
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setCriteria([createCriterion(columns)]);
  }

  function saveBookmark() {
    const trimmedName = name.trim();
    const filteredCriteria = criteria.filter(
      (criterion) => criterion.column.trim() && criterion.value.trim(),
    );

    if (!trimmedName) {
      setStatus("Bookmark name is required.");
      return;
    }

    if (filteredCriteria.length === 0) {
      setStatus("Add at least one completed filter criterion.");
      return;
    }

    const timestamp = Date.now();
    const nextEntry: BookmarkEntry = {
      id: editingId ?? createId(),
      name: trimmedName,
      criteria: filteredCriteria,
      createdAt:
        bookmarks.find((bookmark) => bookmark.id === editingId)?.createdAt ??
        timestamp,
      updatedAt: timestamp,
    };

    setBookmarks((current) => {
      if (editingId) {
        return current.map((bookmark) =>
          bookmark.id === editingId ? nextEntry : bookmark,
        );
      }

      return [nextEntry, ...current];
    });
    setActiveBookmarkId(nextEntry.id);
    setStatus(editingId ? "Bookmark updated." : "Bookmark saved.");
    resetForm();
  }

  function loadBookmark(bookmark: BookmarkEntry) {
    setActiveBookmarkId(bookmark.id);
    setName(bookmark.name);
    setCriteria(bookmark.criteria.map((criterion) => ({ ...criterion })));
    setStatus(`Loaded "${bookmark.name}" into the quick-load editor.`);
  }

  function editBookmark(bookmark: BookmarkEntry) {
    setEditingId(bookmark.id);
    setName(bookmark.name);
    setCriteria(bookmark.criteria.map((criterion) => ({ ...criterion })));
    setActiveBookmarkId(bookmark.id);
    setStatus(`Editing "${bookmark.name}".`);
  }

  function deleteBookmark(bookmarkId: string) {
    setBookmarks((current) =>
      current.filter((bookmark) => bookmark.id !== bookmarkId),
    );

    if (editingId === bookmarkId) {
      resetForm();
    }

    if (activeBookmarkId === bookmarkId) {
      setActiveBookmarkId(null);
    }

    setStatus("Bookmark deleted.");
  }

  return (
    <section className={`overflow-hidden rounded-[2rem] ${GLASS_PANEL}`}>
      <div className="border-b border-white/15 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700 dark:text-sky-300">
            <Bookmark className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
              Data bookmarks
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-slate-50">
              Bookmark filtered views for {tableName}
            </h2>
          </div>
        </div>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          Save interesting row subsets into localStorage, then quick-load, edit,
          or remove them from the glass card list.
        </p>
      </div>

      <div className="grid gap-5 px-5 py-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[1.75rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/35">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {editingId ? "Edit bookmark" : "Create bookmark"}
              </h3>
              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Current columns: {columns.length}
              </p>
            </div>
            <button
              type="button"
              onClick={addCriterion}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/70 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-white/90 dark:bg-slate-950/40 dark:text-slate-200"
            >
              <Plus className="h-4 w-4" />
              Add filter
            </button>
          </div>

          <label className="mt-4 block">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              Bookmark name
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Top-value customers"
              className="mt-2 w-full rounded-2xl border border-white/15 bg-white/70 px-4 py-3 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-sky-400 dark:bg-slate-950/55 dark:text-slate-50"
            />
          </label>

          <div className="mt-4 space-y-3">
            {criteria.map((criterion, index) => (
              <div
                key={criterion.id}
                className="grid gap-3 rounded-[1.5rem] border border-white/15 bg-white/55 p-3 dark:bg-slate-950/30 md:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)_auto]"
              >
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                    Column {index + 1}
                  </span>
                  <select
                    value={criterion.column}
                    onChange={(event) =>
                      updateCriterion(criterion.id, { column: event.target.value })
                    }
                    className="w-full rounded-2xl border border-white/15 bg-white/80 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/55 dark:text-slate-50"
                  >
                    {columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                    Operator
                  </span>
                  <select
                    value={criterion.operator}
                    onChange={(event) =>
                      updateCriterion(criterion.id, {
                        operator: event.target.value as BookmarkOperator,
                      })
                    }
                    className="w-full rounded-2xl border border-white/15 bg-white/80 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/55 dark:text-slate-50"
                  >
                    {OPERATORS.map((operator) => (
                      <option key={operator} value={operator}>
                        {operator}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                    Value
                  </span>
                  <input
                    value={criterion.value}
                    onChange={(event) =>
                      updateCriterion(criterion.id, { value: event.target.value })
                    }
                    placeholder="Example value"
                    className="w-full rounded-2xl border border-white/15 bg-white/80 px-4 py-3 text-sm text-slate-950 outline-none dark:bg-slate-950/55 dark:text-slate-50"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => removeCriterion(criterion.id)}
                  disabled={criteria.length === 1}
                  aria-label={`Remove filter ${index + 1}`}
                  className="self-end rounded-2xl border border-white/15 bg-white/70 p-3 text-slate-500 transition hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-950/40 dark:text-slate-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={saveBookmark}
              className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500"
            >
              <Save className="h-4 w-4" />
              {editingId ? "Update bookmark" : "Save bookmark"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-2xl border border-white/15 bg-white/70 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-white/90 dark:bg-slate-950/40 dark:text-slate-200"
            >
              Reset
            </button>
          </div>

          {status ? (
            <p className="mt-4 rounded-2xl bg-sky-500/10 px-4 py-3 text-sm text-sky-700 dark:text-sky-300">
              {status}
            </p>
          ) : null}
        </div>

        <div className="space-y-4">
          {activeBookmark ? (
            <div className="rounded-[1.75rem] border border-white/15 bg-white/45 p-4 dark:bg-slate-900/35">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Filter className="h-4 w-4 text-sky-600" />
                Quick-loaded view
              </div>
              <p className="mt-3 text-lg font-semibold text-slate-950 dark:text-slate-50">
                {activeBookmark.name}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {formatCriteria(activeBookmark.criteria)}
              </p>
            </div>
          ) : null}

          <AnimatePresence initial={false}>
            {bookmarks.length > 0 ? (
              bookmarks.map((bookmark) => (
                <motion.article
                  key={bookmark.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22, ease: CARD_EASE }}
                  className={`rounded-[1.75rem] border p-4 shadow-lg shadow-slate-950/8 ${
                    bookmark.id === activeBookmarkId
                      ? "border-sky-400/30 bg-sky-500/10"
                      : "border-white/15 bg-white/45 dark:bg-slate-900/35"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-950 dark:text-slate-50">
                        {bookmark.name}
                      </h3>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Updated {formatTimestamp(bookmark.updatedAt)}
                      </p>
                    </div>
                    <div className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-950/45 dark:text-slate-300">
                      {bookmark.criteria.length} filters
                    </div>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {formatCriteria(bookmark.criteria)}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => loadBookmark(bookmark)}
                      className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-500"
                    >
                      <Play className="h-4 w-4" />
                      Load
                    </button>
                    <button
                      type="button"
                      onClick={() => editBookmark(bookmark)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/70 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-white/90 dark:bg-slate-950/40 dark:text-slate-200"
                    >
                      <Pencil className="h-4 w-4" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteBookmark(bookmark.id)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-500/15 dark:text-rose-300"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
                </motion.article>
              ))
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-[1.75rem] border border-dashed border-white/20 bg-white/35 px-5 py-10 text-center text-sm text-slate-500 dark:bg-slate-950/20 dark:text-slate-400"
              >
                Save a bookmark to build your quick-load list.
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
